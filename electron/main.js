const { app, BrowserWindow, shell } = require('electron');
const path = require('path');
const net = require('net');
const { spawn } = require('child_process');

const DEV_URL = process.env.ELECTRON_DEV_URL || 'http://127.0.0.1:3000';
/** Production server port (avoid clashing with `next dev` on 3000). */
const PROD_PORT = 3050;

/** Dev: next dev is started by npm script; Electron only loads the URL. */
const isDevOnly =
  process.env.ELECTRON_DEV === '1' || process.env.ELECTRON_DEV === 'true';

let mainWindow = null;
let serverProcess = null;

function isPackaged() {
  return app.isPackaged;
}

function standaloneRoot() {
  if (isPackaged()) {
    return path.join(process.resourcesPath, 'standalone');
  }
  return path.join(__dirname, '..', '.next', 'standalone');
}

function waitForPort(port, host = '127.0.0.1', timeoutMs = 60000) {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const tryConnect = () => {
      const socket = net.createConnection({ port, host }, () => {
        socket.end();
        resolve();
      });
      socket.on('error', () => {
        socket.destroy();
        if (Date.now() - start > timeoutMs) {
          reject(new Error(`Timeout waiting for port ${port}`));
        } else {
          setTimeout(tryConnect, 200);
        }
      });
    };
    tryConnect();
  });
}

function startNextStandalone() {
  const root = standaloneRoot();
  const serverJs = path.join(root, 'server.js');
  const fs = require('fs');
  if (!fs.existsSync(serverJs)) {
    return Promise.reject(
      new Error(
        `Missing server at ${serverJs}. Run \`npm run build\` (copies static assets into standalone).`
      )
    );
  }

  const env = {
    ...process.env,
    NODE_ENV: 'production',
    PORT: String(PROD_PORT),
    HOSTNAME: '127.0.0.1',
    ELECTRON_RUN_AS_NODE: '1',
  };

  serverProcess = spawn(process.execPath, ['server.js'], {
    cwd: root,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  serverProcess.on('error', (err) => {
    console.error('[electron] next server failed to spawn', err);
  });

  serverProcess.on('exit', (code, signal) => {
    if (code !== 0 && code !== null) {
      console.error('[electron] next server exited', code, signal);
    }
  });

  return waitForPort(PROD_PORT).then(() => `http://127.0.0.1:${PROD_PORT}`);
}

function stopNextStandalone() {
  if (serverProcess && !serverProcess.killed) {
    serverProcess.kill('SIGTERM');
    serverProcess = null;
  }
}

function createWindow(loadUrl) {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 840,
    minWidth: 640,
    minHeight: 480,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  mainWindow.once('ready-to-show', () => {
    mainWindow.maximize();
    mainWindow.show();
  });

  mainWindow.loadURL(loadUrl);

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  app.whenReady().then(async () => {
    try {
      let url;
      if (isDevOnly) {
        url = DEV_URL;
      } else {
        url = await startNextStandalone();
      }
      createWindow(url);
    } catch (e) {
      console.error(e);
      const { dialog } = require('electron');
      dialog.showErrorBox(
        'JSON Workspace',
        e instanceof Error ? e.message : String(e)
      );
      app.quit();
    }
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
      app.quit();
    }
  });

  app.on('before-quit', () => {
    stopNextStandalone();
  });

  app.on('activate', async () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      try {
        let url = isDevOnly ? DEV_URL : `http://127.0.0.1:${PROD_PORT}`;
        if (!isDevOnly && !serverProcess) {
          url = await startNextStandalone();
        }
        createWindow(url);
      } catch (e) {
        console.error(e);
      }
    }
  });
}
