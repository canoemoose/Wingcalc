# Wingcalc

Wing loading / cube loading / stall speed / stall character calculator for RC fixed-wing aircraft. Vue 3, plain JavaScript, Vite. See [README.md](README.md) for formulas and methods, and [SCOPE.md](SCOPE.md) for the original brief and build status.

## Conventions

- UK English everywhere (UI copy, comments, docs).
- All calculation code works in SI base units (m, m², kg, m/s); conversion happens only at the edges (`src/lib/units.js`, `UnitInput.vue`).
- Pure logic lives in `src/lib/` with no Vue imports, so it can be unit-tested directly.
- Styles live in one file, `src/styles/wingcalc.css`, scoped under `.wingcalc` / `wc-` class names. No `<style>` blocks in components.
- Aerofoil data is bundled at build time (`npm run fetch-airfoils`), never fetched from the internet in the browser. `airfoils.json` (polar-backed, eager) and `uiuc.json` (full UIUC catalogue, lazy chunk).
- XFOIL runs in the browser: pure parts (command script, parser, comparison) in `src/lib/xfoil.js`; the WebAssembly engine in `src/lib/xfoilEngine.js` (also used directly by the tests); the worker in `src/workers/`; queueing and the in-memory cache in `src/composables/usePolarSolver.js`; the stall-Re fixed point in `performanceWithXfoil` (`src/lib/airfoils.js`). Never call the engine on the main thread.
- Licence is GPL-3.0-or-later (XFOIL and WebXFOIL are GPL-2.0-or-later); keep `THIRD_PARTY_NOTICES.md` current when bundling anything new.
- Wing geometry for panel mode lives in `src/lib/wing.js` (flat s / projected y coordinates, Bézier edges); `calc.js` delegates to it.
- Decisions for later rounds are in `docs/scope-v2.md` and `docs/scope-v3.md`.
- Projects: `src/lib/projects.js` (storage injected, every access guarded). Saved state is `{ units, input, airfoil }`; anything added to `input` must also go in `defaultState()` so older saves migrate. `input.structure` and `input.exportOptions` are filled from their defaults recursively (`fillDefaults`), so new nested settings migrate too.
- Wing at any span station: `wingSampler` in `src/lib/wing.js` (chord, LE, twist, thickness, dihedral by flat s); `projectedSampler` looks it up by projected y for the lifting line.
- Aerodynamics: `src/lib/liftingLine.js` (Glauert series); `airfoilPerformance` in `airfoils.js` uses it for wing CLmax and stall onset in panel mode.
- Structure: `src/lib/structure.js` (materials, Stage A loads and margins, rib positions), `src/lib/ribs.js` (rib and part geometry, cut list, weight), `src/lib/dxf.js` (R12 DXF, kerf and dogbones, plan, CSV), `src/lib/strokeFont.js` (etched labels), `src/lib/wing3d.js` (3D geometry as plain arrays; `Structure3D.vue` loads three.js on demand and renders on demand, not in a loop). Part geometry is in metres in its own (u, z) plane; DXF converts to millimetres.
- Edge stock: `src/lib/edgeStock.js` (SLEC catalogue, fit check, auto pick). `analyseStructure` resolves it and returns the resolved `structure`; pass `a.structure`, not `input.structure`, to `buildParts`, the plan, 3D and export.
- Unit quantities include `thin` (lengths shown to 0.1 mm, for material sizes) and `percent` (a fraction shown as %).

## Testing

- Runner: **Vitest** (`npm test`). Chosen because it shares Vite's config and transform pipeline, so tests import the same modules (including the bundled JSON) with no extra setup.
- Tests live in `tests/` and cover `src/lib/` and `src/composables/`. `tests/xfoilEngine.test.js` runs real XFOIL polars (a few seconds). Components are not unit-tested; check them in the running app. `tests/render.test.js` renders the whole app on the server from a saved state and fails on any error or Vue warning: a quick crash check, not a substitute for the running app.
- The browser pane may be hidden, in which case the page gets no animation frames and ResizeObserver never fires. Don't mistake that for a bug, but don't rely on either for first paint.

## Data fetch etiquette

airfoiltools.com returns 403 if hit too quickly. The fetch script runs one request at a time with a 1.5 s gap, backs off on 403/429, and caches every response in `scripts/.cache/` (gitignored). Don't lower the delay; re-runs come from the cache.
