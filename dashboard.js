let dirHandle = null;
let chartInstance = null;
let allLogs = [];

const DB_NAME = 'LogViewerDB';
const DB_VERSION = 1;
const STORE = 'handles';
const ERROR_THRESHOLD = 3;

const logLevelColors = {
  ERROR: '#FF0000',      // Red
  WARNING: '#FFD700',    // Yellow
  INFO: '#1E90FF',       // Blue
  DEBUG: '#32CD32',      // Green
  CRITICAL: '#8B0000'    // Dark Red
};


async function loadDashboardFromIDB() {
  try {
    const db = await idb.openDB(DB_NAME, DB_VERSION);
    const handle = await db.get(STORE, 'logDir');

    if (!handle) {
      document.getElementById('folderName').textContent = 'No folder selected.';
      return;
    }

    const hasPermission = await verifyPermission(handle);
    if (!hasPermission) {
      document.getElementById('folderName').textContent = 'Permission denied.';
      return;
    }

    dirHandle = handle;
    document.getElementById('folderName').textContent = `Folder: ${dirHandle.name}`;
    const logs = [];

    const fileType = document.getElementById('fileTypeSelect')?.value || 'json';

    for await (const entry of dirHandle.values()) {
      if (entry.kind !== 'file') continue;

      const isJson = entry.name.toLowerCase().endsWith('.json');
      const isTxt = entry.name.toLowerCase().endsWith('.txt');

      if (
        (fileType === 'json' && isJson) ||
        (fileType === 'txt' && isTxt) ||
        (fileType === 'both' && (isJson || isTxt))
      ) {
        const file = await entry.getFile();
        const content = await file.text();
        if (!content.trim()) continue;

        if (isJson) {
          const lines = content.split('\n').filter(line => line.trim());
          lines.forEach(line => {
            try {
              logs.push(JSON.parse(line));
            } catch {
              logs.push({ level: 'UNKNOWN', message: line });
            }
          });
        } else if (isTxt) {
          const logRegex = /^(?:[^\[]*)?\[(.*?)\]\s+\[(.*?)\]\s+([\s\S]*?)(?=\n\[|$)/gm;
          let match;
          while ((match = logRegex.exec(content)) !== null) {
            const [, timestamp, level, message] = match;
            logs.push({
              timestamp,
              level,
              message: message.trim(),
              raw: match[0].trim()
            });
          }
        }
      }
    }

    
    allLogs = logs;
    document.getElementById('loading').style.display = 'none';
    renderKPIChart();


    const timelineContainer = document.getElementById('timeline');
    if (timelineContainer) {
      const criticalEvents = logs.filter(log =>
        log.level === 'ERROR' || log.level === 'CRITICAL'
      );

      const timelineData = criticalEvents.map(event => ({
        time: new Date(event.timestamp).toLocaleString(),
        type: event.level,
        message: event.message
      }));

      timelineContainer.innerHTML = timelineData.map(event => `
        <li>
          <span class="time">${event.time}</span>
          <span class="type">${event.type.toUpperCase()}</span>
          <p>${event.message}</p>
        </li>
      `).join('');
      }


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

function getColorsForLabels(labels) {
  return labels.map(label => logLevelColors[label] || 'gray');
}


function renderKPIChart() {
  const selectedKPI = document.getElementById("kpiDropdown").value;
  const ctx = document.getElementById("kpiChart").getContext("2d");

  if (chartInstance) {
    chartInstance.destroy();
  }

  let chartConfig;

  switch (selectedKPI) {
    case "logVolume":
      chartConfig = getLogVolumeChart(allLogs);
      break;
    case "errorRate":
      chartConfig = getErrorRateChart(allLogs);
      break;
    case "topErrors":
      chartConfig = getTopErrorSourcesChart(allLogs);
      break;
    case "resolutionTime":
      chartConfig = getResolutionTimeChart(allLogs);
      break;
    case "criticalTimeline":
      chartConfig = getCriticalTimelineChart(allLogs);
      break;
    case "heatmap":
      chartConfig = getHeatmapChart(allLogs);
      break;
    case "uptime":
      chartConfig = getUptimeChart(allLogs);
      break;
    case "userImpact":
      chartConfig = getUserImpactChart(allLogs);
      break;
    case "anomaly":
      chartConfig = getAnomalyChart(allLogs);
      break;
    case "logSource":
      chartConfig = getLogSourceChart(allLogs);
      break;
    default:
      const labels = ['INFO', 'WARNING', 'DEBUG', 'CRITICAL', 'ERROR'];
      chartConfig = {
        type: "bar",
        data: {
          labels: ["Select a KPI"],
          datasets: [{
            label: "No Data",
            data: [0],
            backgroundColor: getColorsForLabels(labels)
          }]
        }
      };
  }
  Chart.register(window['chartjs-plugin-annotation']);

  chartInstance = new Chart(ctx, chartConfig);
}

// Sample chart functions (expand as needed)
function getLogVolumeChart(logs) {
  const dateCounts = {};
  logs.forEach(log => {
    const date = new Date(log.timestamp).toLocaleDateString();
    dateCounts[date] = (dateCounts[date] || 0) + 1;
  });

  return {
    type: "line",
    data: {
      labels: Object.keys(dateCounts),
      datasets: [{
        label: "Log Volume",
        data: Object.values(dateCounts),
        borderColor: "blue",
        fill: false
      }]
    }
  };
}

function getErrorRateChart(logs) {
  const levelCounts = {};
  logs.forEach(log => {
    const level = log.level || "UNKNOWN";
    levelCounts[level] = (levelCounts[level] || 0) + 1;
  });

  return {
    type: "bar",
    data: {
      labels: Object.keys(levelCounts),
      datasets: [{
        label: "Log Count by Level",
        data: Object.values(levelCounts),
        backgroundColor: getColorsForLabels(Object.keys(levelCounts))
      }]
    }
  };
}

// Placeholder chart generators for other KPIs
function getTopErrorSourcesChart(logs) {
  const errorMessages = {};
  logs.forEach(log => {
    if (log.level === "ERROR" || log.level === "CRITICAL") {
      const msg = log.message || "Unknown";
      errorMessages[msg] = (errorMessages[msg] || 0) + 1;
    }
  });

  const sorted = Object.entries(errorMessages).sort((a, b) => b[1] - a[1]).slice(0, 5);
  const labels = sorted.map(([msg]) => msg);
  const data = sorted.map(([, count]) => count);

  return {
    type: "bar",
    data: {
      labels,
      datasets: [{
        label: "Top Error Sources",
        data,
        backgroundColor: "red"
      }]
    }
  };
}

function getAnomalyChart(logs) {
 if (!logs || logs.length === 0) return getPlaceholderChart("No logs available");

  const totalLogCount = logs.length;

  // Group logs by hour
  const hourlyCounts = {};
  logs.forEach(log => {
    const date = new Date(log.timestamp);
    const hourKey = date.toISOString().slice(0, 13); // YYYY-MM-DDTHH
    if (!hourlyCounts[hourKey]) {
      hourlyCounts[hourKey] = { total: 0, errors: 0 };
    }
    hourlyCounts[hourKey].total++;
    if (log.level === 'ERROR' || log.level === 'CRITICAL') {
      hourlyCounts[hourKey].errors++;
    }
  });

  // Prepare data for chart
  const labels = Object.keys(hourlyCounts).sort();
  const errorData = labels.map(label => hourlyCounts[label].errors);
  const totalData = labels.map(label => hourlyCounts[label].total);

  return {
  type: 'line',
  data: {
    labels,
    datasets: [
      {
        label: 'Logs per Hour',
        data: totalData,
        borderColor: 'rgba(54, 162, 235, 1)',
        backgroundColor: 'rgba(54, 162, 235, 0.2)',
        fill: true,
        tension: 0.3
      },
      {
        label: 'Error per Logs',
        data: errorData,
        borderColor: 'rgba(255, 99, 132, 1)',
        backgroundColor: 'rgba(255, 99, 132, 0.2)',
        fill: true,
        tension: 0.3
      }
    ]
  },
  options: {
    responsive: true,
    plugins: {
      title: {
        display: true,
        text: `Anomaly Detection Per Hour — Total Logs without grouping: ${totalLogCount}`
      },
      legend: {
        position: 'top'
      },
      plugins: {
      tooltip: {
        callbacks: {
        title: (tooltipItems) => `Hour: ${tooltipItems[0].label}`,
        label: (tooltipItem) => `Logs: ${tooltipItem.formattedValue}`
          }
        }
      },

      annotation: {
        annotations: {
          thresholdLine: {
            type: 'line',
            yMin: ERROR_THRESHOLD,
            yMax: ERROR_THRESHOLD,
            borderColor: 'orange',
            borderWidth: 2,
            label: {
              content: `Threshold: ${ERROR_THRESHOLD}`,
              enabled: true,
              position: 'start'
            }
          }
        }
      }
    },
    scales: {
      x: {
        title: {
          display: true,
          text: 'Hour'
        }
      },
      y: {
        title: {
          display: true,
          text: 'Log Count'
        },
        beginAtZero: true
      }
    }
  }
};


}




// Add similar dummy or real implementations for:
function getResolutionTimeChart(logs) { /* ... */ return getPlaceholderChart("Resolution Time"); }
function getCriticalTimelineChart(logs) { /* ... */ return getPlaceholderChart("Critical Timeline"); }
function getHeatmapChart(logs) { /* ... */ return getPlaceholderChart("Heatmap"); }
function getUptimeChart(logs) { /* ... */ return getPlaceholderChart("Uptime"); }
function getUserImpactChart(logs) { /* ... */ return getPlaceholderChart("User Impact"); }
//function getAnomalyChart(logs) { /* ... */ return getPlaceholderChart("Anomaly Detection"); }
function getLogSourceChart(logs) { /* ... */ return getPlaceholderChart("Log Source Distribution"); }

function getPlaceholderChart(title) {
  return {
    type: "bar",
    data: {
      labels: ["Feature coming soon"],
      datasets: [{
        label: title,
        data: [0],
        backgroundColor: "lightgray"
      }]
    }
  };
}

// Load dashboard
loadDashboardFromIDB();
