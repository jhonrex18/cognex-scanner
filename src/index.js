// src/index.js
const { app, BrowserWindow, ipcMain } = require('electron');
const net = require('net');
const fs = require('fs');
const path = require('path');

let mainWindow;
const clients = {};
const reconnectAttempts = {};

// 🔧 Save config in project root
const CONFIG_FILE = path.join(__dirname, '..', 'config.json');

// 🎯 Load targets from config.json — no defaults
function loadTargets() {
  if (fs.existsSync(CONFIG_FILE)) {
    try {
      const data = fs.readFileSync(CONFIG_FILE, 'utf-8');
      const saved = JSON.parse(data);
      if (Array.isArray(saved)) {
        console.log('✅ Loaded scanners:', saved);
        return saved;
      }
    } catch (err) {
      console.error('❌ Failed to parse config.json:', err.message);
    }
  }
  // ✅ Start with empty list if no config
  console.log('📁 No config found or invalid — starting with no scanners');
  return [];
}

// 📦 Save targets to config.json
function saveTargets() {
  try {
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(targets, null, 2), 'utf-8');
    console.log('✅ Scanners saved to:', CONFIG_FILE);
  } catch (err) {
    console.error('❌ Failed to save config.json:', err.message);
  }
}

// 🎯 Load targets (empty or from file)
let targets = loadTargets();

// ✅ Connect to Target
function connectToTarget(target) {
  const { ip, port } = target;
  const key = `${ip}:${port}`;

  if (clients[key]) {
    console.warn(`🔁 Already connecting: ${key}`);
    return;
  }

  if (!reconnectAttempts[key]) {
    reconnectAttempts[key] = 0;
  }

  const client = new net.Socket();
  clients[key] = client;

  client.connect(port, ip, () => {
    console.log(`✅ Connected to ${key}`);
    reconnectAttempts[key] = 0;
    client.write('\r\n');
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
      console.log(`📩 Scan from ${key}: ${serial}`);
      if (mainWindow && mainWindow.webContents) {
        mainWindow.webContents.send('serial-scanned', {
          source: key,
          data: serial  // ✅ Must be "data" to match render.js
        });
      }
    }
  });

  client.on('error', (err) => {
    console.error(`🔌 Socket error ${key}:`, err.message);
    cleanupClient(key);
    maybeReconnect(target);
  });

  client.on('close', () => {
    console.warn(`🔁 Connection closed ${key}`);
    cleanupClient(key);
    maybeReconnect(target);
  });
}

function cleanupClient(key) {
  if (clients[key]) {
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
    console.log(`🔁 (${reconnectAttempts[key]}/5) Reconnecting to ${key}...`);
    setTimeout(() => {
      if (!clients[key]) {
        connectToTarget(target);
      }
    }, 3000);
  } else {
    console.log(`❌ Max retries reached for ${key}. Waiting for manual reconnect.`);
    if (mainWindow && mainWindow.webContents) {
      mainWindow.webContents.send('reconnect-failed', { source: key });
    }
  }
}

// 🔄 Manual reconnect
ipcMain.on('manual-reconnect', (event, target) => {
  const exists = targets.some(t => t.ip === target.ip && t.port === target.port);
  if (!exists) return;
  const key = `${target.ip}:${target.port}`;
  console.log(`🔄 Manual reconnect: ${key}`);
  reconnectAttempts[key] = 0;
  connectToTarget(target);
});

// 🗑️ Remove scanner
ipcMain.on('remove-scanner', (event, target) => {
  const key = `${target.ip}:${target.port}`;
  console.log(`🗑️ Removing scanner: ${key}`);

  if (clients[key]) {
    clients[key].destroy();
    delete clients[key];
  }

  const index = targets.findIndex(t => t.ip === target.ip && t.port === target.port);
  if (index !== -1) {
    targets.splice(index, 1);
    saveTargets(); // ✅ Save after remove
  }

  delete reconnectAttempts[key];

  if (mainWindow && mainWindow.webContents) {
    mainWindow.webContents.send('scanner-removed', { source: key });
  }
});

// ➕ Add new scanner
ipcMain.on('add-target', (event, target) => {
  const exists = targets.some(t => t.ip === target.ip && t.port === target.port);
  if (!exists) {
    targets.push(target);
    saveTargets(); // ✅ Save to project folder
    connectToTarget(target);
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