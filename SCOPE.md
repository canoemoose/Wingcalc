# Wing Loading Calculator — Build Scope

## Mode
**Autonomous.** Work through the whole build with minimal interruption. Batch any questions rather than stopping for each one. Finish with a summary of what was built, assumptions made, and anything flagged for review.

## Purpose
An embedded web app for RC fixed-wing aircraft. The user enters weight, wing geometry and an airfoil section; the app reports whether the wing loading is sensible, the expected stall speed, and how forgiving the airfoil is likely to be at the stall.

## Stack and conventions
- Vue 3, plain JavaScript (no TypeScript), served with Vite.
- UK English throughout (UI copy, comments, docs).
- Built to be embeddable (self-contained component/app, no assumptions about the host page).
- Runs on Windows for development.

## Scope
- RC fixed-wing aircraft, wingspans **600 mm to 3 m**. Validate inputs against this range and warn when outside it.

## Units
- Every input and every output supports **both metric and imperial**, with conversion throughout.
- Provide a global unit-system toggle, and show converted values alongside results where useful (e.g. wing loading in g/dm² and oz/ft²).
- Units covered include at least: length (mm/m, in/ft), area (dm²/m², in²/ft²), mass (g/kg, oz/lb), wing loading (g/dm², oz/ft²), cube loading (metric and oz/ft³ equivalent), speed (m/s, km/h, mph).

## Inputs
1. **All-up weight.**
2. **Wing geometry:** span, root chord, tip chord (or mean chord), and planform area. Area can be entered directly or derived from span and chords.
3. **Airfoil**, via one of three paths:
   - **NACA** — select from a library (four-digit series as a minimum).
   - **Eppler (E-series)** — select from a library (e.g. E205, E374 and other common RC sections).
   - **Custom** — see below.

## Airfoil data
- Source NACA and Eppler section data from **airfoiltools.com** (coordinates and polar data, including max lift coefficient and stall angle at RC-relevant Reynolds numbers).
- **Bundle the data as static JSON at build time** via a small fetch/scrape script in the repo, rather than fetching live in the browser (avoids CORS and keeps the app working offline when embedded).
- Record the source URL and Reynolds number used for each section in the data file.
- Check airfoiltools.com's terms of use and note them in the README. If the site can't be reached from the build environment, flag it and leave the fetch script ready to run locally.

## Custom input path
- Parameters are defined on screen: max lift coefficient, thickness (% chord), camber (% chord) and position, leading-edge radius, and any others needed for the calculations.
- Include a **live graphical visualisation** (SVG) that redraws the section and wing planform as the user enters dimensions, so the input can be sanity-checked by eye.
- Use the same visualisation to preview library airfoils when selected.

## Calculations
1. **Wing loading** = weight ÷ wing area.
2. **Wing cube loading** = weight ÷ area^1.5. This is the **headline verdict**, banded as trainer / sport / warbird–scale / hotliner (or similar), with the band thresholds stated in the UI.
3. **Stall speed** from max lift coefficient, wing area, weight and sea-level air density. Shown **side by side** with the cube-loading verdict.

## Stall character
For each airfoil, the tool will also flag its stall character — whether it breaks gently and progressively, giving forgiving, easy recovery, or stalls sharply and abruptly, making recovery harder — based on the section's camber, thickness, and leading-edge profile.

- Where polar data is available, use the shape of the lift curve after the peak (how steeply lift falls away past max lift) as the primary signal.
- For custom sections, use a documented heuristic from thickness, camber and leading-edge radius.
- Present it as a clear rating (e.g. Gentle / Moderate / Sharp) with a one-line explanation.
- State in the UI that this is indicative, not a substitute for flight testing.

## Deliverables
- Working Vue 3 + Vite app with the above.
- Airfoil data fetch script and bundled JSON.
- README covering setup, how to refresh airfoil data, formulas used, cube-loading band thresholds, stall-character method, and data source/terms.
- Unit tests for the core calculations and unit conversions.

## Build status (initial version, 2026-10-11)

Done:
- Vue 3 + Vite app (`src/WingCalc.vue`), standalone page and `<wing-calc>` embed build (shadow DOM, container queries).
- Metric/imperial toggle with per-field unit choice; converted values shown alongside results.
- Geometry from root chord plus panels (length, outer chord, dihedral as an angle or as the rise of the outer end: covers taper, cranked planforms, dihedral and polyhedral), mean chord, or area. Span 600 mm to 3 m validated with warnings.
- Top and true-scale front view of the wing; stall speed uses projected area, loadings use flat area.
- 18 NACA + 21 Eppler sections bundled from airfoiltools.com, XFOIL polars at Re 50k to 1M. Fetch script with caching and back-off.
- Cube-loading verdict (6 bands, thresholds in the UI), stall speed side by side, Reynolds-consistent Clmax lookup.
- Stall character from polar shape (library) or Gault-style geometry heuristic (custom), with lift-curve plot and disclaimer.
- Live SVG section and planform drawings for both library and custom sections.
- README, 65 Vitest unit tests.

Open questions / for review:
- airfoiltools.com publishes no terms of use (copyright footer only). Ask permission before public release, or regenerate polars with XFOIL.
- Top cube-loading band named "Racer / hotliner"; hotliners often sit lower than that. Band names and thresholds want a sanity check.
- Wing CLmax = 0.9 × section Clmax is a fixed rule of thumb; could be made adjustable.
- Visual layout not yet reviewed by eye.

## Second round

See [docs/scope-v2.md](docs/scope-v2.md): UIUC catalogue and picker, indicative lift curve for sections without polars, CAD-style wing plan editor with swept and curved panels, fuselage width.

## Third round

See [docs/scope-v3.md](docs/scope-v3.md): saved projects, chord stations, rounded wingtips, measure tool, auto-fit.
