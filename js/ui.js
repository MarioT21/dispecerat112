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
    let badgeColor = 'bg-red-950/80 text-red-400 border-red-800';
    if (mission.type === 'police') badgeColor = 'bg-blue-950/80 text-blue-400 border-blue-800';
    if (mission.type === 'smurd') badgeColor = 'bg-emerald-950/80 text-emerald-400 border-emerald-800';

    // Doar echipaje libere SI de tipul cerut de misiune.
    const availVehicles = state.vehicles.filter(v => v.status === 'idle' && v.type === mission.reqType);

    let dispatchControlsHtml = '';
    if (mission.status === 'assigned') {
      dispatchControlsHtml = `
        <div class="text-xs text-amber-400 font-medium flex items-center gap-2 pt-2 border-t border-slate-800">
          <i class="fa-solid fa-spinner animate-spin"></i> Echipaj în deplasare...
        </div>`;
    } else if (availVehicles.length === 0) {
      dispatchControlsHtml = `
        <div class="text-[11px] text-red-400 pt-2 border-t border-slate-800">
          Niciun echipaj de tip <b>${TYPE_LABEL[mission.reqType] || mission.reqType}</b> disponibil!
        </div>`;
    } else {
      const selected = dispatchSelections[mission.id];
      dispatchControlsHtml = `
        <div class="pt-2 border-t border-slate-800 space-y-2">
          <label class="text-[10px] text-slate-400 uppercase font-semibold">Trimite Echipaj Disponibil:</label>
          <div class="flex gap-2">
            <select id="select-dispatch-${mission.id}" onchange="rememberDispatchSelection('${mission.id}', this.value)" class="flex-1 px-2.5 py-1.5 rounded-lg bg-slate-900 border border-slate-700 text-xs text-slate-200">
              ${availVehicles.map(v => `<option value="${v.id}" ${v.id === selected ? 'selected' : ''}>${v.name}</option>`).join('')}
            </select>
            <button onclick="dispatchVehicleToMission(document.getElementById('select-dispatch-${mission.id}').value, '${mission.id}')" class="px-3 py-1.5 bg-cyan-600 hover:bg-cyan-500 text-slate-950 font-bold text-xs rounded-lg shadow-md">
              Trimite
            </button>
          </div>
        </div>`;
    }

    const distLabel = (mission.distanceKm != null) ? `${mission.distanceKm.toFixed(1)} km` : '?';
    const card = document.createElement('div');
    card.className = 'glass-panel p-3 rounded-xl space-y-2 border border-slate-800 hover:border-slate-700 transition';
    card.innerHTML = `
      <div class="flex justify-between items-start">
        <span class="text-xs px-2 py-0.5 rounded border ${badgeColor} font-bold uppercase tracking-wider">
          ${TYPE_LABEL[mission.reqType] || mission.type.toUpperCase()}
        </span>
        <span class="font-orbitron text-xs font-bold text-emerald-400">+${mission.reward.toLocaleString('ro-RO')} LEI</span>
      </div>
      <h4 class="text-sm font-bold text-slate-100">${mission.title}</h4>
      <div class="flex justify-between items-center text-[11px] text-slate-400">
        <span><i class="fa-solid fa-location-dot mr-1"></i>${distLabel} · ${mission.district || 'necunoscut'}</span>
        <span id="timer-${mission.id}">--:--</span>
      </div>
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

          return `
            <div class="bg-slate-950/80 p-2 rounded-lg border border-slate-800/80 flex items-center justify-between text-xs">
              <span class="font-medium text-slate-200">${v.name}</span>
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
    if (m.status !== 'active' || !m.deadline) {
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
