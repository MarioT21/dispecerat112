/* =========================================================================
   Dispecerat 112 - ui.js
   Depinde de: core.js, game.js
   ========================================================================= */
// Generat din monolitul index.html - NU adauga cod in alt fisier fara sa verifici
// ordinea de incarcare din index.html (core -> map -> game -> ui -> boot).

// ------------------------------------------------------------------------
// UI RENDER PANEL FUNCTIONS
// ------------------------------------------------------------------------

function renderUI() {
  // Top stats
  document.getElementById('display-budget').textContent = `${state.budget.toLocaleString('ro-RO')} LEI`;
  document.getElementById('display-stations-count').textContent = state.stations.length;
  document.getElementById('display-missions-count').textContent = state.missions.length;

  document.getElementById('badge-missions-tab').textContent = state.missions.length;
  document.getElementById('badge-stations-tab').textContent = state.stations.length;

  // Settings values
  document.getElementById('input-max-distance').value = state.maxDistanceKm;
  document.getElementById('slider-distance-val').textContent = `${state.maxDistanceKm} km`;
  document.getElementById('toggle-coverage-circle').checked = state.showCoverageCircles;

  // Raportul de la fata locului (escaladare) - implicit pornit.
  const escToggle = document.getElementById('toggle-escalation');
  if (escToggle) escToggle.checked = state.escalationEnabled !== false;

  // Apeluri in functie de flota - implicit pornit.
  const fleetToggle = document.getElementById('toggle-fleet-aware');
  if (fleetToggle) fleetToggle.checked = state.fleetAwareCalls !== false;

  // Butonul de pauza + banner-ul de pauza.
  const pauseBtn = document.getElementById('btn-pause-missions');
  if (pauseBtn) {
    pauseBtn.innerHTML = state.missionsPaused
      ? '<i class="fa-solid fa-play"></i> Reia'
      : '<i class="fa-solid fa-pause"></i> Pauză';
    pauseBtn.className = state.missionsPaused
      ? 'px-2.5 py-1.5 rounded-lg bg-emerald-600/90 hover:bg-emerald-500 text-slate-950 text-[11px] font-bold flex items-center gap-1.5 transition'
      : 'px-2.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200 text-[11px] font-semibold flex items-center gap-1.5 transition';
  }
  const pauseBanner = document.getElementById('pause-banner');
  if (pauseBanner) pauseBanner.classList.toggle('hidden', !state.missionsPaused);

  // Viteza simularii (slider din Setari) - sincronizata cu valoarea reala.
  const simSlider = document.getElementById('input-sim-speed');
  if (simSlider) {
    simSlider.value = SIM_SPEED_MULTIPLIER;
    document.getElementById('slider-sim-speed-val').textContent = simSpeedLabel(SIM_SPEED_MULTIPLIER);
  }

  renderMissionsList();
  renderStationsList();
  updateMissionTimers();
}

function renderMissionsList() {
  const container = document.getElementById('missions-list');
  container.innerHTML = '';

  if (state.missions.length === 0) {
    container.innerHTML = `
      <div class="text-center py-10 text-slate-500 space-y-2">
        <i class="fa-solid fa-shield-cat text-3xl text-slate-700"></i>
        <p class="text-xs">Nicio intervenție activă în rază.</p>
      </div>`;
    return;
  }

  state.missions.forEach(mission => {
    ensureMissionShape(mission);
    const pr = priorityOf(mission);

    let badgeColor = 'bg-red-950/80 text-red-400 border-red-800';
    if (mission.type === 'police') badgeColor = 'bg-blue-950/80 text-blue-400 border-blue-800';
    if (mission.type === 'smurd') badgeColor = 'bg-emerald-950/80 text-emerald-400 border-emerald-800';

    const units = missionUnits(mission);
    const onScene = missionUnitsOnScene(mission);
    const needsLeft = missionNeedsOpen(mission);

    // Checklist de forte: fiecare nevoie cu locurile ei ocupate / cerute.
    const needsHtml = (mission.needs || []).map((n, i) => {
      const assigned = Math.min(needAssignedCount(mission, i), n.count);
      const done = assigned >= n.count;
      const cand = state.vehicles.filter(v => v.status === 'idle' && vehicleCoversNeed(v, n));
      let icon = '<i class="fa-solid fa-hourglass-half text-amber-400"></i>';
      if (done) icon = '<i class="fa-solid fa-check text-emerald-400"></i>';
      else if (!cand.length) icon = '<i class="fa-solid fa-ban text-red-400"></i>';
      return `
        <div class="flex items-center justify-between text-[11px]">
          <span class="flex items-center gap-1.5 ${done ? 'text-emerald-400' : 'text-slate-300'}">${icon}${missionNeedLabel(n)}</span>
          <span class="font-orbitron ${done ? 'text-emerald-400' : 'text-amber-400'}">${assigned}/${n.count}</span>
        </div>`;
    }).join('');

    // Bara de apa: cat s-a livrat din cat e nevoie si cu ce debit se lucreaza acum.
    let waterHtml = '';
    if (mission.waterNeeded > 0) {
      const pct = Math.min(100, Math.round((mission.waterDelivered / mission.waterNeeded) * 100));
      const flow = fireFlowLps(mission);
      waterHtml = `
        <div class="space-y-1">
          <div class="flex justify-between text-[10px] text-slate-400">
            <span><i class="fa-solid fa-droplet mr-1 text-cyan-400"></i>Apă livrată</span>
            <span class="font-orbitron">${Math.round(mission.waterDelivered)} / ${mission.waterNeeded} L</span>
          </div>
          <div class="h-1.5 bg-slate-800 rounded-full overflow-hidden">
            <div class="h-full bg-cyan-500" style="width:${pct}%"></div>
          </div>
          <div class="text-[10px] text-slate-500">${flow} L/s acum · ${onScene.length} echipaje la fața locului</div>
        </div>`;
    }

    // Dispecerizare: un rand per nevoie inca neacoperita (tip + modul obligatoriu).
    let dispatchControlsHtml = '';
    if (!needsLeft) {
      dispatchControlsHtml = `
        <div class="text-xs text-amber-400 font-medium flex items-center gap-2 pt-2 border-t border-slate-800">
          <i class="fa-solid fa-spinner animate-spin"></i> Forțe complete — ${units.length} trimise, ${onScene.length} la fața locului
        </div>`;
    } else {
      dispatchControlsHtml = (mission.needs || []).map((n, i) => {
        if (!needOpen(mission, i)) return '';
        const key = needSlotKey(mission.id, i);
        const avail = state.vehicles.filter(v => v.status === 'idle' && vehicleCoversNeed(v, n));
        const reqTxt = n.requires ? ` — ai nevoie de o autospecială cu modulul <b>${n.requires}</b>` : '';
        if (!avail.length) {
          return `
            <div class="text-[11px] text-red-400 pt-2 border-t border-slate-800">
              Niciun echipaj disponibil pentru <b>${missionNeedLabel(n)}</b>${reqTxt}!
            </div>`;
        }
        const selected = dispatchSelections[key];
        return `
          <div class="pt-2 border-t border-slate-800 space-y-2">
            <label class="text-[10px] text-slate-400 uppercase font-semibold">Trimite pentru: ${missionNeedLabel(n)}</label>
            <div class="flex gap-2">
              <select id="select-dispatch-${key}" onchange="rememberDispatchSelection('${key}', this.value)" class="flex-1 px-2.5 py-1.5 rounded-lg bg-slate-900 border border-slate-700 text-xs text-slate-200">
                ${avail.map(v => `<option value="${v.id}" ${v.id === selected ? 'selected' : ''}>${v.name}</option>`).join('')}
              </select>
              <button onclick="dispatchVehicleToMission(document.getElementById('select-dispatch-${key}').value, '${mission.id}', ${i})" class="px-3 py-1.5 bg-cyan-600 hover:bg-cyan-500 text-slate-950 font-bold text-xs rounded-lg shadow-md">Trimite</button>
              <button onclick="dispatchNearestToNeed('${mission.id}', ${i})" title="Trimite cel mai apropiat echipaj" class="px-2.5 py-1.5 bg-emerald-600/80 hover:bg-emerald-500 text-slate-950 font-bold text-xs rounded-lg shadow-md"><i class="fa-solid fa-bolt"></i></button>
            </div>
          </div>`;
      }).join('');
    }

    const distLabel = (mission.distanceKm != null) ? `${mission.distanceKm.toFixed(1)} km` : '?';
    const card = document.createElement('div');
    card.className = 'glass-panel p-3 rounded-xl space-y-2 border border-slate-800 hover:border-slate-700 transition';
    card.innerHTML = `
      <div class="flex justify-between items-start gap-2">
        <div class="flex items-center gap-1.5 flex-wrap">
          <span class="text-[10px] px-1.5 py-0.5 rounded border ${pr.badgeClass} font-bold" title="${pr.name}">${pr.label}</span>
          ${mission.relaxed ? '<span class="text-[10px] px-1.5 py-0.5 rounded border bg-slate-800 text-slate-300 border-slate-600 font-bold" title="Misiune fără urgență: nu expiră">FĂRĂ TERMEN</span>' : ''}
          <span class="text-xs px-2 py-0.5 rounded border ${badgeColor} font-bold uppercase tracking-wider">
            ${TYPE_LABEL[mission.reqType] || mission.type.toUpperCase()}
          </span>
        </div>
        <span class="font-orbitron text-xs font-bold text-emerald-400">+${mission.reward.toLocaleString('ro-RO')} LEI</span>
      </div>
      <h4 class="text-sm font-bold text-slate-100">${mission.title}</h4>
      <div class="flex justify-between items-center text-[11px] text-slate-400">
        <span><i class="fa-solid fa-location-dot mr-1"></i>${distLabel} · ${mission.district || 'necunoscut'}</span>
        <span id="timer-${mission.id}">--:--</span>
      </div>
      <div class="space-y-1 pt-1">${needsHtml}</div>
      ${waterHtml}
      <button onclick="focusMissionOnMap('${mission.id}')" class="w-full py-1 rounded-lg bg-slate-800/60 hover:bg-slate-800 text-slate-300 text-[11px] font-semibold transition">
        <i class="fa-solid fa-crosshairs mr-1"></i> Vezi pe hartă
      </button>
      ${dispatchControlsHtml}
    `;
    container.appendChild(card);
  });
}

function renderStationsList() {
  const container = document.getElementById('stations-list');
  container.innerHTML = '';

  if (state.stations.length === 0) {
    container.innerHTML = `
      <div class="text-center py-8 text-slate-500 space-y-2">
        <i class="fa-solid fa-building-circle-xmark text-3xl text-slate-700"></i>
        <p class="text-xs">Nu ai construit nicio subunitate pe hartă.</p>
      </div>`;
    return;
  }

  state.stations.forEach(station => {
    const stationVehicles = state.vehicles.filter(v => v.stationId === station.id);

    const card = document.createElement('div');
    card.className = 'glass-panel p-4 rounded-xl space-y-3 border border-slate-800';
    card.innerHTML = `
      <div class="flex justify-between items-center border-b border-slate-800 pb-2">
        <div>
          <h4 class="text-sm font-bold text-cyan-400 flex items-center gap-2">
            <i class="fa-solid fa-warehouse"></i> ${station.name}
          </h4>
          <p class="text-[10px] text-slate-400">Garaj: ${stationVehicles.length} / ${MAX_VEHICLES_PER_STATION} Vehicule</p>
        </div>
        ${stationVehicles.length >= MAX_VEHICLES_PER_STATION ? `
        <span class="px-2.5 py-1.5 rounded-lg bg-slate-800 border border-slate-700 text-slate-500 font-semibold text-xs flex items-center gap-1">
          <i class="fa-solid fa-ban"></i> Garaj Plin
        </span>` : `
        <button onclick="openVehicleShopModal('${station.id}')" class="px-2.5 py-1.5 rounded-lg bg-emerald-600/20 hover:bg-emerald-600/30 border border-emerald-500/40 text-emerald-400 font-semibold text-xs flex items-center gap-1">
          <i class="fa-solid fa-plus"></i> Cumpără Vehicul
        </button>`}
      </div>

      <div class="space-y-1.5">
        ${stationVehicles.length === 0 ? '<div class="text-[11px] text-slate-500 italic">Garaj gol</div>' : ''}
        ${stationVehicles.map(v => {
          let statusBadge = '<span class="text-[10px] text-emerald-400 bg-emerald-950/60 px-2 py-0.5 rounded border border-emerald-800">Disponibil</span>';
          if (v.status === 'dispatched') statusBadge = '<span class="text-[10px] text-amber-400 bg-amber-950/60 px-2 py-0.5 rounded border border-amber-800">În deplasare</span>';
          if (v.status === 'on_scene') statusBadge = '<span class="text-[10px] text-red-400 bg-red-950/60 px-2 py-0.5 rounded border border-red-800">Intervine</span>';
          if (v.status === 'returning') statusBadge = '<span class="text-[10px] text-blue-400 bg-blue-950/60 px-2 py-0.5 rounded border border-blue-800">Se întoarce</span>';
          if (v.status === 'refilling') statusBadge = '<span class="text-[10px] text-cyan-300 bg-cyan-950/60 px-2 py-0.5 rounded border border-cyan-800">' +
            (v.hydrantPhase === 'filling' ? 'Alimentează cu apă' : 'La hidrant') + '</span>';

          return `
            <div class="bg-slate-950/80 p-2 rounded-lg border border-slate-800/80 flex items-center justify-between text-xs">
              <span class="font-medium text-slate-200 flex flex-col">
                <span>${v.name}</span>
                ${v.type === 'fire_custom' ? `<span class="text-[10px] text-slate-500">${(v.compartments || []).join(' · ') || 'fără module'}${v.waterCap ? ' · ' + v.waterCap + ' L' : ''}${v.waterLeft != null ? ' · rezervor ' + Math.round(v.waterLeft) + ' L' : ''}</span>` : ''}
              </span>
              ${statusBadge}
            </div>
          `;
        }).join('')}
      </div>
    `;
    container.appendChild(card);
  });
}

// ------------------------------------------------------------------------
// MISSION TIMERS, DISPATCH SELECTION & MAP FOCUS
// ------------------------------------------------------------------------

function rememberDispatchSelection(missionId, vehicleId) {
  dispatchSelections[missionId] = vehicleId;
}

// Actualizeaza doar textele de countdown, fara sa re-randeze lista.

function updateMissionTimers() {
  const now = Date.now();
  state.missions.forEach(m => {
    const el = document.getElementById('timer-' + m.id);
    if (!el) return;
    if (!m.deadline) {
      // Misiunile relaxate (eveniment public, transfer inter-spitale) n-au termen.
      el.textContent = 'fără termen';
      el.className = 'font-orbitron text-[11px] font-bold text-slate-500';
      return;
    }
    if (m.status !== 'active') {
      el.textContent = 'în intervenție';
      el.className = 'font-orbitron text-[11px] font-bold text-amber-400';
      return;
    }
    const left = Math.max(0, Math.round((m.deadline - now) / 1000));
    const mm = String(Math.floor(left / 60)).padStart(2, '0');
    const ss = String(left % 60).padStart(2, '0');
    el.textContent = `${mm}:${ss}`;
    el.className = left <= 30
      ? 'font-orbitron text-[11px] font-bold text-red-400 animate-pulse'
      : 'font-orbitron text-[11px] font-bold text-slate-400';
  });
}

function startTimersLoop() {
  setInterval(updateMissionTimers, 1000);
  // Popup-ul de vehicul (viteza / ETA) se actualizeaza in timp real cat e deschis.
  setInterval(refreshOpenVehiclePopup, 1000);
}

// ------------------------------------------------------------------------
// UI TABS, MODAL & UTILITY HELPERS
// ------------------------------------------------------------------------

function switchTab(tabName) {
  ['missions', 'stations', 'settings'].forEach(t => {
    const btn = document.getElementById(`tab-btn-${t}`);
    const content = document.getElementById(`tab-content-${t}`);
    if (t === tabName) {
      btn.className = 'flex-1 py-2.5 text-xs font-semibold rounded-lg bg-slate-800 text-cyan-400 flex items-center justify-center gap-2 transition';
      content.classList.remove('hidden');
    } else {
      btn.className = 'flex-1 py-2.5 text-xs font-semibold rounded-lg text-slate-400 hover:text-slate-200 flex items-center justify-center gap-2 transition';
      content.classList.add('hidden');
    }
  });
}

function toggleMobileMenu(forceState) {
  const sidebar = document.getElementById('sidebar');
  if (forceState !== undefined) {
    if (forceState) sidebar.classList.remove('-translate-x-full');
    else sidebar.classList.add('-translate-x-full');
  } else {
    sidebar.classList.toggle('-translate-x-full');
  }
}

function closeModal(id) {
  document.getElementById(id).classList.add('hidden');
}


// Raportul de la fata locului: cu el pornit, nevoile reale ale unei misiuni se afla
// abia cand ajunge primul echipaj (victime mai multe, incendiu extins, descarcerare).
function toggleEscalation(enabled) {
  state.escalationEnabled = !!enabled;
  saveState();
  showToast(state.escalationEnabled
    ? 'Raport de la fața locului: ACTIV — nevoile reale se află la sosirea echipajelor.'
    : 'Raport de la fața locului: oprit (nevoile rămân cele de la apel).', 'info');
}


// Setarea "apeluri in functie de flota": cand e pornita, nu vin misiuni care cer un
// tip de masina (sau un modul) pe care nu il ai deloc in garaj, iar numarul de echipaje
// cerute se micsoreaza la cate exista. Cand nu se poate acoperi nimic urgent, raman
// misiunile fara termen (eveniment public, transfer inter-spitale, verificare sesizare).
function toggleFleetAwareCalls(enabled) {
  state.fleetAwareCalls = !!enabled;
  saveState();
  showToast(state.fleetAwareCalls
    ? 'Apeluri adaptate la flotă: nu vin misiuni pentru echipaje pe care nu le ai.'
    : 'Apeluri clasice: pot veni și misiuni pe care nu le poți acoperi.', 'info');
}
