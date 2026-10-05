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

// Id-ul vehiculului cu popup-ul de detalii deschis (viteza / ETA live).
let openVehiclePopupId = null;

// True cat timp renderMapElements() reconstruieste markerii: altfel popup-ul
// deschis se pierde la fiecare re-randare (apel 112 nou, expirare, etc.).
let isRenderingMap = false;

// ------------------------------------------------------------------------
// GEO HELPERS & CONSTANTE DE SIMULARE
// ------------------------------------------------------------------------

// Acceleratie de simulare: 60x timp real. O ruta de 25 km la 70 km/h

// (21 min real) se parcurge in ~21 secunde de joc.

// Viteza simularii: 1 = TIMP REAL (distanta / viteza = timpul chiar afisat de joc).
// Echipajul parcurge 20 km la 100 km/h in ~12 minute, exact cat ar face-o in realitate.
// Se poate accelera din Setari (slider), dar timpii afisati raman mereu in km/h reali.
// Nota: la valori mari (ex. x60) accelerarea/franarea se comprima cu sqrt(viteza),
// altfel masina nu apuca sa ajunga la viteza de croaziera pe rutele scurte.

const SIM_SPEED_MIN = 1;
const SIM_SPEED_MAX = 60;
const SIM_SPEED_DEFAULT = 1;

let SIM_SPEED_MULTIPLIER = SIM_SPEED_DEFAULT;

function simSpeedLabel(v) {
  return v <= 1 ? '×1 (timp real)' : '×' + v;
}

// Aplica viteza simularii + sincronizeaza sliderul din Setari.

function applySimSpeed(value) {
  const v = Math.min(SIM_SPEED_MAX, Math.max(SIM_SPEED_MIN, Number(value) || SIM_SPEED_DEFAULT));
  SIM_SPEED_MULTIPLIER = v;
  state.simSpeed = v;
  const slider = document.getElementById('input-sim-speed');
  if (slider) slider.value = v;
  const label = document.getElementById('slider-sim-speed-val');
  if (label) label.textContent = simSpeedLabel(v);
  return v;
}

function updateSimSpeedSlider(val) {
  applySimSpeed(val);
  saveState();
  showToast(`Viteză simulare: ${simSpeedLabel(SIM_SPEED_MULTIPLIER)}`, 'info');
}

// Viteze medii urbane (km/h) per tip de echipaj.

const VEHICLE_SPEEDS = { police: 70, smurd: 65, fire_custom: 50 };

// --- Fizica de deplasare (viteze reale, nu constante) --------------------
// Viteza nu mai e o constanta: echipajul pleaca de pe loc, accelereaza, incetineste
// in curbe si inainte de viraje. Limita de drum e estimata din geometria rutei
// (OSRM public nu trimite maxspeed), iar regimul de urgenta permite depasirea ei.
// Profil per tip de echipaj:
//   maxKmh - plafonul absolut al vehiculului
//   accel  - acceleratie in m/s^2
//   brake  - deceleratie in m/s^2 la franare
// Cat poate depasi limita drumului (regim prioritar) e in OVERTAKE_KMH.

const VEHICLE_PROFILES = {
  police:      { maxKmh: 150, accel: 3.0, brake: 7.0 },
  smurd:       { maxKmh: 130, accel: 2.4, brake: 6.0 },
  fire_custom: { maxKmh: 100, accel: 1.5, brake: 4.5 }
};

function vehicleProfile(vehicle) {
  return VEHICLE_PROFILES[vehicle && vehicle.type] || VEHICLE_PROFILES.police;
}

// Sub-pasul de integrare a fizicii (tick-urile sunt la 300 ms; 0.5 s e stabil).
const PHYSICS_SUBSTEP_SEC = 0.5;

// La x1 (timp real) accelerarea e cea reala (3 m/s^2, 0-100 in ~9 s).
// Cand simularea e comprimata, accelerarea se comprima cu sqrt(viteza), nu liniar,
// altfel pe o ruta de 8 km masina nu apuca sa treaca de 50 km/h si nu se simtea
// deloc ca vehicul prioritar.

function accelRateKmhPerSubsec(ms2) {
  return ms2 * 3.6 * Math.sqrt(SIM_SPEED_MULTIPLIER); // km/h pe secunda de joc
}

// Acceleratia raportata la spatiul hartii (m/s^2 pe km de harta), pentru formula
// de franare anticipata, unde distantele sunt in metri de harta.

function spatialAccelMs2(ms2) {
  return ms2 / Math.sqrt(SIM_SPEED_MULTIPLIER);
}

// Cat de departe ne uitam la virajele din fata cand calculam franarea (km).
// Spatiul necesar franarii creste cu viteza simularii (la x1: ~120 m de la 145 km/h).

const CORNER_LOOKAHEAD_KM = 0.15;

function cornerLookaheadKm() {
  return CORNER_LOOKAHEAD_KM * Math.sqrt(SIM_SPEED_MULTIPLIER);
}

// Sub aceasta distanta de destinatie (km) incepe franarea de oprire.
const ARRIVAL_SLOWDOWN_KM = 0.25;

// Fereastra de raspuns pentru un apel 112 (secunde reale).

const MISSION_TIMEOUT_SEC = 240;

// Cat dureaza interventia la fata locului (secunde).

const MISSION_WORK_SEC = 20;

// Ritmul apelurilor: un apel nou la fiecare 25 s (timp real) si plafon de
// apeluri nedispecerizate / misiuni active simultan (la x1 o misiune tine minute).

const CALL_INTERVAL_MS = 25000;
const MAX_PENDING_CALLS = 8;
const MAX_ACTIVE_MISSIONS = 14;

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

// Cursul (bearing) in grade intre doua puncte.

function bearingDeg(lat1, lng1, lat2, lng2) {
  const toRad = d => (d * Math.PI) / 180;
  const y = Math.sin(toRad(lng2 - lng1)) * Math.cos(toRad(lat2));
  const x = Math.cos(toRad(lat1)) * Math.sin(toRad(lat2)) -
            Math.sin(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.cos(toRad(lng2 - lng1));
  return (Math.atan2(y, x) * 180) / Math.PI;
}

// Unghiul de schimbare de directie la punctul din mijloc (0 = drept inainte).

function turnAngleDeg(lat1, lng1, lat2, lng2, lat3, lng3) {
  const d = bearingDeg(lat2, lng2, lat3, lng3) - bearingDeg(lat1, lng1, lat2, lng2);
  return Math.abs(((d + 540) % 360) - 180);
}

// Cat de mult peste limita drumului poate merge fiecare tip de echipaj (km/h).
// Depasirea e absoluta, nu procentuala: pe o strada de 50 se merge cu ~70-90,
// pe un drum de 100 cu ~125-145. Ca in realitate, nu o limita fixa pusa la toate.

const OVERTAKE_KMH = { police: 38, smurd: 32, fire_custom: 20 };

// Limita FIZICA de viraj (nu se depaseste). null = drum drept, fara restrictie.

function cornerLimitFromAngle(deg) {
  if (deg < 6) return null;   // drept
  if (deg < 15) return 95;
  if (deg < 30) return 75;
  if (deg < 50) return 58;
  if (deg < 75) return 42;
  return 28;                  // viraj strans / manevra in intersectie
}

// Sub aceasta valoare limita de drum nu conteaza: se foloseste 50 (cerut explicit).
const ROAD_MIN_KMH = 50;

// Anticipare: viteza tinta se uita si la limita de drum din urmatorii ~400 m, ca
// masina sa accelereze INAINTE de sectorul rapid (ex. iesirea din oras pe județean),
// nu dupa ce a intrat pe el. Se anticipeaza doar salturile mari (>= 15 km/h),
// ca sa nu reactioneze la diferentele mici din oras (50 -> 60 -> 50).
const ROAD_AHEAD_KM = 0.4;
const ROAD_AHEAD_MIN_DELTA = 15;

// Sector lung si drept (drum judetean/national): mai pune peste depasirea de urgenta.
// Datele OSM din Romania dau des 50 km/h si pe DN/DJ, deci geometria ramane semnalul
// principal: daca drumul e drept pe sute de metri, masina trebuie sa poata merge tare.
const STRAIGHT_EXTRA_KMH = 10;
const STRAIGHT_EXTRA_MIN_LIMIT = 50;

// Limita de drum estimata din densitatea nodurilor (folosita DOAR cand nu avem
// vitezele reale de pe ruta): strazile urbane au intersectii dese (noduri la
// 20-100 m), drumurile judetene/nationale au noduri rare.

function roadSpeedFromSpacing(avgM) {
  if (avgM < 60) return 50;   // strada urbana cu intersectii dese
  if (avgM < 150) return 60;
  if (avgM < 300) return 80;
  return 100;                 // drum national / autostrada
}

// Eticheta orientativa pentru limita estimata (folosita cand nu stim clasa reala).

function roadKindLabel(limitKmh) {
  if (limitKmh <= 55) return 'zonă urbană';
  if (limitKmh <= 70) return 'drum județean / suburbie';
  if (limitKmh <= 85) return 'drum județean';
  return 'drum național / autostradă';
}

// ------------------------------------------------------------------------
// CLASA REALA A DRUMULUI (din OSRM steps: ref + numarul de intersectii)
// ------------------------------------------------------------------------
// `steps[].ref` da numarul drumului ("DN1", "DJ101", "A3"), iar `intersections`
// arata cat de des sunt intersectii (oras vs. drum deschis). Fara asta, o ruta
// iesita din oras pe un drum judetean aparea tot "zona urbana / 50 km/h",
// pentru ca datele OSM de limita de viteza sunt slabe in Romania.

const ROAD_CLASS_BASE_KMH = { motorway: 130, trunk: 110, national: 100, county: 90 };

const ROAD_CLASS_LABEL = {
  motorway: 'autostradă',
  trunk: 'drum european',
  national: 'drum național',
  county: 'drum județean'
};

// "DN1; DN1A; DN7" -> national; "A3" -> motorway; "DJ101" -> county.

function roadClassFromRef(ref) {
  if (!ref) return null;
  const first = String(ref).split(';')[0].trim().toUpperCase().replace(/\s+/g, '');
  if (/^A\d/.test(first)) return 'motorway';
  if (/^DN\d/.test(first)) return 'national';
  if (/^DJ\d/.test(first)) return 'county';
  if (/^E\d/.test(first)) return 'trunk';
  return null;
}

// Un pas de drum e urban daca are intersectii dese.

function stepLooksUrban(step) {
  const distKm = (step.distance || 0) / 1000;
  if (distKm <= 0.05) return true;
  const intersections = (step.intersections || []).length;
  return intersections / distKm > 6;
}

// Distantele cumulative ale steps-urilor, ca sa stim ce clasa de drum e la fiecare km.

function buildRoadRanges(steps) {
  const ranges = [];
  let acc = 0;
  (steps || []).forEach(step => {
    const dKm = (step.distance || 0) / 1000;
    if (dKm <= 0) return;
    ranges.push({
      from: acc,
      to: acc + dKm,
      cls: roadClassFromRef(step.ref),
      urban: stepLooksUrban(step),
      ref: step.ref || null
    });
    acc += dKm;
  });
  return ranges;
}

// Ce clasa de drum e la distanta dKm (ranges scalate la lungimea reala a rutei).

function roadInfoAt(ranges, dKm, totalKm) {
  if (!ranges || !ranges.length) return null;
  const scale = totalKm / Math.max(ranges[ranges.length - 1].to, 0.001);
  const d = dKm / scale;
  for (let i = 0; i < ranges.length; i++) {
    if (d <= ranges[i].to) return ranges[i];
  }
  return ranges[ranges.length - 1];
}

// Eticheta afisata in popup: clasa reala daca o stim, altfel estimarea din limita.

function roadLabelFor(vehicle, idx, roadLimit) {
  const info = vehicle.routeRoadInfo && vehicle.routeRoadInfo[idx];
  if (info && info.cls && !info.urban) {
    return ROAD_CLASS_LABEL[info.cls] + (info.ref ? ' (' + info.ref + ')' : '');
  }
  if (info && info.urban) return 'zonă urbană';
  return roadKindLabel(roadLimit);
}

// Limita de viteza estimata pentru fiecare segment al rutei, din doua surse
// (OSRM public nu trimite maxspeed):
//   1. unghiul virajului de la inceputul segmentului - curbe stranse = limita mica;
//   2. densitatea nodurilor din jur - intersectii dese = zona urbana.
// Segmentul primeste limita nodului de la inceputul lui, iar franarea anticipata
// din vehicleTargetSpeedKmh() se ocupa de incetinirea INAINTE de viraj.

function buildSegmentProfile(route, flowKmh, roadRanges) {
  const n = route ? route.length : 0;
  if (n < 2) return { speeds: [], corner: [], straight: [], roadInfo: [] };

  const segKm = new Array(n - 1);
  for (let j = 0; j < n - 1; j++) {
    segKm[j] = haversineKm(route[j][0], route[j][1], route[j + 1][0], route[j + 1][1]);
  }

  // Unghiul de schimbare de directie la fiecare nod.
  const angle = new Array(n).fill(0);
  for (let i = 1; i < n - 1; i++) {
    angle[i] = turnAngleDeg(
      route[i - 1][0], route[i - 1][1], route[i][0], route[i][1], route[i + 1][0], route[i + 1][1]
    );
  }

  // Vitezele reale vin per segment (FOSSGIS OSRM -> annotation.speed).
  const hasFlow = !!(flowKmh && flowKmh.length === n - 1);
  const totalKm = segKm.reduce((a, b) => a + b, 0);

  const speeds = new Array(n - 1);
  const corner = new Array(n - 1);
  const straight = new Array(n - 1);
  const roadInfo = new Array(n - 1);

  let cumKm = 0;
  for (let j = 0; j < n - 1; j++) {
    cumKm += segKm[j];

    let roadLimit;
    if (hasFlow && flowKmh[j] != null) {
      // viteza reala de circulatie pe acel segment (date OSM)
      roadLimit = Math.max(ROAD_MIN_KMH, flowKmh[j]);
    } else {
      let sum = 0, cnt = 0;
      for (let k = Math.max(0, j - 2); k <= Math.min(n - 2, j + 2); k++) { sum += segKm[k]; cnt++; }
      roadLimit = Math.max(ROAD_MIN_KMH, roadSpeedFromSpacing((sum / Math.max(1, cnt)) * 1000));
    }

    // Clasa reala a drumului: in afara localitatii, un DN/DJ/autostrada are limita
    // mai mare decat da OSM (care pune des 50 km/h si pe drumurile judetene).
    const info = roadInfoAt(roadRanges, cumKm, totalKm);
    roadInfo[j] = info;
    if (info && info.cls && !info.urban) {
      const base = ROAD_CLASS_BASE_KMH[info.cls] || 0;
      if (base > roadLimit) roadLimit = base;
    }

    speeds[j] = roadLimit;
    corner[j] = (j >= 1 && j <= n - 2) ? cornerLimitFromAngle(angle[j]) : null;

    // Cat de drept e drumul pe urmatorii ~700 m: 1.00 = sinuos, 1.32 = foarte drept.
    let sumA = 0, cntA = 0, dist = 0;
    for (let k = j + 1; k <= n - 2 && dist < 0.7; k++) { sumA += angle[k]; cntA++; dist += segKm[k]; }
    const avgAngle = cntA ? sumA / cntA : 0;
    straight[j] = avgAngle < 1.5 ? 1.32 : avgAngle < 3 ? 1.22 : avgAngle < 7 ? 1.12 : avgAngle < 14 ? 1.05 : 1.00;
  }

  return { speeds: speeds, corner: corner, straight: straight, roadInfo: roadInfo };
}

// Limita de drum per segment (fara plafonul fizic de viraj).

function estimateSegmentSpeeds(route, flowKmh, roadRanges) {
  return buildSegmentProfile(route, flowKmh, roadRanges).speeds;
}

// Stilul soferului: variaza lent pe parcurs (0.82 .. 1.06), ca viteza sa nu fie
// fixa pe toata ruta. Deterministic (pe distanta parcursa), deci curat, fara
// salturi de la un tick la altul.
function driverSpeedFactor(vehicle, distKm) {
  const d = distKm != null ? distKm : (vehicle.distKm || 0);
  const s = vehicle.driverSeed || 0;
  // 0.50 (sofer prudent / trafic) .. 1.06 (sofer presat): variaza mult pe parcurs,
  // ca viteza sa nu para fixa pe toata ruta
  return 0.78 + Math.sin(d * 1.9 + s) * 0.19 + Math.sin(d * 0.61 + s * 2.1) * 0.09;
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

// Viteza tinta (km/h) se calculeaza din mai multe variabile:
//   1. limita reala de drum (OSM) pe segmentul curent SI pe urmatorii ~400 m - anticipare;
//   2. depasirea de urgenta proprie tipului de echipaj;
//   3. stilul soferului (variaza pe parcurs) x cat de drept e sectorul;
//   4. bonus pe sectoare lungi si drepte (drum bun == merge mai tare);
//   5. plafonul fizic de viraj + franarea anticipata pentru ce urmeaza mai lent.

function straightAt(vehicle, idx) {
  return (vehicle.routeStraight && vehicle.routeStraight[idx] != null) ? vehicle.routeStraight[idx] : 1;
}

function vehicleTargetSpeedKmh(vehicle, distKm, segIdx) {
  const p = vehicleProfile(vehicle);
  const speeds = vehicle.routeSpeeds;
  if (!speeds || !speeds.length) return p.maxKmh;

  const i = Math.min(Math.max(segIdx | 0, 0), speeds.length - 1);
  const cum = vehicle.routeCum;
  const overtake = OVERTAKE_KMH[vehicle.type] || 25;
  const straightHere = straightAt(vehicle, i);
  const dyn = driverSpeedFactor(vehicle, distKm) * straightHere;

  // (1) limita de drum, cu anticiparea sectorului urmator
  const here = speeds[i] == null ? ROAD_MIN_KMH : speeds[i];
  let roadLimit = here;
  if (cum) {
    for (let j = i + 1; j < speeds.length; j++) {
      const dKm = cum[j] - distKm;
      if (dKm > ROAD_AHEAD_KM) break;
      // doar salturile mari conteaza (oras -> județean); 50 -> 60 in oras e zgomot
      if (speeds[j] == null || speeds[j] < here + ROAD_AHEAD_MIN_DELTA) continue;
      // trecere graduala: cu cat sectorul rapid e mai aproape, cu atat conteaza mai mult
      const closeness = 1 - dKm / ROAD_AHEAD_KM;
      const blended = here + (speeds[j] - here) * closeness;
      if (blended > roadLimit) roadLimit = blended;
    }
  }

  let target = Math.min(p.maxKmh, roadLimit + overtake * dyn);

  // (4) sector lung si drept: calcă pedala
  if (straightHere >= 1.22 && roadLimit >= STRAIGHT_EXTRA_MIN_LIMIT) {
    target = Math.min(p.maxKmh, target + STRAIGHT_EXTRA_KMH);
  }

  // (5a) plafonul fizic de viraj (nu se depaseste)
  const corner = vehicle.routeCorner && vehicle.routeCorner[i];
  if (corner != null && corner < target) target = corner;

  // (5b) franarea anticipata + oprirea la destinatie
  if (cum) {
    const aSpatial = spatialAccelMs2(p.brake);
    const lookaheadKm = cornerLookaheadKm();
    for (let j = i + 1; j < speeds.length; j++) {
      const dKm = cum[j] - distKm;
      if (dKm > lookaheadKm) break;
      const cor = vehicle.routeCorner && vehicle.routeCorner[j];
      let vNext = Math.min(p.maxKmh, (speeds[j] == null ? ROAD_MIN_KMH : speeds[j]) + overtake * dyn);
      if (cor != null && cor < vNext) vNext = cor;
      const vNextMs = vNext / 3.6;
      const allowed = Math.sqrt(vNextMs * vNextMs + 2 * aSpatial * Math.max(0, dKm * 1000)) * 3.6;
      if (allowed < target) target = allowed;
    }
    const leftKm = cum[cum.length - 1] - distKm;
    if (leftKm < ARRIVAL_SLOWDOWN_KM) {
      const vArr = Math.sqrt(Math.max(0, 2 * aSpatial * leftKm * 1000)) * 3.6;
      target = Math.min(target, vArr);
    }
  }

  return Math.max(0, target);
}

// Avanseaza vehiculul cu fizica reala (accelerare / franare treptata) pe `dtSec`
// secunde de timp real, apoi il pozitioneaza pe ruta.
// Distanta parcursa e accelerata de SIM_SPEED_MULTIPLIER, dar viteza afisata ramane
// in km/h reali, iar ETA se masoara in secunde de joc (ca si countdown-urile).
// Returneaza true daca a ajuns la capatul rutei.

function advanceVehicleAlongRoute(vehicle, dtSec) {
  const route = vehicle.route;
  const cum = vehicle.routeCum;
  if (!route || route.length < 2 || !cum || cum.length < 2) return true;

  const totalKm = cum[cum.length - 1];
  const p = vehicleProfile(vehicle);
  vehicle.distKm = vehicle.distKm || 0;
  vehicle.speedKmh = vehicle.speedKmh || 0;

  let remaining = Math.max(0, dtSec || 0);
  while (remaining > 1e-9 && vehicle.distKm < totalKm) {
    const dt = Math.min(remaining, PHYSICS_SUBSTEP_SEC);
    remaining -= dt;

    const target = vehicleTargetSpeedKmh(vehicle, vehicle.distKm, vehicle.segIdx || 0);
    const dv = target - vehicle.speedKmh;
    const rate = accelRateKmhPerSubsec(dv >= 0 ? p.accel : p.brake) * dt; // m/s^2 -> km/h pe sub-pas
    if (dv >= 0) vehicle.speedKmh = Math.min(target, vehicle.speedKmh + rate);
    else vehicle.speedKmh = Math.max(target, vehicle.speedKmh - rate);

    vehicle.distKm += (vehicle.speedKmh * SIM_SPEED_MULTIPLIER * dt) / 3600;
  }

  if (vehicle.distKm >= totalKm) {
    vehicle.distKm = totalKm;
    vehicle.segIdx = route.length - 1;
    vehicle.speedKmh = 0; // oprit la destinatie
    vehicle.lat = route[route.length - 1][0];
    vehicle.lng = route[route.length - 1][1];
    return true;
  }

  let i = vehicle.segIdx || 0;
  while (i < cum.length - 2 && cum[i + 1] < vehicle.distKm) i++;
  while (i > 0 && cum[i] > vehicle.distKm) i--;
  vehicle.segIdx = i;

  const segLen = cum[i + 1] - cum[i];
  const t = segLen > 0 ? (vehicle.distKm - cum[i]) / segLen : 0;
  vehicle.lat = route[i][0] + (route[i + 1][0] - route[i][0]) * t;
  vehicle.lng = route[i][1] + (route[i + 1][1] - route[i][1]) * t;
  return false;
}

// ETA in secunde de joc: ruleaza exact aceeasi fizica pe o copie a vehiculului
// pana la capatul rutei, deci ETA-ul afisat corespunde miscarii reale.

function simulateEtaSeconds(vehicle, maxSeconds) {
  const route = vehicle && vehicle.route;
  const cum = vehicle && vehicle.routeCum;
  if (!route || route.length < 2 || !cum || cum.length < 2) return 0;
  const limit = maxSeconds || 7200;
  // Copie completa: daca lipseste ceva (stilul soferului, bonusul de sector drept,
  // limitele de viraj), ETA-ul nu mai corespunde miscarii reale.
  const sim = {
    type: vehicle.type,
    route: route,
    routeCum: cum,
    routeSpeeds: vehicle.routeSpeeds,
    routeCorner: vehicle.routeCorner,
    routeStraight: vehicle.routeStraight,
    driverSeed: vehicle.driverSeed,
    distKm: vehicle.distKm || 0,
    segIdx: vehicle.segIdx || 0,
    speedKmh: vehicle.speedKmh || 0
  };
  // Pas de 0.25 s: ETA precis, dar fara mii de iteratii pe rute de minute intregi.
  const STEP = 0.25;
  let t = 0;
  while (t < limit) {
    if (advanceVehicleAlongRoute(sim, STEP)) break;
    t += STEP;
  }
  return t;
}

// Secunde -> "m:ss" pentru ETA.

function formatDuration(sec) {
  const s = Math.max(0, Math.round(sec || 0));
  return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
}

// Seteaza ruta + metricile de distanta, resetand progresul.

function setVehicleRoute(vehicle, route, flowKmh, roadRanges) {
  vehicle.route = route;
  const m = buildRouteMetrics(route);
  vehicle.routeCum = m.cum;
  vehicle.routeTotalKm = m.totalKm;
  // flowKmh = vitezele reale per segment (FOSSGIS OSRM); lipsa -> estimare geometrica.
  const profile = buildSegmentProfile(route, flowKmh, roadRanges);
  vehicle.routeSpeeds = profile.speeds;
  vehicle.routeCorner = profile.corner;
  vehicle.routeStraight = profile.straight;
  vehicle.routeRoadInfo = profile.roadInfo;
  vehicle.roadDataReal = !!(flowKmh && flowKmh.length === route.length - 1);
  if (vehicle.driverSeed == null) vehicle.driverSeed = Math.random() * Math.PI * 2;
  vehicle.distKm = 0;
  vehicle.segIdx = 0;
  vehicle.routeIdx = 0;
  vehicle.speedKmh = 0; // pleaca de pe loc
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
      applySimSpeed(state.simSpeed); // viteza simularii salvata de jucator
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
