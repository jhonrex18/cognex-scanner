const { app, BrowserWindow, ipcMain } = require('electron');
const net = require('net');
const http = require('http');
const fs = require('fs');
const path = require('path');

let mainWindow;
const clients = {};
const reconnectAttempts = {};

// Save config in project root
const CONFIG_FILE = path.join(__dirname, '..', 'config.json');

// Queue for API requests
const apiQueue = [];
let isSending = false;

// Load targets from config.json (with LGNUM and SERVER)
function loadTargets() {
  if (fs.existsSync(CONFIG_FILE)) {
    try {
      const data = fs.readFileSync(CONFIG_FILE, 'utf-8');
      const saved = JSON.parse(data);
      if (Array.isArray(saved)) {
        console.log('Loaded scanners:', saved);
        return saved;
      }
    } catch (err) {
      console.error('Failed to parse config.json:', err.message);
    }
  }
  console.log('No config found or invalid — starting with no scanners');
  return [];
}

// Save targets to config.json
function saveTargets() {
  try {
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(targets, null, 2), 'utf-8');
    console.log('Scanners saved to:', CONFIG_FILE);
  } catch (err) {
    console.error('Failed to save config.json:', err.message);
  }
}

// Load targets
let targets = loadTargets();

// Process API Queue
function processApiQueue() {
  if (isSending || apiQueue.length === 0) return;
  isSending = true;

  const { serial, lgnum, server, callback } = apiQueue[0];
  const url = `/api/HosttoWESPalletReceivingOrder?huident=${encodeURIComponent(serial)}&lgnum=${lgnum}&server=${server}`;

  const options = {
    hostname: '192.168.5.139',
    port: 59629,
    path: url,
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': 0
    },
    timeout: 10_000
  };

  const req = http.request(options, (res) => {
    let body = '';
    res.on('data', (chunk) => (body += chunk));
    res.on('end', () => {
      const success = res.statusCode >= 200 && res.statusCode < 300;

      // Log full API response
      console.log(`API Response [${res.statusCode}] ${url}`);
      console.log(`Response Body:`, body);

      if (success) {
        console.log(`API Success: ${serial} → LGNUM=${lgnum}, SERVER=${server}`);
        apiQueue.shift();
        isSending = false;
        callback(true);
        processApiQueue();
      } else {
        console.error(`API FAILED: Status ${res.statusCode}, Body:`, body);
        isSending = false;
        setTimeout(processApiQueue, 5000);
      }
    });
  });

  req.on('error', (err) => {
    console.error('API Request Failed:', err.message);
    console.error('Full Error:', err);
    isSending = false;
    setTimeout(processApiQueue, 5000);
  });

  req.on('timeout', () => {
    console.warn('API Request Timed Out:', { serial, lgnum, server });
    req.destroy();
    isSending = false;
    setTimeout(processApiQueue, 5000);
  });

  req.end();
}

// Add to API queue
function sendToApi(serial, lgnum, server) {
  return new Promise((resolve) => {
    apiQueue.push({ serial, lgnum, server, callback: resolve });
    console.log('Queued for API:', { serial, lgnum, server });
    processApiQueue();
  });
}

// Connect to Target
function connectToTarget(target) {
  const { ip, port, LGNUM = 'WH05', SERVER = 'prd' } = target;
  const key = `${ip}:${port}`;

  if (clients[key]) {
    console.warn(`Already connecting: ${key}`);
    return;
  }

  if (!reconnectAttempts[key]) {
    reconnectAttempts[key] = 0;
  }

  const client = new net.Socket();
  clients[key] = client;

  client.connect(port, ip, () => {
    console.log(`Connected to ${key}`);
    reconnectAttempts[key] = 0;
    client.write('\r\n'); // Clean handshake

    if (mainWindow && mainWindow.webContents) {
      mainWindow.webContents.send('connection-established', { source: key });
    }
  });

  client.on('data', (data) => {
    const rawString = data.toString();
    const serial = rawString
      .replace(/[\r\n\t\s\x00-\x1F\x7F-\x9F]/g, '')
      .trim();

    if (serial) {
      console.log(`Scan from ${key}: ${serial}`);

      // Send to frontend
      if (mainWindow && mainWindow.webContents) {
        mainWindow.webContents.send('serial-scanned', {
          source: key,
          serial
        });
      }

      // Send to API
      sendToApi(serial, LGNUM, SERVER).then(success => {
        if (success) {
          console.log(`API OK: ${serial}`);
          if (mainWindow && mainWindow.webContents) {
            mainWindow.webContents.send('api-success', { source: key, serial });
          }
        }
      }).catch(err => {
        console.error('API failed:', err);
        if (mainWindow && mainWindow.webContents) {
          mainWindow.webContents.send('api-error', { source: key, serial, error: err.message });
        }
      });
    }
  });

  client.on('error', (err) => {
    console.error(`Socket error ${key}:`, err.message);
    cleanupClient(key);
    maybeReconnect(target);
  });

  client.on('close', () => {
    console.warn(`Connection closed ${key}`);
    if (mainWindow && mainWindow.webContents) {
      mainWindow.webContents.send('connection-closed', { source: key });
    }
    cleanupClient(key);
    maybeReconnect(target);
  });
}

function cleanupClient(key) {
  if (clients[key]) {
    clients[key].destroy();
    delete clients[key];
  }
}

function maybeReconnect(target) {
  const key = `${target.ip}:${target.port}`;
  const stillExists = targets.some(t => t.ip === target.ip && t.port === target.port);
  if (!stillExists) return;

  reconnectAttempts[key] = (reconnectAttempts[key] || 0) + 1;
  const maxRetries = 5;

  if (reconnectAttempts[key] <= maxRetries) {
    console.log(`(${reconnectAttempts[key]}/5) Reconnecting to ${key}...`);
    setTimeout(() => {
      if (!clients[key]) {
        connectToTarget(target);
      }
    }, 3000);
  } else {
    console.log(`Max retries reached for ${key}. Waiting for manual reconnect.`);
    if (mainWindow && mainWindow.webContents) {
      mainWindow.webContents.send('reconnect-failed', { source: key });
    }
  }
}

// Manual reconnect
ipcMain.on('manual-reconnect', (event, target) => {
  const exists = targets.some(t => t.ip === target.ip && t.port === target.port);
  if (!exists) return;

  const key = `${target.ip}:${target.port}`;
  console.log(`Manual reconnect: ${key}`);
  reconnectAttempts[key] = 0;

  if (clients[key]) {
    clients[key].destroy();
    delete clients[key];
  }

  connectToTarget(target);
});

// Remove scanner
ipcMain.on('remove-scanner', (event, target) => {
  const key = `${target.ip}:${target.port}`;
  console.log(`Removing scanner: ${key}`);

  if (clients[key]) {
    clients[key].destroy();
    delete clients[key];
  }

  const index = targets.findIndex(t => t.ip === target.ip && t.port === target.port);
  if (index !== -1) {
    targets.splice(index, 1);
    saveTargets();
  }

  delete reconnectAttempts[key];

  if (mainWindow && mainWindow.webContents) {
    mainWindow.webContents.send('scanner-removed', { source: key });
  }
});

// Add new scanner
ipcMain.on('add-target', (event, target) => {
  const newTarget = {
    ip: target.ip,
    port: target.port,
    LGNUM: target.LGNUM || 'WH05',
    SERVER: target.SERVER || 'prd'
  };

  const exists = targets.some(t => t.ip === newTarget.ip && t.port === newTarget.port);
  if (!exists) {
    targets.push(newTarget);
    saveTargets();
    connectToTarget(newTarget);
  }
});

function connectToAllTargets() {
  targets.forEach(connectToTarget);
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1000,
    height: 700,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false
    }
  });

  mainWindow.loadFile('src/index.html');
  // Optional: Open DevTools
  // mainWindow.webContents.openDevTools();

  connectToAllTargets();
}

app.whenReady().then(() => {
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});