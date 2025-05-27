const { app, BrowserWindow, ipcMain } = require('electron');
const net = require('net');

let mainWindow;
const clients = {}; // Object to store multiple socket connections
const targets = [
  { ip: '192.168.137.9', port: 23 },
  { ip: '192.168.137.216', port: 23 }
];

function connectToTarget(target) {
  const { ip, port } = target;
  const key = `${ip}:${port}`;

  if (clients[key]) {
    console.warn(`⚠️ Already connected to ${key}`);
    return;
  }

  const client = new net.Socket();
  clients[key] = client;

  client.connect(port, ip, () => {
    console.log(`✓ Connected to ${key}`);
    client.write('\r\n'); // Send initial command if needed
    if (mainWindow && mainWindow.webContents) {
      mainWindow.webContents.send('connection-established', { source: key });
    }
  });

  client.on('data', (data) => {
    const serial = data.toString().trim();
    console.log(`ⓘ Received from ${key}:`, serial);
    if (mainWindow && mainWindow.webContents) {
      mainWindow.webContents.send('serial-scanned', { source: key, data: serial });
    }
  });

  client.on('error', (err) => {
    console.error(`× Socket error for ${key}:`, err.message);
    delete clients[key];
    if (mainWindow && mainWindow.webContents) {
      mainWindow.webContents.send('connection-closed', { source: key });
    }
    setTimeout(() => connectToTarget(target), 5000); // Reconnect after 5 seconds
  });

  client.on('close', () => {
    console.warn(`⚠︎ Connection closed for ${key}. Reconnecting...`);
    delete clients[key];
    if (mainWindow && mainWindow.webContents) {
      mainWindow.webContents.send('connection-closed', { source: key });
    }
    setTimeout(() => connectToTarget(target), 5000); // Reconnect after 5 seconds
  });
}

function connectToAllTargets() {
  targets.forEach((target) => connectToTarget(target));
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 800,
    height: 600,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false
    }
  });

  mainWindow.loadFile('src/index.html');
  connectToAllTargets();
}

app.whenReady().then(createWindow);

// Handle dynamic addition of targets (optional)
ipcMain.on('add-target', (event, target) => {
  targets.push(target);
  connectToTarget(target);
});

// Handle dynamic removal of targets (optional)
ipcMain.on('remove-target', (event, target) => {
  const key = `${target.ip}:${target.port}`;
  if (clients[key]) {
    clients[key].destroy();
    delete clients[key];
  }
});