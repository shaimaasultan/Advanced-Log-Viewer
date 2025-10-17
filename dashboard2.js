let dirHandle = null;

const DB_NAME = 'LogViewerDB';
const DB_VERSION = 1;
const STORE = 'handles';

// Load dashboard using stored folder handle from IDB
async function loadDashboardFromIDB() {
  try {
    const db = await idb.openDB(DB_NAME, DB_VERSION);
    const handle = await db.get(STORE, 'logDir');

    if (!handle) {
      console.warn('No folder handle found in IDB.');
      document.getElementById('folderName').textContent = 'No folder selected.';
      return;
    }

    const hasPermission = await verifyPermission(handle);
    if (!hasPermission) {
      console.warn('Permission denied for stored folder handle.');
      document.getElementById('folderName').textContent = 'Permission denied.';
      return;
    }

    dirHandle = handle;
    document.getElementById('folderName').textContent = `Folder: ${dirHandle.name}`;
    const logs = [];

    for await (const entry of dirHandle.values()) {
      console.log('Checking entry:', entry.name, entry.kind);

      if (entry.kind === 'file' && entry.name.toLowerCase().endsWith('.json')) {
        const file = await entry.getFile();
        console.log(`Reading file: ${entry.name}, size: ${file.size}`);

        const content = await file.text();
        if (!content.trim()) {
          console.warn(`File ${entry.name} is empty or unreadable.`);
          continue;
        }

        const lines = content.split('\n').filter(line => line.trim());
        console.log(`File ${entry.name} has ${lines.length} lines.`);

        lines.forEach(line => {
          try {
            const parsed = JSON.parse(line);
            logs.push(parsed);
          } catch (err) {
            console.warn('Parse error:', line, err);
            logs.push({ level: 'UNKNOWN', message: line });
          }
        });
      }
    }

    console.log('Total logs parsed:', logs.length);


    buildCharts(logs);
  } catch (err) {
    console.error('Dashboard loading error:', err);
    document.getElementById('folderName').textContent = 'Error loading dashboard.';
  }
}

async function verifyPermission(handle) {
  const opts = { mode: 'read' };
  const q = await handle.queryPermission?.(opts);
  if (q === 'granted') return true;
  const r = await handle.requestPermission?.(opts);
  return r === 'granted';
}

// Replace the original call
loadDashboardFromIDB();


function buildCharts(logs) {
  document.getElementById('loading').style.display = 'none';

  const levelCounts = { INFO: 0, ERROR: 0, WARNING: 0, DEBUG: 0, CRITICAL: 0, UNKNOWN: 0 };
  const errorTrend = {};
  let criticalCount = 0;
  let nonCriticalCount = 0;

  logs.forEach(log => {
    const level = log.level || 'UNKNOWN';
    levelCounts[level] = (levelCounts[level] || 0) + 1;

    if (level === 'ERROR' || level === 'CRITICAL') {
      const date = log.timestamp ? log.timestamp.split('T')[0] : 'Unknown';
      errorTrend[date] = (errorTrend[date] || 0) + 1;
    }

    if (level === 'CRITICAL') criticalCount++;
    else nonCriticalCount++;
  });

  // Pie Chart
  new Chart(document.getElementById('pieChart'), {
    type: 'pie',
    data: {
      labels: Object.keys(levelCounts),
      datasets: [{
        data: Object.values(levelCounts),
        backgroundColor: ['#4caf50', '#f44336', '#ff9800', '#2196f3', '#9c27b0', '#9e9e9e']
      }]
    },
    options: {
      plugins: {
        title: { display: true, text: 'Log Level Distribution (Pie)' },
        tooltip: { enabled: true }
      }
    }
  });

  // Doughnut Chart
  new Chart(document.getElementById('doughnutChart'), {
    type: 'doughnut',
    data: {
      labels: ['Critical', 'Non-Critical'],
      datasets: [{
        data: [criticalCount, nonCriticalCount],
        backgroundColor: ['#e53935', '#8e24aa']
      }]
    },
    options: {
      plugins: {
        title: { display: true, text: 'Critical vs Non-Critical Logs' },
        tooltip: { enabled: true }
      }
    }
  });

  // Bar Chart
  new Chart(document.getElementById('levelChart'), {
    type: 'bar',
    data: {
      labels: Object.keys(levelCounts),
      datasets: [{
        label: 'Log Level Count',
        data: Object.values(levelCounts),
        backgroundColor: ['#4caf50', '#f44336', '#ff9800', '#2196f3', '#9c27b0', '#9e9e9e']
      }]
    },
    options: {
      plugins: {
        title: { display: true, text: 'Log Level Count (Bar)' },
        tooltip: { enabled: true }
      }
    }
  });

  // Line Chart
  new Chart(document.getElementById('errorTrendChart'), {
    type: 'line',
    data: {
      labels: Object.keys(errorTrend),
      datasets: [{
        label: 'Errors per Day',
        data: Object.values(errorTrend),
        borderColor: '#f44336',
        fill: false,
        tension: 0.3
      }]
    },
    options: {
      plugins: {
        title: { display: true, text: 'Error Trend Over Time' },
        tooltip: { enabled: true }
      },
      scales: {
        x: { title: { display: true, text: 'Date' } },
        y: { title: { display: true, text: 'Error Count' } }
      }
    }
  });
}

