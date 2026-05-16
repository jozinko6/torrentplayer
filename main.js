/* ============================================
   TorrentStream Desktop - Electron Main Process
   ============================================ */

const { app, BrowserWindow, dialog, ipcMain } = require('electron');
const path = require('path');

let mainWindow = null;
let client = null;
let currentTorrent = null;
let currentStreamServer = null;
let parseTorrent = null;

async function getParseTorrent() {
  if (!parseTorrent) {
    const mod = await import('parse-torrent');
    parseTorrent = mod.default;
  }
  return parseTorrent;
}

async function parseTorrentIdentifier(torrentId) {
  const parse = await getParseTorrent();
  return await parse(torrentId);
}

function destroyCurrentTorrent() {
  return new Promise((resolve) => {
    if (!currentTorrent) return resolve();
    const torrent = currentTorrent;
    currentTorrent = null;
    try {
      torrent.destroy({}, () => resolve());
    } catch (e) {
      console.warn('Error destroying previous torrent:', e.message);
      resolve();
    }
  });
}

function getExistingTorrent(infoHash) {
  if (!client || !infoHash) return null;
  return client.torrents.find(t => t.infoHash === infoHash) || null;
}

// ============================================
// Create the main window
// ============================================
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    title: 'TorrentStream',
    icon: path.join(__dirname, 'icon.png'),
    backgroundColor: '#121212',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      enableRemoteModule: false
    }
  });

  // Load the PWA
  mainWindow.loadFile('index.html');

  // Remove menu bar for cleaner look
  mainWindow.setMenuBarVisibility(false);

  // Open DevTools in development
  if (process.argv.includes('--dev')) {
    mainWindow.webContents.openDevTools();
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// ============================================
// Initialize WebTorrent in Node.js (supports ALL tracker protocols)
// Uses dynamic import() because webtorrent is ESM-only
// ============================================
async function initWebTorrent() {
  try {
    const WebTorrent = await import('webtorrent');
    const WebTorrentClient = WebTorrent.default;

    client = new WebTorrentClient({
      tracker: {
        announce: [
          // UDP trackers (work in Node.js, NOT in browser)
          'udp://tracker.openbittorrent.com:80',
          'udp://tracker.publicbittorrent.com:80',
          'udp://tracker.leechers-paradise.org:6969',
          'udp://tracker.coppersurfer.tk:6969',
          'udp://tracker.ex.ua:80',
          'udp://tracker.opentrackr.org:1337',
          'udp://tracker.torrent.eu.org:451',
          'udp://tracker.moeking.me:6969',
          // HTTP/HTTPS trackers (work in Node.js)
          'https://tracker.opentrackr.org:443/announce',
          'https://tracker.nanoha.org:443/announce',
          // WebSocket trackers
          'wss://tracker.btorrent.xyz:443/announce',
          'wss://tracker.openwebtorrent.com:443/announce',
          'wss://tracker.files.fm:7073/announce',
          'wss://tracker.webtorrent.dev:443/announce'
        ]
      }
    });

    console.log('WebTorrent client initialized in Node.js');
    console.log('All tracker protocols supported: UDP, HTTP, HTTPS, WebSocket');
  } catch (err) {
    console.error('Failed to initialize WebTorrent:', err.message);
  }
}

// ============================================
// IPC Handlers - Communication with renderer
// ============================================

/**
 * Add a torrent from file buffer
 */
ipcMain.handle('add-torrent-buffer', async (event, data) => {
  try {
    if (!client) return { error: 'WebTorrent client is not initialized' };

    // Convert Uint8Array (from IPC) to Buffer for WebTorrent
    const buffer = Buffer.from(data);
    let parsed;
    try {
      parsed = await parseTorrentIdentifier(buffer);
    } catch (err) {
      return { error: 'Neplatný .torrent súbor: ' + err.message };
    }

    const existing = getExistingTorrent(parsed.infoHash);
    if (existing) {
      return { duplicate: true, infoHash: existing.infoHash };
    }

    await destroyCurrentTorrent();

    return new Promise((resolve, reject) => {
      let settled = false;
      const torrentHandle = client.add(buffer, (torrent) => {
        if (settled) return;
        settled = true;
        currentTorrent = torrent;
        console.log('Torrent added:', torrent.infoHash);

        // Send torrent info to renderer immediately (files from .torrent metadata)
        const filesInfo = torrent.files.map(f => ({
          name: f.name,
          length: f.length,
          path: f.path,
          index: torrent.files.indexOf(f)
        }));

        mainWindow.webContents.send('torrent-added', {
          infoHash: torrent.infoHash,
          name: torrent.name,
          files: filesInfo
        });

        // Send ready event immediately since we already have files from .torrent
        // (client.add callback fires AFTER metadata is parsed from .torrent file)
        console.log('Torrent ready (from .torrent metadata), files:', torrent.files.length);
        mainWindow.webContents.send('torrent-ready', {
          files: filesInfo
        });

        // Listen for actual ready event (when peers connect)
        torrent.on('ready', () => {
          console.log('Torrent peers connected, files:', torrent.files.length);
        });

        // Listen for errors
        torrent.on('error', (err) => {
          console.error('Torrent error:', err.message);
          mainWindow.webContents.send('torrent-error', err.message);
        });

        // Listen for warnings
        torrent.on('warning', (err) => {
          console.warn('Torrent warning:', err.message);
          mainWindow.webContents.send('torrent-warning', err.message);
        });

        // Listen for download progress
        torrent.on('download', () => {
          mainWindow.webContents.send('torrent-progress', {
            progress: torrent.progress,
            downloadSpeed: torrent.downloadSpeed,
            uploadSpeed: torrent.uploadSpeed,
            numPeers: torrent.numPeers
          });
        });

        // Listen for done
        torrent.on('done', () => {
          console.log('Torrent download complete');
          mainWindow.webContents.send('torrent-done');
        });

        resolve({ infoHash: torrent.infoHash });
      });

      torrentHandle.once('error', (err) => {
        if (settled) return;
        settled = true;
        console.error('Error adding torrent:', err.message);
        resolve({ error: err.message });
      });
    });
  } catch (err) {
    console.error('Error adding torrent:', err);
    return { error: err.message };
  }
});

/**
 * Add a torrent from magnet URI
 */
ipcMain.handle('add-torrent-magnet', async (event, magnetURI) => {
  try {
    if (!client) return { error: 'WebTorrent client is not initialized' };
    let parsed;
    try {
      parsed = await parseTorrentIdentifier(magnetURI);
    } catch (err) {
      return { error: 'Neplatný magnet link: ' + err.message };
    }

    const existing = getExistingTorrent(parsed.infoHash);
    if (existing) {
      return { duplicate: true, infoHash: existing.infoHash };
    }

    await destroyCurrentTorrent();

    return new Promise((resolve, reject) => {
      // Add with error handling for duplicate torrents
      let settled = false;
      const torrentHandle = client.add(magnetURI, (torrent) => {
        if (settled) return;
        settled = true;
        currentTorrent = torrent;
        console.log('Torrent added from magnet:', torrent.infoHash);

        const filesInfo = torrent.files.map(f => ({
          name: f.name,
          length: f.length,
          path: f.path,
          index: torrent.files.indexOf(f)
        }));

        mainWindow.webContents.send('torrent-added', {
          infoHash: torrent.infoHash,
          name: torrent.name,
          files: filesInfo
        });

        // Send ready immediately since callback fires after metadata is fetched
        console.log('Torrent ready (from magnet metadata), files:', torrent.files.length);
        mainWindow.webContents.send('torrent-ready', {
          files: filesInfo
        });

        torrent.on('ready', () => {
          console.log('Torrent peers connected, files:', torrent.files.length);
        });

        torrent.on('error', (err) => {
          console.error('Torrent error:', err.message);
          mainWindow.webContents.send('torrent-error', err.message);
        });

        torrent.on('warning', (err) => {
          console.warn('Torrent warning:', err.message);
          mainWindow.webContents.send('torrent-warning', err.message);
        });

        torrent.on('download', () => {
          mainWindow.webContents.send('torrent-progress', {
            progress: torrent.progress,
            downloadSpeed: torrent.downloadSpeed,
            uploadSpeed: torrent.uploadSpeed,
            numPeers: torrent.numPeers
          });
        });

        torrent.on('done', () => {
          console.log('Torrent download complete');
          mainWindow.webContents.send('torrent-done');
        });

        resolve({ infoHash: torrent.infoHash });
      });

      torrentHandle.once('error', (err) => {
        if (settled) return;
        settled = true;
        console.error('Error adding magnet:', err.message);
        resolve({ error: err.message });
      });
    });
  } catch (err) {
    console.error('Error adding torrent:', err);
    return { error: err.message };
  }
});

/**
 * Get a file stream URL for the renderer
 */
ipcMain.handle('get-file-stream', async (event, fileIndex) => {
  if (!currentTorrent || !currentTorrent.files[fileIndex]) {
    return { error: 'File not found' };
  }

  const file = currentTorrent.files[fileIndex];

  // Create a server to stream the file
  return new Promise((resolve, reject) => {
    // Use the file's stream URL via WebTorrent's built-in HTTP server
    // The server's default pathname is '/webtorrent'
    const finish = (server) => {
      const port = server.address().port;
      // URL format: /webtorrent/<infoHash>/<filePath>
      // Replace backslashes with forward slashes for Windows compatibility
      const filePath = file.path.replace(/\\/g, '/');
      const url = `http://localhost:${port}/webtorrent/${currentTorrent.infoHash}/${encodeURI(filePath)}`;
      console.log('Stream URL:', url);
      resolve({ url, port });
    };

    if (currentStreamServer && currentStreamServer.address()) {
      finish(currentStreamServer);
      return;
    }

    currentStreamServer = client.createServer();
    currentStreamServer.listen(0, () => finish(currentStreamServer));
  });
});

/**
 * Save a file to disk
 */
ipcMain.handle('save-file', async (event, fileIndex) => {
  if (!currentTorrent || !currentTorrent.files[fileIndex]) {
    return { error: 'File not found' };
  }

  const file = currentTorrent.files[fileIndex];

  const result = await dialog.showSaveDialog(mainWindow, {
    defaultPath: file.name,
    filters: [
      { name: 'Video files', extensions: ['mp4', 'webm', 'mkv', 'avi', 'mov'] },
      { name: 'All files', extensions: ['*'] }
    ]
  });

  if (result.canceled) {
    return { canceled: true };
  }

  return new Promise((resolve, reject) => {
    const fs = require('fs');
    const stream = file.createReadStream();
    const writeStream = fs.createWriteStream(result.filePath);

    stream.pipe(writeStream);

    writeStream.on('finish', () => {
      console.log('File saved to:', result.filePath);
      resolve({ saved: true, path: result.filePath });
    });

    writeStream.on('error', (err) => {
      console.error('Error saving file:', err);
      resolve({ error: err.message });
    });
  });
});

/**
 * Destroy current torrent
 */
ipcMain.handle('destroy-torrent', async () => {
  await destroyCurrentTorrent();
  return { success: true };
});

// ============================================
// App lifecycle
// ============================================

app.whenReady().then(async () => {
  await initWebTorrent();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (currentTorrent) {
    currentTorrent.destroy();
  }
  if (currentStreamServer) {
    currentStreamServer.close();
  }
  if (client) {
    client.destroy();
  }
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
