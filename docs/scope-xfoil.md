# XFOIL in Wingcalc: integration scope

Build the in-browser XFOIL solver into Wingcalc, following the spike in [scope-xfoil-wasm.md](scope-xfoil-wasm.md). Its findings and recommended settings are the starting point; the spike harness is on the `spike/xfoil-wasm` branch.

## Objective

Every section (library, catalogue and custom) gets a polar computed by XFOIL at the stall's actual Reynolds number. Today's figures (bundled polar, or Clmax estimated from camber and thickness) show instantly and are replaced when the solver finishes. Where a library section's computed polar differs from its airfoiltools polar, the user is warned.

## Decisions

- **Engine:** WebXFOIL `webxfoil-wasm@0.1.1` (XFOIL 6.996 Fortran compiled to wasm), pinned exactly. No self-built copy.
- **Scope:** all sections, estimate first.
- **Cache:** memory only, per page load. No persistence, nothing saved in projects.
- **Delivery:** the `.wasm` and the worker are ordinary files emitted by `npm run build` next to the app (relative paths, as now).
- **Licence:** GPL-3.0-or-later, with notices and source links for XFOIL and WebXFOIL.
- **No typed Clmax:** the custom-section Clmax field and the catalogue override were removed (2026-10-11). Every section shows the estimate first, then the computed value; if XFOIL fails, the estimate stays.
- **Settings:** 160 panels, Ncrit 9, `ITER 50`, sweep −4° to 18° in 0.5° steps, split at 0° (0 → 18, then `INIT`, −0.5 → −4). Non-converged points are left out.

## Constraints

- SI units and pure logic in `src/lib/` (no Vue imports), unit-tested in Vitest. The wasm module loads in Node, so tests run real polars.
- The solver runs only in a Web Worker; a polar blocks its thread for 0.7 to 3 s.
- No change to saved project format.
- UK English; log and console strings ASCII.

## Files in play

| File | Change |
| --- | --- |
| `package.json` | `webxfoil-wasm` dependency (exact pin); `license` field |
| `LICENSE`, `THIRD_PARTY_NOTICES.md` (new) | GPL-3.0 text; XFOIL and WebXFOIL notices with source links |
| `src/lib/xfoil.js` (new) | Pure: command script builder, polar file parser, Selig serialiser, comparison against a reference polar |
| `src/lib/xfoilEngine.js` (new) | Loads WebXFOIL's `dist/xfoil.js` with output discarded; `runPolar(coords, re, settings)`. Shared by worker and tests |
| `src/workers/xfoil.worker.js` (new) | Receives requests, runs `runPolar`, posts results |
| `src/composables/usePolarSolver.js` (new) | Worker lifecycle, latest-request-wins queue, cancel (terminate and respawn), memory cache, stall-Re refinement |
| `src/lib/airfoils.js` | `airfoilPerformance` accepts a computed polar; the estimate path stays for first paint |
| `src/WingCalc.vue`, `src/components/LiftCurve.vue` | Status (estimate / computing / computed / failed), computed curve with gaps, difference warning |
| `README.md`, `CLAUDE.md` | Method, licence, conventions |

## Steps

1. **Licence and dependency.** Add `LICENSE` (GPL-3.0-or-later), third-party notices, `license` field, and `webxfoil-wasm@0.1.1`. Check that Vite can import `webxfoil-wasm/dist/xfoil.js` and emit the `.wasm` as an asset.
2. **Pure layer, `src/lib/xfoil.js`, with tests.** Script builder from settings, polar parser, Selig serialiser, and `comparePolars` (Clmax, alpha at Clmax, slope, RMS Cl, using the spike's thresholds).
3. **Engine, `src/lib/xfoilEngine.js`, with tests.** Load the Emscripten module with stdout and stderr discarded, so nothing is kept in memory (the npm wrapper buffers it all). Test NACA 2412 at Re 200,000 against the bundled polar, and a cold-start failure case to prove split sweeps.
4. **Prove the build.** Worker created with `new Worker(new URL(...), { type: 'module' })` in a minimal composable; check `npm run build` emits worker and `.wasm` with relative paths, and run the built `dist/` from a static server to confirm a polar completes. This is the riskiest plumbing, so it comes before any UI.
5. **Solver composable.** Cache key: coordinates hash + Re (rounded) + settings. Latest request wins: a new request for a different section or geometry terminates the running polar. Custom section edits debounced (about 500 ms).
6. **Stall-Re refinement.** Start from today's estimate of stall Re, solve, recompute stall speed and Re from the computed Clmax, and solve again if Re moved by more than about 10%. At most 3 polars; each one updates the display.
7. **Results and warning.** Feed the computed polar into `airfoilPerformance` (Clmax from converged points; stall rating from the computed polar, as library sections do today). For library sections, compare with the bundled polar at the same Re and show a warning naming the difference when any spike threshold is exceeded.
8. **UI.** Status beside the Clmax source line; lift curve solid when computed, with gaps for non-converged points; clear fall-back to the estimate if the solver fails.
9. **Verify and document.** Run the app (dev and built): library, catalogue and custom sections, rapid edits, solver failure. Update README and CLAUDE.md.

## Open questions

- **Warning wording and placement:** proposed near the Clmax line, e.g. "XFOIL here differs from airfoiltools.com: Clmax 1.30 vs 1.25". To be agreed at step 7.
- **Ncrit:** fixed at 9 for now. Expose later (turbulence level) only if wanted.
- **Bundled data terms:** UIUC coordinates and airfoiltools polars still have no stated terms. Unchanged by this work.

## Status

Implemented on branch `xfoil-integration` (2026-10-12). All nine steps done; 160 tests pass.

Deviations from the plan:
- **Comparison with airfoiltools.com** uses Clmax only: the computed Clmax against the bundled Clmax interpolated to the same Re, warning above 0.03. Comparing full polars would need an extra solve at one of the five bundled Re values for every library section, and Clmax is what feeds the results.
- **Usable polar** also accepts one that converges right up to the peak and fails after it (XFOIL losing convergence at the stall). Without this, S1223 at Re 100k fell back to bundled data.
- **Time limit** of 20 s per polar added: a degenerate shape (a flat plate) kept XFOIL busy for 25 s.

Verified in the running app (dev server and built `dist/` under `vite preview`, Chromium): default NACA 2412 computes Clmax 1.30 at Re 121k with no warning; S1223 computes 2.00 at Re 100k and warns (airfoiltools.com 2.08); a catalogue section (AG04) and a custom section compute in about 2 s; rapid slider edits show the estimate live and one computed polar about a second after the last edit. No console errors. Not checked: Firefox and Safari, dark-mode appearance of the warning, phone widths.
