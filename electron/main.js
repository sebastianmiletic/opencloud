const { app, BrowserWindow, shell } = require('electron');
const { spawn, execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const APP_DIR = path.resolve(__dirname, '..');
const PORT_FILE = path.join(APP_DIR, 'server_port.txt');
const PID_FILE = path.join(APP_DIR, 'server_pid.txt');

/* Hosts the Electron app is allowed to open (everything else = deny) */
const ALLOWED_HOSTS = new Set([
  'localhost', '127.0.0.1',
  'vidsrc.cc', 'player.videasy.net', 'vidsrc.me', 'vidsrc.to',
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
let serverProcess = null;

/* ── 0. Kill any stale server.py from a previous session ── */
function killStaleServer() {
  // 1. Kill the PID recorded in server_pid.txt
  try {
    const oldPid = parseInt(fs.readFileSync(PID_FILE, 'utf8').trim(), 10);
    if (oldPid) {
      try { process.kill(oldPid, 'SIGTERM'); } catch (e) {}
      // Force-kill after 500ms if still alive
      setTimeout(() => { try { process.kill(oldPid, 'SIGKILL'); } catch (e) {} }, 500);
    }
  } catch (e) {}

  // 2. Kill any process still listening on port 8765
  try {
    if (process.platform === 'win32') {
      const out = execSync('netstat -ano | findstr ":8765" | findstr "LISTENING"', { encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'] });
      const pids = [...new Set(out.trim().split('\n').map(l => l.trim().split(/\s+/).pop()))];
      pids.forEach(pid => { if (pid) { try { execSync(`taskkill /PID ${pid} /F`, { stdio: 'ignore' }); } catch (e) {} } });
    } else {
      const out = execSync('lsof -t -i :8765 2>/dev/null', { encoding: 'utf8' });
      out.trim().split('\n').forEach(pid => {
        if (pid) { try { execSync(`kill -9 ${pid}`, { stdio: 'ignore' }); } catch (e) {} }
      });
    }
  } catch (e) {}
}

/* ── 1. Start Python server ── */
function startServer() {
  return new Promise((resolve, reject) => {
    killStaleServer();
    try { fs.unlinkSync(PORT_FILE); } catch (e) {}

    const pythonCmd = process.platform === 'win32' ? 'python' : 'python3';
    serverProcess = spawn(pythonCmd, ['server.py'], {
      cwd: APP_DIR,
      stdio: ['ignore', 'pipe', 'pipe']
    });

    // Record PID so the next launch can kill us if we become stale
    try { fs.writeFileSync(PID_FILE, String(serverProcess.pid)); } catch (e) {}

    serverProcess.stdout.on('data', (data) => {
      console.log('[Server]', data.toString().trim());
    });
    serverProcess.stderr.on('data', (data) => {
      console.error('[Server ERR]', data.toString().trim());
    });

    let attempts = 0;
    const interval = setInterval(() => {
      attempts++;
      if (fs.existsSync(PORT_FILE)) {
        const port = fs.readFileSync(PORT_FILE, 'utf8').trim();
        if (port) { clearInterval(interval); resolve(port); return; }
      }
      if (!serverProcess || serverProcess.killed) {
        clearInterval(interval); reject(new Error('Server exited')); return;
      }
      if (attempts > 240) {
        clearInterval(interval); reject(new Error('Timed out waiting for server')); return;
      }
    }, 250);
  });
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
  const url = 'http://localhost:' + port;

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
    const port = await startServer();
    createMainWindow(port);
  } catch (err) {
    console.error('Failed to start:', err.message);
    app.quit();
  }
});

app.on('window-all-closed', () => {
  if (serverProcess && !serverProcess.killed) serverProcess.kill('SIGTERM');
  try { fs.unlinkSync(PID_FILE); } catch (e) {}
  app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    try {
      const port = fs.readFileSync(PORT_FILE, 'utf8').trim();
      if (port) createMainWindow(port);
    } catch (e) { app.quit(); }
  }
});
