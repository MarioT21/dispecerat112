/* =========================================================================
   Dispecerat 112 - boot.js
   Depinde de: toate. Se incarca ULTIMUL.
   ========================================================================= */
// Generat din monolitul index.html - NU adauga cod in alt fisier fara sa verifici
// ordinea de incarcare din index.html (core -> map -> game -> ui -> boot).

// ------------------------------------------------------------------------
// INITIALIZATION & LEAFLET MAP SETUP
// ------------------------------------------------------------------------

window.onload = function() {
  loadSavedState();
  initMap();
  recoverStuckVehicles();
  renderUI();
  renderMapElements();
  startGameLoop();
  startCallGeneratorTimer();
  startTimersLoop();
  unlockAudioListeners();
};

// Deblocheaza AudioContext la primul gest al utilizatorului (anti-autoplay policy).

function unlockAudioListeners() {
  const unlock = () => AudioEngine.init();
  window.addEventListener('pointerdown', unlock, { once: true, capture: true });
  window.addEventListener('keydown', unlock, { once: true, capture: true });
  window.addEventListener('touchstart', unlock, { once: true, capture: true });
}
