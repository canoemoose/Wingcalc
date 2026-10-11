# Wingcalc v2 — scope

Source of truth for the second round of work. Update as items land.

## Objective

1. Stall-character graph for sections without polar data (custom, and the new UIUC sections).
2. Aerofoil catalogue from the UIUC Airfoil Coordinates Database (~1,600 sections), with a good picker. Keep NACA and Eppler tabs; everything else goes in an "Other" tab.
3. Per-panel straight or swept/curved leading and trailing edges, edited in a CAD-like wing plan editor.
4. Fuselage width as an input.
5. "Add panel" appends a new outboard section instead of splitting the outer one.

## Decisions (assumed; flag in hand-over)

- **UIUC data**: one download of `coord_seligFmt.zip`, unzipped in the fetch script (fflate, dev dependency). Built into `src/data/uiuc.json`: per section id, name, description (from the UIUC index page), family, thickness/camber and positions, LE radius, 1.25% ordinate, and ~60 decimated points packed as integers. Lazy-loaded (separate chunk) in the app build; inlined in the single-file embed build.
- **Families**: NACA (`n…`, `naca…`), Eppler (`e<digits>…`), everything else Other. The NACA and Eppler tabs list every UIUC section in the family, polar-backed ones first and badged.
- **Polars**: still from airfoiltools.com only. Extend the polar-backed set with ~30 popular RC sections (Clark Y, SD70xx, S30xx, MH, RG15, AG, etc.), so the common picks have real data. Same polite fetch with caching.
- **No-polar sections** (UIUC and custom):
  - Clmax: estimated from camber and thickness by a least-squares fit across the polar-backed library at the stall Reynolds number. The user can override it.
  - Stall rating: existing geometry heuristic.
  - Lift curve: **indicative**, built from thin-aerofoil zero-lift angle (computed from the mean line), a library-calibrated lift slope, the Clmax, and a post-stall shape set by the rating. Labelled clearly as not computed data.
- **Wing model**: half wing in flat (developed) coordinates. Optional fuselage centre section (half-width w/2, root chord, flat). Then panels, each with length, outer chord, LE sweep offset of the outer end, dihedral (angle or rise), and LE and TE edges that are each straight or a quadratic Bézier with one control point (stored as spanwise fraction + chordwise offset, so it survives resizing).
- **Fuselage width**: panels start at the fuselage side. Gross area (including the part inside the fuselage) is used for loadings and stall speed, as is conventional; exposed area is shown too.
- **Sweep**: wing CLmax gets a further cos Λ¼ factor (area-weighted quarter-chord sweep), the usual first-order correction.
- **Plan editor**: SVG canvas of the right half-wing (left half ghosted). Drag handles for each panel's outer LE point (length and sweep), outer TE point (chord), root TE (root chord), fuselage side (width) and curve handles. Snap to grid (toggle), wheel zoom, drag to pan, Fit. Click to select a panel; arrow keys nudge; Delete removes the panel. Undo/redo (Ctrl+Z / Ctrl+Y and buttons). Numeric entry stays in the inputs column as the precise route, synced with the selected panel.

## Files in play

- `scripts/fetch-airfoils.mjs`: UIUC zip + index, extra polar sections, family classification
- `src/data/airfoils.json`, `src/data/uiuc.json`
- `src/lib/airfoils.js`, `src/lib/stall.js` (indicative curve, Clmax estimate), `src/lib/airfoilGeom.js` (zero-lift angle)
- `src/lib/calc.js` → wing geometry v2 (maybe `src/lib/wing.js`)
- `src/components/AirfoilPicker.vue` → browser with search/filters/thumbnails
- `src/components/WingPlanEditor.vue` (new), `PanelEditor.vue`, `PlanformView.vue` (front view)
- `src/WingCalc.vue`, `src/styles/wingcalc.css`
- tests, README

## Steps

1. [x] Fetch script: UIUC zip/index, extra polars; regenerate data (1,662 UIUC sections; 78 polar-backed)
2. [x] Catalogue loading, Clmax estimator, indicative lift curve, tests
3. [x] Aerofoil browser UI
4. [x] Wing geometry v2 (fuselage, sweep, curves, append panels), tests
5. [x] Plan editor, panel inspector, undo/redo
6. [x] README, scope status, commit

## Status (2026-10-11)

All steps done; 93 tests pass; app exercised in the browser (picker, override, custom curve, plan editor drags, curves, fuselage, add/delete, undo/redo, keyboard, embed build). Visual layout not reviewed by eye.

Measured along the way:
- Clmax estimate RMS 0.07 to 0.17 across Re 50k to 1M.
- Geometry stall heuristic vs polar rating on 78 sections: 58% exact, 7 of 390 two steps out.
- Embed IIFE grew to 1.66 MB (533 KB gzipped) with the catalogue inlined.

## Open questions (batch for Matt)

- UIUC publishes no terms of use on its pages either.
- Fuselage width interpretation (panels start at the fuselage side; gross area used).
- Rise convention (from the earlier change) still unconfirmed.
- Wheel zoom on the plan captures the page scroll while the pointer is over it. CAD-like, but may annoy in an embedded page; could require Ctrl+wheel instead.
- Plan editor shows the flat (as-built) plan; the results show projected values. Worth confirming that's the view wanted.
