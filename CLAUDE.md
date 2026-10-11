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
- Projects: `src/lib/projects.js` (storage injected, every access guarded). Saved state is `{ units, input, airfoil }`; anything added to `input` must also go in `defaultState()` so older saves migrate.

## Testing

- Runner: **Vitest** (`npm test`). Chosen because it shares Vite's config and transform pipeline, so tests import the same modules (including the bundled JSON) with no extra setup.
- Tests live in `tests/` and cover `src/lib/` and `src/composables/`. `tests/xfoilEngine.test.js` runs real XFOIL polars (a few seconds). Components are not unit-tested; check them in the running app.
- The browser pane may be hidden, in which case the page gets no animation frames and ResizeObserver never fires. Don't mistake that for a bug, but don't rely on either for first paint.

## Data fetch etiquette

airfoiltools.com returns 403 if hit too quickly. The fetch script runs one request at a time with a 1.5 s gap, backs off on 403/429, and caches every response in `scripts/.cache/` (gitignored). Don't lower the delay; re-runs come from the cache.
