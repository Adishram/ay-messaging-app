const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
    showNotification: (title, body) =>
        ipcRenderer.invoke('show-notification', { title, body }),
    getSignalingPort: () => ipcRenderer.invoke('get-signaling-port'),
    getDesktopSources: () => ipcRenderer.invoke('get-desktop-sources'),
    openExternal: (url) => ipcRenderer.invoke('open-external', url),
    safeStorageEncrypt: (data) => ipcRenderer.invoke('safe-storage-encrypt', data),
    safeStorageDecrypt: (data) => ipcRenderer.invoke('safe-storage-decrypt', data),
});
