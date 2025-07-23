const { ipcRenderer } = require('electron');

const monitorState = {};

function updateMonitorUI(source) {
    const card = document.getElementById(`card-${source}`);
    if (!card) return;

    const currentScanElement = card.querySelector('.current-scan');
    const previousScansElement = card.querySelector('.previous-scans');
    const statusElement = card.querySelector('.status');

    const { currentScan, previousScanHistory, isConnected } = monitorState[source];

    currentScanElement.textContent = `Current Scan: ${currentScan || 'N/A'}`;
    previousScansElement.innerHTML = '<p>Previous Scans:</p>';

    if (previousScanHistory && previousScanHistory.length > 0) {
        previousScanHistory.forEach((scan, index) => {
            const item = document.createElement('div');
            item.className = 'scan-item';
            item.textContent = `#${index + 1}: ${scan}`;
            previousScansElement.appendChild(item);
        });
    } else {
        const noScans = document.createElement('div');
        noScans.className = 'scan-item';
        noScans.textContent = 'No previous scans';
        previousScansElement.appendChild(noScans);
    }

    statusElement.textContent = `Status: ${isConnected ? '🟢 Connected' : '🔴 Disconnected'}`;

    // Reconnect Button
    let reconnectBtn = card.querySelector('.reconnect-btn');
    if (isConnected) {
        if (reconnectBtn) reconnectBtn.style.display = 'none';
    } else {
        if (!reconnectBtn) {
            reconnectBtn = document.createElement('button');
            reconnectBtn.className = 'reconnect-btn';
            reconnectBtn.textContent = 'Reconnect';
            reconnectBtn.style.margin = '10px 10px 0 0';
            reconnectBtn.style.padding = '6px 12px';
            reconnectBtn.style.backgroundColor = '#e67e22';
            reconnectBtn.style.color = 'white';
            reconnectBtn.style.border = 'none';
            reconnectBtn.style.borderRadius = '4px';
            reconnectBtn.style.cursor = 'pointer';
            reconnectBtn.onclick = () => {
                const [ip, portStr] = source.split(':');
                const port = parseInt(portStr, 10);
                ipcRenderer.send('manual-reconnect', { ip, port });
            };
            card.appendChild(reconnectBtn);
        }
        reconnectBtn.style.display = 'inline-block';
    }

    // Remove Button
    let removeBtn = card.querySelector('.remove-btn');
    if (isConnected) {
        if (removeBtn) removeBtn.style.display = 'none';
    } else {
        if (!removeBtn) {
            removeBtn = document.createElement('button');
            removeBtn.className = 'remove-btn';
            removeBtn.textContent = 'Remove';
            removeBtn.style.margin = '10px 0 0 10px';
            removeBtn.style.padding = '6px 12px';
            removeBtn.style.backgroundColor = '#c0392b';
            removeBtn.style.color = 'white';
            removeBtn.style.border = 'none';
            removeBtn.style.borderRadius = '4px';
            removeBtn.style.cursor = 'pointer';
            removeBtn.onclick = () => {
                const [ip, portStr] = source.split(':');
                const port = parseInt(portStr, 10);
                ipcRenderer.send('remove-scanner', { ip, port });
            };
            card.appendChild(removeBtn);
        }
        removeBtn.style.display = 'inline-block';
    }
}

function createOrUpdateCard(source) {
    let card = document.getElementById(`card-${source}`);
    if (!card) {
        card = document.createElement('div');
        card.id = `card-${source}`;
        card.className = 'card';
        card.innerHTML = `
      <h3>${source}</h3>
      <p class="status">Status: ...</p>
      <p class="current-scan">Current Scan: N/A</p>
      <div class="previous-scans">
        <p>Previous Scans:</p>
      </div>
    `;
        document.getElementById('monitor').appendChild(card);
    }

    if (!monitorState[source]) {
        monitorState[source] = {
            currentScan: null,
            previousScanHistory: [],
            isConnected: false
        };
    }

    updateMonitorUI(source);
}

// Add new scanner
document.getElementById('add-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const ip = document.getElementById('ip').value.trim();
    const port = parseInt(document.getElementById('port').value, 10);
    if (ip && !isNaN(port)) {
        const key = `${ip}:${port}`;
        if (!monitorState[key]) {
            monitorState[key] = {
                currentScan: null,
                previousScanHistory: [],
                isConnected: false
            };
            createOrUpdateCard(key);
        }
        ipcRenderer.send('add-target', { ip, port });
        document.getElementById('ip').value = '';
        document.getElementById('port').value = '23';
    }
});

// Scanner connected
ipcRenderer.on('connection-established', (event, { source }) => {
    if (!monitorState[source]) {
        monitorState[source] = {
            currentScan: null,
            previousScanHistory: [],
            isConnected: true
        };
        createOrUpdateCard(source);
    } else {
        monitorState[source].isConnected = true;
    }
    updateMonitorUI(source);
});

// Scan received
ipcRenderer.on('serial-scanned', (event, { source, serial }) => {
    if (!monitorState[source]) {
        monitorState[source] = {
            currentScan: null,
            previousScanHistory: [],
            isConnected: true
        };
        createOrUpdateCard(source);
    }

    monitorState[source].previousScanHistory.push(serial);
    if (monitorState[source].previousScanHistory.length > 5) {
        monitorState[source].previousScanHistory.shift();
    }
    monitorState[source].currentScan = serial;
    updateMonitorUI(source);
});

// Connection closed
ipcRenderer.on('connection-closed', (event, { source }) => {
    if (monitorState[source]) {
        monitorState[source].isConnected = false;
        updateMonitorUI(source);
    }
});

// Max retries reached
ipcRenderer.on('reconnect-failed', (event, { source }) => {
    if (monitorState[source]) {
        monitorState[source].isConnected = false;
        updateMonitorUI(source);
    }
});

// Scanner removed
ipcRenderer.on('scanner-removed', (event, { source }) => {
    const card = document.getElementById(`card-${source}`);
    if (card) card.remove();
    delete monitorState[source];
});