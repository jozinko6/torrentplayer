/* ============================================
   TorrentStream Desktop - Preload Script
   Bridges Electron IPC to renderer process
   ============================================ */

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('torrentAPI', {
  // Add torrent from file buffer
  addTorrentBuffer: (buffer) => ipcRenderer.invoke('add-torrent-buffer', buffer),

  // Add torrent from magnet URI
  addTorrentMagnet: (magnetURI) => ipcRenderer.invoke('add-torrent-magnet', magnetURI),

  // Get file stream URL
  getFileStream: (fileIndex) => ipcRenderer.invoke('get-file-stream', fileIndex),

  // Save file to disk
  saveFile: (fileIndex) => ipcRenderer.invoke('save-file', fileIndex),

  // Destroy current torrent
  destroyTorrent: () => ipcRenderer.invoke('destroy-torrent'),

  // Event listeners
  onTorrentAdded: (callback) => ipcRenderer.on('torrent-added', (event, data) => callback(data)),
  onTorrentReady: (callback) => ipcRenderer.on('torrent-ready', (event, data) => callback(data)),
  onTorrentError: (callback) => ipcRenderer.on('torrent-error', (event, msg) => callback(msg)),
  onTorrentWarning: (callback) => ipcRenderer.on('torrent-warning', (event, msg) => callback(msg)),
  onTorrentProgress: (callback) => ipcRenderer.on('torrent-progress', (event, data) => callback(data)),
  onTorrentDone: (callback) => ipcRenderer.on('torrent-done', () => callback()),

  // Remove listeners
  removeAllListeners: () => {
    ipcRenderer.removeAllListeners('torrent-added');
    ipcRenderer.removeAllListeners('torrent-ready');
    ipcRenderer.removeAllListeners('torrent-error');
    ipcRenderer.removeAllListeners('torrent-warning');
    ipcRenderer.removeAllListeners('torrent-progress');
    ipcRenderer.removeAllListeners('torrent-done');
  }
});
