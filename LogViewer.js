let allLogs = [];
let filteredLogs = [];
let currentPage = 1;
const logsPerPage = 5;
let dirHandle = null;
let logsIntervalId = null;

const DB_NAME = 'LogViewerDB';
const DB_VERSION = 1;
const STORE = 'handles';

const EMOJIS = {
  "DEBUG": "🔍",
  "INFO": "✅",
  "WARNING": "⚠️",
  "ERROR": "❌",
  "CRITICAL": "🔥"
};

// Ensure the IDB store exists and return the DB
async function getDB() {
  // idb must be loaded in your HTML:
  // <script src="https://unpkg.com/idb/build/iife/index-min.js"></script>
  return await idb.openDB(DB_NAME, DB_VERSION, {
    upgrade(db) {
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE);
      }
    }
  });
}

window.addEventListener('DOMContentLoaded', async () => {
  try {
    const db = await getDB();
    const handle = await db.get(STORE, 'logDir');

    // Update inputs/labels from IDB
    const { folderHandleName } = await readFolderNameFromIDB();

    if (folderHandleName) {
      updateFolderPath(folderHandleName);
    }

    if (handle && await verifyPermission(handle)) {
      dirHandle = handle;
      await loadLogs();
      if (!logsIntervalId) {
        logsIntervalId = setInterval(loadLogs, 30000);
      }
    } else {
      console.log("No valid stored handle or permission denied.");
    }
  } catch (err) {
    console.error('Initialization error:', err);
  }
});

async function readFolderNameFromIDB() {
  const db = await getDB();

  const folderHandle = await db.get(STORE, 'logDir');
  const logFullPath = await db.get(STORE, 'logFullPath');

  const manualPathInput = document.getElementById('manualPath');
  if (manualPathInput) {
    manualPathInput.value = logFullPath || '';
  }

  if (folderHandle && folderHandle.name) {
    console.log("Stored folder name:", folderHandle.name);
    return { folderHandleName: folderHandle.name, logFullPath: logFullPath || '' };
  } else {
    console.warn("No folder handle found in IDB.");
    return { folderHandleName: null, logFullPath: logFullPath || '' };
  }
}

function updateFolderPath(path) {
  const folderElement = document.getElementById('manualPath');
  if (folderElement) {
    folderElement.textContent = `${path}`;
  }
}

async function pickFolder() {
  try {
    dirHandle = await window.showDirectoryPicker();
    await saveHandle(dirHandle);
    await loadLogs();
    if (!logsIntervalId) {
      logsIntervalId = setInterval(loadLogs, 30000);
    }
    console.log("Pick dirHandle:", dirHandle);
   
  } catch (err) {
    console.error('Folder picking failed:', err);
  }
}

async function saveHandle(handle) {
  const db = await getDB();
  const tx = db.transaction(STORE, 'readwrite');
  const store = tx.objectStore(STORE);

  store.put(handle, 'logDir');
  document.getElementById('manualPath').value = handle.name;
  const fullPath = document.getElementById('manualPath')?.value || '';
  console.log("fullPath", fullPath);
  store.put(fullPath, 'logFullPath');
  // Save the handle
  store.put('handles', dirHandle, 'logDir');

  console.log("handelere after adding logFullPath", handle);
  // Optional export
  //exportConfigJSON({ defaultLogPath: handle.name });
  await tx.done;
}

function exportConfigJSON(config) {
  const blob = new Blob([JSON.stringify(config, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = 'config.json';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

async function verifyPermission(handle) {
  try {
    const opts = { mode: 'read' };
    const q = await handle.queryPermission?.(opts);
    if (q === 'granted') return true;
    const r = await handle.requestPermission?.(opts);
    return r === 'granted';
  } catch (e) {
    console.warn('Permission API not available or denied:', e);
    return false;
  }
}

async function loadLogs() {
  if (!dirHandle) return;

  try {
    const fileType = document.getElementById('fileTypeSelect')?.value || 'both';
    const logs = [];

    for await (const entry of dirHandle.values()) {
      if (entry.kind !== 'file') continue;

      const isTxt = entry.name.endsWith('.txt');
      const isJson = entry.name.endsWith('.json');

      if (
        (fileType === 'txt' && isTxt) ||
        (fileType === 'json' && isJson) ||
        (fileType === 'both' && (isTxt || isJson))
      ) {
        logs.push(entry);
      }
    }

    logs.sort((a, b) => b.name.localeCompare(a.name));
    allLogs = [];

    for (const fileHandle of logs) {
      const file = await fileHandle.getFile();
      const content = await file.text();

      if (file.name.endsWith('.txt')) {
        const logRegex = /^(?:[^\[]*)?\[(.*?)\]\s+\[(.*?)\]\s+([\s\S]*?)(?=\n\[|$)/gm;
        let match;
        while ((match = logRegex.exec(content)) !== null) {
          const [, timestamp, level, message] = match;
          allLogs.push({
            timestamp,
            level,
            message: message.trim(),
            raw: match[0].trim()
          });
        }
      } else if (file.name.endsWith('.json')) {
        const lines = content.split('\n').filter(line => line.trim());
        lines.forEach(line => {
          try {
            const parsed = JSON.parse(line);
            allLogs.push({
              timestamp: parsed.timestamp,
              level: parsed.level,
              message: parsed.message,
              raw: line
            });
          } catch (err) {
            console.warn('Failed to parse JSON line:', line);
          }
        });
      }
    }

    filterLogs();
    updateSummary(allLogs);
  } catch (err) {
    console.error('loadLogs error:', err);
  }
}


function filterLogs() {
  const query = (document.getElementById('searchInput')?.value || '').toLowerCase();
  const level = document.getElementById('levelFilter')?.value || '';

  filteredLogs = allLogs.filter(log => {
    const matchesQuery = (log.raw || '').toLowerCase().includes(query);
    const matchesLevel = level ? (log.level === level) : true;
    return matchesQuery && matchesLevel;
  });

  currentPage = 1;
  renderLogs();
  updateSummary(filteredLogs);
}

function renderLogs() {
  const container = document.getElementById('logContainer');
  if (!container) return;

  container.innerHTML = '';

  const start = (currentPage - 1) * logsPerPage;
  const end = start + logsPerPage;
  const pageLogs = filteredLogs.slice(start, end);

  pageLogs.forEach(log => {
    const level = (log.level || 'UNKNOWN').toUpperCase();
    const emoji = EMOJIS[level] || '';
    const div = document.createElement('div');
    div.className = `log-entry ${level.toLowerCase()}`;
    div.innerHTML = `
      <strong>${log.timestamp || ''}</strong> 
      <em>${emoji} [${level}]</em><br>
      <pre>${log.message || log.raw || ''}</pre>
    `;
    container.appendChild(div);
  });

  const pageInfoEl = document.getElementById('pageInfo');
  if (pageInfoEl) {
    pageInfoEl.textContent = `Page ${currentPage} of ${Math.ceil(filteredLogs.length / logsPerPage) || 1}`;
  }
  const pageInfoEltop = document.getElementById('pageInfotop');
  if (pageInfoEltop) {
    pageInfoEltop.textContent = `Page ${currentPage} of ${Math.ceil(filteredLogs.length / logsPerPage) || 1}`;
  }
}

function filterLogs() {
  const query = (document.getElementById('searchInput')?.value || '').toLowerCase();
  const level = document.getElementById('levelFilter')?.value || '';
  const fromDateStr = document.getElementById('fromDate')?.value;
  const toDateStr = document.getElementById('toDate')?.value;

  const fromDate = fromDateStr ? new Date(fromDateStr) : null;
  const toDate = toDateStr ? new Date(toDateStr) : null;

  filteredLogs = allLogs.filter(log => {
    const matchesQuery = (log.raw || '').toLowerCase().includes(query);
    const matchesLevel = level ? (log.level === level) : true;

    const logDate = new Date(log.timestamp);
    const matchesDate =
      (!fromDate || logDate >= fromDate) &&
      (!toDate || logDate <= toDate);

    return matchesQuery && matchesLevel && matchesDate;
  });

  currentPage = 1;
  renderLogs();
  updateSummary(filteredLogs);
}

function applyLast7Days() {
  const now = new Date();
  const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

  document.getElementById('fromDate').value = sevenDaysAgo.toISOString().slice(0, 16);
  document.getElementById('toDate').value = now.toISOString().slice(0, 16);

  filterLogs();
}
function clearFilters() {
  document.getElementById('searchInput').value = '';
  document.getElementById('levelFilter').value = '';
  document.getElementById('fromDate').value = '';
  document.getElementById('toDate').value = '';
  filterLogs();
}


function nextPage() {
  if (currentPage * logsPerPage < filteredLogs.length) {
    currentPage++;
    renderLogs();
  }
}

function prevPage() {
  if (currentPage > 1) {
    currentPage--;
    renderLogs();
  }
}

function exportCSV() {
  const rows = filteredLogs.map(log => {
    const t = (log.timestamp || '').replace(/"/g, '""');
    const l = (log.level || '').replace(/"/g, '""');
    const m = (log.message || log.raw || '').replace(/"/g, '""');
    return `"${t}","${l}","${m}"`;
  });
  const csvContent = "data:text/csv;charset=utf-8," + rows.join("\n");
  const encodedUri = encodeURI(csvContent);
  const link = document.createElement("a");
  link.href = encodedUri;
  link.download = "filtered_logs.csv";
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

function updateSummary(logs) {
  const total = logs.length;
  const errorLogs = logs.filter(log => log.level === 'ERROR');
  const warningLogs = logs.filter(log => log.level === 'WARNING');
  const criticalLogs = logs.filter(log => log.level === 'CRITICAL');
  const totalBugs = logs.filter(log => log.level === 'DEBUG');
  const infoLogs = logs.filter(log => log.level === 'INFO');

  const setText = (id, text) => {
    const el = document.getElementById(id);
    if (el) el.textContent = text;
  };

  setText('totalLogs', total);
  setText('errorCount', ` ${errorLogs.length}`);
  setText('warningCount', `${warningLogs.length}`);
  setText('criticalCount', `${criticalLogs.length}`);
  setText('bugCount', `${totalBugs.length}`);
  setText('infoCount', `${infoLogs.length}`);

  const errorRate = total ? ((errorLogs.length / total) * 100).toFixed(2) : 0;
  setText('errorRate', `${errorRate}%`);

  const errorMessages = {};
  errorLogs.forEach(log => {
    const msg = log.message || log.raw || '';
    errorMessages[msg] = (errorMessages[msg] || 0) + 1;
  });

  const sortedErrors = Object.entries(errorMessages)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5);

 
}
