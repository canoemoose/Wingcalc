# XFOIL in the browser: spike

Throwaway test harness for [docs/scope-xfoil-wasm.md](../../docs/scope-xfoil-wasm.md). The outcome is written up in that file's **Findings** section. Nothing here is part of the Wingcalc build: it has its own `package.json`, and the app's Vitest only looks in `tests/`.

## What's here

| Path | Purpose |
| --- | --- |
| `lib/webxfoil-runner.js` | `runPolar(seligText, opts)` on WebXFOIL (XFOIL Fortran compiled to wasm), driven by an XFOIL command script |
| `lib/vibefoil-runner.js` | The same API on Vibefoil (hand port of XFOIL to JavaScript), driving its solver worker module headlessly |
| `lib/reference.js` | Test cases, and reference polars and coordinates from `src/data/airfoils.json` |
| `lib/metrics.js` | Step 5 checks: Clmax, alpha at Clmax, lift-curve slope (−2° to 4°), RMS Cl (0° to 8°) |
| `run-node.mjs` | Runs the cases in Node and prints a pass/fail table |
| `cross-check.mjs` | Compares two engines' result files with each other, and drag/moment with the cached airfoiltools CSVs |
| `browser/` | Test page plus module Web Worker running either engine |
| `serve.mjs` | Tiny static server for the test page (serves the repo root on port 8765) |

`runPolar` options: `re`, `ncrit` (9), `alphaStart`, `alphaEnd`, `alphaStep`, `maxIter` (100), `panels` (160), `split` (true: sweep 0 → end, then reinitialise and sweep −step → start). It returns `{ points: [{ alpha, cl, cd, cm, converged }], ms }`.

## Setup (not in git)

Third-party code stays out of git (see `.gitignore`).

```bash
cd spikes/xfoil-wasm
npm install
git clone https://github.com/kennyjensen/vibefoil.git vendor/vibefoil
git -C vendor/vibefoil checkout 55d2387e0fdf08451582c83880010e2fe7171593
```

| Package | Version | Source | Licence |
| --- | --- | --- | --- |
| webxfoil-wasm | 0.1.1 (npm, published 2026-03-01) | <https://github.com/PR-DC/WebXFOIL>; XFOIL 6.996 tarball, SHA256 `5b6363ce…11120` per its `SOURCES.md` | GPL-2.0-or-later (`node_modules/webxfoil-wasm/COPYING`) |
| Vibefoil | commit `55d2387` (2026-10-11) | <https://github.com/kennyjensen/vibefoil> | GPL-2.0 (`vendor/vibefoil/LICENSE`), port of XFOIL 6.996 (GPL-2.0-or-later) |

## Running

```bash
node run-node.mjs webxfoil --json results/webxfoil.json
```

```bash
node run-node.mjs vibefoil --json results/vibefoil.json
```

```bash
node cross-check.mjs results/webxfoil.json results/vibefoil.json
```

Filters and settings: `--case naca2412-il`, `--re 200000`, `--panels 240`, `--iter 50`, `--nosplit`, `--init`. In the pass column, a capital letter is a pass: C = Clmax, A = alpha at Clmax, S = slope, R = RMS.

Browser: `node serve.mjs`, then open <http://localhost:8765/spikes/xfoil-wasm/browser/>, pick an engine and press Run. (The repo's `.claude/launch.json` also has an `xfoil-spike` entry.)
