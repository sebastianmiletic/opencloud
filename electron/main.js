const { app, BrowserWindow, ipcMain, shell } = require('electron');
const fs = require('fs/promises');
const path = require('path');
const { createOpenCloudServer } = require('./server');

const APP_DIR = app.getAppPath();
const LOCAL_HOST = '127.0.0.1';
const LOCAL_PORT = Number(process.env.OPENCLOUD_ELECTRON_PORT || 38475);

/* Hosts the Electron app is allowed to open (everything else = deny) */
const ALLOWED_HOSTS = new Set([
  'localhost', '127.0.0.1',
  'vidsrc.cc', 'player.videasy.net', 'vsembed.ru', 'cloudorchestranova.com', 'vidsrc.me', 'vidsrc.to',
  'moviesapi.club', 'vidsrc.su', 'vidlink.pro',
  'image.tmdb.org', 'www.themoviedb.org', 'api.themoviedb.org', 'www.omdbapi.com',
]);

function shouldAllowUrl(urlStr) {
  try {
    const hostname = new URL(urlStr).hostname;
    if (hostname === 'localhost' || hostname === '127.0.0.1') return true;
    if (ALLOWED_HOSTS.has(hostname)) return true;
    return false;
  } catch {
    return false;
  }
}

let mainWindow = null;
let localServer = null;
let localServerPort = null;

function registerDesktopBridge() {
  ipcMain.handle('opencloud:export-migration', async (_event, payload) => {
    if (!payload || payload.version !== 1 || typeof payload.storage !== 'object') {
      throw new Error('Invalid Open Cloud migration payload');
    }
    const safeStorage = {};
    for (const [key, value] of Object.entries(payload.storage)) {
      if (typeof key !== 'string' || typeof value !== 'string') continue;
      if (key === 'oc_is_admin' || key.startsWith('sb-')) continue;
      safeStorage[key.slice(0, 256)] = value;
    }
    const migration = {
      version: 1,
      exportedAt: new Date().toISOString(),
      storage: safeStorage
    };
    const destination = path.join(app.getPath('userData'), 'tauri-migration-v1.json');
    const temporary = `${destination}.tmp`;
    const serialized = JSON.stringify(migration, null, 2);
    if (Buffer.byteLength(serialized, 'utf8') > 15 * 1024 * 1024) {
      throw new Error('Migration payload is larger than 15 MB');
    }
    await fs.mkdir(path.dirname(destination), { recursive: true });
    await fs.writeFile(temporary, serialized, { encoding: 'utf8', mode: 0o600 });
    await fs.rename(temporary, destination);
    return { path: destination };
  });

  ipcMain.handle('opencloud:open-external', async (_event, url) => {
    const parsed = new URL(String(url));
    if (parsed.protocol !== 'https:' || !['www.themoviedb.org', 'github.com'].includes(parsed.hostname)) {
      throw new Error('External URL is outside the Open Cloud allowlist');
    }
    await shell.openExternal(parsed.toString());
  });
}

/* ── 1. Start Node.js HTTP server (in-process, no external Python) ── */
async function startServer() {
  const server = createOpenCloudServer({ baseDir: APP_DIR, host: LOCAL_HOST, port: LOCAL_PORT });
  const started = await server.listen();
  localServer = started;
  localServerPort = started.port;
  return started.port;
}

/* ── 2. Renderer-side injection ── */
function injectBlocker(win) {
  if (!win || win.isDestroyed()) return;
  win.webContents.executeJavaScript(`
    (function() {
      if (window.__electronBlockerInstalled) return;
      window.__electronBlockerInstalled = true;
      const _origOpen = window.open;
      window.open = function(url, target) {
        if (target === '_blank' || target === '_new' || target === 'popup' || !target) {
          console.log('[RendererBlocker] BLOCKED window.open:', url);
          return null;
        }
        return _origOpen.apply(window, arguments);
      };
      window.addEventListener('beforeunload', function(e) {
        e.preventDefault(); e.returnValue = '';
      });
    })();
  `).catch(() => {});
}

/* ── 3. Create main window ── */
function createMainWindow(port) {
  const url = `http://${LOCAL_HOST}:${port}`;

  mainWindow = new BrowserWindow({
    width: 1480, height: 920, minWidth: 1024, minHeight: 640,
    title: 'Open Cloud', backgroundColor: '#000000',
    icon: path.join(APP_DIR, process.platform === 'win32' ? 'icon.ico' : (process.platform === 'darwin' ? 'icon.icns' : 'icon.png')),
    webPreferences: {
      nodeIntegration: false, contextIsolation: true,
      preload: path.join(__dirname, 'preload.js'),
      webSecurity: true, allowRunningInsecureContent: false
    },
    show: false
  });

  /* 1️⃣  Block popups / new windows */
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (shouldAllowUrl(url)) return { action: 'allow' };
    console.log('[ElectronBlocker] BLOCKED popup:', url);
    return { action: 'deny' };
  });

  /* 2️⃣  Block top-level navigation to untrusted hosts */
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (!shouldAllowUrl(url)) {
      console.log('[ElectronBlocker] BLOCKED navigation:', url);
      event.preventDefault();
      shell.openExternal(url).catch(() => {});
    }
  });

  /* 3️⃣  Block iframe redirects to untrusted hosts */
  mainWindow.webContents.on('will-frame-navigate', (details) => {
    if (details.frame === mainWindow.webContents.mainFrame) return;
    if (!shouldAllowUrl(details.url)) {
      console.log('[ElectronBlocker] BLOCKED iframe nav:', details.url);
      details.preventDefault();
    }
  });

  /* 4️⃣  Block beforeunload traps */
  mainWindow.webContents.on('will-prevent-unload', (event) => {
    event.preventDefault();
    console.log('[ElectronBlocker] BLOCKED beforeunload trap');
  });

  /* 5️⃣  Inject JS-level protections on every dom-ready */
  mainWindow.webContents.on('dom-ready', () => injectBlocker(mainWindow));

  mainWindow.loadURL(url);

  mainWindow.once('ready-to-show', () => { mainWindow.show(); mainWindow.focus(); });
  mainWindow.on('closed', () => { mainWindow = null; });
}

/* ── 4. App lifecycle ── */
app.whenReady().then(async () => {
  try {
    registerDesktopBridge();
    const port = await startServer();
    createMainWindow(port);
  } catch (err) {
    console.error('Failed to start:', err.message);
    app.quit();
  }
});

app.on('window-all-closed', () => {
  app.quit();
});

app.on('before-quit', async () => {
  if (localServer) {
    try {
      await localServer.close();
    } catch (error) {
      console.error('Failed to stop local server:', error.message);
    }
    localServer = null;
    localServerPort = null;
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    if (localServerPort) createMainWindow(localServerPort);
  }
});
