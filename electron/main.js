const { app, BrowserWindow, shell, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');
const net = require('net');
const { spawn, execSync } = require('child_process');

/**
 * Production: Next.js standalone runs **in the Electron main process** (one OS process).
 * If that fails, we fall back to a child process (two processes — e.g. real `node` or
 * Electron with ELECTRON_RUN_AS_NODE).
 */

const DEV_URL = process.env.ELECTRON_DEV_URL || 'http://127.0.0.1:3000';
const PROD_PORT = 3050;

const isDevOnly =
  process.env.ELECTRON_DEV === '1' || process.env.ELECTRON_DEV === 'true';

/** True when Next was started via require() in this process (no child). */
let embeddedNextRunning = false;

let mainWindow = null;
let serverProcess = null;
let isShuttingDown = false;

function isPackaged() {
  return app.isPackaged;
}

function standaloneRoot() {
  if (isPackaged()) {
    return path.join(process.resourcesPath, 'standalone');
  }
  return path.join(__dirname, '..', '.next', 'standalone');
}

function resolveNodeBinary() {
  if (process.env.NODE_BINARY) {
    const p = process.env.NODE_BINARY;
    if (fs.existsSync(p)) return p;
  }
  try {
    const cmd =
      process.platform === 'win32' ? 'where.exe node' : 'command -v node';
    const out = execSync(cmd, {
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();
    const first = out.split(/\r?\n/).find((line) => line.trim());
    if (first && fs.existsSync(first)) return first;
  } catch {
    /* no node on PATH */
  }
  return null;
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

/**
 * Run Next standalone inside this process so Task Manager shows a single app.
 */
async function startNextStandaloneEmbedded() {
  const root = standaloneRoot();
  const serverJs = path.join(root, 'server.js');
  if (!fs.existsSync(serverJs)) {
    throw new Error(
      `Missing server at ${serverJs}. Run \`npm run build\` (copies static assets into standalone).`
    );
  }

  process.env.NEXT_MANUAL_SIG_HANDLE = '1';
  process.env.NODE_ENV = 'production';
  process.env.PORT = String(PROD_PORT);
  process.env.HOSTNAME = '127.0.0.1';

  const prevCwd = process.cwd();
  const origExit = process.exit.bind(process);
  /** Map exit(1) from Next startup failures to a thrown error (async catch paths). */
  process.exit = (code) => {
    if (code === 1) {
      throw new Error('Next.js server failed to start');
    }
    return origExit(code);
  };

  try {
    process.chdir(root);
    delete require.cache[require.resolve(serverJs)];
    require(serverJs);
  } catch (e) {
    process.chdir(prevCwd);
    process.exit = origExit;
    throw e;
  }

  try {
    await waitForPort(PROD_PORT);
  } catch (e) {
    process.chdir(prevCwd);
    process.exit = origExit;
    throw e;
  }

  embeddedNextRunning = true;
  try {
    process.title = app.getName() || 'Watchfox';
  } catch {
    process.title = 'Watchfox';
  }

  return `http://127.0.0.1:${PROD_PORT}`;
}

function startNextStandaloneChild() {
  const root = standaloneRoot();
  const serverJs = path.join(root, 'server.js');
  if (!fs.existsSync(serverJs)) {
    return Promise.reject(
      new Error(
        `Missing server at ${serverJs}. Run \`npm run build\` (copies static assets into standalone).`
      )
    );
  }

  const nodeBin = resolveNodeBinary();
  const env = {
    ...process.env,
    NODE_ENV: 'production',
    PORT: String(PROD_PORT),
    HOSTNAME: '127.0.0.1',
  };
  if (!nodeBin) {
    env.ELECTRON_RUN_AS_NODE = '1';
  }

  const command = nodeBin || process.execPath;
  serverProcess = spawn(command, ['server.js'], {
    cwd: root,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
    argv0: `${app.getName() || 'Watchfox'} (server)`,
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

async function startNextStandalone() {
  if (process.env.ELECTRON_NEXT_CHILD_ONLY === '1') {
    return startNextStandaloneChild();
  }
  try {
    return await startNextStandaloneEmbedded();
  } catch (e) {
    console.error(
      '[electron] embedded Next server failed; using child process',
      e
    );
    return startNextStandaloneChild();
  }
}

function stopNextStandalone() {
  if (serverProcess && !serverProcess.killed) {
    serverProcess.kill('SIGTERM');
    serverProcess = null;
  }
}

function safeStopServer() {
  try {
    stopNextStandalone();
  } catch (e) {
    console.error('[electron] error while stopping server', e);
  }
}

function quitGracefully(title, err) {
  if (isShuttingDown) return;
  isShuttingDown = true;

  const detail =
    err instanceof Error ? err.message : err != null ? String(err) : '';
  console.error(`[electron] ${title}`, err ?? detail);

  safeStopServer();

  try {
    const { dialog } = require('electron');
    if (app.isReady() && detail) {
      dialog.showErrorBox(title, detail);
    }
  } catch (dialogErr) {
    console.error('[electron] could not show error dialog', dialogErr);
  }

  try {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.destroy();
    }
    mainWindow = null;
  } catch (e) {
    console.error('[electron] error destroying window', e);
  }

  try {
    app.quit();
  } catch (e) {
    console.error('[electron] app.quit failed', e);
    process.exit(1);
  }
}

ipcMain.handle('launch-chrome-debug', () => {
  spawn(
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    ['--remote-debugging-port=9222', '--user-data-dir=/tmp/chrome-debug'],
    { detached: true, stdio: 'ignore' }
  ).unref();
});

function createWindow(loadUrl) {
  try {
    mainWindow = new BrowserWindow({
      width: 1280,
      height: 840,
      minWidth: 640,
      minHeight: 480,
      show: false,
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: false,
        preload: path.join(__dirname, 'preload.js'),
      },
    });

    mainWindow.once('ready-to-show', () => {
      try {
        mainWindow.maximize();
        mainWindow.show();
      } catch (e) {
        quitGracefully('Watchfox', e);
      }
    });

    mainWindow.webContents.setWindowOpenHandler(({ url }) => {
      shell.openExternal(url);
      return { action: 'deny' };
    });

    mainWindow.on('closed', () => {
      mainWindow = null;
    });

    mainWindow.loadURL(loadUrl).catch((loadErr) => {
      quitGracefully('Failed to load app', loadErr);
    });
  } catch (e) {
    quitGracefully('Could not create window', e);
  }
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  process.on('uncaughtException', (error) => {
    quitGracefully('Unexpected error', error);
  });

  process.on('unhandledRejection', (reason) => {
    console.error('[electron] unhandledRejection', reason);
  });

  app.on('second-instance', () => {
    try {
      if (mainWindow) {
        if (mainWindow.isMinimized()) mainWindow.restore();
        mainWindow.focus();
      }
    } catch (e) {
      console.error('[electron] second-instance', e);
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
      quitGracefully('Watchfox', e);
    }
  });

  app.on('window-all-closed', () => {
    try {
      if (process.platform !== 'darwin') {
        app.quit();
      }
    } catch (e) {
      console.error('[electron] window-all-closed', e);
      process.exit(1);
    }
  });

  app.on('before-quit', () => {
    try {
      safeStopServer();
    } catch (e) {
      console.error('[electron] before-quit', e);
    }
  });

  app.on('activate', async () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      try {
        let url = isDevOnly ? DEV_URL : `http://127.0.0.1:${PROD_PORT}`;
        if (
          !isDevOnly &&
          !embeddedNextRunning &&
          !serverProcess
        ) {
          url = await startNextStandalone();
        }
        createWindow(url);
      } catch (e) {
        quitGracefully('Watchfox', e);
      }
    }
  });
}
