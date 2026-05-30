const { app, BrowserWindow, shell, ipcMain } = require('electron');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const APP_DIR = path.resolve(__dirname, '..');
const PORT_FILE = path.join(APP_DIR, 'server_port.txt');

let mainWindow = null;
let serverProcess = null;

/* ── 1. Start Python server ── */
function startServer() {
  return new Promise((resolve, reject) => {
    // If port file already exists, kill stale server first
    try { fs.unlinkSync(PORT_FILE); } catch (e) {}

    const pythonCmd = process.platform === 'win32' ? 'python' : 'python3';
    serverProcess = spawn(pythonCmd, ['server.py'], {
      cwd: APP_DIR,
      stdio: ['ignore', 'pipe', 'pipe']
    });

    serverProcess.stdout.on('data', (data) => {
      console.log('[Server]', data.toString().trim());
    });
    serverProcess.stderr.on('data', (data) => {
      console.error('[Server ERR]', data.toString().trim());
    });

    // Wait for port file
    let attempts = 0;
    const interval = setInterval(() => {
      attempts++;
      if (fs.existsSync(PORT_FILE)) {
        const port = fs.readFileSync(PORT_FILE, 'utf8').trim();
        if (port) {
          clearInterval(interval);
          console.log(`✅ Server ready on port ${port}`);
          resolve(port);
          return;
        }
      }
      if (!serverProcess || serverProcess.killed) {
        clearInterval(interval);
        reject(new Error('Server process exited before writing port'));
        return;
      }
      if (attempts > 240) {
        clearInterval(interval);
        reject(new Error('Timed out waiting for server port'));
      }
    }, 250);
  });
}

/* ── 2. Create main window ── */
function createMainWindow(port) {
  const url = `http://localhost:${port}`;

  mainWindow = new BrowserWindow({
    width: 1480,
    height: 920,
    minWidth: 1024,
    minHeight: 640,
    title: 'Open Cloud',
    backgroundColor: '#000000',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js'),
      webSecurity: true,
      allowRunningInsecureContent: false
    },
    show: false
  });

  // Inject blocker before page loads
  mainWindow.webContents.on('dom-ready', () => {
    mainWindow.webContents.executeJavaScript(`
      (function() {
        const orig = window.open;
        window.open = function(...args) {
          console.log('[ElectronBlocker] BLOCKED window.open:', args);
          return null;
        };
      })();
    `).catch(() => {});
  });

  // Block ANY new window/tab/popup from the main content
  mainWindow.webContents.setWindowOpenHandler(({ url, frameName, features }) => {
    const hostname = (() => { try { return new URL(url).hostname; } catch { return ''; } })();
    // Allow internal navigation within the same origin
    if (hostname === 'localhost') {
      return { action: 'allow' };
    }
    console.log(`[ElectronBlocker] BLOCKED popup: ${url}`);
    return { action: 'deny' };
  });

  // Catch beforeunload traps
  mainWindow.webContents.on('will-prevent-unload', (event) => {
    event.preventDefault();
    console.log('[ElectronBlocker] BLOCKED beforeunload trap');
  });

  // If a navigation tries to open a new window, block it
  mainWindow.webContents.on('new-window', (event, url) => {
    event.preventDefault();
    console.log(`[ElectronBlocker] BLOCKED new-window: ${url}`);
  });

  // Block external protocol handlers
  mainWindow.webContents.on('will-navigate', (event, url) => {
    const parsed = new URL(url);
    if (parsed.hostname !== 'localhost') {
      console.log(`[ElectronBlocker] BLOCKED navigation to external host: ${url}`);
      event.preventDefault();
      shell.openExternal(url).catch(() => {});
    }
  });

  mainWindow.loadURL(url);

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
    mainWindow.focus();
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

/* ── 3. App lifecycle ── */
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
  if (serverProcess && !serverProcess.killed) {
    serverProcess.kill('SIGTERM');
  }
  // macOS stays alive even with no windows, but we want clean exit
  app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    // Re-read port and recreate
    try {
      const port = fs.readFileSync(PORT_FILE, 'utf8').trim();
      if (port) createMainWindow(port);
    } catch (e) {
      app.quit();
    }
  }
});

// Block ALL app-level new window requests from any webContents
app.on('web-contents-created', (event, wc) => {
  wc.setWindowOpenHandler(({ url }) => {
    console.log(`[ElectronBlocker] BLOCKED from webContents: ${url}`);
    return { action: 'deny' };
  });
});
