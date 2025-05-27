const { ipcRenderer } = require('electron');

// State to track active IPs and their data
const monitorState = {};

// Function to update the UI for a specific source (IP:port)
function updateMonitorUI(source) {
    const card = document.getElementById(`card-${source}`);
    if (!card) return;

    const currentScanElement = card.querySelector('.current-scan');
    const previousScansElement = card.querySelector('.previous-scans');

    // Update Current Scan
    const { currentScan, previousScanHistory } = monitorState[source];
    currentScanElement.textContent = `Current Scan: ${currentScan || 'N/A'}`;

    // Clear Previous Scans
    previousScansElement.innerHTML = '';

    // Add Previous Scans
    if (previousScanHistory && previousScanHistory.length > 0) {
        previousScanHistory.forEach((scan, index) => {
            const scanItem = document.createElement('div');
            scanItem.className = 'scan-item';
            scanItem.textContent = `#${index + 1}: ${scan}`;
            previousScansElement.appendChild(scanItem);
        });
    } else {
        const noScans = document.createElement('div');
        noScans.className = 'scan-item';
        noScans.textContent = 'No previous scans';
        previousScansElement.appendChild(noScans);
    }
}

// Function to create or update a card for a new source
function createOrUpdateCard(source) {
    let card = document.getElementById(`card-${source}`);
    if (!card) {
        card = document.createElement('div');
        card.id = `card-${source}`;
        card.className = 'card';

        card.innerHTML = `
      <h3>${source}</h3>
      <p class="status"></p>
      <p class="current-scan">Current Scan: N/A</p>
      <div class="previous-scans">
        <p>Previous Scans:</p>
      </div>
    `;
        document.getElementById('monitor').appendChild(card);
    }

    // Update status
    const statusElement = card.querySelector('.status');
    statusElement.textContent = `Status: ${monitorState[source].isConnected ? '🟢 Connected' : '🔴 Disconnected'}`;
}

// Listen for connection events
ipcRenderer.on('connection-established', (event, { source }) => {
    monitorState[source] = {
        currentScan: null,
        previousScanHistory: [],
        isConnected: true,
    };
    createOrUpdateCard(source);
    updateMonitorUI(source);
});

ipcRenderer.on('serial-scanned', (event, { source, data }) => {
    if (!monitorState[source]) return;

    // Update previous scan history
    monitorState[source].previousScanHistory.push(data);
    if (monitorState[source].previousScanHistory.length > 5) {
        monitorState[source].previousScanHistory.shift(); // Keep only the last 5 scans
    }

    // Update current scan
    monitorState[source].currentScan = data;

    createOrUpdateCard(source);
    updateMonitorUI(source);
});

ipcRenderer.on('connection-closed', (event, { source }) => {
    if (!monitorState[source]) return;

    monitorState[source].isConnected = false;
    createOrUpdateCard(source);
    updateMonitorUI(source);
});

// Example: Add a new target dynamically
document.getElementById('add-target').addEventListener('click', () => {
    const ip = document.getElementById('ip').value;
    const port = parseInt(document.getElementById('port').value, 10);
    ipcRenderer.send('add-target', { ip, port });
});