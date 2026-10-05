/* =========================================================================
   Dispecerat 112 - game.js
   Depinde de: core.js, map.js
   ========================================================================= */
// Generat din monolitul index.html - NU adauga cod in alt fisier fara sa verifici
// ordinea de incarcare din index.html (core -> map -> game -> ui -> boot).

// ------------------------------------------------------------------------
// INITIALIZATION & LEAFLET MAP SETUP
// ------------------------------------------------------------------------

// Repara starile ramase agatate dupa un reload (F5 in timpul unei interventii).

// Fara asta, un echipaj ajuns pe scena ramanea blocat pe 'on_scene' pentru totdeauna.

function recoverStuckVehicles() {
  let changed = false;
  const liveMissionIds = new Set(state.missions.map(m => m.id));

  state.vehicles.forEach(v => {
    if (v.missionId && !liveMissionIds.has(v.missionId)) {
      v.missionId = null;
      if (v.status !== 'on_scene') v.status = 'idle';
      changed = true;
    }

    if (v.status === 'on_scene') {
      // Timerul de interventie traia doar in memorie -> il relansam (mai scurt,
      // interventia era deja in curs cand s-a dat reload).
      setTimeout(() => completeMissionWork(v.id), 5000);
    } else if (v.status === 'dispatched' || v.status === 'returning') {
      if (v.route && v.route.length > 1) {
        // Ruta a fost persistata -> reconstruim distantele cumulative.
        const metrics = buildRouteMetrics(v.route);
        v.routeCum = metrics.cum;
        v.routeTotalKm = metrics.totalKm;
        // Salvarile vechi nu au profilul de drum -> il reconstruim (fara viteze reale).
        if (!v.routeSpeeds || v.routeSpeeds.length !== v.route.length - 1) {
          const prof = buildSegmentProfile(v.route, null);
          v.routeSpeeds = prof.speeds;
          v.routeCorner = prof.corner;
          v.routeStraight = prof.straight;
        }
        if (v.driverSeed == null) v.driverSeed = Math.random() * Math.PI * 2;
        v.distKm = v.distKm || 0;
        v.segIdx = v.segIdx || 0;
        advanceVehicleAlongRoute(v, 0);
      } else {
        const st = state.stations.find(s => s.id === v.stationId);
        v.status = 'idle';
        v.missionId = null;
        v.route = [];
        v.routeCum = [];
        v.segIdx = 0;
        v.distKm = 0;
        if (st) { v.lat = st.lat; v.lng = st.lng; }
      }
      changed = true;
    }
  });

  state.missions.forEach(m => {
    if (m.status === 'assigned') {
      const enRoute = state.vehicles.some(v => v.missionId === m.id && v.status !== 'idle');
      if (!enRoute) { m.status = 'active'; changed = true; }
    }
    if (!m.deadline) { m.deadline = Date.now() + MISSION_TIMEOUT_SEC * 1000; changed = true; }
  });

  if (changed) saveState();
}

// ------------------------------------------------------------------------
// DYNAMIC VEHICLE CONFIGURATOR & DYNAMIC PRICING CALCULATOR
// ------------------------------------------------------------------------

function openVehicleShopModal(stationId) {
  activeStationShopId = stationId;
  document.getElementById('select-vehicle-type').value = 'fire_custom';
  handleVehicleTypeChange('fire_custom');
  document.getElementById('modal-vehicle-shop').classList.remove('hidden');
}

function handleVehicleTypeChange(val) {
  const customBox = document.getElementById('fire-truck-customizer');
  if (val === 'fire_custom') {
    customBox.classList.remove('hidden');
  } else {
    customBox.classList.add('hidden');
  }
  updateFireTruckPrice();
}

function updateFireTruckPrice() {
  const type = document.getElementById('select-vehicle-type').value;
  const priceDisplay = document.getElementById('display-calculated-vehicle-price');

  if (type === 'police') {
    priceDisplay.textContent = '35.000 LEI';
    return 35000;
  } else if (type === 'smurd') {
    priceDisplay.textContent = '55.000 LEI';
    return 55000;
  }

  // Dynamic calculation for fire truck
  const waterLiters = parseInt(document.getElementById('input-water-capacity').value);
  document.getElementById('display-water-val').textContent = `${waterLiters.toLocaleString('ro-RO')} Litri`;

  const basePrice = 25000;
  const waterCost = waterLiters * 6; // 6 LEI per Liter

  let compartmentsCost = 0;
  if (document.getElementById('chk-mod-stingere').checked) compartmentsCost += 15000;
  if (document.getElementById('chk-mod-descarcerare').checked) compartmentsCost += 22000;
  if (document.getElementById('chk-mod-primajutor').checked) compartmentsCost += 18000;

  const totalPrice = basePrice + waterCost + compartmentsCost;
  priceDisplay.textContent = `${totalPrice.toLocaleString('ro-RO')} LEI`;

  return totalPrice;
}

function confirmVehiclePurchase() {
  const price = updateFireTruckPrice();

  if (state.budget < price) {
    showToast('Buget insuficient pentru achiziție!', 'error');
    return;
  }

  const station = state.stations.find(s => s.id === activeStationShopId);
  if (!station) return;

  // BUG REPARAT: limita garajului era afisata in UI dar nu era impusa.
  const currentCount = state.vehicles.filter(v => v.stationId === station.id).length;
  if (currentCount >= MAX_VEHICLES_PER_STATION) {
    showToast(`Garaj plin! Maxim ${MAX_VEHICLES_PER_STATION} vehicule per subunitate.`, 'error');
    return;
  }

  const type = document.getElementById('select-vehicle-type').value;
  let name = 'Autospecială ASAS Pompieri';
  let waterCap = 0;
  let compartments = [];

  if (type === 'police') {
    name = 'Echipaj Poliție Duster';
  } else if (type === 'smurd') {
    name = 'Ambulanță SMURD Tip B2';
  } else {
    waterCap = parseInt(document.getElementById('input-water-capacity').value);
    if (document.getElementById('chk-mod-stingere').checked) compartments.push('Stingere');
    if (document.getElementById('chk-mod-descarcerare').checked) compartments.push('Descarcerare');
    if (document.getElementById('chk-mod-primajutor').checked) compartments.push('Prim Ajutor');
    name = `ASAS Pompieri (${waterCap}L)`;
  }

  state.budget -= price;

  const newVehicle = {
    id: 'v_' + Date.now(),
    stationId: station.id,
    type: type,
    name: name,
    waterCap: waterCap,
    compartments: compartments,
    status: 'idle',
    lat: station.lat,
    lng: station.lng,
    route: [],
    routeIdx: 0,
    missionId: null
  };

  state.vehicles.push(newVehicle);
  AudioEngine.playSuccessChime();
  showToast(`Vehiculul "${name}" cumpărat cu succes!`, 'success');

  closeModal('modal-vehicle-shop');
  saveState();
  renderUI();
  renderMapElements();
}

// ------------------------------------------------------------------------
// 112 EMERGENCY CALL GENERATOR & DISTANCE FILTER
// ------------------------------------------------------------------------

function startCallGeneratorTimer() {
  setInterval(() => {
    if (state.stations.length === 0) return;
    // La timp real un echipaj e plecat minute intregi, deci se numara doar
    // apelurile inca nedispecerizate, plus un plafon total de siguranta.
    const pending = state.missions.filter(m => m.status === 'active').length;
    if (pending >= MAX_PENDING_CALLS || state.missions.length >= MAX_ACTIVE_MISSIONS) return;

    generateRandom112Call();
  }, CALL_INTERVAL_MS);
}

function generateRandom112Call() {
  if (state.stations.length === 0) return;

  // Generam in jurul unei subunitati, apoi VALIDAM fata de cea mai apropiata
  // subunitate - altfel, cu mai multe subunitati, cercul afisat nu corespunde
  // cu locul unde apar de fapt apelurile.
  let pick = null;
  for (let attempt = 0; attempt < 20; attempt++) {
    const epicenter = state.stations[Math.floor(Math.random() * state.stations.length)];
    const candidate = randomPointInRadius(epicenter.lat, epicenter.lng, state.maxDistanceKm);
    const info = nearestStationInfo(candidate[0], candidate[1]);
    if (info.km <= state.maxDistanceKm) {
      pick = { lat: candidate[0], lng: candidate[1], info: info };
      break;
    }
    if (!pick || info.km < pick.info.km) {
      pick = { lat: candidate[0], lng: candidate[1], info: info };
    }
  }
  if (!pick) return;

  const callLat = pick.lat;
  const callLng = pick.lng;
  const nearest = pick.info;

  const callTemplates = [
    { type: 'fire', reqType: 'fire_custom', title: 'Incendiu Anexă Gospodărească', reward: 8500 },
    { type: 'fire', reqType: 'fire_custom', title: 'Incendiu de Vegetație Uscată', reward: 6000 },
    { type: 'fire', reqType: 'fire_custom', title: 'Incendiu Garaj cu Pericol de Explozie', reward: 12000 },
    { type: 'police', reqType: 'police', title: 'Accident Rutier cu Drum Blocat', reward: 4500 },
    { type: 'police', reqType: 'police', title: 'Tulburarea Liniștii Publice / Scandal', reward: 3500 },
    { type: 'smurd', reqType: 'smurd', title: 'Urgente Medicale - Stop Cardio-Respirator', reward: 7000 },
    { type: 'smurd', reqType: 'smurd', title: 'Accident Casnic Grav cu Traumatisme', reward: 5500 }
  ];

  const template = callTemplates[Math.floor(Math.random() * callTemplates.length)];

  const mission = {
    id: 'm_' + Date.now() + '_' + Math.floor(Math.random() * 1000),
    title: template.title,
    type: template.type,
    reqType: template.reqType,
    lat: callLat,
    lng: callLng,
    reward: template.reward,
    district: nearest.station ? nearest.station.name : null,
    distanceKm: +nearest.km.toFixed(2),
    createdAt: Date.now(),
    deadline: Date.now() + MISSION_TIMEOUT_SEC * 1000,
    status: 'active'
  };

  state.missions.push(mission);
  AudioEngine.playDispatchAlert();
  showToast(`APEL NOU 112: ${mission.title} (la ${mission.distanceKm.toFixed(1)} km)`, 'warning');

  saveState();
  renderUI();
  renderMapElements();
}

// ------------------------------------------------------------------------
// OSRM ROAD ROUTING ENGINE & DISPATCH
// ------------------------------------------------------------------------

// Rutare + viteze reale de drum. FOSSGIS (routing.openstreetmap.de) intoarce
// annotation.speed per segment - viteza de parcurs din datele OSM. O folosim ca
// limita reala a drumului; daca serverul nu raspunde, cade pe OSRM demo (fara
// viteze, doar geometrie -> limita se estimeaza din geometrie).

const ROUTE_PROVIDERS = [
  'https://routing.openstreetmap.de/routed-car/route/v1/driving',
  'https://router.project-osrm.org/route/v1/driving'
];

async function fetchRouteWithSpeeds(startLat, startLng, endLat, endLng) {
  for (let i = 0; i < ROUTE_PROVIDERS.length; i++) {
    try {
      const url = `${ROUTE_PROVIDERS[i]}/${startLng},${startLat};${endLng},${endLat}?overview=full&geometries=geojson&annotations=speed`;
      const res = await fetch(url);
      const data = await res.json();

      if (data.code === 'Ok' && data.routes && data.routes.length > 0) {
        const route = data.routes[0];
        // OSRM intoarce [lng, lat]; Leaflet vrea [lat, lng]
        const coords = route.geometry.coordinates.map(c => [c[1], c[0]]);
        const ann = (route.legs && route.legs[0] && route.legs[0].annotation) || route.annotations || {};
        const raw = ann.speed;
        // speed e in m/s, cate un element per segment de geometrie
        const flowKmh = (raw && raw.length === coords.length - 1) ? raw.map(v => v * 3.6) : null;
        if (coords.length > 1) return { coords: coords, flowKmh: flowKmh };
      }
    } catch (e) {
      console.warn('Rutare esuata pe', ROUTE_PROVIDERS[i], e);
    }
  }

  // Fallback liniar (offline)
  const points = [];
  const steps = 25;
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    points.push([
      startLat + (endLat - startLat) * t,
      startLng + (endLng - startLng) * t
    ]);
  }
  return { coords: points, flowKmh: null };
}

async function dispatchVehicleToMission(vehicleId, missionId) {
  const vehicle = state.vehicles.find(v => v.id === vehicleId);
  const mission = state.missions.find(m => m.id === missionId);

  if (!vehicle || !mission) return;

  if (vehicle.status !== 'idle') {
    showToast('Echipajul nu mai este disponibil!', 'error');
    renderUI();
    return;
  }

  // BUG REPARAT: nu se verifica tipul echipajului, deci puteai trimite
  // SMURD la incendiu. Acum se compara cu mission.reqType.
  if (vehicle.type !== mission.reqType) {
    showToast(`Echipaj incompatibil! Ai nevoie de ${TYPE_LABEL[mission.reqType] || mission.reqType}.`, 'error');
    renderUI();
    return;
  }

  vehicle.status = 'dispatched';
  vehicle.missionId = mission.id;
  vehicle.speedKmh = 0; // pleaca de pe loc, accelereaza progresiv pe ruta
  mission.status = 'assigned';
  delete dispatchSelections[mission.id];

  AudioEngine.playSirenTone();
  showToast(`Echipajul "${vehicle.name}" trimis la interventie!`, 'info');

  // Ruta rutiera reala + vitezele reale de drum (FOSSGIS/OSM).
  const routed = await fetchRouteWithSpeeds(vehicle.lat, vehicle.lng, mission.lat, mission.lng);
  setVehicleRoute(vehicle, routed.coords, routed.flowKmh);

  const eta = simulateEtaSeconds(vehicle);
  showToast(`Traseu ${vehicle.routeTotalKm.toFixed(1)} km${vehicle.roadDataReal ? ' (limite reale de drum)' : ''} - sosire in ~${formatDuration(eta)}`, 'info');

  saveState();
  renderUI();
  renderMapElements();
}

// ------------------------------------------------------------------------
// GAME LOOP & REAL-TIME VEHICLE MOVEMENT PHYSICS
// ------------------------------------------------------------------------

function startGameLoop() {
  let lastTick = Date.now();
  let saveCounter = 0;

  setInterval(() => {
    const now = Date.now();
    // Limiteaza delta-ul: daca tab-ul a fost in background, nu teleporta echipajele.
    const dtSec = Math.min((now - lastTick) / 1000, 2);
    lastTick = now;

    let stateChanged = false;
    checkMissionTimeouts();

    state.vehicles.forEach(vehicle => {
      if ((vehicle.status === 'dispatched' || vehicle.status === 'returning') &&
          vehicle.route && vehicle.route.length > 1) {

        // BUG REPARAT: inainte se avansa 1 punct la 300ms, deci durata depindea
        // de cate puncte avea ruta OSRM, nu de distanta. Acum e viteza reala (km/h).
        const atEnd = advanceVehicleAlongRoute(vehicle, dtSec);
        stateChanged = true;

        if (atEnd) {
          if (vehicle.status === 'dispatched') {
            vehicle.status = 'on_scene';
            // Interventia la fata locului (secunde reale).
            setTimeout(() => completeMissionWork(vehicle.id), MISSION_WORK_SEC * 1000);
          } else if (vehicle.status === 'returning') {
            vehicle.status = 'idle';
            vehicle.route = [];
            vehicle.routeCum = [];
            vehicle.routeIdx = 0;
            vehicle.segIdx = 0;
            vehicle.distKm = 0;
            vehicle.missionId = null;

            // Snap to station
            const st = state.stations.find(s => s.id === vehicle.stationId);
            if (st) {
              vehicle.lat = st.lat;
              vehicle.lng = st.lng;
            }
          }
        }
      }
    });

    if (stateChanged) {
      updateVehiclePositionsOnMap();
      saveCounter++;
      if (saveCounter >= 16) { saveCounter = 0; saveState(); } // salvare ~5s
    }
  }, 300);
}

async function completeMissionWork(vehicleId) {
  const vehicle = state.vehicles.find(v => v.id === vehicleId);
  // Guard: previne dubla recompensa daca timerul de interventie ruleaza de doua ori
  // (unul din memorie + unul restaurat dupa reload).
  if (!vehicle || vehicle.status !== 'on_scene') return;

  const missionIndex = state.missions.findIndex(m => m.id === vehicle.missionId);
  if (missionIndex !== -1) {
    const mission = state.missions[missionIndex];

    // Award reward
    state.budget += mission.reward;
    AudioEngine.playSuccessChime();
    showToast(`Misiune finalizată! Recompensă: +${mission.reward.toLocaleString('ro-RO')} LEI`, 'success');

    // Remove mission
    state.missions.splice(missionIndex, 1);
  }

  // Return vehicle to station
  const station = state.stations.find(s => s.id === vehicle.stationId);
  if (station) {
    vehicle.status = 'returning'; // setVehicleRoute() o repune pe loc (viteza 0)
    const routedBack = await fetchRouteWithSpeeds(vehicle.lat, vehicle.lng, station.lat, station.lng);
    setVehicleRoute(vehicle, routedBack.coords, routedBack.flowKmh);
  } else {
    vehicle.status = 'idle';
    vehicle.missionId = null;
    vehicle.route = [];
    vehicle.routeCum = [];
  }

  saveState();
  renderUI();
  renderMapElements();
}

// ------------------------------------------------------------------------
// MISSION TIMERS, DISPATCH SELECTION & MAP FOCUS
// ------------------------------------------------------------------------

// BUG REPARAT: apelurile ignorate se acumulau pana la 8 si blocau generatorul

// pentru totdeauna. Acum expira si se aplica o penalizare.

function checkMissionTimeouts() {
  const now = Date.now();
  const expired = state.missions.filter(m => m.status === 'active' && m.deadline && now > m.deadline);
  if (expired.length === 0) return;

  expired.forEach(m => {
    const idx = state.missions.findIndex(x => x.id === m.id);
    if (idx !== -1) state.missions.splice(idx, 1);
    delete dispatchSelections[m.id];
    const penalty = Math.round(m.reward * MISSION_FAIL_PENALTY);
    state.budget = Math.max(0, state.budget - penalty);
    showToast(`Apel 112 expirat: ${m.title}. Penalizare -${penalty.toLocaleString('ro-RO')} LEI`, 'error');
  });

  AudioEngine.playTimeoutTone();
  saveState();
  renderUI();
  renderMapElements();
}
