/* =========================================================================
   Dispecerat 112 - core.js
   Incarcare: PRIMUL. Nu depinde de niciun alt fisier.
   ========================================================================= */
// Generat din monolitul index.html - NU adauga cod in alt fisier fara sa verifici
// ordinea de incarcare din index.html (core -> map -> game -> ui -> boot).

// ------------------------------------------------------------------------
// GLOBAL APP STATE & LOCALSTORAGE SYNC
// ------------------------------------------------------------------------

const STORAGE_KEY = 'DISPECERAT_112_DATA_V1';

let state = {
  budget: 250000,
  maxDistanceKm: 25,
  showCoverageCircles: true,
  mapTileStyle: 'dark',
  stations: [], // { id, name, lat, lng }
  vehicles: [], // { id, stationId, type, name, waterCap, compartments, status: 'idle'|'dispatched'|'on_scene'|'returning', lat, lng, route: [], routeIdx: 0, missionId: null }
  missions: []  // { id, title, type: 'fire'|'police'|'smurd', reqType, lat, lng, reward, status: 'active'|'assigned'|'completed' }
};

let pendingStationCoords = null;

let isPlacementMode = false;

let activeStationShopId = null;

let map = null;

let tileLayer = null;

let mapMarkers = {
  stations: {},
  missions: {},
  vehicles: {},
  circles: {},
  routes: {}
};

// ------------------------------------------------------------------------
// GEO HELPERS & CONSTANTE DE SIMULARE
// ------------------------------------------------------------------------

// Acceleratie de simulare: 60x timp real. O ruta de 25 km la 70 km/h

// (21 min real) se parcurge in ~21 secunde de joc.

const SIM_SPEED_MULTIPLIER = 60;

// Viteze medii urbane (km/h) per tip de echipaj.

const VEHICLE_SPEEDS = { police: 70, smurd: 65, fire_custom: 50 };

// Fereastra de raspuns pentru un apel 112 (secunde reale).

const MISSION_TIMEOUT_SEC = 150;

// Procentul din recompensa pierdut cand un apel expira nerezolvat.

const MISSION_FAIL_PENALTY = 0.5;

const MAX_VEHICLES_PER_STATION = 10;

// Selectiile din dropdown-urile de dispecerizare (missionId -> vehicleId).

// Nu se persista, dar supravietuiesc re-randarilor listei.

let dispatchSelections = {};

const EARTH_R = 6371; // km

function haversineKm(lat1, lng1, lat2, lng2) {
  const toRad = d => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 +
            Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_R * Math.asin(Math.sqrt(a));
}

// Punct aleator distribuit uniform in discul de raza radiusKm

// (sqrt e obligatoriu, altfel se aglomereaza in centru).

function randomPointInRadius(lat, lng, radiusKm) {
  const r = radiusKm * Math.sqrt(Math.random());
  const angle = Math.random() * 2 * Math.PI;
  const lngScale = Math.max(Math.cos((lat * Math.PI) / 180), 0.01);
  const dLat = (r * Math.cos(angle)) / 111.32;
  const dLng = (r * Math.sin(angle)) / (111.32 * lngScale);
  return [lat + dLat, lng + dLng];
}

function nearestStationInfo(lat, lng) {
  let best = null;
  let bestKm = Infinity;
  state.stations.forEach(s => {
    const d = haversineKm(lat, lng, s.lat, s.lng);
    if (d < bestKm) { bestKm = d; best = s; }
  });
  return { station: best, km: bestKm };
}

// Distante cumulative (km) pe o ruta [[lat,lng], ...] + totalul.

function buildRouteMetrics(route) {
  const cum = [0];
  for (let i = 1; i < route.length; i++) {
    cum.push(cum[i - 1] + haversineKm(route[i - 1][0], route[i - 1][1], route[i][0], route[i][1]));
  }
  return { cum: cum, totalKm: cum.length ? cum[cum.length - 1] : 0 };
}

// Avanseaza vehiculul pe ruta cu `speedKmh` pe durata `dtSec` de timp real.

// Viteza e constanta in km/h indiferent de cate puncte are ruta.

// Returneaza true daca a ajuns la capatul rutei.

function advanceVehicleAlongRoute(vehicle, dtSec) {
  const route = vehicle.route;
  const cum = vehicle.routeCum;
  if (!route || route.length < 2 || !cum || cum.length < 2) return true;

  const totalKm = cum[cum.length - 1];
  const speedKmh = vehicle.speedKmh || 60;
  const simKm = (speedKmh * SIM_SPEED_MULTIPLIER * dtSec) / 3600;
  const travelled = (vehicle.distKm || 0) + simKm;

  if (travelled >= totalKm) {
    vehicle.distKm = totalKm;
    vehicle.segIdx = route.length - 1;
    vehicle.lat = route[route.length - 1][0];
    vehicle.lng = route[route.length - 1][1];
    return true;
  }

  vehicle.distKm = travelled;

  let i = vehicle.segIdx || 0;
  while (i < cum.length - 2 && cum[i + 1] < travelled) i++;
  while (i > 0 && cum[i] > travelled) i--;
  vehicle.segIdx = i;

  const segLen = cum[i + 1] - cum[i];
  const t = segLen > 0 ? (travelled - cum[i]) / segLen : 0;
  vehicle.lat = route[i][0] + (route[i + 1][0] - route[i][0]) * t;
  vehicle.lng = route[i][1] + (route[i + 1][1] - route[i][1]) * t;
  return false;
}

// Seteaza ruta + metricile de distanta, resetand progresul.

function setVehicleRoute(vehicle, route) {
  vehicle.route = route;
  const m = buildRouteMetrics(route);
  vehicle.routeCum = m.cum;
  vehicle.routeTotalKm = m.totalKm;
  vehicle.distKm = 0;
  vehicle.segIdx = 0;
  vehicle.routeIdx = 0;
  vehicle.lat = route[0][0];
  vehicle.lng = route[0][1];
}

// Timp estimat de deplasare (secunde reale de joc).

function etaSeconds(totalKm, speedKmh) {
  return (totalKm / (speedKmh * SIM_SPEED_MULTIPLIER)) * 3600;
}

// ------------------------------------------------------------------------
// WEB AUDIO SYNTHESIZER ENGINE
// ------------------------------------------------------------------------

const AudioEngine = {
  ctx: null,
  muted: false,
  init() {
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      this.ctx = new AC();
    }
    // Chrome/Safari suspenda contextul pana la primul gest al utilizatorului.
    if (this.ctx.state === 'suspended' && this.ctx.resume) {
      this.ctx.resume().catch(() => {});
    }
    return this.ctx;
  },
  // Ton descendent pentru apelurile 112 expirate nerezolvate.
  playTimeoutTone() {
    if (this.muted) return;
    this.init();
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    [440, 330, 220].forEach((freq, i) => {
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = 'square';
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.10, now + i * 0.18);
      gain.gain.exponentialRampToValueAtTime(0.001, now + i * 0.18 + 0.18);
      osc.connect(gain);
      gain.connect(this.ctx.destination);
      osc.start(now + i * 0.18);
      osc.stop(now + i * 0.18 + 0.2);
    });
  },
  playDispatchAlert() {
    if (this.muted) return;
    this.init();
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(880, now);
    osc.frequency.setValueAtTime(1200, now + 0.12);
    gain.gain.setValueAtTime(0.2, now);
    gain.gain.exponentialRampToValueAtTime(0.01, now + 0.3);
    osc.connect(gain);
    gain.connect(this.ctx.destination);
    osc.start(now);
    osc.stop(now + 0.3);
  },
  playSirenTone() {
    if (this.muted) return;
    this.init();
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(500, now);
    osc.frequency.linearRampToValueAtTime(850, now + 0.25);
    osc.frequency.linearRampToValueAtTime(500, now + 0.5);
    gain.gain.setValueAtTime(0.2, now);
    gain.gain.exponentialRampToValueAtTime(0.01, now + 0.55);
    osc.connect(gain);
    gain.connect(this.ctx.destination);
    osc.start(now);
    osc.stop(now + 0.55);
  },
  playSuccessChime() {
    if (this.muted) return;
    this.init();
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    [523.25, 659.25, 783.99].forEach((freq, i) => {
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.15, now + i * 0.08);
      gain.gain.exponentialRampToValueAtTime(0.001, now + i * 0.08 + 0.25);
      osc.connect(gain);
      gain.connect(this.ctx.destination);
      osc.start(now + i * 0.08);
      osc.stop(now + i * 0.08 + 0.25);
    });
  }
};

function toggleAudio() {
  AudioEngine.muted = !AudioEngine.muted;
  const icon = document.getElementById('audio-icon');
  if (AudioEngine.muted) {
    icon.className = 'fa-solid fa-volume-xmark text-slate-500';
    showToast('Sunet dezactivat', 'info');
  } else {
    icon.className = 'fa-solid fa-volume-high text-cyan-400';
    AudioEngine.playDispatchAlert();
    showToast('Sunet activat', 'info');
  }
}

// ------------------------------------------------------------------------
// MISSION TIMERS, DISPATCH SELECTION & MAP FOCUS
// ------------------------------------------------------------------------

const TYPE_LABEL = { fire_custom: 'Pompieri', police: 'Poliție', smurd: 'SMURD' };

// ------------------------------------------------------------------------
// UI TABS, MODAL & UTILITY HELPERS
// ------------------------------------------------------------------------

function showToast(message, type = 'info') {
  const container = document.getElementById('toast-container');
  const toast = document.createElement('div');

  let borderCol = 'border-cyan-500/50 text-cyan-200';
  if (type === 'error') borderCol = 'border-red-500/50 text-red-200';
  if (type === 'success') borderCol = 'border-emerald-500/50 text-emerald-200';
  if (type === 'warning') borderCol = 'border-amber-500/50 text-amber-200';

  toast.className = `glass-panel px-4 py-3 rounded-xl border ${borderCol} shadow-2xl text-xs font-medium flex items-center gap-2 transform transition duration-300 translate-y-2 pointer-events-auto`;
  toast.innerHTML = `<i class="fa-solid fa-circle-info"></i> <span>${message}</span>`;

  container.appendChild(toast);

  setTimeout(() => {
    toast.style.opacity = '0';
    setTimeout(() => toast.remove(), 300);
  }, 3500);
}

// ------------------------------------------------------------------------
// LOCALSTORAGE PERSISTENCE
// ------------------------------------------------------------------------

function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function loadSavedState() {
  const saved = localStorage.getItem(STORAGE_KEY);
  if (saved) {
    try {
      const parsed = JSON.parse(saved);
      state = { ...state, ...parsed };
    } catch (e) {
      console.error('Error loading saved state', e);
    }
  }
}

function resetDataPrompt() {
  if (window.confirm && window.confirm("Ești sigur că vrei să resetezi toate datele și progresul?")) {
    localStorage.removeItem(STORAGE_KEY);
    window.location.reload();
  }
}
