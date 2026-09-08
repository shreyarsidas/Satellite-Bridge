/* =========================================================================
   SATELLITE BRIDGE — ANALYTICS EXTENSION & LIVE FEED
   ========================================================================= */

const DISASTERS = {
  fire: { label: 'Wildfire', icon: '🔥', color: '#c0392b', priority: 0 },
  flood: { label: 'Flooding', icon: '🌊', color: '#3498db', priority: 1 },
  quake: { label: 'Earthquake', icon: '🌍', color: '#f1c40f', priority: 1 },
  storm: { label: 'Cyclone', icon: '🌪️', color: '#7f8c8d', priority: 2 },
  chemical: { label: 'Chemical Leak', icon: '☢️', color: '#27ae60', priority: 0 },
  bio: { label: 'Biohazard', icon: '☣️', color: '#8e44ad', priority: 0 },
  gas: { label: 'Gas Leak', icon: '💨', color: '#f39c12', priority: 1 },
  structural: { label: 'Collapse', icon: '🏚️', color: '#d35400', priority: 1 },
};

const EVENT_TYPES = {
  person: { label: 'PERSON_DETECTED', icon: '🧍', priority: 0 },
  fire: { label: 'FIRE_DETECTED', icon: '🔥', priority: 0 },
  vehicle: { label: 'VEHICLE_DETECTED', icon: '🚙', priority: 2 },
  animal: { label: 'ANIMAL_DETECTED', icon: '🦌', priority: 2 },
};

const HOME = { lat: 12.9716, lon: 80.2209 };
const DEAD_ZONE = { lat: 12.9755, lon: 80.2255, radiusM: 900 };
const DETECTION_RANGE = 5000; 

let map, deadZoneCircle;
let drones = [];
let droneMarkers = {};
let selectedDroneId = null;
let outbox = [];
let sideActive = false;
let sideCanvas, sideCtx;
let isPlacingDrone = false;
let activeDisasters = [];
let eventStats = { totalDetections: 0, solved: 0 };
let packets = [];
let lastDetectedEvent = null;

const DRONE_COLORS = [
  { name: 'Blue',   hex: '#3498db' },
  { name: 'Red',    hex: '#e74c3c' },
  { name: 'Green',  hex: '#2ecc71' },
  { name: 'Purple', hex: '#9b59b6' },
  { name: 'Orange', hex: '#e67e22' },
  { name: 'Yellow', hex: '#f1c40f' },
  { name: 'Teal',   hex: '#1abc9c' },
  { name: 'Pink',   hex: '#e84393' }
];
let nextColorIndex = 0;
function nextDroneColor() {
  const c = DRONE_COLORS[nextColorIndex % DRONE_COLORS.length];
  nextColorIndex++;
  return c;
}

function droneSvg(colorHex) {
  return `
<svg width="40" height="40" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
  <path d="M12 12L18 6M12 12L6 6M12 12L18 18M12 12L6 18" stroke="#2c3e50" stroke-width="2" stroke-linecap="round"/>
  <circle cx="12" cy="12" r="3" fill="#2c3e50"/>
  <circle cx="6" cy="6" r="2" fill="${colorHex}"/>
  <circle cx="18" cy="6" r="2" fill="${colorHex}"/>
  <circle cx="6" cy="18" r="2" fill="${colorHex}"/>
  <circle cx="18" cy="18" r="2" fill="${colorHex}"/>
</svg>`;
}

function init() {
  initMap();
  initSideView();
  initDisasterPalette();
  setupDragAndDrop();
  addDrone(null, HOME.lat, HOME.lon);
  selectedDroneId = drones[0].id;
  updateDroneSelect();
  setInterval(tick, 100);
}

function initMap() {
  map = L.map('map', { zoomControl: false, attributionControl: false }).setView([HOME.lat, HOME.lon], 14);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png').addTo(map);
  deadZoneCircle = L.circle([DEAD_ZONE.lat, DEAD_ZONE.lon], {
    radius: DEAD_ZONE.radiusM, color: '#c0392b', fillColor: '#c0392b', fillOpacity: 0.1, weight: 1, dashArray: '5,5'
  }).addTo(map);
  map.on('click', (e) => {
    if (isPlacingDrone) {
      addDrone(null, e.latlng.lat, e.latlng.lng);
      isPlacingDrone = false;
      document.getElementById('map').classList.remove('place-mode');
      document.getElementById('add-drone-btn').textContent = 'PLACE DRONE';
    }
  });
}

function initSideView() {
  sideCanvas = document.getElementById('sideView');
  sideCtx = sideCanvas.getContext('2d');
  window.addEventListener('resize', resizeCanvas);
  resizeCanvas();
}

function resizeCanvas() {
  const container = document.getElementById('mapStack');
  sideCanvas.width = container.clientWidth;
  sideCanvas.height = container.clientHeight;
}

function initDisasterPalette() {
  const palette = document.getElementById('disasterPalette');
  Object.entries(DISASTERS).forEach(([id, data]) => {
    const chip = document.createElement('div');
    chip.className = 'disaster-chip';
    chip.draggable = true;
    chip.dataset.type = id;
    chip.innerHTML = `<span>${data.icon}</span> <span>${data.label}</span>`;
    chip.addEventListener('dragstart', (e) => { e.dataTransfer.setData('text/plain', id); });
    palette.appendChild(chip);
  });
}

function setupDragAndDrop() {
  const mapEl = document.getElementById('map');
  mapEl.addEventListener('dragover', (e) => { e.preventDefault(); mapEl.classList.add('drag-over'); });
  mapEl.addEventListener('dragleave', () => mapEl.classList.remove('drag-over'));
  mapEl.addEventListener('drop', (e) => {
    e.preventDefault();
    mapEl.classList.remove('drag-over');
    const type = e.dataTransfer.getData('text/plain');
    const point = map.mouseEventToLatLng(e);
    const disasterData = DISASTERS[type];
    
    const marker = L.marker([point.lat, point.lng], {
      icon: L.divIcon({ 
        className: '', 
        html: `<div class="disaster-container"><div class="disaster-ring"></div><div style="font-size:36px; z-index:1">${disasterData.icon}</div></div>`, 
        iconSize: [80, 80], iconAnchor: [40, 40] 
      })
    }).addTo(map);
    
    marker.bindPopup(`
      <div style="text-align:center; font-family:var(--font-mono); color:#000; padding:5px;">
        <b style="display:block; margin-bottom:8px;">${disasterData.label}</b>
        <button onclick="solveDisaster('${marker._leaflet_id}')" class="popup-solve-btn">MARK SOLVED</button>
      </div>`);
    activeDisasters.push({ id: marker._leaflet_id, marker: marker });
    checkDetections(type, disasterData, point);
  });
}

window.solveDisaster = function(markerId) {
  const idx = activeDisasters.findIndex(d => d.id === markerId);
  if (idx !== -1) {
    map.removeLayer(activeDisasters[idx].marker);
    activeDisasters.splice(idx, 1);
    eventStats.solved++;
    logEvent(`Disaster resolved by ground team.`, 'info');
  }
  document.getElementById('solve-event-btn').style.display = 'none';
};

function addDrone(name, lat, lon) {
  const color = nextDroneColor();
  const id = name || `Drone ${color.name}`;
  const d = {
    id, lat: lat || HOME.lat, lon: lon || HOME.lon,
    alt: 120, batt: 100, connection: 'cellular', hoverPhase: Math.random()*Math.PI*2,
    batteryHistory: [100], color: color.hex, colorName: color.name
  };
  drones.push(d);
  const marker = L.marker([d.lat, d.lon], {
    draggable: true,
    icon: L.divIcon({ 
      className: '', 
      html: `<div class="drone-container" style="--drone-color:${color.hex}"><div class="drone-ping"></div><div style="z-index:2">${droneSvg(color.hex)}</div></div>`, 
      iconSize: [64, 64], iconAnchor: [32, 32] 
    })
  }).addTo(map);
  marker.on('dragend', (e) => {
    const newPos = e.target.getLatLng();
    d.lat = newPos.lat; d.lon = newPos.lng;
  });
  droneMarkers[id] = marker;
  updateDroneSelect();
  logEvent(`${id} deployed to sector.`, 'info');
}

function updateDroneSelect() {
  const sel = document.getElementById('drone-select');
  sel.innerHTML = drones.map(d => `<option value="${d.id}" ${d.id === selectedDroneId ? 'selected' : ''}>${d.id}</option>`).join('');
}

function logEvent(msg, type) {
  const feed = document.getElementById('tab-feed');
  const item = document.createElement('div');
  item.className = `event-item ${type === 'crit' ? 'crit' : 'info'}`;
  item.innerHTML = `<span style="color:var(--text-muted)">[${new Date().toLocaleTimeString()}]</span> ${msg}`;
  feed.prepend(item);
}

function checkDetections(type, data, coords) {
  const detectingDrones = drones.map(d => {
    const dist = map.distance([d.lat, d.lon], [coords.lat, coords.lng]);
    return { drone: d, distance: dist };
  }).filter(item => item.distance <= DETECTION_RANGE);

  if (detectingDrones.length > 0) {
    detectingDrones.sort((a, b) => a.distance - b.distance);
    const closestDrone = detectingDrones[0].drone;
    const firstDetector = detectingDrones[Math.floor(Math.random() * detectingDrones.length)].drone;
    
    let confidence = 0.85 + (detectingDrones.length * 0.03);
    confidence = Math.min(confidence, 0.99).toFixed(2);
    
    const primaryDroneId = firstDetector.id;
    triggerDetection(primaryDroneId, type, data, coords, detectingDrones.length, closestDrone.id, firstDetector.id);
  }
}


function updateSnapshot(data, conf) {
  document.getElementById('snap-icon').textContent = data.icon;
  document.getElementById('snap-event').textContent = data.label;
  document.getElementById('snap-conf').textContent = (conf * 100).toFixed(0) + '%';
  document.getElementById('snap-badge').style.display = data.priority === 0 ? 'block' : 'none';
  const solveBtn = document.getElementById('solve-event-btn');
  solveBtn.style.display = 'block';
  solveBtn.onclick = () => {
    if (lastDetectedEvent) {
      let closestId = null, minDist = Infinity;
      activeDisasters.forEach(dis => {
        const dPos = dis.marker.getLatLng();
        const dist = map.distance([dPos.lat, dPos.lng], [lastDetectedEvent.lat, lastDetectedEvent.lon]);
        if (dist < minDist) { minDist = dist; closestId = dis.id; }
      });
      if (closestId) solveDisaster(closestId);
    }
  };
}

function triggerDetection(droneId, typeKey, data, coords, droneCount, closestId, firstId) {
  const conf = (0.85 + (droneCount * 0.03)).toFixed(2);
  const ts = new Date().toLocaleTimeString();
  const event = {
    droneId, type: data.label, icon: data.icon, priority: data.priority,
    conf: conf, lat: coords.lat.toFixed(4), lon: coords.lng.toFixed(4),
    ts: ts, closestDrone: closestId, firstDetector: firstId, droneCount: droneCount
  };
  
  lastDetectedEvent = event;
  eventStats.totalDetections++;

  updateSnapshot(data, conf);
  outbox.push(event);
  updateQueueUI();
  const feed = document.getElementById('alert-feed');
  const item = document.createElement('div');
  item.className = `event-item ${data.priority === 0 ? 'crit' : ''}`;
  const reporterText = droneCount > 1 ? `${droneId} (+${droneCount-1} others)` : droneId;
  item.innerHTML = `<b>${data.icon} ${data.label}</b> · ${reporterText}<br/><span style="font-size:10px; opacity:0.7">${ts} · Conf: ${conf}</span>`;
  feed.prepend(item);
  const hist = document.getElementById('tab-history');
  const hItem = document.createElement('div');
  hItem.className = 'event-item';
  hItem.innerHTML = `<b>${ts}</b>: ${data.label} detected by ${reporterText} via SATELLITE`;
  hist.prepend(hItem);
  logEvent(`ALERT: ${data.label} detected by ${reporterText}`, 'crit');
}

function updateQueueUI() {
  const list = document.getElementById('queue-list');
  list.innerHTML = outbox.slice(-10).reverse().map(m => `
    <div class="event-item" style="font-size:11px; margin-bottom:4px; border-left-color:var(--accent-primary)">
      <span style="color:var(--accent-primary)">P${m.priority}</span> ${m.droneId}: ${m.type} → SATELLITE
    </div>
  `).join('');
}

function tick() {
  const t = Date.now() / 1000;
  drones.forEach(d => {
    const offsetLat = Math.sin(t * 0.5 + d.hoverPhase) * 0.00005;
    const offsetLon = Math.cos(t * 0.5 + d.hoverPhase) * 0.00005;
    d.batt -= 0.001;
    if (d.batt < 0) d.batt = 0;
    d.batteryHistory.push(d.batt);
    if (d.batteryHistory.length > 100) d.batteryHistory.shift();
    droneMarkers[d.id].setLatLng([d.lat + offsetLat, d.lon + offsetLon]);
  });
  const d = drones.find(dr => dr.id === selectedDroneId);
  if (!d) return;
  document.getElementById('drone-id-label').textContent = d.id;
  document.getElementById('t-lat').textContent = d.lat.toFixed(4);
  document.getElementById('t-lon').textContent = d.lon.toFixed(4);
  document.getElementById('t-alt').textContent = Math.round(d.alt) + 'm';
  document.getElementById('t-batt').textContent = Math.round(d.batt) + '%';
  document.getElementById('batt-fill').style.width = d.batt + '%';
  const dist = map.distance([d.lat, d.lon], [DEAD_ZONE.lat, DEAD_ZONE.lon]);
  if (dist < DEAD_ZONE.radiusM) {
    d.connection = 'satellite';
    document.getElementById('conn-dot').className = 'dot satellite';
    document.getElementById('conn-text').textContent = 'SATELLITE UPLINK';
    document.getElementById('cm-mode').textContent = 'SATELLITE';
  } else {
    d.connection = 'cellular';
    document.getElementById('conn-dot').className = 'dot cellular';
    document.getElementById('conn-text').textContent = 'CELLULAR LINK';
    document.getElementById('cm-mode').textContent = 'CELLULAR';
  }
  updateAnalytics();
}

function updateAnalytics() {
  const d = drones.find(dr => dr.id === selectedDroneId);
  if (!d) return;
  const canvas = document.getElementById('battery-chart');
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0,0,canvas.width, canvas.height);
  ctx.strokeStyle = '#27ae60'; ctx.lineWidth = 2; ctx.beginPath();
  d.batteryHistory.forEach((v, i) => {
    const x = (i / (d.batteryHistory.length - 1)) * canvas.width;
    const y = canvas.height - (v / 100) * canvas.height;
    i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
  });
  ctx.stroke();
  const stats = document.getElementById('analytics-stats');
  let eventDetailHtml = '';
  if (lastDetectedEvent) {
    let currentClosest = 'None';
    let minDist = Infinity;
    drones.forEach(dr => {
      const dist = map.distance([dr.lat, dr.lon], [lastDetectedEvent.lat, lastDetectedEvent.lon]);
      if (dist < minDist) {
        minDist = dist;
        currentClosest = dr.id;
      }
    });

    eventDetailHtml = `
      <div class="card" style="grid-column: span 2; padding:12px; background:var(--bg-surface-alt);">
        <div class="tel-label" style="margin-bottom:8px; text-align:center">LAST EVENT ANALYSIS</div>
        <div class="telemetry-grid">
          <div class="tel-item"><span class="tel-label">FIRST DETECTOR</span><span class="tel-value">${lastDetectedEvent.firstDetector}</span></div>
          <div class="tel-item"><span class="tel-label">CURRENT CLOSEST</span><span class="tel-value">${currentClosest}</span></div>
          <div class="tel-item"><span class="tel-label">DETECTION TIME</span><span class="tel-value">${lastDetectedEvent.ts}</span></div>
          <div class="tel-item"><span class="tel-label">CONFIDENCE</span><span class="tel-value">${(lastDetectedEvent.conf * 100).toFixed(0)}%</span></div>
        </div>
      </div>
    `;
  } else {
    eventDetailHtml = `<div class="card" style="grid-column: span 2; padding:12px; text-align:center; color:var(--text-muted)">No events detected yet.</div>`;
  }
  stats.innerHTML = `
    <div class="card" style="padding:10px; text-align:center;">
      <div class="tel-label">DETECTIONS</div>
      <div class="tel-value" style="font-size:20px">${eventStats.totalDetections}</div>
    </div>
    <div class="card" style="padding:10px; text-align:center;">
      <div class="tel-label">RESOLVED</div>
      <div class="tel-value" style="font-size:20px">${eventStats.solved}</div>
    </div>
    ${eventDetailHtml}
  `;
}

document.getElementById('drone-select').addEventListener('change', e => {
  selectedDroneId = e.target.value;
});

document.getElementById('add-drone-btn').addEventListener('click', () => {
  isPlacingDrone = true;
  document.getElementById('map').classList.add('place-mode');
  document.getElementById('add-drone-btn').textContent = 'CLICK MAP TO PLACE';
});

document.getElementById('outage-btn').addEventListener('click', () => {
  document.getElementById('conn-dot').className = 'dot offline';
  document.getElementById('conn-text').textContent = 'TOTAL OUTAGE';
  document.getElementById('cm-mode').textContent = 'OFFLINE';
  logEvent(`CRITICAL: Full network outage detected. Switching to store & forward.`, 'crit');
});

document.getElementById('toggle-view').addEventListener('click', (e) => {
  sideActive = !sideActive;
  document.getElementById('mapStack').classList.toggle('side-active', sideActive);
  e.target.textContent = sideActive ? '🗺️ TOP VIEW' : '📡 SIDE VIEW';
  if (sideActive) renderSideView();
});

function renderSideView() {
  if (!sideActive) return;
  sideCtx.clearRect(0,0,sideCanvas.width, sideCanvas.height);
  
  const satX = sideCanvas.width / 2;
  const satY = 60;
  const bridgeX = sideCanvas.width / 2;
  const bridgeY = 200;

  // Satellite
  sideCtx.fillStyle = '#bdc3c7';
  sideCtx.beginPath(); sideCtx.arc(satX, satY, 10, 0, Math.PI*2); sideCtx.fill();
  sideCtx.fillStyle = '#2f3640'; sideCtx.font = '10px monospace'; sideCtx.textAlign = 'center';
  sideCtx.fillText('SATELLITE', satX, satY - 20);

  // Bridge/Pointer
  sideCtx.fillStyle = '#f1c40f';
  sideCtx.beginPath(); sideCtx.arc(bridgeX, bridgeY, 8, 0, Math.PI*2); sideCtx.fill();
  sideCtx.strokeStyle = '#f1c40f';
  sideCtx.lineWidth = 2;
  sideCtx.beginPath(); sideCtx.arc(bridgeX, bridgeY, 12, 0, Math.PI*2); sideCtx.stroke();
  sideCtx.fillStyle = '#2f3640';
  sideCtx.fillText('SATELLITE BRIDGE', bridgeX, bridgeY + 25);

  // Connection: Bridge to Satellite
  sideCtx.strokeStyle = 'rgba(241, 196, 15, 0.4)';
  sideCtx.lineWidth = 2;
  sideCtx.setLineDash([5, 5]);
  sideCtx.beginPath();
  sideCtx.moveTo(bridgeX, bridgeY);
  sideCtx.lineTo(satX, satY);
  sideCtx.stroke();
  sideCtx.setLineDash([]);

  sideCtx.fillStyle = '#edf2f7';
  sideCtx.fillRect(0, sideCanvas.height - 40, sideCanvas.width, 40);

  // Variated heights for drones
  const dronePositions = drones.map((d, i) => ({
    x: (sideCanvas.width / (drones.length + 1)) * (i + 1),
    y: sideCanvas.height - 150 - (i * 60) - (Math.sin(Date.now()/1000 + i)*20),
    id: d.id,
    conn: d.connection
  }));

  // Drone Mesh (Internal Communication)
  sideCtx.strokeStyle = 'rgba(44, 62, 80, 0.1)';
  sideCtx.lineWidth = 1;
  for(let i=0; i<dronePositions.length; i++) {
    for(let j=i+1; j<dronePositions.length; j++) {
      sideCtx.beginPath();
      sideCtx.moveTo(dronePositions[i].x, dronePositions[i].y);
      sideCtx.lineTo(dronePositions[j].x, dronePositions[j].y);
      sideCtx.stroke();
    }
  }

  // Drone to Bridge connections
  dronePositions.forEach(p => {
    sideCtx.strokeStyle = 'rgba(52, 152, 219, 0.1)';
    sideCtx.lineWidth = 1;
    sideCtx.beginPath();
    sideCtx.moveTo(p.x, p.y);
    sideCtx.lineTo(bridgeX, bridgeY);
    sideCtx.stroke();
  });

  // Packet Animation
  if (Math.random() < 0.05 && drones.length > 0) {
    const start = dronePositions[Math.floor(Math.random()*dronePositions.length)];
    packets.push({
      startX: start.x, startY: start.y, 
      bridgeX: bridgeX, bridgeY: bridgeY,
      satX: satX, satY: satY, 
      p: 0, 
      stage: 1, // 1: Drone -> Bridge, 2: Bridge -> Satellite
      color: start.conn === 'satellite' ? '#3498db' : '#27ae60'
    });
  }

  packets.forEach((pkt, i) => {
    pkt.p += 0.02;
    let curX, curY;
    if (pkt.stage === 1) {
      curX = pkt.startX + (pkt.bridgeX - pkt.startX) * pkt.p;
      curY = pkt.startY + (pkt.bridgeY - pkt.startY) * pkt.p;
      if (pkt.p >= 1) {
        pkt.p = 0;
        pkt.stage = 2;
      }
    } else {
      curX = pkt.bridgeX + (pkt.satX - pkt.bridgeX) * pkt.p;
      curY = pkt.bridgeY + (pkt.satY - pkt.bridgeY) * pkt.p;
      if (pkt.p >= 1) {
        packets.splice(i, 1);
        return;
      }
    }
    sideCtx.fillStyle = pkt.color;
    sideCtx.beginPath(); sideCtx.arc(curX, curY, 3, 0, Math.PI*2); sideCtx.fill();
  });

  dronePositions.forEach(p => {
    sideCtx.fillStyle = p.conn === 'satellite' ? '#3498db' : '#27ae60';
    sideCtx.beginPath(); sideCtx.arc(p.x, p.y, 6, 0, Math.PI*2); sideCtx.fill();
    sideCtx.fillStyle = '#2f3640'; sideCtx.font = '10px monospace';
    sideCtx.fillText(p.id, p.x - 20, p.y - 15);
  });
  requestAnimationFrame(renderSideView);
}

document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById('tab-' + btn.dataset.tab).classList.add('active');
  });
});

init();

/* =========================================================================
   LIVE CAMERA FEED INTEGRATION (PeerJS Receiver)
   ========================================================================= */
const videoContainer = document.getElementById("live-video-container");
const liveVideo = document.getElementById("live-video");
let peer; 

document.getElementById("live-feed-btn").addEventListener("click", () => {
    videoContainer.style.display = "block";
    
    if (!peer) {
        logEvent("Initializing secure feed receiver...", "info");
        
        peer = new Peer('satellite-mission-control-hq-001'); 
        
        peer.on('open', (id) => {
            logEvent("Receiver active. Awaiting Ground Team connection.", "info");
        });

        peer.on('call', (call) => {
            logEvent("Incoming feed from Ground Team...", "crit");
            call.answer(); 
            
            call.on('stream', (remoteStream) => {
                liveVideo.srcObject = remoteStream;
                logEvent("Live feed established successfully.", "crit");
            });
        });
        
        peer.on('error', (err) => {
            console.error(err);
            logEvent("Feed Error: " + err.type, "crit");
        });
    }
});

document.getElementById("close-video").addEventListener("click", () => {
    videoContainer.style.display = "none";
});
