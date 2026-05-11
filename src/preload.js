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
