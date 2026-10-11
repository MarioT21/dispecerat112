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
  // Misiunile salvate inainte de sistemul de forte multiple n-au `needs` - le
  // transformam intr-o nevoie unica, altfel dispecerizarea lor nu mai functioneaza.
  if (ensureAllMissionsShape()) changed = true;
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
      if (v.workEndsAt == null) v.workEndsAt = Date.now() + 5000;
      if (v.type === 'fire_custom' && v.waterLeft == null) v.waterLeft = v.waterCap || 0;
      setTimeout(() => completeMissionWork(v.id), 5000);
    } else if (v.status === 'dispatched' || v.status === 'returning') {
      if (v.route && v.route.length > 1) {
        // Ruta a fost persistata -> reconstruim distantele cumulative.
        const metrics = buildRouteMetrics(v.route);
        v.routeCum = metrics.cum;
        v.routeTotalKm = metrics.totalKm;
        // Salvarile vechi nu au profilul de drum -> il reconstruim (fara viteze reale).
        if (!v.routeSpeeds || v.routeSpeeds.length !== v.route.length - 1) {
          const prof = buildSegmentProfile(v.route, null, null);
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

// Template de apeluri: fiecare eveniment are NEVOILE lui de forte. `victims` da
// numarul de victime (deci cate ambulante se cer), `water` cati litri trebuie
// livrati la incendiu, iar `needs(ctx)` lista de nevoi (tip + numar + modul).
// Accident in parcare = 1 politie. Accident rutier = 2 politie + o autospeciala cu
// descarcerare + cate o ambulanta pe victima. Incendiu = autospeciale de stingere
// (+ politie la perimetru si SMURD cand e pericol de explozie).
const MISSION_TEMPLATES = [
  {
    id: 'accident_parcare', kind: 'police', priority: 'p3',
    title: 'Accident În Parcare (Fără Victime)', reward: 3500,
    victims: () => 0,
    needs: () => [{ kind: 'police', count: 1, label: 'Constatare' }],
    water: () => 0
  },
  {
    id: 'accident_rutier', kind: 'police', priority: 'p2',
    title: 'Accident Rutier cu Drum Blocat', reward: 14000,
    victims: () => 1 + (Math.random() < 0.45 ? 1 : 0),
    needs: (ctx) => [
      { kind: 'police', count: 2, label: 'Perimetru / dirijare' },
      { kind: 'fire_custom', count: 1, requires: 'Descarcerare', label: 'Descarcerare' },
      { kind: 'smurd', count: ctx.victims, label: 'Asistență medicală' }
    ],
    water: () => 0
  },
  {
    id: 'accident_grav', kind: 'police', priority: 'p1',
    title: 'Accident Grav cu Victime Multiple', reward: 32000,
    victims: () => 2 + Math.floor(Math.random() * 3),
    needs: (ctx) => [
      { kind: 'police', count: 3, label: 'Perimetru / dirijare' },
      { kind: 'fire_custom', count: 2, requires: 'Descarcerare', label: 'Descarcerare' },
      { kind: 'smurd', count: ctx.victims, label: 'Asistență medicală' }
    ],
    water: () => 0
  },
  {
    id: 'incendiu_vegetatie', kind: 'fire', priority: 'p3',
    title: 'Incendiu de Vegetație Uscată', reward: 9000,
    victims: () => 0,
    needs: () => [{ kind: 'fire_custom', count: 1, requires: 'Stingere', label: 'Stingere' }],
    water: () => 3000
  },
  {
    id: 'incendiu_anexa', kind: 'fire', priority: 'p2',
    title: 'Incendiu Anexă Gospodărească', reward: 15000,
    victims: () => 0,
    needs: () => [{ kind: 'fire_custom', count: 1, requires: 'Stingere', label: 'Stingere' }],
    water: () => 5000
  },
  {
    id: 'incendiu_locuinta', kind: 'fire', priority: 'p1',
    title: 'Incendiu Locuință cu Persoane Blocate', reward: 38000,
    victims: () => (Math.random() < 0.5 ? 1 : 2),
    needs: (ctx) => [
      { kind: 'fire_custom', count: 2, requires: 'Stingere', label: 'Stingere' },
      { kind: 'smurd', count: ctx.victims, label: 'Asistență medicală' },
      { kind: 'police', count: 1, label: 'Perimetru' }
    ],
    water: () => 12000
  },
  {
    id: 'incendiu_garaj', kind: 'fire', priority: 'p1',
    title: 'Incendiu Garaj cu Pericol de Explozie', reward: 34000,
    victims: () => 0,
    needs: () => [
      { kind: 'fire_custom', count: 2, requires: 'Stingere', label: 'Stingere' },
      { kind: 'police', count: 1, label: 'Perimetru' },
      { kind: 'smurd', count: 1, label: 'Rezervă medicală' }
    ],
    water: () => 9000
  },
  {
    id: 'stop_cardiac', kind: 'smurd', priority: 'p1',
    title: 'Urgențe Medicale — Stop Cardio-Respirator', reward: 11000,
    victims: () => 1,
    needs: () => [{ kind: 'smurd', count: 1, label: 'Reanimare' }],
    water: () => 0
  },
  {
    id: 'accident_casnic', kind: 'smurd', priority: 'p2',
    title: 'Accident Casnic Grav cu Traumatisme', reward: 8000,
    victims: () => 1,
    needs: () => [{ kind: 'smurd', count: 1, label: 'Asistență medicală' }],
    water: () => 0
  },
  {
    id: 'scandal', kind: 'police', priority: 'p3',
    title: 'Tulburarea Liniștii Publice / Scandal', reward: 6000,
    victims: () => 0,
    needs: () => [{ kind: 'police', count: 2, label: 'Intervenție' }],
    water: () => 0
  }
];

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

  const template = MISSION_TEMPLATES[Math.floor(Math.random() * MISSION_TEMPLATES.length)];
  const victims = template.victims ? template.victims() : 0;
  const needs = template.needs({ victims: victims }).map(n => ({
    kind: n.kind,
    count: n.count,
    requires: n.requires || null,
    label: n.label || TYPE_LABEL[n.kind] || n.kind
  }));

  const mission = {
    id: 'm_' + Date.now() + '_' + Math.floor(Math.random() * 1000),
    templateId: template.id,
    title: template.title,
    type: template.kind,
    reqType: needs[0].kind, // compat: primul tip cerut
    priority: template.priority,
    needs: needs,
    victims: victims,
    waterNeeded: template.water ? template.water({ victims: victims }) : 0,
    waterDelivered: 0,
    lat: callLat,
    lng: callLng,
    reward: template.reward,
    district: nearest.station ? nearest.station.name : null,
    distanceKm: +nearest.km.toFixed(2),
    createdAt: Date.now(),
    deadline: Date.now() + priorityOf(template).timeoutSec * 1000,
    reportedAt: null,
    escalated: false,
    status: 'active'
  };

  state.missions.push(mission);
  AudioEngine.playDispatchAlert();
  const needTxt = mission.needs
    .map(n => n.count + '× ' + (TYPE_LABEL[n.kind] || n.kind) + (n.requires ? '/' + n.requires : ''))
    .join(' + ');
  showToast(`APEL NOU 112 [${priorityOf(mission).label}] ${mission.title} (${mission.distanceKm.toFixed(1)} km) — necesar: ${needTxt}`, 'warning');

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

// Fara timeout, un fetch agatat lasa echipajul vesnic in drum (si, la intoarcere,
// vesnic pe scena). 8 s e destul pentru o ruta de oras; apoi cade pe providerul
// urmator, respectiv pe ruta liniara.
const ROUTE_FETCH_TIMEOUT_MS = 8000;

async function fetchRouteWithSpeeds(startLat, startLng, endLat, endLng) {
  for (let i = 0; i < ROUTE_PROVIDERS.length; i++) {
    try {
      const url = `${ROUTE_PROVIDERS[i]}/${startLng},${startLat};${endLng},${endLat}?overview=full&geometries=geojson&annotations=speed&steps=true`;
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), ROUTE_FETCH_TIMEOUT_MS);
      let res;
      try {
        res = await fetch(url, { signal: ctrl.signal });
      } finally {
        clearTimeout(timer);
      }
      const data = await res.json();

      if (data.code === 'Ok' && data.routes && data.routes.length > 0) {
        const route = data.routes[0];
        // OSRM intoarce [lng, lat]; Leaflet vrea [lat, lng]
        const coords = route.geometry.coordinates.map(c => [c[1], c[0]]);
        const ann = (route.legs && route.legs[0] && route.legs[0].annotation) || route.annotations || {};
        const raw = ann.speed;
        // speed e in m/s, cate un element per segment de geometrie
        const flowKmh = (raw && raw.length === coords.length - 1) ? raw.map(v => v * 3.6) : null;

        // Clasa reala a drumului (ref DN/DJ/A + densitatea intersectiilor), per bucata.
        const allSteps = [];
        (route.legs || []).forEach(leg => (leg.steps || []).forEach(st => allSteps.push(st)));
        const roadRanges = buildRoadRanges(allSteps);

        if (coords.length > 1) return { coords: coords, flowKmh: flowKmh, roadRanges: roadRanges };
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
  return { coords: points, flowKmh: null, roadRanges: [] };
}

async function dispatchVehicleToMission(vehicleId, missionId, needIdx) {
  const vehicle = state.vehicles.find(v => v.id === vehicleId);
  const mission = state.missions.find(m => m.id === missionId);

  if (!vehicle || !mission) return;

  if (vehicle.status !== 'idle') {
    showToast('Echipajul nu mai este disponibil!', 'error');
    renderUI();
    return;
  }

  ensureMissionShape(mission);

  // Fiecare nevoie are locurile ei. Daca nu se da un index, cautam prima nevoie
  // deschisa pe care echipajul o poate acoperi (tip potrivit + modulul cerut).
  const idx = (needIdx == null) ? nextOpenNeedIndex(mission, vehicle) : needIdx;
  if (idx < 0 || !mission.needs[idx] || !needOpen(mission, idx) ||
      !vehicleCoversNeed(vehicle, mission.needs[idx])) {
    const need = (idx >= 0) ? mission.needs[idx] : null;
    if (need && need.requires && !vehicleHasModule(vehicle, need.requires)) {
      showToast(`Echipaj fără modulul ${need.requires}! Nevoia cere ${missionNeedLabel(need)}.`, 'error');
    } else {
      const wanted = mission.needs.map(n => TYPE_LABEL[n.kind] || n.kind).join(', ');
      showToast(`Echipaj incompatibil! Ai nevoie de: ${wanted}.`, 'error');
    }
    renderUI();
    return;
  }

  const need = mission.needs[idx];
  vehicle.status = 'dispatched';
  vehicle.missionId = mission.id;
  vehicle.needIdx = idx;
  vehicle.speedKmh = 0; // pleaca de pe loc, accelereaza progresiv pe ruta
  vehicle.workEndsAt = null;
  mission.status = 'assigned';
  delete dispatchSelections[needSlotKey(mission.id, idx)];

  AudioEngine.playSirenTone();
  showToast(`"${vehicle.name}" trimis: ${missionNeedLabel(need)} (${mission.title}).`, 'info');

  // Ruta rutiera reala + vitezele reale de drum (FOSSGIS/OSM).
  const routed = await fetchRouteWithSpeeds(vehicle.lat, vehicle.lng, mission.lat, mission.lng);
  setVehicleRoute(vehicle, routed.coords, routed.flowKmh, routed.roadRanges);

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

    // Munca la fata locului: stingerea consuma apa, raportul primului echipaj
    // actualizeaza nevoile (escaladare), iar misiunile gata se inchid.
    const dtGame = dtSec * SIM_SPEED_MULTIPLIER;
    state.missions.slice().forEach(mission => {
      if (maybeEscalateMission(mission, now)) stateChanged = true;
      if (updateFireWork(mission, dtGame, now)) stateChanged = true;
      evaluateMissionClosure(mission, now);
    });

    state.vehicles.forEach(vehicle => {
      if ((vehicle.status === 'dispatched' || vehicle.status === 'returning') &&
          vehicle.route && vehicle.route.length > 1) {

        // BUG REPARAT: inainte se avansa 1 punct la 300ms, deci durata depindea
        // de cate puncte avea ruta OSRM, nu de distanta. Acum e viteza reala (km/h).
        const atEnd = advanceVehicleAlongRoute(vehicle, dtSec);
        stateChanged = true;

        if (atEnd) {
          if (vehicle.status === 'dispatched') {
            onVehicleArrived(vehicle); // primul echipaj porneste si raportul de la fata locului
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

// Echipaje cu intoarcerea la baza in curs (memorie, nu se persista): daca timerul
// de interventie ruleaza de doua ori (unul din memorie + unul restaurat dupa reload),
// al doilea apel iese imediat.
const returningInFlight = new Set();

// Sosirea la fata locului: echipajul incepe sa lucreze. Primul echipaj porneste
// "raportul" - dupa ESCALATION_REPORT_SEC dispecerul afla situatia reala.
function onVehicleArrived(vehicle) {
  vehicle.status = 'on_scene';
  vehicle.speedKmh = 0;
  vehicle.arrivedAt = Date.now();
  vehicle.workEndsAt = Date.now() + MISSION_WORK_SEC * 1000;
  if (vehicle.type === 'fire_custom') {
    vehicle.waterLeft = vehicle.waterCap || 0; // autospeciala pleaca plina de la subunitate
  }
  vehicle.refillUntil = null;
  vehicle.refillNotified = false;

  const mission = state.missions.find(m => m.id === vehicle.missionId);
  if (!mission) return;

  if (!mission.reportedAt) {
    mission.reportedAt = Date.now();
    showToast(`Echipaj sosit la "${mission.title}". Se așteaptă raportul de la fața locului...`, 'info');
  } else {
    showToast(`Echipaj sosit la "${mission.title}".`, 'info');
  }

  evaluateMissionClosure(mission, Date.now());
}

// Raportul de la fata locului (escaladare): la apel nu se stie niciodata exact cate
// victime sunt sau cat de mare e incendiul. Primul echipaj raporteaza, nevoile cresc.
function maybeEscalateMission(mission, now) {
  if (!state.escalationEnabled) return false;
  if (mission.escalated || !mission.reportedAt) return false;
  if (now - mission.reportedAt < ESCALATION_REPORT_SEC * 1000) return false;
  mission.escalated = true;
  ensureMissionShape(mission);

  const extra = [];

  if (mission.type === 'police' && mission.needs.some(n => n.kind === 'smurd')) {
    // Accident: numarul real de victime se afla la fata locului.
    const realVictims = Math.max(mission.victims, mission.victims + Math.floor(Math.random() * 3));
    if (realVictims > mission.victims) {
      mission.victims = realVictims;
      const need = mission.needs.find(n => n.kind === 'smurd');
      if (need && realVictims > need.count) {
        extra.push((realVictims - need.count) + '× SMURD');
        need.count = realVictims;
      }
    }
    // O victima poate fi blocata in caroserie -> apare nevoia de descarcerare.
    if (!mission.needs.some(n => n.requires === 'Descarcerare') && Math.random() < 0.3) {
      mission.needs.push({ kind: 'fire_custom', count: 1, requires: 'Descarcerare', label: 'Descarcerare' });
      extra.push('1× Pompieri (Descarcerare)');
    }
  }

  if (mission.waterNeeded > 0) {
    // Incendiul nestins se extinde: creste apa necesara si, la incendiile mari,
    // mai apare o autospeciala de cerut.
    const before = mission.waterNeeded;
    mission.waterNeeded = Math.round(before * 1.35);
    extra.push(`apa necesară ${before} → ${mission.waterNeeded} L`);
    if (mission.templateId !== 'incendiu_vegetatie' && mission.templateId !== 'incendiu_anexa') {
      const need = mission.needs.find(n => n.requires === 'Stingere');
      if (need && need.count < 3) { need.count += 1; extra.push('1× Autospecială în plus'); }
    }
  }

  if (!extra.length) return false;

  AudioEngine.playDispatchAlert();
  showToast(`RAPORT de la "${mission.title}": ${extra.join(', ')}. Trimite forțele suplimentare!`, 'warning');
  mission.deadline = Date.now() + Math.round(priorityOf(mission).timeoutSec * 0.6) * 1000;
  saveState();
  renderUI();
  return true;
}

// Stingerea: fiecare autospeciala cu modulul Stingere varsa FIRE_PUMP_LPS din
// rezervorul ei; cand il goleste, pleaca la hidrant FIRE_REFILL_SEC si revine plina.
// Deci 3 autospeciale sting de 3 ori mai repede decat una singura.
function updateFireWork(mission, dtGame, now) {
  if (!mission.waterNeeded) return false;
  let changed = false;
  let lps = 0;

  state.vehicles.forEach(v => {
    if (v.missionId !== mission.id || v.status !== 'on_scene') return;
    if (!vehicleHasModule(v, 'Stingere')) return;

    if (v.refillUntil) {
      if (now >= v.refillUntil) {
        v.refillUntil = null;
        v.waterLeft = v.waterCap || 0;
        v.refillNotified = false;
        changed = true;
      }
      return; // plecata la hidrant
    }

    if (v.waterLeft == null) v.waterLeft = v.waterCap || 0;
    if (v.waterLeft <= 0) {
      v.refillUntil = now + (FIRE_REFILL_SEC * 1000) / Math.max(1, SIM_SPEED_MULTIPLIER);
      if (!v.refillNotified) {
        v.refillNotified = true;
        showToast(`${v.name}: rezervor gol, pleacă la hidrant (${FIRE_REFILL_SEC} s).`, 'info');
      }
      changed = true;
      return;
    }

    v.waterLeft = Math.max(0, v.waterLeft - FIRE_PUMP_LPS * dtGame);
    lps += FIRE_PUMP_LPS;
    changed = true;
  });

  if (lps > 0) {
    mission.waterDelivered = Math.min(mission.waterNeeded, mission.waterDelivered + lps * dtGame);
    changed = true;
  }
  return changed;
}

// Debitul curent livrat la un incendiu (L/s) - pentru afisare in lista de misiuni.
function fireFlowLps(mission) {
  if (!mission || !mission.waterNeeded) return 0;
  const now = Date.now();
  let lps = 0;
  state.vehicles.forEach(v => {
    if (v.missionId !== mission.id || v.status !== 'on_scene') return;
    if (!vehicleHasModule(v, 'Stingere')) return;
    if (v.refillUntil && now < v.refillUntil) return;
    if ((v.waterLeft || 0) <= 0) return;
    lps += FIRE_PUMP_LPS;
  });
  return lps;
}

// Misiunea se inchide cand: toate locurile sunt ocupate, toate echipajele au ajuns,
// fiecare a lucrat minim MISSION_WORK_SEC si (la incendii) apa a fost livrata integral.
function evaluateMissionClosure(mission, now) {
  if (!mission) return false;
  now = now || Date.now();
  ensureMissionShape(mission);
  if (missionNeedsOpen(mission)) return false;      // inca lipsesc forte
  const units = missionUnits(mission);
  if (!units.length) return false;
  if (units.some(v => v.status !== 'on_scene')) return false;  // mai sunt in drum
  if (!units.every(v => v.workEndsAt && now >= v.workEndsAt)) return false;
  if (mission.waterNeeded > 0 && mission.waterDelivered < mission.waterNeeded) return false;
  // Intoarce promisiunea inchiderii (buclei de joc nu-i pasa, dar recuperarea dupa
  // reload si testele pot astepta intoarcerea efectiva a echipajelor in subunitate).
  return closeMission(mission);
}

// Inchide misiunea: recompensa (cu bonus de rapiditate si penalizare pentru resurse
// irosite), apoi fiecare echipaj se intoarce in subunitatea lui.
async function closeMission(mission) {
  const units = missionUnits(mission);
  const slots = Math.max(1, missionSlotsTotal(mission));
  const extra = Math.max(0, units.length - slots);
  const effMul = Math.max(0.6, 1 - extra * EXTRA_UNIT_PENALTY);

  const pr = priorityOf(mission);
  const responseSec = ((mission.reportedAt || Date.now()) - mission.createdAt) / 1000;
  const fastBonus = responseSec <= pr.timeoutSec * 0.5 ? 0.15 : 0;

  const reward = Math.round(mission.reward * effMul * (1 + fastBonus));
  state.budget += reward;
  AudioEngine.playSuccessChime();

  const notes = [];
  if (extra > 0) notes.push(`−${Math.round((1 - effMul) * 100)}% resurse irosite (${units.length} echipaje pentru ${slots} necesare)`);
  if (fastBonus > 0) notes.push('+15% intervenție rapidă');
  const noteTxt = notes.length ? ' [' + notes.join(' · ') + ']' : '';
  showToast(`Misiune finalizată: ${mission.title} (${units.length} echipaje) +${reward.toLocaleString('ro-RO')} LEI${noteTxt}`, 'success');

  const idx = state.missions.findIndex(m => m.id === mission.id);
  if (idx !== -1) state.missions.splice(idx, 1);

  await Promise.all(units.map(v => sendVehicleBack(v)));
  saveState();
  renderUI();
  renderMapElements();
}

// Trimite automat echipajul potrivit cel mai apropiat de locul interventiei.
function dispatchNearestToNeed(missionId, needIdx) {
  const mission = state.missions.find(m => m.id === missionId);
  if (!mission) return;
  ensureMissionShape(mission);
  const need = mission.needs[needIdx];
  if (!need) return;
  const candidates = state.vehicles.filter(v => v.status === 'idle' && vehicleCoversNeed(v, need));
  if (!candidates.length) {
    showToast(`Niciun echipaj disponibil pentru ${missionNeedLabel(need)}.`, 'error');
    return;
  }
  candidates.sort((a, b) =>
    haversineKm(a.lat, a.lng, mission.lat, mission.lng) -
    haversineKm(b.lat, b.lng, mission.lat, mission.lng));
  showToast(`Cel mai apropiat pentru ${missionNeedLabel(need)}: ${candidates[0].name}`, 'info');
  dispatchVehicleToMission(candidates[0].id, missionId, needIdx);
}

// Compat + recuperare dupa reload: marcheaza interventia echipajului ca terminata si
// reevalueaza misiunea. Finalizarea propriu-zisa (recompensa) o face closeMission(),
// cand TOATE nevoile misiunii sunt acoperite si munca s-a terminat.
async function completeMissionWork(vehicleId) {
  const vehicle = state.vehicles.find(v => v.id === vehicleId);
  if (!vehicle || vehicle.status !== 'on_scene') return;
  vehicle.workEndsAt = Date.now();
  const mission = state.missions.find(m => m.id === vehicle.missionId);
  if (mission) return evaluateMissionClosure(mission, Date.now());
}

// Un echipaj isi incheie misiunea si se intoarce in subunitate (ruta reala).
async function sendVehicleBack(vehicle) {
  if (!vehicle) return;
  if (returningInFlight.has(vehicle.id)) return;
  returningInFlight.add(vehicle.id);

  // Reset la starea de interventie (altfel ramane cu nevoia alocata si cu apa pe el).
  vehicle.needIdx = null;
  vehicle.workEndsAt = null;
  vehicle.waterLeft = null;
  vehicle.refillUntil = null;
  vehicle.refillNotified = false;

  // Return vehicle to station
  const station = state.stations.find(s => s.id === vehicle.stationId);
  if (station) {
    // BUG REPARAT ("masina nu se intoarce in baza"): inainte statusul devenea
    // 'returning' INAINTE de await-ul pe ruta de intors. Cat se descarca ruta
    // (200-800 ms), bucla de joc (300 ms) vedea tot vechea ruta - deja parcursa,
    // distKm la capat - declara sosirea, muta echipajul pe 'idle' si il teleporta
    // in baza; apoi setVehicleRoute() rescria lat/lng la locul interventiei, cu
    // status 'idle' -> masina aparea parcata la fata locului, "disponibila".
    // Ordinea corecta: intai ruta, apoi statusul. Cat asteptam, echipajul ramane
    // 'on_scene', deci bucla de joc nu-l atinge.
    const routedBack = await fetchRouteWithSpeeds(vehicle.lat, vehicle.lng, station.lat, station.lng);
    setVehicleRoute(vehicle, routedBack.coords, routedBack.flowKmh, routedBack.roadRanges);
    vehicle.status = 'returning'; // setVehicleRoute() o repune pe loc (viteza 0)
  } else {
    vehicle.status = 'idle';
    vehicle.missionId = null;
    vehicle.route = [];
    vehicle.routeCum = [];
  }

  returningInFlight.delete(vehicle.id);

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
    // Prioritatea conteaza: un P1 ratat doare mai tare decat un scandal de noapte.
    const penalty = Math.round(m.reward * MISSION_FAIL_PENALTY * priorityOf(m).penaltyMul);
    state.budget = Math.max(0, state.budget - penalty);
    showToast(`Apel 112 expirat: ${m.title}. Penalizare -${penalty.toLocaleString('ro-RO')} LEI`, 'error');
  });

  AudioEngine.playTimeoutTone();
  saveState();
  renderUI();
  renderMapElements();
}
