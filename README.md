# Dispecerat Național 112 — Simulator România

Simulator de dispecerat pentru apelurile de urgență 112. Îți construiești subunități pe hartă,
cumperi autospeciale și echipaje, și trimiți intervenții la incendii, accidente și urgențe medicale.

## Cum se joacă

1. Deschide link-ul (merge și pe PC, și pe telefon — e responsive).
2. Tab **Subunități** → *Plasare Subunitate Nouă* (100.000 LEI) → click pe hartă.
3. În cardul subunității → *Cumpără Vehicul*. Autospeciala de pompieri e configurabilă
   (capacitate rezervor + module: stingere, descarcerare, prim ajutor).
4. Tab **Misiuni 112** → alege echipajul din dropdown → *Trimite*.
5. Echipajul merge pe ruta rutieră reală (OSRM), intervine ~8 secunde, apoi se întoarce
   la subunitate. Recompensa intră în buget.

## Setări

- **Rază max. generare apeluri** (1–150 km) — distanța față de cea mai apropiată subunitate.
- **Stil hartă** — Dark Tactical (CartoDB), OpenStreetMap, Satelit Esri.
- **Cerc acoperire** — desenează raza de acoperire a subunităților.

Progresul se salvează automat în `localStorage` (butonul **Reset** șterge tot).

## Detalii tehnice

Un singur fișier HTML, fără build step.

- [Tailwind CSS](https://tailwindcss.com/) (CDN) — UI
- [Leaflet 1.9.4](https://leafletjs.com/) — hartă interactivă
- [OSRM](http://project-osrm.org/) (`router.project-osrm.org`) — rutare rutieră reală
- Web Audio API — alerte, sirenă și chime sintetizate, fără fișiere audio
- `localStorage` — persistența progresului
- FontAwesome 6 + Google Fonts (Inter, Orbitron)

Necesită conexiune la internet (CDN-uri + OSRM).

## Hosting

Publicat cu GitHub Pages din branch-ul `main`, rădăcină.
