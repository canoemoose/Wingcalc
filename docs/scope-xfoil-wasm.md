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

## Findings

_Not started._
