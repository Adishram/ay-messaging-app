const { app, BrowserWindow, ipcMain, Notification, desktopCapturer, session, shell, safeStorage } = require('electron');
const path = require('path');

let mainWindow;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1100,
    height: 750,
    minWidth: 900,
    minHeight: 600,
    titleBarStyle: 'hiddenInset',
    vibrancy: 'under-window',
    visualEffectState: 'active',
    backgroundColor: '#00000000',
    trafficLightPosition: { x: 16, y: 16 },
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      webSecurity: true,
      allowRunningInsecureContent: false,
      experimentalFeatures: false,
    },
    show: false,
  });

  // ── CSP Header ──────────────────────────────────────────────────
  mainWindow.webContents.session.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [
          "default-src 'self';" +
          " script-src 'self';" +
          " style-src 'self' 'unsafe-inline' https://fonts.googleapis.com;" +
          " font-src https://fonts.gstatic.com;" +
          " connect-src * data: blob: 'unsafe-inline';" +
          " img-src 'self' https: data: blob:;" +
          " media-src 'self' blob:;"
        ],
      },
    });
  });

  // ── Block navigation to external URLs ──────────────────────────
  mainWindow.webContents.on('will-navigate', (event, url) => {
    try {
      const parsedUrl = new URL(url);
      if (parsedUrl.protocol !== 'file:') {
        event.preventDefault();
        console.warn(`[Security] Blocked navigation to: ${url}`);
      }
    } catch (e) {
      event.preventDefault();
      console.warn(`[Security] Blocked navigation to invalid URL: ${url}`);
    }
  });

  // ── Block opening new windows ──────────────────────────────────
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    console.warn(`[Security] Blocked new window: ${url}`);
    return { action: 'deny' };
  });

  // ── Prevent webview creation ───────────────────────────────────
  mainWindow.webContents.on('will-attach-webview', (event) => {
    event.preventDefault();
    console.warn('[Security] Blocked webview creation');
  });

  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));

  mainWindow.webContents.on('console-message', (event, level, message, line, sourceId) => {
    console.log(`[Renderer]: ${message}`);
  });

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.whenReady().then(async () => {
  // ── Permission Handling ─────────────────────────────────────────
  session.defaultSession.setPermissionRequestHandler((webContents, permission, callback) => {
    const allowedPermissions = ['media', 'mediaKeySystem', 'display-capture'];
    if (allowedPermissions.includes(permission)) {
      callback(true);
    } else {
      console.warn(`[Security] Denied permission: ${permission}`);
      callback(false);
    }
  });

  session.defaultSession.setPermissionCheckHandler((webContents, permission) => {
    const allowedPermissions = ['media', 'mediaKeySystem', 'display-capture'];
    return allowedPermissions.includes(permission);
  });

  // ── Handle screen share (desktopCapturer) ───────────────────────
  session.defaultSession.setDisplayMediaRequestHandler((request, callback) => {
    desktopCapturer.getSources({ types: ['screen', 'window'] }).then((sources) => {
      if (sources.length > 0) {
        callback({ video: sources[0], audio: 'loopback' });
      } else {
        callback({});
      }
    }).catch((err) => {
      console.warn('[DesktopCapturer] Failed to get sources:', err.message);
      callback({});
    });
  });

  createWindow();
});

app.on('window-all-closed', () => {
  app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

// ── IPC Handlers ──────────────────────────────────────────────────

ipcMain.handle('show-notification', (event, { title, body }) => {
  const safeTitle = String(title).substring(0, 100);
  const safeBody = String(body).substring(0, 200);
  new Notification({ title: safeTitle, body: safeBody }).show();
});

ipcMain.handle('get-signaling-port', () => 3001);

ipcMain.handle('get-desktop-sources', async () => {
  try {
    const sources = await desktopCapturer.getSources({
      types: ['screen', 'window'],
      thumbnailSize: { width: 150, height: 150 },
    });
    return sources.map((s) => ({
      id: s.id,
      name: s.name,
      thumbnail: s.thumbnail.toDataURL(),
    }));
  } catch (err) {
    console.warn('[DesktopCapturer] Failed to get sources:', err.message);
    return [];
  }
});

// Open external URLs safely (P3 #9)
ipcMain.handle('open-external', (event, url) => {
  // Only allow http/https URLs
  try {
    const parsed = new URL(url);
    if (parsed.protocol === 'https:' || parsed.protocol === 'http:') {
      shell.openExternal(url);
    }
  } catch (e) {
    console.warn('[Security] Blocked openExternal for invalid URL:', url);
  }
});
