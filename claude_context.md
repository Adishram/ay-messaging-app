# A&Y App Codebase Context

## File: package.json
```json
{
  "name": "ay-facetime",
  "version": "1.0.0",
  "description": "FaceTime-like video calling & messaging app for macOS",
  "main": "src/main.js",
  "scripts": {
    "start": "electron .",
    "make": "electron-forge make",
    "dist": "electron-builder --mac",
    "dist:win": "electron-builder --win"
  },
  "build": {
    "appId": "com.adishram.aymessaging",
    "productName": "A&Y",
    "files": [
      "src/**/*",
      "package.json",
      "assets/**/*",
      "!dist",
      "!website",
      "!out"
    ],
    "mac": {
      "category": "public.app-category.social-networking",
      "target": [
        "zip",
        "dmg"
      ],
      "identity": null
    },
    "win": {
      "target": "nsis",
      "icon": "build/icon.png"
    },
    "nsis": {
      "oneClick": false,
      "perMachine": false,
      "allowToChangeInstallationDirectory": true
    }
  },
  "keywords": [
    "electron",
    "video-call",
    "messaging",
    "webrtc",
    "appwrite"
  ],
  "author": "A&Y",
  "license": "MIT",
  "devDependencies": {
    "@electron-forge/cli": "^7.6.0",
    "@electron-forge/maker-dmg": "^7.6.0",
    "@electron-forge/maker-zip": "^7.6.0",
    "electron": "^33.0.0",
    "electron-builder": "^26.8.1"
  },
  "dependencies": {
    "b4a": "^1.6.6",
    "hypercore-crypto": "^3.4.2",
    "hyperswarm": "^4.17.0",
    "simple-peer": "^9.11.1"
  }
}```

## File: src/main.js
```javascript
const { app, BrowserWindow, ipcMain, Notification, desktopCapturer, session, shell, safeStorage } = require('electron');
const path = require('path');
const SwarmManager = require('./swarm');

let mainWindow;

// Handle --user-data-dir flag for running multiple instances
const userDataDirArg = process.argv.find(arg => arg.startsWith('--user-data-dir='));
if (userDataDirArg) {
  const dir = userDataDirArg.split('=')[1];
  app.setPath('userData', path.resolve(dir));
}

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
          " connect-src 'self' data: blob:;" +
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

  // Initialize SwarmManager with this window
  SwarmManager.init(mainWindow);

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
    const allowedPermissions = ['media', 'mediaKeySystem', 'display-capture', 'clipboard-sanitized-write'];
    if (allowedPermissions.includes(permission)) {
      callback(true);
    } else {
      console.warn(`[Security] Denied permission: ${permission}`);
      callback(false);
    }
  });

  session.defaultSession.setPermissionCheckHandler((webContents, permission) => {
    const allowedPermissions = ['media', 'mediaKeySystem', 'display-capture', 'clipboard-sanitized-write'];
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
  SwarmManager.teardown();
  app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

// ── IPC Handlers ──────────────────────────────────────────────────

// Notifications
ipcMain.handle('show-notification', (event, { title, body }) => {
  const safeTitle = String(title).substring(0, 100);
  const safeBody = String(body).substring(0, 200);
  new Notification({ title: safeTitle, body: safeBody }).show();
});

// Desktop sources for screen sharing
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

// Open external URLs safely
ipcMain.handle('open-external', (event, url) => {
  try {
    const parsed = new URL(url);
    if (parsed.protocol === 'https:' || parsed.protocol === 'http:') {
      shell.openExternal(url);
    }
  } catch (e) {
    console.warn('[Security] Blocked openExternal for invalid URL:', url);
  }
});

// ── Hyperswarm IPC Handlers ──────────────────────────────────────

// Initialize swarm with seed, returns public key hex
ipcMain.handle('swarm-init', async (event, seedArray) => {
  try {
    const pubKeyHex = await SwarmManager.startSwarm(seedArray);
    return pubKeyHex;
  } catch (err) {
    console.error('[IPC] swarm-init failed:', err);
    throw err;
  }
});

// Connect to a peer by their public key hex
ipcMain.handle('swarm-connect-peer', async (event, remotePubKeyHex) => {
  try {
    return await SwarmManager.connectToPeer(remotePubKeyHex);
  } catch (err) {
    console.error('[IPC] swarm-connect-peer failed:', err);
    return false;
  }
});

// Send a message to a peer
ipcMain.handle('swarm-send', (event, { to, message }) => {
  return SwarmManager.sendToPeer(to, message);
});

// Check if a peer is connected
ipcMain.handle('swarm-is-connected', (event, remotePubKeyHex) => {
  return SwarmManager.isPeerConnected(remotePubKeyHex);
});

// Get list of online peers
ipcMain.handle('swarm-get-online-peers', () => {
  return SwarmManager.getOnlinePeers();
});

// Get own public key
ipcMain.handle('swarm-get-pubkey', () => {
  return SwarmManager.getPublicKeyHex();
});

// Teardown swarm
ipcMain.handle('swarm-teardown', async () => {
  await SwarmManager.teardown();
});

// ── Safe Storage (for mnemonic encryption) ──────────────────────

ipcMain.handle('safe-storage-encrypt', (event, data) => {
  if (safeStorage.isEncryptionAvailable()) {
    const encrypted = safeStorage.encryptString(data);
    return encrypted.toString('base64');
  }
  return null;
});

ipcMain.handle('safe-storage-decrypt', (event, encryptedB64) => {
  if (safeStorage.isEncryptionAvailable()) {
    const buffer = Buffer.from(encryptedB64, 'base64');
    return safeStorage.decryptString(buffer);
  }
  return null;
});
```

## File: src/preload.js
```javascript
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
    // ── Notifications ────────────────────────────────────────────
    showNotification: (title, body) =>
        ipcRenderer.invoke('show-notification', { title, body }),

    // ── Desktop Sources (screen share) ───────────────────────────
    getDesktopSources: () => ipcRenderer.invoke('get-desktop-sources'),

    // ── External URLs ────────────────────────────────────────────
    openExternal: (url) => ipcRenderer.invoke('open-external', url),

    // ── Safe Storage (mnemonic encryption) ───────────────────────
    safeStorageEncrypt: (data) => ipcRenderer.invoke('safe-storage-encrypt', data),
    safeStorageDecrypt: (data) => ipcRenderer.invoke('safe-storage-decrypt', data),

    // ── Hyperswarm P2P ───────────────────────────────────────────
    swarmInit: (seedArray) => ipcRenderer.invoke('swarm-init', seedArray),
    swarmConnectPeer: (pubKeyHex) => ipcRenderer.invoke('swarm-connect-peer', pubKeyHex),
    swarmSend: (to, message) => ipcRenderer.invoke('swarm-send', { to, message }),
    swarmIsConnected: (pubKeyHex) => ipcRenderer.invoke('swarm-is-connected', pubKeyHex),
    swarmGetOnlinePeers: () => ipcRenderer.invoke('swarm-get-online-peers'),
    swarmGetPubKey: () => ipcRenderer.invoke('swarm-get-pubkey'),
    swarmTeardown: () => ipcRenderer.invoke('swarm-teardown'),

    // ── Swarm Events (main → renderer) ───────────────────────────
    onSwarmMessage: (callback) => {
        ipcRenderer.on('swarm-message', (event, data) => callback(data));
    },
    onSwarmPeerConnected: (callback) => {
        ipcRenderer.on('swarm-peer-connected', (event, data) => callback(data));
    },
    onSwarmPeerDisconnected: (callback) => {
        ipcRenderer.on('swarm-peer-disconnected', (event, data) => callback(data));
    },
    onSwarmOnlinePeers: (callback) => {
        ipcRenderer.on('swarm-online-peers', (event, peers) => callback(peers));
    },
});
```

## File: src/swarm.js
```javascript
// swarm.js — Hyperswarm P2P networking (runs in main process)
// Handles: DHT discovery, peer connections, message relay to renderer

const Hyperswarm = require('hyperswarm');
const b4a = require('b4a');
const crypto = require('crypto');

let swarm = null;
let mainWindow = null;
let myPublicKeyHex = null;

// Track connections: pubKeyHex → socket
const connections = new Map();
// Track connected peer public keys
const onlinePeers = new Set();
// Buffer incoming data per peer (for JSON message framing)
const peerBuffers = new Map();

// ── Initialize ──────────────────────────────────────────────────────

function init(window) {
  mainWindow = window;
}

async function startSwarm(seedArray) {
  // If already running, tear down first
  if (swarm) {
    await teardown();
  }

  const seed = Buffer.from(seedArray);
  
  swarm = new Hyperswarm({ seed });
  myPublicKeyHex = b4a.toString(swarm.keyPair.publicKey, 'hex');

  console.log('[Swarm] Started with pubkey:', myPublicKeyHex.slice(0, 16) + '...');

  // Listen on a local port and announce our public key to the DHT
  // This is REQUIRED for joinPeer() to work over the internet!
  await swarm.listen();

  // Announce ourselves on a topic derived from our public key
  // so that contacts who know our pubkey can find us
  const selfTopic = crypto.createHash('sha256')
    .update(swarm.keyPair.publicKey)
    .digest();
  
  swarm.join(selfTopic, { server: true, client: false });
  swarm.flush().catch(err => console.error('DHT flush error:', err));

  // Handle incoming connections
  swarm.on('connection', (socket, peerInfo) => {
    const remotePubKeyHex = b4a.toString(peerInfo.publicKey, 'hex');
    console.log('[Swarm] Connected to peer:', remotePubKeyHex.slice(0, 16) + '...');

    // Store connection
    connections.set(remotePubKeyHex, socket);
    onlinePeers.add(remotePubKeyHex);
    peerBuffers.set(remotePubKeyHex, '');

    // Notify renderer
    sendToRenderer('swarm-peer-connected', { pubKeyHex: remotePubKeyHex });
    sendToRenderer('swarm-online-peers', Array.from(onlinePeers));

    // Handle incoming data
    socket.on('data', (data) => {
      handleIncomingData(remotePubKeyHex, data);
    });

    socket.on('error', (err) => {
      console.error('[Swarm] Peer error:', remotePubKeyHex.slice(0, 16), err.message);
    });

    socket.on('close', () => {
      console.log('[Swarm] Peer disconnected:', remotePubKeyHex.slice(0, 16) + '...');
      connections.delete(remotePubKeyHex);
      onlinePeers.delete(remotePubKeyHex);
      peerBuffers.delete(remotePubKeyHex);
      sendToRenderer('swarm-peer-disconnected', { pubKeyHex: remotePubKeyHex });
      sendToRenderer('swarm-online-peers', Array.from(onlinePeers));
    });
  });

  swarm.on('update', () => {
    // Connection state changed
    sendToRenderer('swarm-online-peers', Array.from(onlinePeers));
  });

  return myPublicKeyHex;
}

// ── Connect to a peer ────────────────────────────────────────────────

async function connectToPeer(remotePubKeyHex) {
  if (!swarm) throw new Error('Swarm not initialized');
  if (connections.has(remotePubKeyHex)) {
    console.log('[Swarm] Already connected to', remotePubKeyHex.slice(0, 16));
    return true;
  }

  const remotePubKey = b4a.from(remotePubKeyHex, 'hex');

  // Join the topic derived from the remote peer's public key
  // This lets the DHT find them
  const peerTopic = crypto.createHash('sha256')
    .update(remotePubKey)
    .digest();

  swarm.join(peerTopic, { server: false, client: true });

  // Also try direct peer connection
  swarm.joinPeer(remotePubKey);

  console.log('[Swarm] Looking for peer:', remotePubKeyHex.slice(0, 16) + '...');
  
  // Wait for the DHT lookup to complete so that over the internet, 
  // it has enough time to find the peer and punch holes before returning
  await swarm.flush();
  
  return true;
}

async function disconnectPeer(remotePubKeyHex) {
  const remotePubKey = b4a.from(remotePubKeyHex, 'hex');
  swarm.leavePeer(remotePubKey);
  
  const socket = connections.get(remotePubKeyHex);
  if (socket) {
    socket.destroy();
    connections.delete(remotePubKeyHex);
    onlinePeers.delete(remotePubKeyHex);
  }
}

// ── Send data to a peer ──────────────────────────────────────────────

function sendToPeer(remotePubKeyHex, message) {
  const socket = connections.get(remotePubKeyHex);
  if (!socket || socket.destroyed) {
    console.warn('[Swarm] No connection to', remotePubKeyHex.slice(0, 16));
    return false;
  }

  try {
    // Send JSON + newline delimiter
    const data = JSON.stringify(message) + '\n';
    socket.write(data);
    return true;
  } catch (err) {
    console.error('[Swarm] Send failed:', err.message);
    return false;
  }
}

// ── Handle incoming data ─────────────────────────────────────────────

function handleIncomingData(remotePubKeyHex, rawData) {
  // Data comes as Buffer, might be partial or multiple messages
  const dataStr = rawData.toString('utf-8');
  let buffer = (peerBuffers.get(remotePubKeyHex) || '') + dataStr;

  // Split by newline delimiter
  const lines = buffer.split('\n');
  // Last element might be incomplete — keep it in buffer
  peerBuffers.set(remotePubKeyHex, lines.pop());

  for (const line of lines) {
    if (!line.trim()) continue;
    try {
      const msg = JSON.parse(line);
      // Forward to renderer
      sendToRenderer('swarm-message', {
        from: remotePubKeyHex,
        message: msg,
      });
    } catch (err) {
      console.error('[Swarm] Failed to parse message from', remotePubKeyHex.slice(0, 16), err.message);
    }
  }
}

// ── Helpers ──────────────────────────────────────────────────────────

function sendToRenderer(channel, data) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, data);
  }
}

function isPeerConnected(remotePubKeyHex) {
  const socket = connections.get(remotePubKeyHex);
  return socket && !socket.destroyed;
}

function getOnlinePeers() {
  return Array.from(onlinePeers);
}

function getPublicKeyHex() {
  return myPublicKeyHex;
}

async function teardown() {
  if (swarm) {
    for (const [key, socket] of connections) {
      try { socket.destroy(); } catch (_) {}
    }
    connections.clear();
    onlinePeers.clear();
    peerBuffers.clear();
    
    await swarm.destroy();
    swarm = null;
    myPublicKeyHex = null;
    console.log('[Swarm] Torn down');
  }
}

module.exports = {
  init,
  startSwarm,
  connectToPeer,
  disconnectPeer,
  sendToPeer,
  isPeerConnected,
  getOnlinePeers,
  getPublicKeyHex,
  teardown,
};
```

## File: src/renderer/index.html
```html
<!DOCTYPE html>
<html lang="en">

<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>A&Y — Serverless P2P Messaging</title>
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&display=swap" rel="stylesheet" />
  <!-- SimplePeer for video calls only -->
  <script src="vendor/simplepeer.min.js"></script>
  <link rel="stylesheet" href="styles.css" />
</head>

<body>
  <!-- Draggable titlebar area for macOS -->
  <div class="titlebar-drag-region"></div>

  <!-- App container -->
  <div id="app">
    <!-- Auth View (Create / Restore) -->
    <div id="view-auth" class="view active">
      <div class="auth-container">
        <div class="auth-logo">
          <div class="logo-icon">
            <svg viewBox="0 0 80 80" fill="none" xmlns="http://www.w3.org/2000/svg">
              <rect rx="18" width="80" height="80" fill="#D1C4E9" />
              <rect x="16" y="28" width="30" height="24" rx="5" fill="white" />
              <polygon points="50,32 64,24 64,56 50,48" fill="white" />
            </svg>
          </div>
          <h1>A&Y</h1>
          <p class="auth-subtitle">Serverless P2P Messaging</p>
        </div>

        <div class="auth-card glass-card">
          <!-- Tab switcher -->
          <div class="auth-tabs">
            <button class="auth-tab active" data-tab="create">Create Account</button>
            <button class="auth-tab" data-tab="restore">Restore Account</button>
          </div>

          <!-- Create Account Panel -->
          <div id="auth-create-panel">
            <form id="form-create" class="auth-form">
              <div class="input-group">
                <label for="create-name">Display Name</label>
                <input type="text" id="create-name" placeholder="Your name" required />
              </div>
              <button type="submit" class="btn-primary" id="btn-create" style="margin-top: 16px;">
                <span>Create Account</span>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <path d="M5 12h14M12 5l7 7-7 7" />
                </svg>
              </button>
              <p id="create-error" class="auth-error"></p>
            </form>
          </div>

          <!-- Restore Account Panel -->
          <div id="auth-restore-panel" class="hidden">
            <form id="form-restore" class="auth-form">
              <div class="input-group">
                <label for="restore-words">Recovery Phrase (8 words)</label>
                <textarea id="restore-words" rows="3" placeholder="Enter your 8 recovery words separated by spaces..." required></textarea>
              </div>
              <div class="input-group">
                <label for="restore-name">Display Name</label>
                <input type="text" id="restore-name" placeholder="Your name" required />
              </div>
              <button type="submit" class="btn-primary" id="btn-restore" style="margin-top: 16px;">
                <span>Restore Account</span>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <path d="M5 12h14M12 5l7 7-7 7" />
                </svg>
              </button>
              <p id="restore-error" class="auth-error"></p>
            </form>
          </div>

          <!-- Mnemonic Display Step (shown after create) -->
          <div id="mnemonic-step" class="hidden">
            <h3 style="color: white; text-align: center; margin-bottom: 8px;">Your Recovery Phrase</h3>
            <p style="color: rgba(255,255,255,0.6); text-align: center; font-size: 13px; margin-bottom: 16px;">
              Write these words down and keep them safe. They are the ONLY way to recover your account.
            </p>
            <div id="mnemonic-display" class="mnemonic-grid"></div>
            <div style="display: flex; gap: 8px; margin-top: 16px;">
              <button class="btn-secondary" id="btn-copy-mnemonic" style="flex: 1;">Copy Words</button>
              <button class="btn-primary" id="btn-confirm-mnemonic" style="flex: 1;">
                <span>I've Saved Them</span>
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- Main View (Contacts + Chat) -->
    <div id="view-main" class="view">
      <div class="main-layout">
        <!-- Sidebar -->
        <aside class="sidebar glass-panel">
          <div class="sidebar-header">
            <div class="user-info">
              <div class="user-avatar" id="current-user-avatar"></div>
              <span class="user-name" id="current-user-name"></span>
            </div>
            <div style="display:flex;gap:2px;">
              <button class="btn-icon" id="btn-settings" title="Settings">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <circle cx="12" cy="12" r="3" />
                  <path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z" />
                </svg>
              </button>
              <button class="btn-icon" id="btn-logout" title="Log Out">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4M16 17l5-5-5-5M21 12H9" />
                </svg>
              </button>
            </div>
          </div>

          <div class="sidebar-search">
            <div class="search-box">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <circle cx="11" cy="11" r="8" />
                <path d="M21 21l-4.35-4.35" />
              </svg>
              <input type="text" id="search-contacts" placeholder="Search contacts..." />
            </div>
          </div>

          <div class="sidebar-tabs">
            <button class="sidebar-tab active" data-panel="conversations">Chats</button>
            <button class="sidebar-tab" data-panel="contacts">Contacts</button>
          </div>

          <div id="panel-conversations" class="sidebar-panel active">
            <div id="conversation-list" class="contact-list"></div>
          </div>

          <div id="panel-contacts" class="sidebar-panel">
            <div id="contact-list" class="contact-list"></div>
            <div class="add-contact-area">
              <button class="btn-secondary" id="btn-add-contact">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <path d="M16 21v-2a4 4 0 00-4-4H5a4 4 0 00-4-4v2" />
                  <circle cx="8.5" cy="7" r="4" />
                  <line x1="20" y1="8" x2="20" y2="14" />
                  <line x1="23" y1="11" x2="17" y2="11" />
                </svg>
                <span>Add Contact</span>
              </button>
            </div>
          </div>
        </aside>

        <!-- Chat Area -->
        <main class="chat-area" id="chat-area">
          <div class="chat-empty" id="chat-empty">
            <div class="empty-icon">
              <svg viewBox="0 0 64 64" fill="none">
                <rect rx="16" width="64" height="64" fill="rgba(179,136,255,0.1)" />
                <path d="M17 22C17 19.5 19 17.5 21.5 17.5H42.5C45 17.5 47 19.5 47 22V36C47 38.5 45 40.5 42.5 40.5H36L30 46.5L24 40.5H21.5C19 40.5 17 38.5 17 36V22Z" stroke="#b388ff" stroke-width="2.5" />
              </svg>
            </div>
            <h2>Welcome to A&Y</h2>
            <p>Select a conversation or start a new one</p>
          </div>

          <div class="chat-header hidden" id="chat-header">
            <div class="chat-header-info">
              <div class="chat-avatar" id="chat-peer-avatar"></div>
              <div>
                <h3 id="chat-peer-name">Contact Name</h3>
                <span class="chat-status" id="chat-peer-status">Offline</span>
              </div>
            </div>
            <div class="chat-header-actions">
              <button class="btn-icon" id="btn-search-messages" title="Search Messages">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <circle cx="11" cy="11" r="8" />
                  <line x1="21" y1="21" x2="16.65" y2="16.65" />
                </svg>
              </button>
              <button class="btn-icon btn-call" id="btn-screen-share-chat" title="Screen Share">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <rect x="2" y="3" width="20" height="14" rx="2" ry="2" />
                  <line x1="8" y1="21" x2="16" y2="21" />
                  <line x1="12" y1="17" x2="12" y2="21" />
                </svg>
              </button>
              <button class="btn-icon btn-call" id="btn-video-call" title="Video Call">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <polygon points="23 7 16 12 23 17 23 7" />
                  <rect x="1" y="5" width="15" height="14" rx="2" ry="2" />
                </svg>
              </button>
            </div>
          </div>

          <div class="search-panel hidden" id="search-panel">
            <input type="text" id="search-messages-input" placeholder="Search messages..." />
            <span class="search-count" id="search-count"></span>
            <button class="btn-icon" id="btn-close-search" title="Close">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:16px;height:16px">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </div>

          <div class="chat-messages hidden" id="chat-messages"></div>

          <div class="file-preview-bar hidden" id="file-preview-bar">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:16px;height:16px;flex-shrink:0">
              <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
              <polyline points="14 2 14 8 20 8" />
            </svg>
            <span class="file-preview-name" id="file-preview-name"></span>
            <span class="file-preview-size" id="file-preview-size"></span>
            <button class="btn-remove-file" id="btn-remove-file" title="Remove">✕</button>
          </div>

          <div class="typing-indicator hidden" id="typing-indicator">
            <span class="typing-dot"></span>
            <span class="typing-dot"></span>
            <span class="typing-dot"></span>
            <span class="typing-label">typing</span>
          </div>

          <div class="chat-input hidden" id="chat-input">
            <div class="message-input-wrapper">
              <button class="btn-attach" id="btn-attach" title="Attach file">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <path d="M21.44 11.05l-9.19 9.19a6 6 0 01-8.49-8.49l9.19-9.19a4 4 0 015.66 5.66l-9.2 9.19a2 2 0 01-2.83-2.83l8.49-8.48" />
                </svg>
              </button>
              <input type="text" id="message-input" placeholder="Type a message..." />
              <button class="btn-send" id="btn-send">
                <svg viewBox="0 0 24 24" fill="none">
                  <path d="M22 2L11 13" stroke="currentColor" stroke-width="2" stroke-linecap="round" />
                  <path d="M22 2L15 22L11 13L2 9L22 2Z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />
                </svg>
              </button>
            </div>
            <input type="file" id="file-input" style="display:none" />
          </div>
        </main>
      </div>
    </div>

    <!-- Video Call Overlay -->
    <div id="view-video-call" class="view video-call-overlay">
      <div class="video-call-container">
        <video id="remote-video" autoplay playsinline></video>
        <video id="local-video" autoplay playsinline muted></video>
        <div class="call-info" id="call-info">
          <h2 id="call-peer-name">Calling...</h2>
          <p id="call-status">Connecting</p>
        </div>
        <div class="call-controls">
          <button class="btn-call-control" id="btn-toggle-mic" title="Toggle Microphone">
            <svg id="icon-mic-on" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M12 1a3 3 0 00-3 3v8a3 3 0 006 0V4a3 3 0 00-3-3z" />
              <path d="M19 10v2a7 7 0 01-14 0v-2" />
              <line x1="12" y1="19" x2="12" y2="23" />
              <line x1="8" y1="23" x2="16" y2="23" />
            </svg>
            <svg id="icon-mic-off" class="hidden" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <line x1="1" y1="1" x2="23" y2="23" />
              <path d="M9 9v3a3 3 0 005.12 2.12M15 9.34V4a3 3 0 00-5.94-.6" />
              <path d="M17 16.95A7 7 0 015 12v-2m14 0v2c0 .64-.09 1.26-.24 1.85" />
              <line x1="12" y1="19" x2="12" y2="23" />
              <line x1="8" y1="23" x2="16" y2="23" />
            </svg>
          </button>
          <button class="btn-call-control" id="btn-toggle-camera" title="Toggle Camera">
            <svg id="icon-cam-on" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <polygon points="23 7 16 12 23 17 23 7" />
              <rect x="1" y="5" width="15" height="14" rx="2" ry="2" />
            </svg>
            <svg id="icon-cam-off" class="hidden" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <line x1="1" y1="1" x2="23" y2="23" />
              <path d="M21 21H3a2 2 0 01-2-2V8a2 2 0 012-2h3m2-2h9a2 2 0 012 2v9.5" />
              <polygon points="23 7 16 12 23 17 23 7" />
            </svg>
          </button>
          <button class="btn-call-control btn-screen-share" id="btn-screen-share" title="Share Screen">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <rect x="2" y="3" width="20" height="14" rx="2" ry="2" />
              <line x1="8" y1="21" x2="16" y2="21" />
              <line x1="12" y1="17" x2="12" y2="21" />
            </svg>
          </button>
          <button class="btn-call-control btn-end-call" id="btn-end-call" title="End Call">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
              <line x1="6" y1="6" x2="18" y2="18" />
              <line x1="6" y1="18" x2="18" y2="6" />
            </svg>
          </button>
        </div>
      </div>
    </div>

    <!-- Incoming call modal -->
    <div class="incoming-call-modal hidden" id="incoming-call-modal">
      <div class="incoming-call-card glass-card">
        <div class="incoming-call-avatar" id="incoming-caller-avatar"></div>
        <h2 id="incoming-caller-name">Someone</h2>
        <p>Incoming Video Call</p>
        <div class="incoming-call-actions">
          <button class="btn-call-control btn-accept-call" id="btn-accept-call">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M22 16.92v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07 19.5 19.5 0 01-6-6 19.79 19.79 0 01-3.07-8.67A2 2 0 014.11 2h3a2 2 0 012 1.72c.127.96.361 1.903.7 2.81a2 2 0 01-.45 2.11L8.09 9.91a16 16 0 006 6l1.27-1.27a2 2 0 012.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0122 16.92z" />
            </svg>
          </button>
          <button class="btn-call-control btn-end-call" id="btn-reject-call">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M10.68 13.31a16 16 0 003.41 2.6l1.27-1.27a2 2 0 012.11-.45 12.84 12.84 0 004.33.8 2 2 0 012 2v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07 19.5 19.5 0 01-6-6 19.79 19.79 0 01-3.07-8.67A2 2 0 015.93 2h3a2 2 0 012 1.72 12.84 12.84 0 00.7 2.81 2 2 0 01-.45 2.11L9.91 9.91" transform="rotate(135 12 12)" />
            </svg>
          </button>
        </div>
      </div>
    </div>

    <!-- Screen Source Picker Modal -->
    <div class="incoming-call-modal hidden" id="screen-picker-modal">
      <div class="screen-picker-card glass-card">
        <h3>Choose what to share</h3>
        <div class="screen-picker-grid" id="screen-picker-grid"></div>
        <button class="btn-secondary" id="btn-cancel-screen-pick" style="margin-top:12px;width:100%">Cancel</button>
      </div>
    </div>

    <!-- Add Contact Modal -->
    <div class="modal-overlay hidden" id="modal-add-contact">
      <div class="modal glass-card">
        <h3>Add Contact</h3>
        <p>Paste your friend's User ID to connect.</p>
        <div class="input-group">
          <label for="add-contact-id">User ID (64-char hex)</label>
          <input type="text" id="add-contact-id" placeholder="e.g. 7f4e2k9m3x5p8q1r..." style="font-family: monospace;" />
        </div>
        <p id="add-contact-error" class="auth-error"></p>
        <div class="modal-actions">
          <button class="btn-secondary" id="btn-cancel-add-contact">Cancel</button>
          <button class="btn-primary" id="btn-confirm-add-contact">
            <span>Connect</span>
          </button>
        </div>
      </div>
    </div>

    <!-- Settings View -->
    <div id="view-settings" class="view">
      <div class="settings-container">
        <div class="settings-header">
          <button class="btn-icon" id="btn-settings-back">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M19 12H5M12 19l-7-7 7-7" />
            </svg>
          </button>
          <h2>Settings</h2>
        </div>

        <div class="settings-body">
          <!-- User ID -->
          <div class="settings-section">
            <h3>Your User ID</h3>
            <p>Share this with friends so they can add you.</p>
            <div class="settings-row" style="margin-top: 8px;">
              <input type="text" id="settings-userid" class="settings-input" readonly style="font-family: monospace; font-size: 12px; color: #a1a1aa;" />
              <button class="btn-secondary settings-btn" id="btn-copy-userid">Copy</button>
            </div>
            <p id="userid-status" class="settings-status"></p>
          </div>

          <!-- Recovery Phrase -->
          <div class="settings-section">
            <h3>Recovery Phrase</h3>
            <p>These 8 words are the only way to recover your account. Keep them safe.</p>
            <div id="settings-mnemonic" class="mnemonic-grid hidden" style="margin-top: 8px;"></div>
            <button class="btn-secondary" id="btn-reveal-mnemonic" style="margin-top: 8px;">Reveal</button>
          </div>

          <!-- Display Name -->
          <div class="settings-section">
            <h3>Display Name</h3>
            <div class="settings-row">
              <input type="text" id="settings-name" class="settings-input" placeholder="Your name" />
              <button class="btn-primary settings-btn" id="btn-save-name">Save</button>
            </div>
            <p id="name-status" class="settings-status"></p>
          </div>

          <!-- Danger Zone -->
          <div class="settings-section settings-danger">
            <h3>Danger Zone</h3>
            <p>Permanently delete your account and all data. This action cannot be undone.</p>
            <button class="btn-danger" id="btn-delete-account">Delete My Account</button>
            <p id="delete-status" class="settings-status"></p>
          </div>
        </div>
      </div>
    </div>
  </div>

  <!-- Load scripts -->
  <script src="wordlist.js"></script>
  <script src="identity.js"></script>
  <script src="localDB.js"></script>
  <script src="encryption.js"></script>
  <script src="p2p.js"></script>
  <script src="fileTransfer.js"></script>
  <script src="views/auth.js"></script>
  <script src="views/contacts.js"></script>
  <script src="views/chat.js"></script>
  <script src="views/videoCall.js"></script>
  <script src="views/settings.js"></script>
  <script src="app.js"></script>
</body>

</html>```

## File: src/renderer/app.js
```javascript
// app.js — Main Application Controller

const App = {
    currentUser: null,
    currentView: 'auth',
    onlineUsers: new Set(),

    async init() {
        console.log('App init...');
        
        AuthView.init();
        ContactsView.init();
        ChatView.init();
        SettingsView.init();
        VideoCallView.init();

        this.setupEventListeners();

        try {
            // Try to load existing identity
            const identity = await P2P.init();
            
            if (identity && identity.profile.name !== 'Anonymous') {
                this.currentUser = identity;
                await this.initializeMainView();
            } else {
                this.showView('auth');
            }

            window.App = this;
        } catch (error) {
            console.error('Failed to initialize:', error);
            this.showView('auth');
        }
    },

    setupEventListeners() {
        document.getElementById('btn-logout').addEventListener('click', () => this.logout());
        document.getElementById('btn-settings').addEventListener('click', () => {
            SettingsView.loadData();
            this.showView('settings');
        });
    },

    async initializeMainView() {
        this.updateUserUI();
        this.showView('main');
        await ContactsView.loadConversations();
        await ContactsView.loadContacts();
        ChatView.showEmptyState();
        
        // Auto-connect to known contacts
        this.autoConnectContacts();
    },

    async autoConnectContacts() {
        try {
            const contacts = await getAllContacts();
            for (const contact of contacts) {
                P2P.connectToPeer(contact.pubKeyHex).catch(() => {});
            }
        } catch (err) {
            console.error('Auto-connect failed:', err);
        }
    },

    updateUserUI() {
        if (!this.currentUser) return;
        
        const name = this.currentUser.profile.name;
        document.getElementById('current-user-name').textContent = name;
        
        const avatarEl = document.getElementById('current-user-avatar');
        avatarEl.innerHTML = `<span>${ContactsView.getInitials(name)}</span>`;
        
        if (this.currentUser.profile.avatarColor) {
            avatarEl.style.backgroundColor = this.currentUser.profile.avatarColor;
        }
    },

    async logout() {
        const confirmLogout = confirm('Are you sure you want to log out? Local data will remain on this device.');
        if (!confirmLogout) return;

        await P2P.teardown();
        this.currentUser = null;
        this.onlineUsers = new Set();
        AuthView.resetUI();
        this.showView('auth');
    },

    showView(viewId) {
        document.querySelectorAll('.view').forEach(el => el.classList.remove('active'));
        document.getElementById(`view-${viewId}`).classList.add('active');
        this.currentView = viewId;
    },
    
    // Callback from P2P layer for presence
    onOnlineUsers(usersArray) {
        this.onlineUsers = new Set(usersArray);
        ContactsView.updateOnlineStatuses();
        ChatView.updateHeaderStatus();
    }
};

document.addEventListener('DOMContentLoaded', () => {
    App.init();
});
```

## File: src/renderer/encryption.js
```javascript
// ── Encryption Module (Simplified) ──────────────────────────────
// Transport encryption is handled by Hyperswarm's Noise protocol.
// This module is kept for any future local encryption needs.

const Encryption = {
    // Utility — kept for potential future use (e.g., encrypting local DB)

    _arrayBufferToBase64(buffer) {
        const bytes = new Uint8Array(buffer);
        let binary = '';
        for (let i = 0; i < bytes.byteLength; i++) {
            binary += String.fromCharCode(bytes[i]);
        }
        return btoa(binary);
    },

    _base64ToArrayBuffer(base64) {
        const binary = atob(base64);
        const len = binary.length;
        const bytes = new Uint8Array(len);
        for (let i = 0; i < len; i++) {
            bytes[i] = binary.charCodeAt(i);
        }
        return bytes.buffer;
    },
};
```

## File: src/renderer/fileTransfer.js
```javascript
// fileTransfer.js — File transfer over Hyperswarm streams
// Files are chunked and sent as base64 over the JSON message protocol

const FileTransfer = {
    pendingReceive: new Map(), // fileId → { meta, chunks: [], received: 0 }
    CHUNK_SIZE: 48 * 1024, // 48KB per chunk (safe for JSON serialization)

    // ── Send a file ─────────────────────────────────────────────────

    async sendFile(remotePubKeyHex, file) {
        const fileId = crypto.randomUUID();
        const totalChunks = Math.ceil(file.size / this.CHUNK_SIZE);

        // Send metadata first
        P2P.sendRaw(remotePubKeyHex, {
            type: 'file-meta',
            fileId,
            name: file.name,
            size: file.size,
            mimeType: file.type || 'application/octet-stream',
            totalChunks,
        });

        // Read and send chunks
        const arrayBuffer = await file.arrayBuffer();
        const bytes = new Uint8Array(arrayBuffer);

        for (let i = 0; i < totalChunks; i++) {
            const start = i * this.CHUNK_SIZE;
            const end = Math.min(start + this.CHUNK_SIZE, file.size);
            const chunk = bytes.slice(start, end);

            // Encode chunk as base64
            const base64 = this._uint8ToBase64(chunk);

            P2P.sendRaw(remotePubKeyHex, {
                type: 'file-chunk',
                fileId,
                index: i,
                data: base64,
            });

            // Small delay between chunks to avoid overwhelming the stream
            if (i % 5 === 4) {
                await new Promise(r => setTimeout(r, 10));
            }
        }

        console.log(`[FileTransfer] Sent ${file.name} (${totalChunks} chunks)`);
        return fileId;
    },

    // ── Receive handlers ────────────────────────────────────────────

    handleMeta(remotePubKeyHex, msg) {
        console.log(`[FileTransfer] Receiving ${msg.name} (${msg.totalChunks} chunks)`);
        this.pendingReceive.set(msg.fileId, {
            from: remotePubKeyHex,
            meta: {
                name: msg.name,
                size: msg.size,
                mimeType: msg.mimeType,
                totalChunks: msg.totalChunks,
            },
            chunks: new Array(msg.totalChunks),
            received: 0,
        });
    },

    handleChunk(remotePubKeyHex, msg) {
        const pending = this.pendingReceive.get(msg.fileId);
        if (!pending) return;

        pending.chunks[msg.index] = this._base64ToUint8(msg.data);
        pending.received++;

        // Check if complete
        if (pending.received >= pending.meta.totalChunks) {
            this._assembleFile(msg.fileId, pending);
        }
    },

    _assembleFile(fileId, pending) {
        // Concatenate all chunks
        const totalSize = pending.chunks.reduce((sum, c) => sum + c.length, 0);
        const result = new Uint8Array(totalSize);
        let offset = 0;
        for (const chunk of pending.chunks) {
            result.set(chunk, offset);
            offset += chunk.length;
        }

        // Create blob URL
        const blob = new Blob([result], { type: pending.meta.mimeType });
        const url = URL.createObjectURL(blob);

        console.log(`[FileTransfer] Assembled ${pending.meta.name} (${totalSize} bytes)`);

        // Dispatch event for chat.js to handle
        window.dispatchEvent(new CustomEvent('file-received', {
            detail: {
                from: pending.from,
                name: pending.meta.name,
                size: pending.meta.size,
                mimeType: pending.meta.mimeType,
                url,
            }
        }));

        this.pendingReceive.delete(fileId);
    },

    // ── Base64 helpers ───────────────────────────────────────────────

    _uint8ToBase64(uint8) {
        let binary = '';
        for (let i = 0; i < uint8.length; i++) {
            binary += String.fromCharCode(uint8[i]);
        }
        return btoa(binary);
    },

    _base64ToUint8(base64) {
        const binary = atob(base64);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) {
            bytes[i] = binary.charCodeAt(i);
        }
        return bytes;
    },
};

// Expose globally for p2p.js
window.__fileTransfer = FileTransfer;
```

## File: src/renderer/identity.js
```javascript
// identity.js — Mnemonic-based identity (Session-like)
// 8 random words → deterministic seed → Hyperswarm keypair

const ID_DB_NAME = 'ay-identity';
const STORE      = 'keys';
const MNEMONIC_WORDS = 8;

// ── IndexedDB ────────────────────────────────────────────────────────

async function openIdentityDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(ID_DB_NAME, 2);
    req.onupgradeneeded = e => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE);
      }
    };
    req.onsuccess = e => resolve(e.target.result);
    req.onerror   = e => reject(e.target.error);
  });
}

// ── Mnemonic Generation ──────────────────────────────────────────────

function generateMnemonic() {
  // Pick 8 random words from BIP-39 wordlist (2048 words)
  const indices = new Uint16Array(MNEMONIC_WORDS);
  crypto.getRandomValues(indices);
  return Array.from(indices).map(i => BIP39_WORDLIST[i % 2048]);
}

// ── Seed Derivation ──────────────────────────────────────────────────

async function mnemonicToSeed(words) {
  // words → PBKDF2 → 32-byte seed
  const encoder = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    encoder.encode(words.join(' ')),
    'PBKDF2',
    false,
    ['deriveBits']
  );
  const seedBuf = await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      salt: encoder.encode('A&Y-mnemonic-seed-v1'),
      iterations: 100000,
      hash: 'SHA-256',
    },
    keyMaterial,
    256 // 32 bytes
  );
  return new Uint8Array(seedBuf);
}

// ── Identity Management ──────────────────────────────────────────────

async function createNewIdentity(displayName) {
  const mnemonic = generateMnemonic();
  const seed = await mnemonicToSeed(mnemonic);
  
  // Send seed to main process, get back the Hyperswarm public key
  const pubKeyHex = await window.electronAPI.swarmInit(
    Array.from(seed) // Send as regular array (IPC serialization)
  );

  const identity = {
    mnemonic,
    seedHex: bufToHex(seed),
    pubKeyHex,
    profile: {
      name: displayName || 'Anonymous',
      avatarColor: randomColor(),
    },
  };

  // Store in IndexedDB
  const db = await openIdentityDB();
  await new Promise((res, rej) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put(identity, 'identity').onsuccess = res;
    tx.onerror = e => rej(e.target.error);
  });

  return identity;
}

async function restoreFromMnemonic(words, displayName) {
  const seed = await mnemonicToSeed(words);

  // Send seed to main process, get back the Hyperswarm public key
  const pubKeyHex = await window.electronAPI.swarmInit(
    Array.from(seed)
  );

  const identity = {
    mnemonic: words,
    seedHex: bufToHex(seed),
    pubKeyHex,
    profile: {
      name: displayName || 'Anonymous',
      avatarColor: randomColor(),
    },
  };

  // Store in IndexedDB
  const db = await openIdentityDB();
  await new Promise((res, rej) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put(identity, 'identity').onsuccess = res;
    tx.onerror = e => rej(e.target.error);
  });

  return identity;
}

async function getStoredIdentity() {
  const db = await openIdentityDB();
  return new Promise((res, rej) => {
    const tx = db.transaction(STORE, 'readonly');
    tx.objectStore(STORE).get('identity').onsuccess = e => res(e.target.result || null);
    tx.onerror = e => rej(e.target.error);
  });
}

async function initExistingIdentity() {
  const identity = await getStoredIdentity();
  if (!identity) return null;

  // If the stored identity is from the old ECDH system, clear it
  if (!identity.seedHex || !identity.mnemonic) {
    console.warn('[Identity] Stale identity format detected, clearing...');
    await clearIdentity();
    return null;
  }

  // Re-initialize swarm with stored seed
  const seed = hexToBuf(identity.seedHex);
  const pubKeyHex = await window.electronAPI.swarmInit(
    Array.from(new Uint8Array(seed))
  );

  // Verify the public key matches
  if (pubKeyHex !== identity.pubKeyHex) {
    console.warn('[Identity] Public key mismatch after re-init, updating...');
    identity.pubKeyHex = pubKeyHex;
    await updateIdentityField('pubKeyHex', pubKeyHex);
  }

  return identity;
}

// Update the local identity profile (name, avatar, etc.)
async function updateIdentityProfile(updates) {
  const db = await openIdentityDB();
  const identity = await getStoredIdentity();
  if (!identity) throw new Error('No identity found');

  Object.assign(identity.profile, updates);

  await new Promise((res, rej) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put(identity, 'identity').onsuccess = res;
    tx.onerror = e => rej(e.target.error);
  });

  return identity;
}

async function updateIdentityField(field, value) {
  const db = await openIdentityDB();
  const identity = await getStoredIdentity();
  if (!identity) return;
  identity[field] = value;
  await new Promise((res, rej) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put(identity, 'identity').onsuccess = res;
    tx.onerror = e => rej(e.target.error);
  });
}

// Clear the entire identity (for account deletion)
async function clearIdentity() {
  const db = await openIdentityDB();
  await new Promise((res, rej) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).clear().onsuccess = res;
    tx.onerror = e => rej(e.target.error);
  });
}

// ── Helpers ──────────────────────────────────────────────────────────

const bufToHex    = b => [...new Uint8Array(b)].map(x => x.toString(16).padStart(2,'0')).join('');
const hexToBuf    = h => new Uint8Array(h.match(/.{2}/g).map(b => parseInt(b,16))).buffer;
const randomColor = () => `hsl(${Math.floor(Math.random()*360)},60%,50%)`;

// Format public key for display: AY-XXXX-XXXX-...-XXXX
function formatPubKeyShort(hex) {
  if (!hex) return '';
  return hex.slice(0, 8) + '…' + hex.slice(-8);
}

function formatPubKeyDisplay(hex) {
  if (!hex) return '';
  // Group into 8-char chunks
  return hex.match(/.{1,8}/g).join('-');
}
```

## File: src/renderer/localDB.js
```javascript
// localDB.js — IndexedDB replacing Appwrite collections

const APP_DB_NAME    = 'ay-app';
const DB_VERSION = 1;

const STORES = {
  contacts:      { keyPath: 'pubKeyHex' },
  conversations: { keyPath: 'id' },
  messages:      { keyPath: 'id', autoIncrement: true },
};

let _db = null;

async function openDB() {
  if (_db) return _db;
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(APP_DB_NAME, DB_VERSION);
    req.onupgradeneeded = e => {
      const db = e.target.result;
      for (const [name, opts] of Object.entries(STORES)) {
        if (!db.objectStoreNames.contains(name)) {
          const store = db.createObjectStore(name, opts);
          if (name === 'messages') {
            store.createIndex('by_conv', 'conversationId', { unique: false });
            store.createIndex('by_time', 'timestamp',      { unique: false });
          }
          if (name === 'conversations') {
            store.createIndex('by_peer', 'peerPubKeyHex', { unique: false });
          }
        }
      }
    };
    req.onsuccess = e => { _db = e.target.result; resolve(_db); };
    req.onerror   = e => reject(e.target.error);
  });
}

// ── Contacts (replaces Appwrite `users` collection) ──────────────────────────

async function upsertContact(contact) {
  // contact = { pubKeyHex, userId, profile: { name, avatarColor } }
  const db = await openDB();
  return idbPut(db, 'contacts', contact);
}

async function getContact(pubKeyHex) {
  const db = await openDB();
  return idbGet(db, 'contacts', pubKeyHex);
}

async function getAllContacts() {
  const db = await openDB();
  return idbGetAll(db, 'contacts');
}

async function deleteContact(pubKeyHex) {
  const db = await openDB();
  return new Promise((res, rej) => {
    const req = db.transaction('contacts', 'readwrite').objectStore('contacts').delete(pubKeyHex);
    req.onsuccess = () => res();
    req.onerror = e => rej(e.target.error);
  });
}

// ── Conversations ─────────────────────────────────────────────────────────────

async function getOrCreateConversationLocal(localPubKey, remotePubKey) {
  const db   = await openDB();
  const keys = [localPubKey, remotePubKey].sort();
  const id   = await sha256Hex(keys.join(':'));

  const existing = await idbGet(db, 'conversations', id);
  if (existing) return existing;

  const conv = {
    id,
    peerPubKeyHex: remotePubKey,
    createdAt: Date.now(),
    lastMessageAt: null,
    lastMessagePreview: null,
  };
  await idbPut(db, 'conversations', conv);
  return conv;
}

async function getConversationsLocal() {
  const db = await openDB();
  const all = await idbGetAll(db, 'conversations');
  // Sort by last message time descending
  return all.sort((a, b) => (b.lastMessageAt || b.createdAt) - (a.lastMessageAt || a.createdAt));
}

async function updateConversationPreview(convId, preview) {
  const db   = await openDB();
  const conv = await idbGet(db, 'conversations', convId);
  if (!conv) return;
  Object.assign(conv, { lastMessageAt: Date.now(), lastMessagePreview: preview });
  return idbPut(db, 'conversations', conv);
}

async function deleteConversation(convId) {
  const db = await openDB();
  return new Promise((res, rej) => {
    const req = db.transaction('conversations', 'readwrite').objectStore('conversations').delete(convId);
    req.onsuccess = () => res();
    req.onerror = e => rej(e.target.error);
  });
}

// ── Messages ──────────────────────────────────────────────────────────────────

async function saveMessage(msg) {
  // msg = { id, conversationId, senderId, content, timestamp, status, type }
  const db = await openDB();
  return idbPut(db, 'messages', { ...msg, timestamp: msg.timestamp || Date.now() });
}

async function getMessagesLocal(conversationId, limit = 100) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx    = db.transaction('messages', 'readonly');
    const index = tx.objectStore('messages').index('by_conv');
    const range = IDBKeyRange.only(conversationId);
    const msgs  = [];
    index.openCursor(range).onsuccess = e => {
      const cursor = e.target.result;
      if (!cursor) {
        // Sort by timestamp ascending (oldest first) then take last N
        msgs.sort((a, b) => a.timestamp - b.timestamp);
        resolve(msgs.slice(-limit));
        return;
      }
      msgs.push(cursor.value);
      cursor.continue();
    };
    tx.onerror = e => reject(e.target.error);
  });
}

async function updateMessageStatus(msgId, status) {
  const db  = await openDB();
  const msg = await idbGet(db, 'messages', msgId);
  if (!msg) return;
  msg.status = status;
  return idbPut(db, 'messages', msg);
}

async function deleteAllMessages(conversationId) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx    = db.transaction('messages', 'readwrite');
    const store = tx.objectStore('messages');
    const index = store.index('by_conv');
    const range = IDBKeyRange.only(conversationId);
    index.openCursor(range).onsuccess = e => {
      const cursor = e.target.result;
      if (!cursor) { resolve(); return; }
      cursor.delete();
      cursor.continue();
    };
    tx.onerror = e => reject(e.target.error);
  });
}

// Clear all stores (for account deletion)
async function clearAllData() {
  const db = await openDB();
  await Promise.all(['contacts', 'conversations', 'messages'].map(store =>
    new Promise((res, rej) => {
      const tx = db.transaction(store, 'readwrite');
      tx.objectStore(store).clear().onsuccess = res;
      tx.onerror = e => rej(e.target.error);
    })
  ));
}

// ── IDB helpers ───────────────────────────────────────────────────────────────

function idbGet(db, store, key) {
  return new Promise((res, rej) => {
    const req = db.transaction(store, 'readonly').objectStore(store).get(key);
    req.onsuccess = e => res(e.target.result ?? null);
    req.onerror   = e => rej(e.target.error);
  });
}
function idbGetAll(db, store) {
  return new Promise((res, rej) => {
    const req = db.transaction(store, 'readonly').objectStore(store).getAll();
    req.onsuccess = e => res(e.target.result);
    req.onerror   = e => rej(e.target.error);
  });
}
function idbPut(db, store, val) {
  return new Promise((res, rej) => {
    const req = db.transaction(store, 'readwrite').objectStore(store).put(val);
    req.onsuccess = e => res(e.target.result);
    req.onerror   = e => rej(e.target.error);
  });
}
function idbAdd(db, store, val) {
  return new Promise((res, rej) => {
    const req = db.transaction(store, 'readwrite').objectStore(store).add(val);
    req.onsuccess = e => res(e.target.result);
    req.onerror   = e => rej(e.target.error);
  });
}
async function sha256Hex(str) {
  const buf  = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str));
  return [...new Uint8Array(buf)].map(x => x.toString(16).padStart(2,'0')).join('');
}
```

## File: src/renderer/p2p.js
```javascript
// p2p.js — P2P layer (bridges renderer to main process Hyperswarm via IPC)
// Replaces Socket.io + SimplePeer with Hyperswarm streams

let p2pIdentity = null;

// Event callbacks (set from app.js / chat.js / videoCall.js)
const P2P = {
    onMessage:     null,  // ({ remotePubKeyHex, plaintext, msgId, timestamp }) =>
    onTyping:      null,  // ({ remotePubKeyHex, isTyping }) =>
    onReceipt:     null,  // ({ msgId, status }) =>
    onPeerOnline:  null,  // (pubKeyHex) =>
    onPeerOffline: null,  // (pubKeyHex) =>
    onPeerProfile: null,  // ({ pubKeyHex, profile }) =>
    onCallSignal:  null,  // ({ from, data }) =>  — for video call signaling

    // ── Init ──────────────────────────────────────────────────────────

    async init() {
        // Try to load existing identity and re-init swarm
        const identity = await initExistingIdentity();
        if (!identity) return null;

        p2pIdentity = identity;
        this.setupEventListeners();
        return p2pIdentity;
    },

    async initWithIdentity(identity) {
        p2pIdentity = identity;
        this.setupEventListeners();
        return p2pIdentity;
    },

    setupEventListeners() {
        // Listen for messages from main process (Hyperswarm)
        window.electronAPI.onSwarmMessage(({ from, message }) => {
            this.handleIncoming(from, message);
        });

        window.electronAPI.onSwarmPeerConnected(({ pubKeyHex }) => {
            console.log('[P2P] Peer connected:', pubKeyHex.slice(0, 12));
            // Send our profile immediately
            this.sendRaw(pubKeyHex, { type: 'profile', payload: p2pIdentity.profile });
            P2P.onPeerOnline?.(pubKeyHex);
        });

        window.electronAPI.onSwarmPeerDisconnected(({ pubKeyHex }) => {
            console.log('[P2P] Peer disconnected:', pubKeyHex.slice(0, 12));
            P2P.onPeerOffline?.(pubKeyHex);
        });

        window.electronAPI.onSwarmOnlinePeers((peers) => {
            if (typeof App !== 'undefined' && App.onOnlineUsers) {
                App.onOnlineUsers(peers);
            }
        });
    },

    getIdentity() {
        return p2pIdentity;
    },

    // ── Connect to a peer (by pubkey hex) ──────────────────────────

    async connectToPeer(remotePubKeyHex) {
        return await window.electronAPI.swarmConnectPeer(remotePubKeyHex);
    },

    async isPeerConnected(remotePubKeyHex) {
        return await window.electronAPI.swarmIsConnected(remotePubKeyHex);
    },

    // ── Outgoing message ──────────────────────────────────────────

    async sendMessage(remotePubKeyHex, plaintext) {
        const isConnected = await this.isPeerConnected(remotePubKeyHex);
        if (!isConnected) throw new Error('Peer not connected');

        const conv = await getOrCreateConversationLocal(p2pIdentity.pubKeyHex, remotePubKeyHex);
        const msgId = crypto.randomUUID();
        const timestamp = Date.now();

        // Send over Hyperswarm (already encrypted by Noise protocol)
        const packet = { type: 'message', id: msgId, content: plaintext, timestamp };
        this.sendRaw(remotePubKeyHex, packet);

        // Save locally
        await saveMessage({
            id: msgId,
            conversationId: conv.id,
            senderId: p2pIdentity.pubKeyHex,
            content: plaintext,
            timestamp,
            status: 'sent',
            type: 'text',
        });
        await updateConversationPreview(conv.id, plaintext.slice(0, 60));

        return { msgId, timestamp, conversationId: conv.id };
    },

    sendTyping(remotePubKeyHex, isTyping) {
        this.sendRaw(remotePubKeyHex, { type: 'typing', isTyping });
    },

    // ── Video call signaling over Hyperswarm ─────────────────────

    sendCallSignal(remotePubKeyHex, signalData) {
        this.sendRaw(remotePubKeyHex, { type: 'call-signal', data: signalData });
    },

    sendCallRequest(remotePubKeyHex, callerName) {
        this.sendRaw(remotePubKeyHex, { type: 'call-request', callerName });
    },

    sendCallAccepted(remotePubKeyHex) {
        this.sendRaw(remotePubKeyHex, { type: 'call-accepted' });
    },

    sendCallRejected(remotePubKeyHex) {
        this.sendRaw(remotePubKeyHex, { type: 'call-rejected' });
    },

    sendCallEnded(remotePubKeyHex) {
        this.sendRaw(remotePubKeyHex, { type: 'call-ended' });
    },

    sendCallBusy(remotePubKeyHex) {
        this.sendRaw(remotePubKeyHex, { type: 'call-busy' });
    },

    // ── Incoming message handler ──────────────────────────────────

    async handleIncoming(remotePubKeyHex, msg) {
        switch (msg.type) {

            case 'profile': {
                await upsertContact({
                    pubKeyHex: remotePubKeyHex,
                    profile: msg.payload,
                });
                P2P.onPeerProfile?.({ pubKeyHex: remotePubKeyHex, profile: msg.payload });
                break;
            }

            case 'message': {
                const conv = await getOrCreateConversationLocal(p2pIdentity.pubKeyHex, remotePubKeyHex);

                await saveMessage({
                    id: msg.id,
                    conversationId: conv.id,
                    senderId: remotePubKeyHex,
                    content: msg.content,
                    timestamp: msg.timestamp,
                    status: 'delivered',
                    type: 'text',
                });
                await updateConversationPreview(conv.id, msg.content.slice(0, 60));

                // Send delivery receipt
                this.sendRaw(remotePubKeyHex, { type: 'receipt', msgId: msg.id, status: 'delivered' });

                P2P.onMessage?.({
                    remotePubKeyHex,
                    plaintext: msg.content,
                    msgId: msg.id,
                    timestamp: msg.timestamp,
                    conversationId: conv.id,
                });
                break;
            }

            case 'receipt': {
                await updateMessageStatus(msg.msgId, msg.status);
                P2P.onReceipt?.({ msgId: msg.msgId, status: msg.status });
                break;
            }

            case 'typing': {
                P2P.onTyping?.({ remotePubKeyHex, isTyping: msg.isTyping });
                break;
            }

            case 'file-meta': {
                window.__fileTransfer?.handleMeta(remotePubKeyHex, msg);
                break;
            }

            case 'file-chunk': {
                window.__fileTransfer?.handleChunk(remotePubKeyHex, msg);
                break;
            }

            // Video call signaling
            case 'call-signal': {
                P2P.onCallSignal?.({ from: remotePubKeyHex, data: msg.data });
                break;
            }

            case 'call-request': {
                VideoCallView.handleIncomingCall(remotePubKeyHex, msg.callerName);
                break;
            }

            case 'call-accepted': {
                VideoCallView.handleCallAccepted(remotePubKeyHex);
                break;
            }

            case 'call-rejected': {
                VideoCallView.handleCallRejected(remotePubKeyHex);
                break;
            }

            case 'call-ended': {
                VideoCallView.handleCallEnded(remotePubKeyHex);
                break;
            }

            case 'call-busy': {
                VideoCallView.handleCallBusy(remotePubKeyHex);
                break;
            }
        }
    },

    // ── Helpers ───────────────────────────────────────────────────

    sendRaw(remotePubKeyHex, obj) {
        window.electronAPI.swarmSend(remotePubKeyHex, obj);
    },

    // Teardown
    async teardown() {
        await window.electronAPI.swarmTeardown();
        p2pIdentity = null;
    },
};
```

## File: src/renderer/styles.css
```css
/* ── CSS Variables & Reset ──────────────────────────────────────── */
:root {
  --bg-primary: #000000;
  --bg-secondary: #1c1c1e;
  --bg-tertiary: #2c2c2e;
  --bg-glass: rgba(28, 28, 30, 0.85);
  --bg-glass-hover: rgba(44, 44, 46, 0.9);

  --accent: #D1C4E9;
  --accent-hover: #E0D4F5;
  --accent-glow: transparent;
  --accent-dim: rgba(209, 196, 233, 0.15);
  --accent-solid: #D1C4E9;

  --blue: #B39DDB;
  --blue-dim: rgba(179, 157, 219, 0.15);
  --red: #ff5252;
  --red-dim: rgba(255, 82, 82, 0.15);
  --orange: #ffab40;
  --yellow: #ffd740;

  --sent-bubble: linear-gradient(135deg, #B39DDB, #D1C4E9);
  --received-bubble: #2c2c2e;

  --text-primary: #f5f5f7;
  --text-secondary: #a1a1a6;
  --text-tertiary: #636366;
  --text-inverse: #000000;

  --border-color: rgba(255, 255, 255, 0.08);
  --border-focus: rgba(209, 196, 233, 0.5);

  --shadow-sm: 0 2px 8px rgba(0, 0, 0, 0.3);
  --shadow-md: 0 8px 32px rgba(0, 0, 0, 0.4);
  --shadow-lg: 0 16px 64px rgba(0, 0, 0, 0.5);
  --shadow-glow: none;

  --radius-sm: 8px;
  --radius-md: 12px;
  --radius-lg: 16px;
  --radius-xl: 20px;
  --radius-full: 9999px;

  --font: 'Inter', -apple-system, BlinkMacSystemFont, 'SF Pro Display', sans-serif;

  --transition-fast: 150ms ease;
  --transition-normal: 250ms ease;
  --transition-slow: 400ms cubic-bezier(0.16, 1, 0.3, 1);
}

*,
*::before,
*::after {
  box-sizing: border-box;
  margin: 0;
  padding: 0;
}

html,
body {
  height: 100%;
  font-family: var(--font);
  background: var(--bg-primary);
  color: var(--text-primary);
  overflow: hidden;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
  user-select: none;
}

/* ── Titlebar Drag Region ──────────────────────────────────────── */
.titlebar-drag-region {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  height: 38px;
  -webkit-app-region: drag;
  z-index: 9999;
}

/* ── Scrollbar ─────────────────────────────────────────────────── */
::-webkit-scrollbar {
  width: 6px;
}

::-webkit-scrollbar-track {
  background: transparent;
}

::-webkit-scrollbar-thumb {
  background: var(--bg-tertiary);
  border-radius: var(--radius-full);
}

::-webkit-scrollbar-thumb:hover {
  background: var(--text-tertiary);
}

/* ── Utility ───────────────────────────────────────────────────── */
.hidden {
  display: none !important;
}

#app {
  width: 100%;
  height: 100%;
}

.view {
  display: none;
  width: 100%;
  height: 100%;
}

.view.active {
  display: flex;
}

/* ── Glass Effects ─────────────────────────────────────────────── */
.glass-card {
  background: var(--bg-glass);
  backdrop-filter: blur(40px) saturate(180%);
  -webkit-backdrop-filter: blur(40px) saturate(180%);
  border: 1px solid var(--border-color);
  border-radius: var(--radius-lg);
}

.glass-panel {
  background: var(--bg-glass);
  backdrop-filter: blur(40px) saturate(180%);
  -webkit-backdrop-filter: blur(40px) saturate(180%);
  border-right: 1px solid var(--border-color);
}

/* ── Buttons ───────────────────────────────────────────────────── */
.btn-primary {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  width: 100%;
  padding: 12px 24px;
  background: linear-gradient(135deg, var(--accent-solid), var(--accent));
  color: white;
  border: none;
  border-radius: var(--radius-md);
  font-family: var(--font);
  font-size: 15px;
  font-weight: 600;
  cursor: pointer;
  transition: all var(--transition-normal);
  box-shadow: var(--shadow-sm);
  -webkit-app-region: no-drag;
}

.btn-primary:hover {
  transform: translateY(-1px);
  box-shadow: var(--shadow-md);
}

.btn-primary:active {
  transform: translateY(0);
}

.btn-primary svg {
  width: 16px;
  height: 16px;
}

.btn-secondary {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 10px 20px;
  background: var(--bg-tertiary);
  color: var(--text-primary);
  border: 1px solid var(--border-color);
  border-radius: var(--radius-md);
  font-family: var(--font);
  font-size: 14px;
  font-weight: 500;
  cursor: pointer;
  transition: all var(--transition-fast);
  -webkit-app-region: no-drag;
}

.btn-secondary:hover {
  background: var(--bg-glass-hover);
  border-color: var(--text-tertiary);
}

.btn-secondary svg {
  width: 16px;
  height: 16px;
}

.btn-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 36px;
  height: 36px;
  background: transparent;
  border: none;
  border-radius: var(--radius-sm);
  color: var(--text-secondary);
  cursor: pointer;
  transition: all var(--transition-fast);
  -webkit-app-region: no-drag;
}

.btn-icon:hover {
  background: var(--bg-tertiary);
  color: var(--text-primary);
}

.btn-icon svg {
  width: 18px;
  height: 18px;
}

/* ── Inputs ────────────────────────────────────────────────────── */
.input-group {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.input-group label {
  font-size: 13px;
  font-weight: 500;
  color: var(--text-secondary);
}

.input-group input {
  padding: 11px 14px;
  background: var(--bg-primary);
  border: 1px solid var(--border-color);
  border-radius: var(--radius-sm);
  color: var(--text-primary);
  font-family: var(--font);
  font-size: 15px;
  outline: none;
  transition: border-color var(--transition-fast);
  -webkit-app-region: no-drag;
}

.input-group input::placeholder {
  color: var(--text-tertiary);
}

.input-group input:focus {
  border-color: var(--border-focus);
  box-shadow: 0 0 0 3px var(--accent-dim);
}

/* ── Auth View ─────────────────────────────────────────────────── */
.auth-container {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  width: 100%;
  height: 100%;
  gap: 32px;
  padding: 40px;
  background: var(--bg-primary);
  position: relative;
  z-index: 1;
  -webkit-app-region: no-drag;
}

.auth-logo {
  text-align: center;
}

.logo-icon {
  width: 80px;
  height: 80px;
  margin: 0 auto 16px;
}

.logo-icon svg {
  width: 100%;
  height: 100%;
}

.auth-logo h1 {
  font-size: 36px;
  font-weight: 700;
  letter-spacing: -0.5px;
  color: var(--accent);
}

.auth-subtitle {
  color: var(--text-secondary);
  font-size: 15px;
  margin-top: 4px;
}

.auth-card {
  width: 100%;
  max-width: 520px;
  padding: 28px;
  overflow: hidden;
}

.auth-switch {
  text-align: center;
  font-size: 14px;
  color: var(--text-secondary);
  margin-top: 8px;
}

.auth-switch a {
  color: var(--accent);
  text-decoration: none;
  font-weight: 500;
}

.auth-switch a:hover {
  text-decoration: underline;
}

.auth-tabs {
  display: flex;
  gap: 4px;
  margin-bottom: 24px;
  background: var(--bg-primary);
  border-radius: var(--radius-sm);
  padding: 3px;
}

.auth-tab {
  flex: 1;
  padding: 8px 16px;
  background: none;
  border: none;
  border-radius: 6px;
  color: var(--text-secondary);
  font-family: var(--font);
  font-size: 14px;
  font-weight: 500;
  cursor: pointer;
  transition: all var(--transition-fast);
  -webkit-app-region: no-drag;
}

.auth-tab.active {
  background: var(--bg-tertiary);
  color: var(--text-primary);
}

.auth-form {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.auth-error {
  color: var(--red);
  font-size: 13px;
  min-height: 18px;
}

/* ── Mnemonic Grid ────────────────────────────────────────────── */
.mnemonic-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 8px;
  width: 100%;
}

.mnemonic-word {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 8px 8px;
  background: var(--bg-primary);
  border: 1px solid var(--border-color);
  border-radius: var(--radius-sm);
  font-family: 'SF Mono', 'Fira Code', monospace;
  font-size: 12px;
  color: var(--accent);
  font-weight: 500;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
  min-width: 0;
}

.mnemonic-word small {
  color: var(--text-tertiary);
  font-size: 10px;
  font-weight: 600;
  min-width: 12px;
  flex-shrink: 0;
}

/* ── Textarea for recovery phrase ─────────────────────────────── */
.input-group textarea {
  padding: 11px 14px;
  background: var(--bg-primary);
  border: 1px solid var(--border-color);
  border-radius: var(--radius-sm);
  color: var(--text-primary);
  font-family: 'SF Mono', 'Fira Code', monospace;
  font-size: 14px;
  outline: none;
  resize: none;
  transition: border-color var(--transition-fast);
  -webkit-app-region: no-drag;
}

.input-group textarea::placeholder {
  color: var(--text-tertiary);
  font-family: var(--font);
}

.input-group textarea:focus {
  border-color: var(--border-focus);
  box-shadow: 0 0 0 3px var(--accent-dim);
}

/* ── Status Indicator (online/offline dot) ────────────────────── */
.status-indicator {
  position: absolute;
  bottom: 1px;
  right: 1px;
  width: 10px;
  height: 10px;
  border-radius: var(--radius-full);
  border: 2px solid var(--bg-secondary);
  background: var(--text-tertiary);
}

.status-indicator.online {
  background: #69f0ae;
}

/* ── Contact Header Row ───────────────────────────────────────── */
.contact-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
}


/* ── Main Layout ───────────────────────────────────────────────── */
.main-layout {
  display: flex;
  width: 100%;
  height: 100%;
  overflow: hidden;
}

/* ── Sidebar ───────────────────────────────────────────────────── */
.sidebar {
  width: 320px;
  min-width: 280px;
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  background: var(--bg-secondary);
  border-right: 1px solid var(--border-color);
}

.sidebar-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 48px 16px 12px;
}

.user-info {
  display: flex;
  align-items: center;
  gap: 10px;
}

.user-avatar {
  width: 32px;
  height: 32px;
  border-radius: var(--radius-full);
  background: linear-gradient(135deg, var(--accent-solid), var(--accent-hover));
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 13px;
  font-weight: 600;
  color: white;
  flex-shrink: 0;
}

.user-name {
  font-size: 15px;
  font-weight: 600;
}

.sidebar-search {
  padding: 8px 16px;
}

.search-box {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  background: var(--bg-primary);
  border-radius: var(--radius-sm);
  border: 1px solid var(--border-color);
  transition: border-color var(--transition-fast);
}

.search-box:focus-within {
  border-color: var(--border-focus);
}

.search-box svg {
  width: 16px;
  height: 16px;
  color: var(--text-tertiary);
  flex-shrink: 0;
}

.search-box input {
  flex: 1;
  background: none;
  border: none;
  color: var(--text-primary);
  font-family: var(--font);
  font-size: 14px;
  outline: none;
  -webkit-app-region: no-drag;
}

.search-box input::placeholder {
  color: var(--text-tertiary);
}

.sidebar-tabs {
  display: flex;
  gap: 4px;
  margin: 4px 16px 8px;
  background: var(--bg-primary);
  border-radius: var(--radius-sm);
  padding: 3px;
}

.sidebar-tab {
  flex: 1;
  padding: 6px 12px;
  background: none;
  border: none;
  border-radius: 6px;
  color: var(--text-secondary);
  font-family: var(--font);
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  transition: all var(--transition-fast);
  -webkit-app-region: no-drag;
}

.sidebar-tab.active {
  background: var(--bg-tertiary);
  color: var(--text-primary);
}

.sidebar-panel {
  display: none;
  flex-direction: column;
  flex: 1;
  overflow-y: auto;
}

.sidebar-panel.active {
  display: flex;
}

.contact-list {
  flex: 1;
  padding: 4px 8px;
}

.contact-item {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 12px;
  border-radius: var(--radius-md);
  cursor: pointer;
  transition: all var(--transition-fast);
  -webkit-app-region: no-drag;
}

.contact-item:hover {
  background: var(--bg-tertiary);
}

.contact-item.active {
  background: var(--accent-dim);
  border: 1px solid rgba(179, 136, 255, 0.15);
}

.contact-avatar {
  width: 42px;
  height: 42px;
  border-radius: var(--radius-full);
  background: linear-gradient(135deg, var(--accent-solid), var(--accent-hover));
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 15px;
  font-weight: 600;
  color: white;
  flex-shrink: 0;
  position: relative;
}

.contact-avatar .online-badge {
  position: absolute;
  bottom: 0;
  right: 0;
  width: 12px;
  height: 12px;
  background: #69f0ae;
  border: 2px solid var(--bg-secondary);
  border-radius: var(--radius-full);
}

.contact-info {
  flex: 1;
  min-width: 0;
}

.contact-name {
  font-size: 14px;
  font-weight: 600;
  color: var(--text-primary);
}

.contact-preview {
  font-size: 13px;
  color: var(--text-secondary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.contact-meta {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 4px;
}

.contact-time {
  font-size: 12px;
  color: var(--text-tertiary);
}

.add-contact-area {
  padding: 12px 16px;
  border-top: 1px solid var(--border-color);
}

.add-contact-area .btn-secondary {
  width: 100%;
}

/* ── Chat Area ─────────────────────────────────────────────────── */
.chat-area {
  flex: 1;
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  position: relative;
}

.chat-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  flex: 1;
  gap: 12px;
  opacity: 0.6;
}

.empty-icon {
  width: 80px;
  height: 80px;
  margin-bottom: 8px;
}

.empty-icon svg {
  width: 100%;
  height: 100%;
}

.chat-empty h2 {
  font-size: 22px;
  font-weight: 600;
}

.chat-empty p {
  color: var(--text-secondary);
  font-size: 15px;
}

.chat-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 48px 20px 12px;
  border-bottom: 1px solid var(--border-color);
  background: var(--bg-glass);
  backdrop-filter: blur(20px);
}

.chat-header-info {
  display: flex;
  align-items: center;
  gap: 12px;
}

.chat-avatar {
  width: 38px;
  height: 38px;
  border-radius: var(--radius-full);
  background: linear-gradient(135deg, var(--accent-solid), var(--accent-hover));
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 14px;
  font-weight: 600;
  color: white;
}

.chat-header-info h3 {
  font-size: 16px;
  font-weight: 600;
}

.chat-status {
  font-size: 13px;
  color: var(--text-tertiary);
}

.chat-status.online {
  color: #69f0ae;
}

.chat-header-actions {
  display: flex;
  gap: 4px;
}

.btn-call {
  color: var(--accent);
}

.btn-call:hover {
  background: var(--accent-dim);
  color: var(--accent);
}

/* ── Messages ──────────────────────────────────────────────────── */
.chat-messages {
  flex: 1;
  overflow-y: auto;
  padding: 16px 20px;
  display: flex;
  flex-direction: column;
  gap: 3px;
  min-height: 0;
}

/* Individual message row */
.message {
  display: flex;
  align-items: flex-end;
  max-width: 65%;
  align-self: flex-start;
  animation: messageIn 0.25s ease-out;
}

.message.message-self {
  align-self: flex-end;
}

/* Message bubble */
.message-bubble {
  padding: 7px 10px 6px;
  border-radius: 12px 12px 12px 4px;
  font-size: 14.5px;
  line-height: 1.35;
  word-wrap: break-word;
  overflow-wrap: break-word;
  background: var(--bg-tertiary);
  color: var(--text-primary);
  position: relative;
  box-shadow: 0 1px 2px rgba(0,0,0,0.15);
}

.message.message-self .message-bubble {
  background: linear-gradient(135deg, #7c4dff, #b388ff);
  color: white;
  border-radius: 12px 12px 4px 12px;
}

/* Message content */
.message-content {
  white-space: pre-wrap;
}

/* Meta row (time + status) */
.message-meta {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 4px;
  margin-top: 2px;
}

.message-time {
  font-size: 10.5px;
  color: rgba(255,255,255,0.45);
  line-height: 1;
}

.message:not(.message-self) .message-time {
  color: var(--text-tertiary);
}

.message-status {
  width: 14px;
  height: 14px;
  opacity: 0.5;
}

.message-status.status-read {
  opacity: 0.8;
  color: #69f0ae;
}

/* Date divider */
.date-divider {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 10px 0;
  margin: 4px 0;
}

.date-divider span {
  background: var(--bg-tertiary);
  color: var(--text-secondary);
  font-size: 11px;
  font-weight: 500;
  padding: 4px 12px;
  border-radius: var(--radius-full);
}

@keyframes messageIn {
  from {
    opacity: 0;
    transform: translateY(6px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

/* ── File Messages ─────────────────────────────────────────────── */
.message-file {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 14px;
  border-radius: 14px;
  cursor: pointer;
  text-decoration: none;
  transition: opacity var(--transition-fast);
}

.message-file:hover {
  opacity: 0.85;
}

.message-file-icon {
  width: 36px;
  height: 36px;
  border-radius: var(--radius-sm);
  background: rgba(255, 255, 255, 0.15);
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.message-file-icon svg {
  width: 18px;
  height: 18px;
  color: white;
}

.message-file-info {
  flex: 1;
  min-width: 0;
}

.message-file-name {
  font-size: 14px;
  font-weight: 500;
  color: inherit;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.message-file-size {
  font-size: 12px;
  opacity: 0.7;
}

.message-image {
  max-width: 280px;
  max-height: 280px;
  border-radius: 14px;
  object-fit: cover;
  cursor: pointer;
  transition: transform var(--transition-fast);
}

.message-image:hover {
  transform: scale(1.02);
}

.message-video {
  max-width: 320px;
  max-height: 240px;
  border-radius: 14px;
  object-fit: cover;
}

/* Fix for raw links like the one in the screenshot */
.message-content a.text-preview {
  color: inherit;
  text-decoration: underline;
}

.message-content a.file-attachment {
  color: inherit;
  text-decoration: none;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 10px;
  background: rgba(255, 255, 255, 0.1);
  border-radius: 8px;
  margin-top: 4px;
}

.message-content a.file-attachment:hover {
  background: rgba(255, 255, 255, 0.2);
}

/* ── Chat Input ────────────────────────────────────────────────── */
.chat-input {
  padding: 12px 20px 20px;
  border-top: 1px solid var(--border-color);
}

.message-input-wrapper {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 4px 4px 4px 8px;
  background: var(--bg-secondary);
  border: 1px solid var(--border-color);
  border-radius: var(--radius-xl);
  transition: border-color var(--transition-fast);
}

.message-input-wrapper:focus-within {
  border-color: var(--border-focus);
}

.btn-attach {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  background: transparent;
  border: none;
  border-radius: var(--radius-full);
  color: var(--text-tertiary);
  cursor: pointer;
  transition: all var(--transition-fast);
  flex-shrink: 0;
  -webkit-app-region: no-drag;
}

.btn-attach:hover {
  color: var(--accent);
  background: var(--accent-dim);
}

.btn-attach svg {
  width: 18px;
  height: 18px;
}

.message-input-wrapper input {
  flex: 1;
  background: none;
  border: none;
  color: var(--text-primary);
  font-family: var(--font);
  font-size: 15px;
  outline: none;
  padding: 0 6px;
  -webkit-app-region: no-drag;
}

.message-input-wrapper input::placeholder {
  color: var(--text-tertiary);
}

.btn-send {
  width: 36px;
  height: 36px;
  border-radius: var(--radius-full);
  background: linear-gradient(135deg, var(--accent-solid), var(--accent));
  border: none;
  color: white;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: all var(--transition-fast);
  flex-shrink: 0;
  -webkit-app-region: no-drag;
}

.btn-send:hover {
  transform: scale(1.05);
  box-shadow: var(--shadow-glow);
}

.btn-send svg {
  width: 16px;
  height: 16px;
}

/* ── File Upload Preview ───────────────────────────────────────── */
.file-preview-bar {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 16px;
  background: var(--bg-secondary);
  border-top: 1px solid var(--border-color);
  font-size: 13px;
  color: var(--text-secondary);
}

.file-preview-bar .file-preview-name {
  flex: 1;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.file-preview-bar .btn-remove-file {
  background: none;
  border: none;
  color: var(--text-tertiary);
  cursor: pointer;
  font-size: 18px;
  padding: 0 4px;
  -webkit-app-region: no-drag;
}

.file-preview-bar .btn-remove-file:hover {
  color: var(--red);
}

/* ── Reply Preview Bar ──────────────────────────────────────────── */
.reply-preview-bar {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 16px;
  background: var(--bg-secondary);
  border-top: 1px solid var(--border-color);
  border-left: 3px solid var(--accent-solid);
  font-size: 13px;
  color: var(--text-secondary);
}

.reply-preview-content {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.reply-preview-label {
  font-size: 11px;
  font-weight: 600;
  color: var(--accent);
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.reply-preview-text {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* ── Message Context Menu ──────────────────────────────────────── */
.message-context-menu {
  position: fixed;
  z-index: 5000;
  min-width: 140px;
  background: var(--bg-glass);
  backdrop-filter: blur(20px);
  border: 1px solid var(--border-color);
  border-radius: var(--radius-md);
  padding: 4px;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.4);
  animation: contextIn 0.15s ease;
}

@keyframes contextIn {
  from {
    opacity: 0;
    transform: scale(0.92);
  }

  to {
    opacity: 1;
    transform: scale(1);
  }
}

.context-menu-item {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 8px 12px;
  background: none;
  border: none;
  color: var(--text-primary);
  font-size: 13px;
  font-family: var(--font);
  cursor: pointer;
  border-radius: var(--radius-sm);
  transition: background var(--transition-fast);
}

.context-menu-item:hover {
  background: var(--hover-bg);
}

.context-menu-item.ctx-delete {
  color: var(--red);
}

.context-menu-item.ctx-delete:hover {
  background: rgba(248, 81, 73, 0.12);
}

/* ── Reply Quote in Message ────────────────────────────────────── */
.reply-quote {
  font-size: 12px;
  padding: 6px 10px;
  margin-bottom: 4px;
  border-radius: 8px;
  border-left: 2px solid var(--accent-solid);
  background: rgba(179, 136, 255, 0.08);
  color: var(--text-secondary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 100%;
  cursor: pointer;
}

.message-group.sent .reply-quote {
  background: rgba(255, 255, 255, 0.1);
  border-left-color: rgba(255, 255, 255, 0.5);
}

/* ── In-App Notification Toast ─────────────────────────────────── */
.in-app-notification {
  position: fixed;
  top: 44px;
  right: 16px;
  z-index: 6000;
  background: var(--bg-glass);
  backdrop-filter: blur(20px);
  border: 1px solid var(--border-color);
  border-radius: var(--radius-md);
  padding: 12px 16px;
  display: flex;
  align-items: center;
  gap: 10px;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.4);
  min-width: 240px;
  max-width: 360px;
  cursor: pointer;
  animation: notifIn 0.3s ease;
}

.in-app-notification.hiding {
  animation: notifOut 0.3s ease forwards;
}

@keyframes notifIn {
  from {
    opacity: 0;
    transform: translateX(100px);
  }

  to {
    opacity: 1;
    transform: translateX(0);
  }
}

@keyframes notifOut {
  from {
    opacity: 1;
    transform: translateX(0);
  }

  to {
    opacity: 0;
    transform: translateX(100px);
  }
}

.notif-avatar {
  width: 36px;
  height: 36px;
  border-radius: var(--radius-full);
  background: linear-gradient(135deg, var(--accent-solid), var(--accent-hover));
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 14px;
  font-weight: 600;
  color: white;
  flex-shrink: 0;
}

.notif-body {
  flex: 1;
  min-width: 0;
}

.notif-name {
  font-size: 13px;
  font-weight: 600;
  color: var(--text-primary);
}

.notif-text {
  font-size: 12px;
  color: var(--text-secondary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* ── Video Call ─────────────────────────────────────────────────── */
.video-call-overlay {
  position: fixed;
  inset: 0;
  z-index: 1000;
  background: #0a0812;
}

.video-call-container {
  position: relative;
  width: 100%;
  height: 100%;
}

#remote-video {
  width: 100%;
  height: 100%;
  object-fit: cover;
  background: var(--bg-primary);
}

#local-video {
  position: absolute;
  top: 20px;
  right: 20px;
  width: 200px;
  height: 150px;
  border-radius: var(--radius-lg);
  object-fit: cover;
  border: 2px solid rgba(179, 136, 255, 0.3);
  box-shadow: var(--shadow-md);
  z-index: 10;
  background: var(--bg-secondary);
  cursor: grab;
  transition: box-shadow var(--transition-fast);
}

#local-video:hover {
  box-shadow: var(--shadow-lg);
}

/* Screen Source Picker */
.screen-picker-card {
  padding: 24px;
  max-width: 600px;
  width: 90%;
}

.screen-picker-card h3 {
  margin: 0 0 16px;
  font-size: 18px;
  font-weight: 600;
  color: var(--text-primary);
}

.screen-picker-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));
  gap: 12px;
  max-height: 400px;
  overflow-y: auto;
}

.screen-picker-item {
  cursor: pointer;
  border-radius: var(--radius-md);
  border: 2px solid transparent;
  padding: 8px;
  background: var(--bg-secondary);
  transition: all var(--transition-fast);
  text-align: center;
}

.screen-picker-item:hover {
  border-color: var(--accent-solid);
  background: var(--hover-bg);
}

.screen-picker-item img {
  width: 100%;
  height: auto;
  border-radius: var(--radius-sm);
  margin-bottom: 6px;
}

.screen-picker-item span {
  font-size: 12px;
  color: var(--text-secondary);
  display: block;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.call-info {
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  text-align: center;
  z-index: 5;
}

.call-info h2 {
  font-size: 28px;
  font-weight: 700;
  text-shadow: 0 2px 8px rgba(0, 0, 0, 0.5);
}

.call-info p {
  color: var(--text-secondary);
  font-size: 16px;
  margin-top: 4px;
}

.call-controls {
  position: absolute;
  bottom: 40px;
  left: 50%;
  transform: translateX(-50%);
  display: flex;
  gap: 12px;
  z-index: 20;
  padding: 14px 20px;
  background: rgba(10, 8, 18, 0.6);
  backdrop-filter: blur(24px);
  border-radius: var(--radius-xl);
  border: 1px solid var(--border-color);
}

.btn-call-control {
  width: 52px;
  height: 52px;
  border-radius: var(--radius-full);
  background: var(--bg-tertiary);
  border: none;
  color: var(--text-primary);
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: all var(--transition-fast);
  -webkit-app-region: no-drag;
}

.btn-call-control:hover {
  background: var(--bg-glass-hover);
  transform: scale(1.08);
}

.btn-call-control svg {
  width: 22px;
  height: 22px;
}

.btn-call-control.active {
  background: var(--accent);
  color: white;
}

.btn-end-call {
  background: var(--red) !important;
  color: white !important;
}

.btn-end-call:hover {
  background: #e64a44 !important;
}

.btn-accept-call {
  background: #69f0ae !important;
  color: var(--text-inverse) !important;
}

.btn-accept-call:hover {
  background: #56d89a !important;
}

.btn-screen-share {
  position: relative;
}

.btn-screen-share.sharing {
  background: var(--accent) !important;
  color: white !important;
  animation: shareGlow 2s ease-in-out infinite;
}

@keyframes shareGlow {

  0%,
  100% {
    box-shadow: none;
  }

  50% {
    box-shadow: 0 0 16px var(--accent-glow);
  }
}

/* ── Incoming Call Modal ───────────────────────────────────────── */
.incoming-call-modal {
  position: fixed;
  inset: 0;
  z-index: 2000;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(10, 8, 18, 0.8);
  backdrop-filter: blur(12px);
}

.incoming-call-card {
  padding: 40px;
  text-align: center;
  animation: slideUp 0.4s var(--transition-slow);
}

@keyframes slideUp {
  from {
    opacity: 0;
    transform: translateY(20px) scale(0.95);
  }

  to {
    opacity: 1;
    transform: translateY(0) scale(1);
  }
}

.incoming-call-avatar {
  width: 80px;
  height: 80px;
  border-radius: var(--radius-full);
  background: linear-gradient(135deg, var(--accent-solid), var(--accent-hover));
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 28px;
  font-weight: 700;
  color: white;
  margin: 0 auto 16px;
  animation: pulse 2s ease-in-out infinite;
}

@keyframes pulse {

  0%,
  100% {
    box-shadow: 0 0 0 0 var(--accent-glow);
  }

  50% {
    box-shadow: 0 0 0 16px transparent;
  }
}

.incoming-call-card h2 {
  font-size: 22px;
  font-weight: 700;
  margin-bottom: 4px;
}

.incoming-call-card p {
  color: var(--text-secondary);
  font-size: 15px;
  margin-bottom: 24px;
}

.incoming-call-actions {
  display: flex;
  justify-content: center;
  gap: 24px;
}

/* ── Modal ─────────────────────────────────────────────────────── */
.modal-overlay {
  position: fixed;
  inset: 0;
  z-index: 500;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(10, 8, 18, 0.7);
  backdrop-filter: blur(8px);
}

.modal {
  padding: 28px;
  width: 100%;
  max-width: 400px;
  animation: slideUp 0.3s var(--transition-slow);
}

.modal h3 {
  font-size: 18px;
  font-weight: 700;
  margin-bottom: 8px;
}

.modal p {
  color: var(--text-secondary);
  font-size: 14px;
  margin-bottom: 16px;
}

.modal .input-group {
  margin-bottom: 8px;
}

.modal-actions {
  display: flex;
  gap: 8px;
  justify-content: flex-end;
  margin-top: 16px;
}

.modal-actions .btn-primary {
  width: auto;
}

/* ── Loading Spinner ───────────────────────────────────────────── */
.spinner {
  width: 20px;
  height: 20px;
  border: 2px solid var(--text-tertiary);
  border-top-color: var(--accent);
  border-radius: var(--radius-full);
  animation: spin 0.6s linear infinite;
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}

/* ── Settings View ─────────────────────────────────────────────── */
.settings-container {
  display: flex;
  flex-direction: column;
  width: 100%;
  height: 100%;
  max-width: 560px;
  margin: 0 auto;
}

.settings-header {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 48px 24px 16px;
  border-bottom: 1px solid var(--border-color);
}

.settings-header h2 {
  font-size: 20px;
  font-weight: 600;
}

.settings-body {
  flex: 1;
  overflow-y: auto;
  padding: 24px;
  display: flex;
  flex-direction: column;
  gap: 32px;
}

.settings-section {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.settings-section h3 {
  font-size: 15px;
  font-weight: 600;
  color: var(--text-secondary);
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.settings-avatar-row {
  display: flex;
  align-items: center;
  gap: 20px;
}

.settings-avatar {
  width: 72px;
  height: 72px;
  border-radius: var(--radius-full);
  background: linear-gradient(135deg, var(--accent-solid), var(--accent-hover));
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 24px;
  font-weight: 600;
  color: white;
  flex-shrink: 0;
  overflow: hidden;
  position: relative;
}

.settings-avatar img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  border-radius: var(--radius-full);
}

.settings-avatar-actions {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.settings-hint {
  font-size: 12px;
  color: var(--text-tertiary);
}

.settings-row {
  display: flex;
  gap: 12px;
  align-items: center;
}

.settings-input {
  flex: 1;
  padding: 10px 14px;
  background: var(--bg-tertiary);
  border: 1px solid var(--border-color);
  border-radius: var(--radius-sm);
  color: var(--text-primary);
  font-family: var(--font);
  font-size: 15px;
  outline: none;
  transition: border-color var(--transition-fast);
  -webkit-app-region: no-drag;
}

.settings-input:focus {
  border-color: var(--border-focus);
}

.settings-btn {
  width: auto !important;
  padding: 10px 24px !important;
  white-space: nowrap;
}

.settings-status {
  font-size: 13px;
  min-height: 18px;
}

.settings-status.success {
  color: #69f0ae;
}

.settings-status.error {
  color: var(--red);
}

.settings-danger {
  padding: 20px;
  border: 1px solid rgba(255, 82, 82, 0.2);
  border-radius: var(--radius-md);
  background: rgba(255, 82, 82, 0.05);
}

.settings-danger h3 {
  color: var(--red);
}

.settings-danger p {
  font-size: 14px;
  color: var(--text-secondary);
}

.btn-danger {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 10px 24px;
  background: var(--red);
  color: white;
  border: none;
  border-radius: var(--radius-sm);
  font-family: var(--font);
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
  transition: all var(--transition-fast);
  -webkit-app-region: no-drag;
}

.btn-danger:hover {
  opacity: 0.85;
}

/* ── Emoji Picker (2.3) ────────────────────────────────────────── */
.emoji-picker {
  position: fixed;
  z-index: 2000;
  display: flex;
  gap: 4px;
  padding: 8px;
  background: var(--bg-primary);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-xl);
  backdrop-filter: blur(20px);
}

.emoji-btn {
  background: none;
  border: none;
  font-size: 20px;
  padding: 6px 8px;
  cursor: pointer;
  border-radius: var(--radius-sm);
  transition: transform 0.15s ease, background 0.15s ease;
}

.emoji-btn:hover {
  transform: scale(1.3);
  background: var(--hover-bg);
}

/* ── Reaction Chips (2.3) ──────────────────────────────────────── */
.reactions-row {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  margin-top: 2px;
}

.reaction-chip {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  background: var(--bg-secondary);
  border: 1px solid var(--border-subtle);
  border-radius: 12px;
  padding: 2px 8px;
  font-size: 13px;
  cursor: pointer;
  transition: all var(--transition-fast);
}

.reaction-chip:hover {
  background: var(--hover-bg);
  transform: scale(1.05);
}

.reaction-chip.my-reaction {
  border-color: var(--accent-solid);
  background: rgba(179, 136, 255, 0.12);
}

.reaction-chip span {
  font-size: 11px;
  color: var(--text-secondary);
}

/* ── Search Panel (2.4) ────────────────────────────────────────── */
.search-panel {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 16px;
  background: var(--bg-secondary);
  border-bottom: 1px solid var(--border-subtle);
}

.search-panel input {
  flex: 1;
  background: var(--bg-primary);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-md);
  padding: 6px 12px;
  font-size: 13px;
  font-family: var(--font);
  color: var(--text-primary);
  outline: none;
  transition: border-color var(--transition-fast);
}

.search-panel input:focus {
  border-color: var(--accent-solid);
}

.search-count {
  font-size: 12px;
  color: var(--text-secondary);
  white-space: nowrap;
}

.search-highlight {
  background: rgba(179, 136, 255, 0.15) !important;
  border-left: 3px solid var(--accent-solid) !important;
  border-radius: 0 var(--radius-md) var(--radius-md) 0 !important;
}

/* ── Edit Mode (2.2) ───────────────────────────────────────────── */
.editing-active {
  border-color: #f0b429 !important;
  box-shadow: 0 0 0 2px rgba(240, 180, 41, 0.2) !important;
}

/* ── Draft Label ───────────────────────────────────────────────── */
.draft-label {
  color: #e8a838;
  font-weight: 600;
  font-size: 12px;
}

/* ── Connection Banner (1.3) ────────────────────────────────────── */
.connection-banner {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  z-index: 9999;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 12px;
  padding: 8px 16px;
  background: linear-gradient(135deg, #ff6b35, #ff4444);
  color: white;
  font-size: 13px;
  font-weight: 500;
  font-family: var(--font);
  animation: slideDown 0.3s ease;
}

@keyframes slideDown {
  from {
    transform: translateY(-100%);
  }

  to {
    transform: translateY(0);
  }
}

.connection-retry-btn {
  background: rgba(255, 255, 255, 0.2);
  border: 1px solid rgba(255, 255, 255, 0.4);
  color: white;
  padding: 4px 12px;
  border-radius: var(--radius-sm);
  font-size: 12px;
  font-family: var(--font);
  cursor: pointer;
  transition: background var(--transition-fast);
}

.connection-retry-btn:hover {
  background: rgba(255, 255, 255, 0.35);
}

/* ── Typing Indicator ──────────────────────────────────────────── */
.typing-indicator {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 6px 16px;
  font-size: 12px;
  color: var(--text-tertiary);
}

.typing-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--accent-solid);
  animation: typingBounce 1.2s ease-in-out infinite;
}

.typing-dot:nth-child(2) {
  animation-delay: 0.2s;
}

.typing-dot:nth-child(3) {
  animation-delay: 0.4s;
}

@keyframes typingBounce {

  0%,
  60%,
  100% {
    transform: translateY(0);
    opacity: 0.4;
  }

  30% {
    transform: translateY(-4px);
    opacity: 1;
  }
}

.typing-label {
  margin-left: 4px;
  font-style: italic;
}

/* ── Delivery Ticks (1.2) ──────────────────────────────────────── */
.delivery-tick {
  display: inline-flex;
  align-items: center;
  margin-left: 4px;
  vertical-align: middle;
}

.tick-icon {
  width: 14px;
  height: 14px;
  color: rgba(255, 255, 255, 0.5);
}

.tick-read {
  color: var(--accent-solid);
}

.tick-failed {
  color: var(--red);
}

/* ── Retry Banner ──────────────────────────────────────────────── */
.retry-banner {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
  padding: 8px 16px;
  margin: 4px 12px;
  background: rgba(248, 81, 73, 0.12);
  border: 1px solid rgba(248, 81, 73, 0.3);
  border-radius: var(--radius-md);
  font-size: 13px;
  color: var(--red);
}

.retry-btn {
  background: var(--red);
  color: white;
  border: none;
  padding: 4px 12px;
  border-radius: var(--radius-sm);
  font-size: 12px;
  font-family: var(--font);
  cursor: pointer;
}

.retry-btn:hover {
  opacity: 0.85;
}

/* ── Responsive / Small Window ─────────────────────────────────── */
@media (max-width: 700px) {
  .sidebar {
    width: 260px;
    min-width: 260px;
  }

  #local-video {
    width: 120px;
    height: 90px;
  }
}```

## File: src/renderer/views/auth.js
```javascript
// auth.js — Auth / Setup UI Flow (Create + Restore)

const AuthView = {
    currentTab: 'create',

    init() {
        // Tab switching
        document.querySelectorAll('.auth-tab').forEach(tab => {
            tab.addEventListener('click', (e) => {
                document.querySelectorAll('.auth-tab').forEach(t => t.classList.remove('active'));
                e.target.classList.add('active');
                this.currentTab = e.target.dataset.tab;
                document.getElementById('auth-create-panel').classList.toggle('hidden', this.currentTab !== 'create');
                document.getElementById('auth-restore-panel').classList.toggle('hidden', this.currentTab !== 'restore');
            });
        });

        // Create account form
        document.getElementById('form-create').addEventListener('submit', async (e) => {
            e.preventDefault();
            await this.handleCreate();
        });

        // Restore account form
        document.getElementById('form-restore').addEventListener('submit', async (e) => {
            e.preventDefault();
            await this.handleRestore();
        });

        // Copy mnemonic button
        document.getElementById('btn-copy-mnemonic').addEventListener('click', () => {
            const text = document.getElementById('mnemonic-display').textContent;
            navigator.clipboard.writeText(text);
            const btn = document.getElementById('btn-copy-mnemonic');
            btn.textContent = 'Copied!';
            setTimeout(() => btn.textContent = 'Copy Words', 2000);
        });

        // Confirm mnemonic (proceed to main view)
        document.getElementById('btn-confirm-mnemonic').addEventListener('click', async () => {
            document.getElementById('mnemonic-step').classList.add('hidden');
            await App.initializeMainView();
        });
    },

    async handleCreate() {
        const name = document.getElementById('create-name').value.trim();
        if (!name) return;

        const btn = document.getElementById('btn-create');
        const origHTML = btn.innerHTML;
        btn.innerHTML = '<span>Creating...</span>';
        btn.disabled = true;

        try {
            const identity = await createNewIdentity(name);
            App.currentUser = identity;
            await P2P.initWithIdentity(identity);

            // Show the mnemonic to the user
            this.showMnemonic(identity.mnemonic);
        } catch (err) {
            console.error('Create failed:', err);
            this.showError('create-error', err.message || 'Failed to create account.');
        } finally {
            btn.innerHTML = origHTML;
            btn.disabled = false;
        }
    },

    showMnemonic(words) {
        const display = document.getElementById('mnemonic-display');
        display.innerHTML = '';
        words.forEach((word, i) => {
            const span = document.createElement('span');
            span.className = 'mnemonic-word';
            span.innerHTML = `<small>${i + 1}</small>${word}`;
            display.appendChild(span);
        });

        // Show the mnemonic step, hide the form
        document.getElementById('auth-create-panel').classList.add('hidden');
        document.getElementById('auth-restore-panel').classList.add('hidden');
        document.querySelector('.auth-tabs').classList.add('hidden');
        document.getElementById('mnemonic-step').classList.remove('hidden');
    },

    async handleRestore() {
        const wordsInput = document.getElementById('restore-words').value.trim().toLowerCase();
        const name = document.getElementById('restore-name').value.trim();
        
        if (!wordsInput || !name) {
            this.showError('restore-error', 'Please fill in all fields.');
            return;
        }

        const words = wordsInput.split(/\s+/);
        if (words.length !== 8) {
            this.showError('restore-error', 'Please enter exactly 8 words.');
            return;
        }

        // Validate words are in BIP-39 wordlist
        const invalid = words.filter(w => !BIP39_WORDLIST.includes(w));
        if (invalid.length > 0) {
            this.showError('restore-error', `Invalid words: ${invalid.join(', ')}`);
            return;
        }

        const btn = document.getElementById('btn-restore');
        const origHTML = btn.innerHTML;
        btn.innerHTML = '<span>Restoring...</span>';
        btn.disabled = true;

        try {
            const identity = await restoreFromMnemonic(words, name);
            App.currentUser = identity;
            await P2P.initWithIdentity(identity);
            await App.initializeMainView();
        } catch (err) {
            console.error('Restore failed:', err);
            this.showError('restore-error', err.message || 'Failed to restore account.');
        } finally {
            btn.innerHTML = origHTML;
            btn.disabled = false;
        }
    },

    showError(elementId, message) {
        document.getElementById(elementId).textContent = message;
    },

    resetUI() {
        document.getElementById('create-name').value = '';
        document.getElementById('restore-words').value = '';
        document.getElementById('restore-name').value = '';
        document.getElementById('create-error').textContent = '';
        document.getElementById('restore-error').textContent = '';
        document.getElementById('mnemonic-step').classList.add('hidden');
        document.getElementById('auth-create-panel').classList.remove('hidden');
        document.querySelector('.auth-tabs').classList.remove('hidden');
    },
};
```

## File: src/renderer/views/chat.js
```javascript
// chat.js — Chat interaction and message rendering (P2P + DB)

const ChatView = {
    currentConversation: null,
    currentPeer: null,
    pendingFile: null,
    typingTimeout: null,
    searchActive: false,

    init() {
        this.setupEventListeners();
        
        // Bind P2P callbacks
        P2P.onMessage = (data) => this.handleIncomingMessage(data);
        P2P.onReceipt = (data) => this.handleReceipt(data);
        P2P.onTyping = (data) => this.handleTyping(data);
        P2P.onPeerProfile = async (data) => {
            await ContactsView.loadContacts();
            await ContactsView.loadConversations();
            if (this.currentPeer && this.currentPeer.pubKeyHex === data.pubKeyHex) {
                this.currentPeer.profile = data.profile;
                this.updateHeaderStatus();
            }
        };

        window.addEventListener('file-received', (e) => this.handleFileReceived(e.detail));
    },

    setupEventListeners() {
        const input = document.getElementById('message-input');
        input.addEventListener('keypress', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                this.handleSend();
            }
        });
        
        input.addEventListener('input', () => {
            if (!this.currentPeer) return;
            P2P.sendTyping(this.currentPeer.pubKeyHex, true);
            
            clearTimeout(this.typingTimeout);
            this.typingTimeout = setTimeout(() => {
                P2P.sendTyping(this.currentPeer.pubKeyHex, false);
            }, 3000);
        });

        document.getElementById('btn-send').addEventListener('click', () => this.handleSend());

        // File input — instant (no delay)
        const fileInput = document.getElementById('file-input');
        fileInput.addEventListener('change', (e) => {
            const file = e.target.files[0];
            if (!file) return;
            if (file.size > 100 * 1024 * 1024) {
                alert('File too large (max 100MB)');
                e.target.value = '';
                return;
            }
            this.pendingFile = file;
            document.getElementById('file-preview-name').textContent = file.name;
            document.getElementById('file-preview-size').textContent = this.formatFileSize(file.size);
            document.getElementById('file-preview-bar').classList.remove('hidden');
            input.focus();
        });

        document.getElementById('btn-attach').addEventListener('click', () => fileInput.click());
        document.getElementById('btn-remove-file').addEventListener('click', () => this.clearPendingFile());

        // Header controls
        document.getElementById('btn-video-call').addEventListener('click', () => {
            if (this.currentPeer) VideoCallView.startCall(this.currentPeer.pubKeyHex, this.currentPeer.profile.name, false);
        });
        document.getElementById('btn-screen-share-chat').addEventListener('click', () => {
            if (this.currentPeer) VideoCallView.startCall(this.currentPeer.pubKeyHex, this.currentPeer.profile.name, true);
        });

        document.getElementById('btn-search-messages').addEventListener('click', () => this.toggleSearch());
        document.getElementById('btn-close-search').addEventListener('click', () => this.toggleSearch());
        document.getElementById('search-messages-input').addEventListener('input', (e) => this.performSearch(e.target.value));
    },

    showEmptyState() {
        document.getElementById('chat-empty').classList.remove('hidden');
        document.getElementById('chat-header').classList.add('hidden');
        document.getElementById('chat-messages').classList.add('hidden');
        document.getElementById('chat-input').classList.add('hidden');
        this.currentConversation = null;
        this.currentPeer = null;
    },

    async openConversation(conversation, peerContact) {
        this.currentConversation = conversation;
        this.currentPeer = peerContact;

        document.getElementById('chat-empty').classList.add('hidden');
        document.getElementById('chat-header').classList.remove('hidden');
        document.getElementById('chat-messages').classList.remove('hidden');
        document.getElementById('chat-input').classList.remove('hidden');

        document.getElementById('chat-peer-name').textContent = peerContact.profile.name;
        const avatarEl = document.getElementById('chat-peer-avatar');
        avatarEl.style.backgroundColor = peerContact.profile.avatarColor;
        avatarEl.innerHTML = `<span>${ContactsView.getInitials(peerContact.profile.name)}</span>`;
        
        this.updateHeaderStatus();

        const isConnected = await P2P.isPeerConnected(peerContact.pubKeyHex);
        if (!isConnected) {
            P2P.connectToPeer(peerContact.pubKeyHex).catch(() => {});
        }

        document.getElementById('chat-messages').innerHTML = '';
        await this.loadMessages();
        setTimeout(() => document.getElementById('message-input').focus(), 100);
    },

    updateHeaderStatus() {
        if (!this.currentPeer) return;
        const statusEl = document.getElementById('chat-peer-status');
        const isOnline = App.onlineUsers.has(this.currentPeer.pubKeyHex);
        statusEl.textContent = isOnline ? 'Online' : 'Offline';
        statusEl.classList.toggle('online', isOnline);
    },

    async loadMessages() {
        if (!this.currentConversation) return;
        
        const msgs = await getMessagesLocal(this.currentConversation.id);
        const container = document.getElementById('chat-messages');
        container.innerHTML = '';

        let currentDate = null;
        msgs.forEach(msg => {
            const msgDate = new Date(msg.timestamp).toISOString().split('T')[0];
            if (msgDate !== currentDate) {
                container.appendChild(this.createDateDivider(msg.timestamp));
                currentDate = msgDate;
            }
            container.appendChild(this.createMessageElement(msg));
        });

        this.scrollToBottom();
    },

    async handleSend() {
        const input = document.getElementById('message-input');
        const text = input.value.trim();
        
        if (!text && !this.pendingFile) return;
        input.value = '';

        // Handle file send
        if (this.pendingFile) {
            const file = this.pendingFile;
            this.clearPendingFile();
            
            try {
                await FileTransfer.sendFile(this.currentPeer.pubKeyHex, file);
                const conv = await getOrCreateConversationLocal(App.currentUser.pubKeyHex, this.currentPeer.pubKeyHex);
                const fileUrl = URL.createObjectURL(file);
                const isImg = file.type.startsWith('image/');
                const isVid = file.type.startsWith('video/');
                let contentHtml = `<a href="${fileUrl}" download="${file.name}" class="file-attachment text-preview">📄 ${file.name} (${(file.size / 1024 / 1024).toFixed(2)} MB) - Click to download</a>`;
                if (isImg) contentHtml = `<a href="${fileUrl}" download="${file.name}"><img src="${fileUrl}" class="file-attachment image-preview" style="max-width: 200px; border-radius: 8px;"></a>`;
                if (isVid) contentHtml = `<video src="${fileUrl}" controls class="file-attachment video-preview" style="max-width: 200px; border-radius: 8px;"></video>`;

                await saveMessage({
                    id: crypto.randomUUID(),
                    conversationId: conv.id,
                    senderId: App.currentUser.pubKeyHex,
                    content: contentHtml,
                    timestamp: Date.now(),
                    status: 'sent',
                    type: 'html',
                });
                await this.loadMessages();
                ContactsView.loadConversations();
            } catch (err) {
                console.error('File send failed:', err);
            }

            // Also send the text if there was one
            if (!text) return;
        }

        if (!text) return;

        try {
            await P2P.sendMessage(this.currentPeer.pubKeyHex, text);
            P2P.sendTyping(this.currentPeer.pubKeyHex, false);
            await this.loadMessages();
            ContactsView.loadConversations();
        } catch (error) {
            console.error('Send message failed:', error);
        }
    },

    handleIncomingMessage(data) {
        ContactsView.loadConversations();
        
        // Show notification if not viewing this conversation
        const isActive = this.currentConversation && this.currentConversation.id === data.conversationId;
        
        if (isActive) {
            this.loadMessages();
        }

        // Always show notification unless it's the active conversation
        if (!isActive || !document.hasFocus()) {
            const contact = ContactsView.contacts.find(c => c.pubKeyHex === data.remotePubKeyHex);
            const senderName = contact ? contact.profile.name : 'New message';
            const preview = data.plaintext.length > 60 ? data.plaintext.slice(0, 60) + '…' : data.plaintext;
            
            if (window.electronAPI) {
                window.electronAPI.showNotification(senderName, preview);
            }
        }
    },

    handleFileReceived(fileMeta) {
        const { from, name, size, mimeType, url } = fileMeta;
        ContactsView.loadConversations(); 
        
        if (this.currentPeer && this.currentPeer.pubKeyHex === from) {
            const isImg = mimeType.startsWith('image/');
            const isVid = mimeType.startsWith('video/');
            
            let contentHtml = `<a href="${url}" download="${name}" class="file-attachment text-preview">📄 ${name} (${(size/1024/1024).toFixed(2)} MB) - Click to download</a>`;
            if (isImg) contentHtml = `<a href="${url}" download="${name}"><img src="${url}" class="file-attachment image-preview" style="max-width: 200px; border-radius: 8px;"></a>`;
            if (isVid) contentHtml = `<video src="${url}" controls class="file-attachment video-preview" style="max-width: 200px; border-radius: 8px;"></video>`;

            saveMessage({
                id: crypto.randomUUID(),
                senderId: from,
                conversationId: this.currentConversation.id,
                content: contentHtml,
                timestamp: Date.now(),
                status: 'delivered',
                type: 'html'
            });

            this.loadMessages();
        }

        // Notification for file
        if (!this.currentPeer || this.currentPeer.pubKeyHex !== from || !document.hasFocus()) {
            const contact = ContactsView.contacts.find(c => c.pubKeyHex === from);
            const senderName = contact ? contact.profile.name : 'Someone';
            if (window.electronAPI) {
                window.electronAPI.showNotification(senderName, `📎 Sent a file: ${name}`);
            }
        }
    },



    handleReceipt(data) {
        const svg = document.getElementById(`status-${data.msgId}`);
        if (svg && data.status === 'delivered') {
            svg.classList.add('status-read');
        }
    },

    handleTyping(data) {
        if (!this.currentPeer || data.remotePubKeyHex !== this.currentPeer.pubKeyHex) return;
        const ind = document.getElementById('typing-indicator');
        if (data.isTyping) {
            ind.classList.remove('hidden');
            this.scrollToBottom();
        } else {
            ind.classList.add('hidden');
        }
    },

    createMessageElement(msg) {
        const isSelf = msg.senderId === App.currentUser.pubKeyHex;
        const el = document.createElement('div');
        el.className = `message ${isSelf ? 'message-self' : ''}`;
        el.dataset.id = msg.id;

        const timeStr = new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

        let statusHtml = '';
        if (isSelf) {
            const statusClass = msg.status === 'delivered' ? 'status-read' : '';
            statusHtml = `<svg id="status-${msg.id}" class="message-status ${statusClass}" viewBox="0 0 24 24" stroke="currentColor" fill="none" stroke-width="2.5" stroke-linecap="round"><path d="M5 13l4 4L19 7"/></svg>`;
        }

        let msgContent = msg.type === 'html' ? msg.content : this.escapeHtml(msg.content);

        el.innerHTML = `
            <div class="message-bubble">
                <div class="message-content">${msgContent}</div>
                <div class="message-meta">
                    <span class="message-time">${timeStr}</span>
                    ${statusHtml}
                </div>
            </div>
        `;
        return el;
    },

    createDateDivider(timestamp) {
        const date = new Date(timestamp);
        const now = new Date();
        const diffDays = Math.floor((now - date) / (1000 * 60 * 60 * 24));
        
        let label = date.toLocaleDateString([], { weekday: 'long', month: 'short', day: 'numeric' });
        if (diffDays === 0) label = 'Today';
        else if (diffDays === 1) label = 'Yesterday';

        const wrapper = document.createElement('div');
        wrapper.className = 'date-divider';
        wrapper.innerHTML = `<span>${label}</span>`;
        return wrapper;
    },

    clearPendingFile() {
        this.pendingFile = null;
        document.getElementById('file-preview-bar').classList.add('hidden');
        document.getElementById('file-input').value = '';
    },

    scrollToBottom() {
        const msgsEl = document.getElementById('chat-messages');
        requestAnimationFrame(() => { msgsEl.scrollTop = msgsEl.scrollHeight; });
    },

    formatFileSize(bytes) {
        if (bytes < 1024) return bytes + ' B';
        if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
        return (bytes / (1024 * 1024)).toFixed(2) + ' MB';
    },

    escapeHtml(str) {
        if (!str) return '';
        const div = document.createElement('div');
        div.textContent = str;
        return div.innerHTML;
    },

    toggleSearch() {
        this.searchActive = !this.searchActive;
        const panel = document.getElementById('search-panel');
        if (this.searchActive) {
            panel.classList.remove('hidden');
            document.getElementById('search-messages-input').focus();
        } else {
            panel.classList.add('hidden');
            document.getElementById('search-messages-input').value = '';
            this.performSearch('');
        }
    },

    performSearch(term) {
        const messages = document.querySelectorAll('.message-bubble');
        let count = 0;
        const lowerTerm = term.toLowerCase();

        messages.forEach(bubble => {
            const content = bubble.querySelector('.message-content').textContent.toLowerCase();
            const parent = bubble.parentElement;
            if (term && content.includes(lowerTerm)) { parent.style.display = 'flex'; count++; }
            else if (!term) { parent.style.display = 'flex'; }
            else { parent.style.display = 'none'; }
        });

        const countEl = document.getElementById('search-count');
        countEl.textContent = term ? `${count} matches` : '';
    }
};
```

## File: src/renderer/views/contacts.js
```javascript
// contacts.js — Manage Contacts and Conversations locally

const ContactsView = {
    conversations: [],
    contacts: [],

    init() {
        // Tab switching
        document.querySelectorAll('.sidebar-tab').forEach(tab => {
            tab.addEventListener('click', (e) => {
                document.querySelectorAll('.sidebar-tab').forEach(t => t.classList.remove('active'));
                document.querySelectorAll('.sidebar-panel').forEach(p => p.classList.remove('active'));
                
                e.target.classList.add('active');
                const panelId = `panel-${e.target.dataset.panel}`;
                document.getElementById(panelId).classList.add('active');
            });
        });

        // Search
        document.getElementById('search-contacts').addEventListener('input', (e) => {
            this.handleSearch(e.target.value);
        });

        // Add Contact Modal
        document.getElementById('btn-add-contact').addEventListener('click', () => {
            document.getElementById('modal-add-contact').classList.remove('hidden');
            setTimeout(() => document.getElementById('add-contact-id').focus(), 100);
        });

        document.getElementById('btn-cancel-add-contact').addEventListener('click', () => {
            document.getElementById('modal-add-contact').classList.add('hidden');
            document.getElementById('add-contact-id').value = '';
            document.getElementById('add-contact-error').textContent = '';
        });

        document.getElementById('btn-confirm-add-contact').addEventListener('click', () => this.addContact());
        
        // Handle enter key in add contact
        document.getElementById('add-contact-id').addEventListener('keypress', (e) => {
            if (e.key === 'Enter') this.addContact();
        });
    },

    async loadConversations() {
        try {
            this.conversations = await getConversationsLocal();
            this.renderConversations();
        } catch (error) {
            console.error('Failed to load conversations:', error);
        }
    },

    async loadContacts() {
        try {
            this.contacts = await getAllContacts();
            this.renderContacts();
        } catch (error) {
            console.error('Failed to load contacts:', error);
        }
    },

    async addContact() {
        const rawInput = document.getElementById('add-contact-id').value.trim();
        const errorEl = document.getElementById('add-contact-error');
        const btn = document.getElementById('btn-confirm-add-contact');
        
        if (!rawInput) return;

        // Clean up input — accept hex with or without dashes, spaces, etc.
        const pubKeyHex = rawInput.replace(/[-\s]/g, '').toLowerCase();

        // Validate: must be 64 hex chars (32-byte Ed25519 public key)
        if (!/^[0-9a-f]{64}$/.test(pubKeyHex)) {
            errorEl.textContent = 'Invalid User ID. Should be a 64-character hex string.';
            return;
        }

        // Don't add yourself
        if (pubKeyHex === App.currentUser.pubKeyHex) {
            errorEl.textContent = "That's your own ID!";
            return;
        }

        btn.innerHTML = '<span>Connecting...</span>';
        btn.disabled = true;
        errorEl.textContent = '';

        try {
            // Connect via Hyperswarm DHT
            await P2P.connectToPeer(pubKeyHex);
            
            // Wait a bit for profile exchange
            await new Promise(res => setTimeout(res, 3000));
            
            // Check if contact was added (P2P layer upserts it when profile received)
            let contact = await getContact(pubKeyHex);
            
            if (!contact) {
                // Not online immediately, add placeholder
                contact = {
                    pubKeyHex,
                    profile: { name: 'Unknown User', avatarColor: '#9e9e9e' }
                };
                await upsertContact(contact);
            }

            // Create a conversation
            const conv = await getOrCreateConversationLocal(App.currentUser.pubKeyHex, pubKeyHex);

            document.getElementById('modal-add-contact').classList.add('hidden');
            document.getElementById('add-contact-id').value = '';
            
            // Reload views
            await this.loadContacts();
            await this.loadConversations();
            
            // Switch to chats tab
            document.querySelector('[data-panel="conversations"]').click();
            ChatView.openConversation(conv, contact);

        } catch (error) {
            console.error('Add contact failed:', error);
            errorEl.textContent = 'Failed to connect. Make sure the ID is correct.';
        } finally {
            btn.innerHTML = '<span>Connect</span>';
            btn.disabled = false;
        }
    },

    renderConversations(filterText = '') {
        const listEl = document.getElementById('conversation-list');
        listEl.innerHTML = '';

        // Hydrate conversations with contact profiles
        const hydrated = this.conversations.map(conv => {
            const contact = this.contacts.find(c => c.pubKeyHex === conv.peerPubKeyHex) || 
                          { profile: { name: 'Unknown', avatarColor: '#9e9e9e' }};
            return { ...conv, peerProfile: contact.profile };
        });

        const filtered = hydrated.filter(conv => 
            conv.peerProfile.name.toLowerCase().includes(filterText.toLowerCase())
        );

        if (filtered.length === 0) {
            listEl.innerHTML = '<div style="padding: 20px; text-align: center; color: var(--text-secondary); font-size: 13px;">No chats found</div>';
            return;
        }

        filtered.forEach(conv => {
            const isOnline = App.onlineUsers.has(conv.peerPubKeyHex);
            const initials = this.getInitials(conv.peerProfile.name);
            const timeStr = conv.lastMessageAt ? new Date(conv.lastMessageAt).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'}) : '';
            const previewText = conv.lastMessagePreview || 'Started a conversation';
            const isActive = ChatView.currentConversation?.id === conv.id;

            const item = document.createElement('div');
            item.className = `contact-item ${isActive ? 'active' : ''}`;
            item.onclick = () => ChatView.openConversation(
                this.conversations.find(c => c.id === conv.id), 
                this.contacts.find(c => c.pubKeyHex === conv.peerPubKeyHex)
            );

            item.innerHTML = `
                <div class="contact-avatar" style="background-color: ${conv.peerProfile.avatarColor}">
                    ${initials}
                    <div class="status-indicator ${isOnline ? 'online' : 'offline'}"></div>
                </div>
                <div class="contact-info">
                    <div class="contact-header">
                        <span class="contact-name">${this.escapeHtml(conv.peerProfile.name)}</span>
                        <span class="contact-time">${timeStr}</span>
                    </div>
                    <span class="contact-preview">${this.escapeHtml(previewText)}</span>
                </div>
            `;
            listEl.appendChild(item);
        });
    },

    renderContacts(filterText = '') {
        const listEl = document.getElementById('contact-list');
        listEl.innerHTML = '';

        const filtered = this.contacts.filter(contact => 
            contact.profile.name.toLowerCase().includes(filterText.toLowerCase())
        );

        if (filtered.length === 0) {
            listEl.innerHTML = '<div style="padding: 20px; text-align: center; color: var(--text-secondary); font-size: 13px;">No contacts found</div>';
            return;
        }

        filtered.forEach(contact => {
            const isOnline = App.onlineUsers.has(contact.pubKeyHex);
            const initials = this.getInitials(contact.profile.name);

            const item = document.createElement('div');
            item.className = `contact-item`;
            item.onclick = async () => {
                const conv = await getOrCreateConversationLocal(App.currentUser.pubKeyHex, contact.pubKeyHex);
                document.querySelector('[data-panel="conversations"]').click();
                ChatView.openConversation(conv, contact);
            };

            item.innerHTML = `
                <div class="contact-avatar" style="background-color: ${contact.profile.avatarColor}">
                    ${initials}
                    <div class="status-indicator ${isOnline ? 'online' : 'offline'}"></div>
                </div>
                <div class="contact-info" style="justify-content: center">
                    <span class="contact-name">${this.escapeHtml(contact.profile.name)}</span>
                </div>
            `;
            listEl.appendChild(item);
        });
    },

    handleSearch(text) {
        const isChatsTab = document.querySelector('[data-panel="conversations"]').classList.contains('active');
        if (isChatsTab) {
            this.renderConversations(text);
        } else {
            this.renderContacts(text);
        }
    },

    updateOnlineStatuses() {
        // Just re-render the current lists to update the green dots
        this.renderConversations(document.getElementById('search-contacts').value);
        this.renderContacts(document.getElementById('search-contacts').value);
    },

    getInitials(name) {
        if (!name) return '?';
        return name.split(' ').map(n => n[0]).join('').substring(0, 2).toUpperCase();
    },

    escapeHtml(str) {
        if (!str) return '';
        const div = document.createElement('div');
        div.textContent = str;
        return div.innerHTML;
    }
};
```

## File: src/renderer/views/settings.js
```javascript
// settings.js — Local-first settings

const SettingsView = {
    init() {
        document.getElementById('btn-settings-back').addEventListener('click', () => {
            App.showView('main');
        });

        document.getElementById('btn-save-name').addEventListener('click', () => this.saveName());
        document.getElementById('btn-delete-account').addEventListener('click', () => this.deleteAccount());
        document.getElementById('btn-copy-userid').addEventListener('click', () => this.copyUserId());
        document.getElementById('btn-reveal-mnemonic').addEventListener('click', () => this.toggleMnemonic());
    },

    loadData() {
        const id = App.currentUser;
        if (!id) return;
        
        document.getElementById('settings-name').value = id.profile.name !== 'Anonymous' ? id.profile.name : '';
        
        // Show User ID (full hex, formatted)
        document.getElementById('settings-userid').value = id.pubKeyHex;
        
        // Hide mnemonic by default
        document.getElementById('settings-mnemonic').classList.add('hidden');
        document.getElementById('btn-reveal-mnemonic').textContent = 'Reveal';
        
        document.getElementById('name-status').textContent = '';
        document.getElementById('delete-status').textContent = '';
        document.getElementById('userid-status').textContent = '';
    },

    async saveName() {
        const newName = document.getElementById('settings-name').value.trim();
        if (!newName) return;

        const btn = document.getElementById('btn-save-name');
        btn.textContent = 'Saving...';
        btn.disabled = true;

        try {
            await updateIdentityProfile({ name: newName });
            App.currentUser = await getStoredIdentity();
            App.updateUserUI();
            this.showStatus('name-status', 'Name updated successfully', 'success');
        } catch (error) {
            console.error('Failed to update name:', error);
            this.showStatus('name-status', error.message || 'Failed to update name', 'error');
        } finally {
            btn.textContent = 'Save';
            btn.disabled = false;
        }
    },

    async copyUserId() {
        const input = document.getElementById('settings-userid');
        input.select();
        input.setSelectionRange(0, 99999);
        navigator.clipboard.writeText(input.value);
        this.showStatus('userid-status', 'Copied to clipboard!', 'success');
        setTimeout(() => {
            document.getElementById('userid-status').textContent = '';
        }, 2000);
    },

    toggleMnemonic() {
        const container = document.getElementById('settings-mnemonic');
        const btn = document.getElementById('btn-reveal-mnemonic');
        
        if (container.classList.contains('hidden')) {
            // Show mnemonic
            const words = App.currentUser.mnemonic;
            container.innerHTML = '';
            words.forEach((word, i) => {
                const span = document.createElement('span');
                span.className = 'mnemonic-word';
                span.innerHTML = `<small>${i + 1}</small>${word}`;
                container.appendChild(span);
            });
            container.classList.remove('hidden');
            btn.textContent = 'Hide';
        } else {
            container.classList.add('hidden');
            container.innerHTML = '';
            btn.textContent = 'Reveal';
        }
    },

    async deleteAccount() {
        if (!confirm('Are you sure you want to delete your account? This will erase all your local messages, contacts, and keys. This cannot be undone.')) {
            return;
        }

        const btn = document.getElementById('btn-delete-account');
        btn.textContent = 'Deleting...';
        btn.disabled = true;

        try {
            await P2P.teardown();
            await clearIdentity();
            await clearAllData();
            
            App.currentUser = null;
            App.onlineUsers = new Set();
            AuthView.resetUI();
            App.showView('auth');
            
        } catch (error) {
            console.error('Failed to delete account:', error);
            this.showStatus('delete-status', error.message || 'Failed to delete account.', 'error');
            btn.textContent = 'Delete My Account';
            btn.disabled = false;
        }
    },

    showStatus(elementId, message, type) {
        const el = document.getElementById(elementId);
        el.textContent = message;
        el.className = 'settings-status';
        el.classList.add(type);
        setTimeout(() => {
            if (el.textContent === message) el.textContent = '';
        }, 3000);
    }
};
```

## File: src/renderer/views/videoCall.js
```javascript
// ── Video Call View Controller ────────────────────────────────────
// Uses WebRTC (SimplePeer) for video/audio, signaling via Hyperswarm streams
const VideoCallView = {
    peer: null,
    localStream: null,
    screenStream: null,
    currentCallPeerId: null,
    isMuted: false,
    isCameraOff: false,
    isScreenSharing: false,
    startWithScreenShare: false,
    pendingSignals: [], // Buffer signals before peer is created

    init() {
        document.getElementById('btn-end-call').addEventListener('click', () => this.endCall());
        document.getElementById('btn-toggle-mic').addEventListener('click', () => this.toggleMic());
        document.getElementById('btn-toggle-camera').addEventListener('click', () => this.toggleCamera());
        document.getElementById('btn-screen-share').addEventListener('click', () => this.toggleScreenShare());
        document.getElementById('btn-accept-call').addEventListener('click', () => this.acceptCall());
        document.getElementById('btn-reject-call').addEventListener('click', () => this.rejectCall());

        // Set up P2P call signal handler — buffers signals if peer not ready
        P2P.onCallSignal = ({ from, data }) => {
            if (this.peer && this.currentCallPeerId === from && !this.peer.destroyed) {
                this.peer.signal(data);
            } else if (this.currentCallPeerId === from) {
                // Buffer signals until peer is created (receiver hasn't accepted yet)
                console.log('[VideoCall] Buffering signal from', from.slice(0, 12));
                this.pendingSignals.push(data);
            }
        };
    },

    // Called by P2P when a call-request message arrives
    handleIncomingCall(from, callerName) {
        console.log('[VideoCall] Incoming call from:', callerName);
        if (this.peer) {
            P2P.sendCallBusy(from);
            return;
        }
        this.currentCallPeerId = from;
        this.pendingSignals = []; // Clear old signals
        this.showIncomingCallUI(callerName);
    },

    handleCallAccepted(from) {
        console.log('[VideoCall] Call accepted by', from.slice(0, 12));
        document.getElementById('call-status').textContent = 'Connected';
        document.getElementById('call-info').classList.add('hidden');
    },

    handleCallRejected(from) {
        document.getElementById('call-status').textContent = 'Call rejected';
        setTimeout(() => this.endCall(), 2000);
    },

    handleCallEnded(from) {
        console.log('[VideoCall] Call ended by remote');
        document.getElementById('incoming-call-modal').classList.add('hidden');
        this.cleanupCall();
        App.showView('main');
    },

    handleCallBusy(from) {
        document.getElementById('call-status').textContent = 'User is busy on another call';
        setTimeout(() => this.endCall(), 2000);
    },

    // ── Start Call (caller side) ─────────────────────────────────────

    async startCall(peerId, peerName, withScreenShare = false) {
        this.currentCallPeerId = peerId;
        this.startWithScreenShare = withScreenShare;

        App.showView('video-call');
        document.getElementById('call-peer-name').textContent = peerName;
        document.getElementById('call-status').textContent = 'Calling...';
        document.getElementById('call-info').classList.remove('hidden');

        try {
            this.localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
            document.getElementById('local-video').srcObject = this.localStream;

            this.peer = new SimplePeer({
                initiator: true,
                stream: this.localStream,
                trickle: true,
                config: {
                    iceServers: [
                        { urls: 'stun:stun.l.google.com:19302' },
                        { urls: 'stun:stun1.l.google.com:19302' },
                        { urls: 'stun:global.stun.twilio.com:3478' }
                    ],
                },
            });

            this.peer.on('signal', (data) => {
                // Send call request with first offer, then signal data for ICE
                if (data.type === 'offer') {
                    P2P.sendCallRequest(peerId, App.currentUser.profile.name);
                }
                // Send all signal data (offer, answer, ICE candidates)
                P2P.sendCallSignal(peerId, data);
            });

            this.peer.on('stream', (remoteStream) => {
                console.log('[VideoCall] Remote stream received!');
                document.getElementById('remote-video').srcObject = remoteStream;
                document.getElementById('call-info').classList.add('hidden');
                if (this.startWithScreenShare) {
                    this.startWithScreenShare = false;
                    setTimeout(() => this.toggleScreenShare(), 500);
                }
            });

            this.peer.on('error', (err) => {
                console.error('[VideoCall] Peer error:', err);
                document.getElementById('call-status').textContent = 'Connection failed';
                setTimeout(() => this.endCall(), 3000);
            });

            this.peer.on('close', () => {
                this.cleanupCall();
                App.showView('main');
            });
        } catch (err) {
            console.error('[VideoCall] Failed to start call:', err);
            document.getElementById('call-status').textContent = 'Camera/mic access denied';
            setTimeout(() => this.endCall(), 3000);
        }
    },

    // ── Incoming Call UI ─────────────────────────────────────────────

    showIncomingCallUI(callerName) {
        const initials = ContactsView.getInitials(callerName);
        document.getElementById('incoming-caller-avatar').textContent = initials;
        document.getElementById('incoming-caller-name').textContent = callerName;
        document.getElementById('incoming-call-modal').classList.remove('hidden');

        if (window.electronAPI) {
            window.electronAPI.showNotification('Incoming Video Call', `${callerName} is calling you`);
        }
    },

    // ── Accept Call (receiver side) ──────────────────────────────────

    async acceptCall() {
        document.getElementById('incoming-call-modal').classList.add('hidden');
        if (!this.currentCallPeerId) return;
        const from = this.currentCallPeerId;

        App.showView('video-call');
        document.getElementById('call-peer-name').textContent = 'Connecting...';
        document.getElementById('call-status').textContent = 'Connecting...';
        document.getElementById('call-info').classList.remove('hidden');

        try {
            this.localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
            document.getElementById('local-video').srcObject = this.localStream;

            this.peer = new SimplePeer({
                initiator: false,
                stream: this.localStream,
                trickle: true,
                config: {
                    iceServers: [
                        { urls: 'stun:stun.l.google.com:19302' },
                        { urls: 'stun:stun1.l.google.com:19302' },
                        { urls: 'stun:global.stun.twilio.com:3478' }
                    ],
                },
            });

            this.peer.on('signal', (data) => {
                P2P.sendCallSignal(from, data);
                if (data.type === 'answer') {
                    P2P.sendCallAccepted(from);
                }
            });

            this.peer.on('stream', (remoteStream) => {
                console.log('[VideoCall] Remote stream received!');
                document.getElementById('remote-video').srcObject = remoteStream;
                document.getElementById('call-info').classList.add('hidden');
            });

            this.peer.on('error', (err) => {
                console.error('[VideoCall] Peer error:', err);
                this.endCall();
            });

            this.peer.on('close', () => {
                this.cleanupCall();
                App.showView('main');
            });

            // Replay any buffered signals (offer + ICE candidates that arrived before accept)
            console.log('[VideoCall] Replaying', this.pendingSignals.length, 'buffered signals');
            for (const sig of this.pendingSignals) {
                this.peer.signal(sig);
            }
            this.pendingSignals = [];
        } catch (err) {
            console.error('[VideoCall] Failed to accept call:', err);
            this.endCall();
        }
    },

    rejectCall() {
        document.getElementById('incoming-call-modal').classList.add('hidden');
        if (this.currentCallPeerId) {
            P2P.sendCallRejected(this.currentCallPeerId);
            this.currentCallPeerId = null;
        }
    },

    // ── Screen Sharing with Source Picker ─────────────────────────────

    async toggleScreenShare() {
        if (this.isScreenSharing) {
            this.stopScreenShare();
        } else {
            await this.startScreenShare();
        }
    },

    async startScreenShare() {
        try {
            if (window.electronAPI && window.electronAPI.getDesktopSources) {
                const sources = await window.electronAPI.getDesktopSources();
                if (!sources || sources.length === 0) {
                    console.warn('[VideoCall] No screen sources available');
                    return;
                }

                const selectedSource = await this.showScreenPicker(sources);
                if (!selectedSource) return;

                this.screenStream = await navigator.mediaDevices.getUserMedia({
                    audio: false,
                    video: {
                        mandatory: {
                            chromeMediaSource: 'desktop',
                            chromeMediaSourceId: selectedSource.id,
                            maxWidth: 1920,
                            maxHeight: 1080,
                            maxFrameRate: 30
                        },
                    },
                });
            } else {
                this.screenStream = await navigator.mediaDevices.getDisplayMedia({
                    video: { cursor: 'always' },
                });
            }

            this.isScreenSharing = true;
            document.getElementById('btn-screen-share').classList.add('sharing');

            if (this.peer && this.localStream) {
                const screenTrack = this.screenStream.getVideoTracks()[0];
                const sender = this.peer._pc
                    .getSenders()
                    .find((s) => s.track && s.track.kind === 'video');
                if (sender) sender.replaceTrack(screenTrack);
                screenTrack.onended = () => this.stopScreenShare();
            }
        } catch (err) {
            console.error('[VideoCall] Screen share failed:', err);
            this.isScreenSharing = false;
        }
    },

    showScreenPicker(sources) {
        return new Promise((resolve) => {
            const modal = document.getElementById('screen-picker-modal');
            const grid = document.getElementById('screen-picker-grid');
            grid.innerHTML = '';

            for (const source of sources) {
                const item = document.createElement('div');
                item.className = 'screen-picker-item';
                item.innerHTML = `
                    <img src="${source.thumbnail}" alt="${source.name}" />
                    <span>${source.name.substring(0, 30)}</span>
                `;
                item.addEventListener('click', () => {
                    modal.classList.add('hidden');
                    resolve(source);
                });
                grid.appendChild(item);
            }

            document.getElementById('btn-cancel-screen-pick').onclick = () => {
                modal.classList.add('hidden');
                resolve(null);
            };

            modal.classList.remove('hidden');
        });
    },

    stopScreenShare() {
        this.isScreenSharing = false;
        document.getElementById('btn-screen-share').classList.remove('sharing');

        if (this.screenStream) {
            this.screenStream.getTracks().forEach((t) => t.stop());
            this.screenStream = null;
        }

        if (this.peer && this.localStream) {
            const cameraTrack = this.localStream.getVideoTracks()[0];
            if (cameraTrack) {
                const sender = this.peer._pc
                    .getSenders()
                    .find((s) => s.track && s.track.kind === 'video');
                if (sender) sender.replaceTrack(cameraTrack);
            }
        }
    },

    // ── End & Cleanup ────────────────────────────────────────────────

    endCall() {
        if (this.currentCallPeerId) {
            P2P.sendCallEnded(this.currentCallPeerId);
        }
        this.cleanupCall();
        App.showView('main');
    },

    cleanupCall() {
        if (this.isScreenSharing) this.stopScreenShare();

        if (this.peer) {
            this.peer.destroy();
            this.peer = null;
        }
        if (this.localStream) {
            this.localStream.getTracks().forEach((t) => t.stop());
            this.localStream = null;
        }

        document.getElementById('local-video').srcObject = null;
        document.getElementById('remote-video').srcObject = null;

        this.currentCallPeerId = null;
        this.isMuted = false;
        this.isCameraOff = false;
        this.isScreenSharing = false;
        this.startWithScreenShare = false;
        this.pendingSignals = [];

        document.getElementById('incoming-call-modal').classList.add('hidden');

        document.getElementById('icon-mic-on').classList.remove('hidden');
        document.getElementById('icon-mic-off').classList.add('hidden');
        document.getElementById('icon-cam-on').classList.remove('hidden');
        document.getElementById('icon-cam-off').classList.add('hidden');
        document.getElementById('btn-screen-share').classList.remove('sharing');
    },

    toggleMic() {
        if (!this.localStream) return;
        this.isMuted = !this.isMuted;
        this.localStream.getAudioTracks().forEach((t) => (t.enabled = !this.isMuted));
        document.getElementById('icon-mic-on').classList.toggle('hidden', this.isMuted);
        document.getElementById('icon-mic-off').classList.toggle('hidden', !this.isMuted);
    },

    toggleCamera() {
        if (!this.localStream) return;
        this.isCameraOff = !this.isCameraOff;
        this.localStream.getVideoTracks().forEach((t) => (t.enabled = !this.isCameraOff));
        document.getElementById('icon-cam-on').classList.toggle('hidden', this.isCameraOff);
        document.getElementById('icon-cam-off').classList.toggle('hidden', !this.isCameraOff);
    },
};
```

