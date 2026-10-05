/* =========================================================================
   Dispecerat 112 - map.js
   Depinde de: core.js
   ========================================================================= */
// Generat din monolitul index.html - NU adauga cod in alt fisier fara sa verifici
// ordinea de incarcare din index.html (core -> map -> game -> ui -> boot).

// ------------------------------------------------------------------------
// INITIALIZATION & LEAFLET MAP SETUP
// ------------------------------------------------------------------------

function initMap() {
  // Default centered on Bucharest / Romania center
  map = L.map('map', {
    center: [44.4323, 26.1063],
    zoom: 12,
    zoomControl: false
  });

  L.control.zoom({ position: 'bottomright' }).addTo(map);

  setMapTileProvider(state.mapTileStyle);

  // Map Click Event for Station Placement
  map.on('click', function(e) {
    if (isPlacementMode) {
      pendingStationCoords = e.latlng;
      openStationNamingModal();
    }
  });
}

function setMapTileProvider(styleKey) {
  if (tileLayer) map.removeLayer(tileLayer);

  let url = 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png';
  let attrib = '&copy; OpenStreetMap &copy; CARTO';

  if (styleKey === 'osm') {
    url = 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png';
    attrib = '&copy; OpenStreetMap contributors';
  } else if (styleKey === 'satellite') {
    url = 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}';
    attrib = 'Tiles &copy; Esri';
  }

  tileLayer = L.tileLayer(url, {
    maxZoom: 19,
    attribution: attrib
  }).addTo(map);

  state.mapTileStyle = styleKey;
  saveState();
}

function changeMapTile(key) {
  setMapTileProvider(key);
  showToast('Stil hartă schimbat', 'info');
}

// ------------------------------------------------------------------------
// STATION BUY & PLACEMENT LOGIC
// ------------------------------------------------------------------------

function startStationPlacementMode() {
  if (state.budget < 100000) {
    showToast('Buget insuficient! Ai nevoie de 100.000 LEI.', 'error');
    return;
  }

  isPlacementMode = true;
  document.getElementById('placement-banner').classList.remove('hidden');
  document.getElementById('map').style.cursor = 'crosshair';
  toggleMobileMenu(false);
  showToast('Apasă pe hartă în locația dorită pentru a construi subunitatea', 'info');
}

function cancelStationPlacementMode() {
  isPlacementMode = false;
  document.getElementById('placement-banner').classList.add('hidden');
  document.getElementById('map').style.cursor = '';
}

function openStationNamingModal() {
  document.getElementById('input-station-name').value = `Detașamentul ${state.stations.length + 1} Pompieri`;
  document.getElementById('modal-station-name').classList.remove('hidden');
}

function confirmStationPurchase() {
  const name = document.getElementById('input-station-name').value.trim() || 'Subunitate 112';

  if (state.budget < 100000) {
    showToast('Buget insuficient!', 'error');
    return;
  }

  // Deduct funds
  state.budget -= 100000;

  const newStation = {
    id: 'st_' + Date.now(),
    name: name,
    lat: pendingStationCoords.lat,
    lng: pendingStationCoords.lng
  };

  state.stations.push(newStation);

  // Auto create 1 default police & 1 smurd vehicle
  state.vehicles.push({
    id: 'v_' + Date.now() + '_1',
    stationId: newStation.id,
    type: 'police',
    name: 'Poliție Duster',
    waterCap: 0,
    compartments: [],
    status: 'idle',
    lat: newStation.lat,
    lng: newStation.lng,
    route: [],
    routeIdx: 0,
    missionId: null
  });

  cancelStationPlacementMode();
  closeModal('modal-station-name');
  AudioEngine.playSuccessChime();
  showToast(`A fost construită subunitatea "${name}"!`, 'success');

  saveState();
  renderUI();
  renderMapElements();

  // Pan map to new station
  map.flyTo([newStation.lat, newStation.lng], 13);
}

// ------------------------------------------------------------------------
// 112 EMERGENCY CALL GENERATOR & DISTANCE FILTER
// ------------------------------------------------------------------------

function updateMaxDistanceSlider(val) {
  state.maxDistanceKm = Math.max(1, parseInt(val, 10) || 1);
  document.getElementById('slider-distance-val').textContent = `${state.maxDistanceKm} km`;
  // BUG REPARAT: cercurile de pe harta nu se actualizau la mutarea sliderului,
  // asa ca raza parea ca nu functioneaza.
  refreshCoverageCircles();
  saveState();
}

// Actualizeaza raza cercurilor de acoperire fara sa re-randeze toata harta.

function refreshCoverageCircles() {
  if (!state.showCoverageCircles) return;
  state.stations.forEach(station => {
    const circle = mapMarkers.circles[station.id];
    if (circle) circle.setRadius(state.maxDistanceKm * 1000);
  });
}

// ------------------------------------------------------------------------
// MAP MARKERS & VISUAL RENDERING
// ------------------------------------------------------------------------

function renderMapElements() {
  isRenderingMap = true;
  // Clear old markers
  Object.values(mapMarkers.stations).forEach(m => map.removeLayer(m));
  Object.values(mapMarkers.circles).forEach(c => map.removeLayer(c));
  Object.values(mapMarkers.missions).forEach(m => map.removeLayer(m));
  Object.values(mapMarkers.vehicles).forEach(v => map.removeLayer(v));
  Object.values(mapMarkers.routes).forEach(r => map.removeLayer(r));

  mapMarkers.stations = {};
  mapMarkers.circles = {};
  mapMarkers.missions = {};
  mapMarkers.vehicles = {};
  mapMarkers.routes = {};

  // 1. Render Stations
  state.stations.forEach(station => {
    const stationIcon = L.divIcon({
      className: 'custom-leaflet-icon',
      html: `<div class="w-10 h-10 rounded-xl bg-slate-900 border-2 border-cyan-400 text-cyan-400 flex items-center justify-center shadow-lg shadow-cyan-500/30 pulse-cyan">
               <i class="fa-solid fa-building-shield text-lg"></i>
             </div>`,
      iconSize: [40, 40],
      iconAnchor: [20, 20]
    });

    const marker = L.marker([station.lat, station.lng], { icon: stationIcon })
      .addTo(map)
      .bindTooltip(`<b>${station.name}</b>`, { permanent: false, direction: 'top' });

    mapMarkers.stations[station.id] = marker;

    // Coverage circle
    if (state.showCoverageCircles) {
      const circle = L.circle([station.lat, station.lng], {
        radius: state.maxDistanceKm * 1000,
        color: '#00f3ff',
        weight: 1,
        fillColor: '#00f3ff',
        fillOpacity: 0.05
      }).addTo(map);
      mapMarkers.circles[station.id] = circle;
    }
  });

  // 2. Render Missions
  state.missions.forEach(mission => {
    let colorClass = 'bg-red-600 border-red-300 text-white';
    let iconClass = 'fa-fire';

    if (mission.type === 'police') {
      colorClass = 'bg-blue-600 border-blue-300 text-white';
      iconClass = 'fa-shield-halved';
    } else if (mission.type === 'smurd') {
      colorClass = 'bg-emerald-600 border-emerald-300 text-white';
      iconClass = 'fa-truck-medical';
    }

    const missionIcon = L.divIcon({
      className: 'custom-leaflet-icon',
      html: `<div class="w-9 h-9 rounded-full ${colorClass} border-2 flex items-center justify-center shadow-xl pulse-emergency">
               <i class="fa-solid ${iconClass} text-sm"></i>
             </div>`,
      iconSize: [36, 36],
      iconAnchor: [18, 18]
    });

    const marker = L.marker([mission.lat, mission.lng], { icon: missionIcon })
      .addTo(map)
      .bindTooltip(`<b>${mission.title}</b><br>Recompensă: ${mission.reward} LEI`, { direction: 'top' });

    mapMarkers.missions[mission.id] = marker;
  });

  // 3. Render Vehicles & Routes
  state.vehicles.forEach(vehicle => {
    let vColor = 'text-amber-400 bg-slate-900 border-amber-400';
    if (vehicle.type === 'police') vColor = 'text-blue-400 bg-slate-900 border-blue-400';
    if (vehicle.type === 'smurd') vColor = 'text-emerald-400 bg-slate-900 border-emerald-400';

    const vehicleIcon = L.divIcon({
      className: 'custom-leaflet-icon',
      html: `<div class="w-8 h-8 rounded-lg ${vColor} border-2 flex items-center justify-center shadow-md">
               <i class="fa-solid fa-truck-fast text-xs"></i>
             </div>`,
      iconSize: [32, 32],
      iconAnchor: [16, 16]
    });

    // Click pe vehicul -> popup cu viteza curenta, limita de drum, distanta
    // ramasa si timpul estimat pana la destinatie (reimprospatate live).
    const marker = L.marker([vehicle.lat, vehicle.lng], { icon: vehicleIcon })
      .addTo(map)
      .bindPopup(() => vehiclePopupHtml(vehicle), {
        className: 'd112-popup',
        closeButton: true,
        autoPan: false,
        offset: [0, -6]
      });

    marker.on('popupopen', () => { openVehiclePopupId = vehicle.id; });
    marker.on('popupclose', () => {
      if (!isRenderingMap && openVehiclePopupId === vehicle.id) openVehiclePopupId = null;
    });

    mapMarkers.vehicles[vehicle.id] = marker;

    // Draw neon route line if active
    if (vehicle.route.length > 0 && (vehicle.status === 'dispatched' || vehicle.status === 'returning')) {
      // Deseneaza doar portiunea ramasa de parcurs.
      const remaining = vehicle.route.slice(vehicle.segIdx || 0);
      const polyline = L.polyline(remaining, {
        color: '#00f3ff',
        weight: 4,
        opacity: 0.8,
        className: 'route-glow'
      }).addTo(map);
      mapMarkers.routes[vehicle.id] = polyline;
    }
  });

  isRenderingMap = false;
  restoreOpenVehiclePopup();
}

// Re-deschide popup-ul de vehicul dupa o re-randare completa a hartii.

function restoreOpenVehiclePopup() {
  if (!openVehiclePopupId) return;
  const marker = mapMarkers.vehicles[openVehiclePopupId];
  if (marker && typeof marker.openPopup === 'function') marker.openPopup();
}

// ========================================================================
// POPUP DETALII VEHICUL (click pe vehicul)
// ========================================================================

function vehicleStatusLabel(vehicle) {
  if (vehicle.status === 'dispatched') return 'In deplasare spre intervenție';
  if (vehicle.status === 'on_scene') return 'Intervine la fața locului';
  if (vehicle.status === 'returning') return 'Se întoarce la subunitate';
  return 'Disponibil în garaj';
}

function vehicleDestinationLabel(vehicle) {
  if (vehicle.missionId) {
    const m = state.missions.find(x => x.id === vehicle.missionId);
    if (m) return m.title;
  }
  const st = state.stations.find(s => s.id === vehicle.stationId);
  return st ? st.name : '—';
}

// Viteza instanta + limita de drum estimata + distanta ramasa + ETA.

function vehiclePopupHtml(vehicle) {
  const moving = (vehicle.status === 'dispatched' || vehicle.status === 'returning') &&
                 !!vehicle.route && vehicle.route.length > 1;
  const speed = Math.round(vehicle.speedKmh || 0);
  const totalKm = vehicle.routeTotalKm || 0;
  const doneKm = vehicle.distKm || 0;
  const leftKm = moving ? Math.max(0, totalKm - doneKm) : 0;
  const pct = totalKm > 0 ? Math.min(100, Math.round((doneKm / totalKm) * 100)) : 0;

  let roadLimit = 0;
  if (moving && vehicle.routeSpeeds && vehicle.routeSpeeds.length) {
    const i = Math.min(Math.max(vehicle.segIdx || 0, 0), vehicle.routeSpeeds.length - 1);
    roadLimit = Math.round(vehicle.routeSpeeds[i] || 0);
  }
  const eta = moving ? simulateEtaSeconds(vehicle) : 0;

  const rows = moving ? `
      <div class="flex justify-between gap-3"><span class="text-slate-400">Viteză curentă</span><b class="font-orbitron text-cyan-300">${speed} km/h</b></div>
      <div class="flex justify-between gap-3"><span class="text-slate-400">Limită drum (est.)</span><b class="font-orbitron text-amber-300">${roadLimit} km/h</b></div>
      <div class="text-right text-[10px] text-slate-500 -mt-1">${roadLimit ? roadKindLabel(roadLimit) : ''}</div>
      <div class="flex justify-between gap-3"><span class="text-slate-400">Distanță rămasă</span><b class="font-orbitron text-slate-200">${leftKm.toFixed(1)} / ${totalKm.toFixed(1)} km</b></div>
      <div class="flex justify-between gap-3"><span class="text-slate-400">Timp estimat</span><b class="font-orbitron text-emerald-300">${formatDuration(eta)}</b></div>
      <div class="mt-1 h-1.5 rounded bg-slate-800 overflow-hidden"><div class="h-full bg-cyan-400" style="width:${pct}%"></div></div>` : `
      <div class="flex justify-between gap-3"><span class="text-slate-400">Viteză curentă</span><b class="font-orbitron text-slate-300">0 km/h</b></div>
      <div class="text-slate-400 italic">Echipajul este în rezervă.</div>`;

  return `
    <div class="min-w-[200px] font-sans">
      <div class="text-xs font-bold text-slate-100">${vehicle.name}</div>
      <div class="mt-0.5 text-[10px] uppercase tracking-wider text-cyan-400">${vehicleStatusLabel(vehicle)}</div>
      <div class="mt-2 space-y-1 text-[11px]">${rows}</div>
      <div class="mt-2 pt-2 border-t border-slate-800 text-[11px] text-slate-400">
        <i class="fa-solid fa-location-dot mr-1"></i>${vehicleDestinationLabel(vehicle)}
      </div>
    </div>`;
}

// Reimprospateaza popup-ul deschis (apelat la 1s din startTimersLoop).

function refreshOpenVehiclePopup() {
  if (!openVehiclePopupId) return;
  const marker = mapMarkers.vehicles[openVehiclePopupId];
  const vehicle = state.vehicles.find(v => v.id === openVehiclePopupId);
  if (!marker || !vehicle) { openVehiclePopupId = null; return; }
  if (typeof marker.isPopupOpen === 'function' && !marker.isPopupOpen()) return;
  if (typeof marker.setPopupContent === 'function') {
    marker.setPopupContent(vehiclePopupHtml(vehicle));
  }
}

function updateVehiclePositionsOnMap() {
  state.vehicles.forEach(vehicle => {
    if (mapMarkers.vehicles[vehicle.id]) {
      mapMarkers.vehicles[vehicle.id].setLatLng([vehicle.lat, vehicle.lng]);
    }
  });
}

function toggleCoverageCircles(show) {
  state.showCoverageCircles = show;
  saveState();
  renderMapElements();
}

// ------------------------------------------------------------------------
// MISSION TIMERS, DISPATCH SELECTION & MAP FOCUS
// ------------------------------------------------------------------------

function focusMissionOnMap(missionId) {
  const m = state.missions.find(x => x.id === missionId);
  if (m) map.flyTo([m.lat, m.lng], 14);
}
