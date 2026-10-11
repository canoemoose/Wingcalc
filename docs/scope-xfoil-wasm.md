# XFOIL in the browser — spike scope

A time-boxed test of whether XFOIL can run in the browser as WebAssembly, before committing to building it into Wingcalc. Update the **Findings** section as the spike progresses; it's the hand-over.

## Why

Today:
- 78 sections have XFOIL polars, scraped from airfoiltools.com (whose terms are unclear).
- About 1,580 UIUC sections have coordinates only, so their Clmax is estimated from camber and thickness and their stall rating comes from a geometry heuristic.
- Custom sections have no polar at all; the lift curve shown is indicative only.

An in-browser solver would give:
- real polars for custom sections, a few seconds after an edit;
- polars on demand for any catalogue section, computed at the stall's actual Reynolds number rather than one of five bundled values, and cached in the browser;
- no dependency on airfoiltools.com's data.

## Decisions already made

- **Licence:** Wingcalc will be open source, so shipping GPL code (XFOIL, XFLR5) is acceptable. The repo will need a GPL-compatible licence before release (see open questions).
- **Route to try first:** XFLR5's C++ translation of XFOIL's core, compiled with Emscripten. C++ compiles to WebAssembly cleanly, and XFLR5's version has no interactive menus or X11 plotting. Fallback: the original Fortran via `f2c` and Emscripten.
- **Not in this spike:** any change to the Wingcalc app or its UI. The spike lives in its own folder and must not affect `npm run build` or `npm test`.

## Constraints

- Windows 11 development machine; Node via Volta (pinned in `package.json`); npm.
- **Ask Matt before downloading or installing anything**: the Emscripten SDK, XFLR5 or XFOIL sources, native XFOIL binaries. Say what it is, where from and roughly how big.
- Spike code goes in `spikes/xfoil-wasm/` with its own README. Large downloads and build outputs stay out of git (add to `.gitignore`).
- UK English in docs and comments. Log and console strings ASCII only.
- Keep any third-party source in the spike folder with its licence file and a note of the exact version and where it came from.

## Steps

1. **Look for prior art (30 min max).** Search npm and GitHub for an existing WebAssembly or JavaScript port of XFOIL. For anything promising, note its licence, upstream version, maintenance, size, and whether it can run a viscous polar. If one is usable, evaluate it (steps 5–6) instead of compiling our own.
2. **Get the toolchain and sources** (after asking). The Emscripten SDK (`emsdk`), and XFLR5's source at a tagged release. Locate the XFoil class (historically `XFoil.cpp` / `XFoil.h`) and list what it depends on.
3. **Cut it loose.** Copy the XFoil class into the spike folder and stub or replace its Qt dependencies (strings, text streams, logging). Aim for plain C++ with no Qt.
4. **Wrap and build.** A small C++ entry point, e.g. `runPolar(coords, nPoints, re, ncrit, alphaStart, alphaEnd, alphaStep, maxIter)`, that returns arrays of alpha, Cl, Cd, Cm and a per-point converged flag. Build with Emscripten as an ES module (`-sMODULARIZE -sEXPORT_ES6`, no filesystem if possible). Run it from Node first.
5. **Check it against known data.** NACA 2412 at Re 200,000, Ncrit 9, alpha −4° to 18° in 0.25° steps, against its polar in `src/data/airfoils.json` (which came from XFOIL via airfoiltools.com). Targets:
   - Clmax within ±0.03
   - alpha at Clmax within ±0.5°
   - lift-curve slope (−2° to 4°) within 3%
   - RMS Cl difference over 0° to 8° under 0.02

   Then repeat for NACA 0012, E205, Clark Y, SD7037 and S1223, at Re 100,000 and 500,000. Record pass/fail per case. Differences in repanelling or iteration settings are the likely cause of mismatches; note which settings matched.
6. **Measure:**
   - `.wasm` size, raw and gzipped;
   - time per polar in Node and in a browser Web Worker (a minimal HTML page in the spike folder is fine);
   - how often points fail to converge, especially near stall;
   - peak memory.
7. **Write the findings** below: go/no-go, an effort estimate for integrating into Wingcalc, risks, and recommended settings (panel count, Ncrit, iteration limit, how to handle non-converged points).

Time box: about half a day. If blocked (toolchain won't install, the code won't compile within a couple of hours, or results are far off), stop, write up what happened and why, and suggest the fallback.

## Fallbacks

- **Original Fortran** via `f2c` to C, then Emscripten, stubbing the plotting library and driving XFOIL's command interface through simulated keyboard input and the virtual file system.
- **Build-time native XFOIL** over the whole UIUC catalogue (no browser solver). That still replaces airfoiltools.com and covers every catalogue section, but not custom sections.

## Success criteria

- A `.wasm` module that runs a viscous polar for arbitrary Selig-format coordinates, from Node and from a browser Web Worker.
- NACA 2412 at Re 200,000 within the step 5 targets; most of the other cases too.
- A polar in a few seconds or less in the browser.
- A clear recommendation, written below.

## Open questions

- **Licence for Wingcalc:** must be GPL-compatible. Check the exact GPL versions of XFOIL and XFLR5, then choose (likely GPL-3.0-or-later). Also remove `"private": true` from `package.json` when publishing.
- **Bundled data licences:** the UIUC coordinates and airfoiltools.com polars still have no stated terms (see README). Generating our own polars would remove the airfoiltools question; UIUC remains.
- **How the app would use it:** live polars for custom sections only, or on demand for every section with caching, replacing the bundled polars? Probably both, decided after the spike.
- **Embed:** inline the `.wasm` into the single-file embed (larger) or load it as a second file.

### Decided after the spike (2026-10-11)

- **Where our polars differ from airfoiltools, warn the user** rather than hide or reconcile the difference.
- **Embed:** load the `.wasm` as a second file, not inlined.
- **No self-built WebXFOIL:** depend on the pinned npm package; no Docker/flang-wasm toolchain.

## Findings

Spike run 2026-10-11, harness in [spikes/xfoil-wasm/](../spikes/xfoil-wasm/README.md). Took roughly half the time box.

### Verdict: go, using WebXFOIL (real XFOIL Fortran compiled to wasm)

Prior art made the planned route unnecessary. [WebXFOIL](https://github.com/PR-DC/WebXFOIL) (`webxfoil-wasm` on npm, GPL-2.0-or-later) is XFOIL 6.996 compiled with the flang-wasm toolchain and Emscripten. It runs an unmodified XFOIL session from a command script, in Node and in a Web Worker, and it reproduces the bundled airfoiltools polars almost exactly for conventional sections. I didn't install the Emscripten SDK or XFLR5, and didn't need to.

- **Accuracy:** NACA 2412 at Re 200,000 passes all four targets (Clmax 1.328 vs 1.328, RMS Cl 0.0002). 7 of 13 cases pass all four. The 6 misses are all thin, high-camber, bubble-dominated sections (E205, SD7037, S1223), and the evidence says the reference is the outlier (see below).
- **Speed:** 89-point polar (−4° to 18° in 0.25° steps): median 1.3 s in Node, 1.3 to 3.7 s in a browser Web Worker. With 0.5° steps and 50 iterations, about 0.7 to 1.0 s in Node.
- **Size:** `.wasm` 1,003 KB raw, 340 KB gzipped, 261 KB brotli. JS glue 65 KB (18 KB gzipped).
- **Memory:** fixed 28.4 MB wasm heap (XFOIL's static arrays; it never grew). Node process about 60 to 75 MB RSS.

### Prior art

| Port | What it is | Licence | Verdict |
| --- | --- | --- | --- |
| **WebXFOIL** 0.1.1 | XFOIL 6.996 Fortran → wasm (flang-wasm + Emscripten), command-script driven | GPL-2.0-or-later | **Use.** Fast and faithful. Small project (2 commits, one maintainer). |
| **Vibefoil** (`55d2387`) | Hand port of XFOIL 6.996 to plain JS (plus a Qt-free C++ port), with a numerical audit against the Fortran | GPL-2.0 | Good fallback and cross-check. 6 to 20× slower. |
| FlexFoil (Flexcompute) | Rust rewrite, MIT | MIT | Skipped: not a faithful port, and its viscous solver is still in progress. |

### Step 5 results (WebXFOIL; 160 panels, Ncrit 9, ITER 100, split sweeps from 0°)

| Case | Re | Clmax ref / calc | α Clmax ref / calc | Slope err | RMS Cl 0–8° | Converged | Result |
| --- | --- | --- | --- | --- | --- | --- | --- |
| NACA 2412 | 200k | 1.328 / 1.328 | 14.25 / 14.00 | 0.0% | 0.0002 | 88/89 | **pass** |
| NACA 2412 | 100k | 1.291 / 1.279 | 12.00 / 11.75 | 0.4% | 0.0007 | 88/89 | **pass** |
| NACA 2412 | 500k | 1.407 / 1.405 | 15.25 / 14.75 | 0.0% | 0.0003 | 89/89 | **pass** |
| NACA 0012 | 100k | 0.992 / 0.984 | 10.75 / 10.25 | 0.0% | 0.0005 | 87/89 | **pass** |
| NACA 0012 | 500k | 1.236 / 1.234 | 14.75 / 14.25 | 0.2% | 0.0009 | 86/89 | **pass** |
| Clark Y | 100k | 1.369 / 1.370 | 12.50 / 12.50 | 0.2% | 0.0033 | 89/89 | **pass** |
| Clark Y | 500k | 1.433 / 1.435 | 13.50 / 13.50 | 0.1% | 0.0014 | 87/89 | **pass** |
| E205 | 100k | 1.207 / 1.226 | 12.50 / 12.25 | 5.8% | 0.0140 | 81/89 | fail (slope) |
| E205 | 500k | 1.236 / 1.296 | 11.75 / 12.50 | −3.6% | 0.0204 | 88/89 | fail (all four) |
| SD7037 | 100k | 1.315 / 1.336 | 12.25 / 12.00 | −5.0% | 0.0145 | 78/89 | fail (slope) |
| SD7037 | 500k | 1.397 / 1.442 | 13.25 / 13.00 | 0.4% | 0.0090 | 86/89 | fail (Clmax) |
| S1223 | 100k | 2.081 / 2.000 | 9.75 / 9.00 | −9.4% | 0.0140 | 58/89 | fail (Clmax, α, slope) |
| S1223 | 500k | 2.353 / 2.280 | 14.00 / 14.00 | −5.7% | 0.0281 | 82/89 | fail (Clmax, slope, RMS) |

Drag and moment, checked against the full airfoiltools CSVs in `scripts/.cache/`: Cd within 0.1 to 0.5% RMS on the passing cases and up to 2% on S1223. Cm within 0.0006 on the passing cases.

**Why the misses are the reference, not the build:** Vibefoil is an independent reimplementation in double precision. In the 0° to 8° range it agrees with WebXFOIL to RMS 0.0001 to 0.0007 in Cl on every section except S1223 (0.003 to 0.006). That holds even where both sit 0.014 to 0.02 away from the reference (E205 at 100k, 0°: reference 0.368, WebXFOIL 0.3411, Vibefoil 0.3411). So airfoiltools must have used a different XFOIL build or settings for these sections, probably an older 6.9x version, possibly single precision; their files don't say. Bubble-dominated low-Re sections are exactly where version and precision differences show. I can't confirm the version without asking airfoiltools.

**Which settings matched:** 160 panels matches the reference best. The bundled XFOIL includes the 2023 addendum, which raised the default to 240, so the panel count must be set explicitly. 240 panels was ~3× slower, had more failures, and drifted further from the reference (NACA 0012 at 500k then fails α Clmax). ITER 50 gives the same Clmax as ITER 100 on every case and is ~15% faster.

### Convergence

- WebXFOIL with the recommended split sweep: 70 of 1,157 points failed (6.1%). 55 of those were past Clmax, mostly deep stall on S1223 and SD7037 at 100k. 15 were isolated points before stall (for example NACA 0012 at 500k, ±1.5°; Clark Y at 500k, 4.75° and 5.25°).
- A single sweep cold-started at −4° can derail an entire polar: NACA 2412 at 100k converged 6/89 and S1223 at 500k 0/89, reproducibly in a fresh process. XFOIL warm-starts each point from the last, so one bad point poisons the rest. Starting at 0° and sweeping outwards both ways fixes it.
- `INIT` as the first command of a cold session made every point fail in this build (cause not investigated; `INIT` between sweeps is fine).
- Vibefoil failed fewer points (2.8%), because it retries a failed point cold. That also lands it on a different branch near stall: its Clmax runs 0.01 to 0.04 below WebXFOIL's.

### Timings

| | Node 24 (median / max of 13 polars) | Browser Web Worker (Chromium 152) |
| --- | --- | --- |
| WebXFOIL, 0.25°, ITER 100 | 1.3 s / 2.1 s | 1.3 s to 3.7 s; module load 22 ms |
| WebXFOIL, 0.5°, ITER 50 | 0.7 s to 1.0 s (4 cases) | not measured |
| Vibefoil, 0.25°, ITER 100 | 7.8 s / 44 s | 23.7 s (NACA 2412 only) |

The browser figures came from the app's built-in browser pane while it was hidden, which may throttle the worker. Treat them as an upper bound.

### Effort to integrate (estimate: 4 to 6 days)

1. **Our own thin wrapper** over `dist/xfoil.js` (half a day). It builds the command script, discards stdout, and parses the polar file. The npm wrapper keeps every output line, and a fully failing polar pushed Node's RSS to about 1 GB.
2. **Worker plus composable** (1 day): queue, cancel (terminate and respawn costs about 20 ms), and a cache keyed by coordinates hash + Re + Ncrit + settings.
3. **App use** (1 to 2 days): live polars for custom sections; on-demand polars at the actual stall Re for catalogue sections; show non-converged points as gaps.
4. **Embed** (half a day): load the `.wasm` as a second file, or inline it as base64 (1.34 MB raw, 480 KB gzipped, on top of the current embed).
5. **Tests** (half a day): the module loads in Node in about 10 ms, so Vitest can run real polars, for example NACA 2412 at 200k against the bundled data.
6. **Licensing and source** (half a day plus): GPL-3.0-or-later for Wingcalc is compatible with XFOIL's and WebXFOIL's GPL-2.0-or-later. Ship a link to the WebXFOIL tag and the XFOIL tarball as corresponding source. Optional: reproduce the WebXFOIL build ourselves (needs Docker and the flang-wasm image, probably 1 to 2 GB) so we aren't tied to a one-maintainer package.

### Risks

- **Bus factor:** WebXFOIL has one maintainer and 2 commits. Mitigations: pin the version and keep the build reproducible; Vibefoil is a drop-in fallback at a speed cost.
- **Numbers shift for some sections:** for bubble-dominated low-Re sections, polars we generate will differ from today's bundled ones (Cl offset up to about 0.03 in the linear range; S1223 Clmax 0.07 to 0.08 lower). Our numbers are reproducible and self-consistent, but users comparing against airfoiltools will see differences.
- **Convergence near stall:** 6% of points fail, mostly post-stall. Clmax relies on the points around the peak converging, which they did in every test case, but exotic custom sections could do worse.
- **Synchronous and single-instance:** a polar blocks its thread, so it must run in a worker. XFOIL's global state allows one run per instance; parallel polars need multiple workers, at 28 MB each.
- **Unexplained quirks:** `INIT` on a cold session; the banner reports "Version 7.00" although packaged as 6.996 with the 2020/2023 addenda.

### Recommended settings

- **Panels:** 160 (`PPAR N 160`), set explicitly.
- **Ncrit:** 9 by default. A user setting can come later.
- **Iterations:** `ITER 50`.
- **Sweep:** split, from 0° up to the end, then `INIT` and from −step down to the start. Use 0.5° steps for on-demand polars (Clmax identical to 0.25° in every case tried), with an optional 0.25° refinement around the peak.
- **Non-converged points:** leave them out of the polar (XFOIL only stores converged points). Interpolate isolated gaps before stall for display. Take Clmax from converged points only. If several points just past the peak fail, treat that as stall reached rather than as an error.

### Not done or not verified

- XFLR5's C++ and the `f2c` fallback: not attempted; not needed.
- Browser timings in a foreground tab or in Firefox and Safari (the embed audience).
- `performance.measureUserAgentSpecificMemory` in the browser; the 28.4 MB is the wasm heap only.
- Which XFOIL build airfoiltools used.
