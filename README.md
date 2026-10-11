# Wingcalc

A wing loading calculator for RC fixed-wing aircraft with spans of 600 mm to 3 m. Enter the all-up weight, the wing geometry and an aerofoil, and it reports:

- **Wing cube loading** with a verdict band (the headline figure)
- **Stall speed**, side by side with the verdict
- **Wing loading**, area, mean aerodynamic chord, aspect ratio and the Reynolds number at the stall
- **Stall character** of the aerofoil: Gentle, Moderate or Sharp

Every input and output works in metric or imperial, with a global toggle and per-field unit choice. Numeric boxes accept sums (`700 - 20`, `(120 + 80) / 2`) and numbers with their own units (`24in + 50mm` in a millimetre box); commas are thousands separators. An unfinished sum leaves the last good value in place, and the result shows under the box while you type.

The wing can be drawn in a CAD-style **wing plan editor** or entered numerically: fuselage width, root chord, then one or more panels per side, each with its own length, outer chord, sweep, dihedral, and straight edges, Bézier curves or chords dimensioned at stations, plus an optional rounded wingtip. That covers straight, tapered, cranked, swept, elliptical, dihedral and polyhedral wings. The editor also has a measure tool for dimensions.

Projects can be saved in the browser, and the work in progress is kept automatically. Mean chord or area can be entered instead for a quick check.

Aerofoils come from a browsable catalogue of the whole UIUC Airfoil Coordinates Database (about 1,660 sections) in NACA, Eppler and Other tabs, with 78 popular sections backed by bundled XFOIL polar data. A custom section can also be defined by its parameters. Every section, custom ones included, also gets an XFOIL polar computed in the browser at the stall's own Reynolds number (see [Polars computed in the browser](#polars-computed-in-the-browser-xfoil)).

Built with Vue 3 (plain JavaScript) and Vite.

## Setup

Node is pinned with Volta (see `package.json`).

```bash
npm install
npm run dev
```

The dev server serves the app at `/`.

| Command | What it does |
| --- | --- |
| `npm run dev` | Development server |
| `npm test` | Run the unit tests (Vitest) |
| `npm run build` | The app into `dist/` (relative paths, host anywhere) |
| `npm run fetch-airfoils` | Refresh the bundled aerofoil data |

The UIUC catalogue is a separate chunk, loaded after first paint. Layout responds to the calculator's own width (container queries) rather than the viewport.

## Projects

The bar at the top holds the project name and its controls, then the units and theme toggles.

- **Save** stores the project in this browser (localStorage) under its name; saving again updates it. A dot in the name box means there are unsaved changes.
- **New** starts a fresh project (asking first if there are unsaved changes).
- **Open** lists saved projects, newest first, with **Save as copy**, **Export file** and **Import file** underneath. Delete a saved project with its ×.
- **Auto / Light / Dark** sets the colour theme. Auto follows the system setting. The choice is remembered in this browser for whoever is using it; it isn't part of a project.
- The work in progress also **autosaves** and comes back on reload, saved or not.
- **Export file** downloads the project as a `.wingcalc.json` file; **Import file** opens one. Use these to back up or move projects between browsers, since localStorage belongs to one browser on one machine and is lost if site data is cleared.

A project holds the units, weight, wing shape (including stations, tip and dimensions) and the aerofoil choice. Files carry a format version, and anything missing from an older file is filled from the defaults. If the browser blocks storage, saving is disabled with a note and Export still works.

## Wing plan editor

In "Chords & panels" mode the results column shows the wing plan: one half of the wing, drawn flat (as built), with the other half ghosted.

**Open wing editor** expands it to fill the browser window: the plan takes most of the space, the wing and panel settings sit on the left (tabs switch between panels), and a strip along the top keeps span, area, aspect ratio, cube loading and stall speed in view as you edit. Done or Esc returns to the page.

- **Select** a panel by clicking it (or its heading in the inputs column); the two stay in step.
- **Drag** the round handles at a panel's tip to change its length and sweep (leading edge) or its tip chord (trailing edge). Hold Shift to change length without changing sweep. The handle on the root trailing edge sets the root chord; the diamond ahead of the root sets the fuselage width.
- **Curves**: on the selected panel, drag the small dashed handle in the middle of either edge to curve it. That creates a square control handle (a quadratic Bézier control point); drag it to shape the curve, double-click it to straighten the edge again.
- **Chord stations**: set a panel's shape to "Chord stations" in the inputs column to define it by chords dimensioned along it instead. Each station has a distance from the panel's inner end, a chord, and a leading-edge set-back (how far its leading edge sits behind the panel's inner leading edge). **Add station** under the table adds a blank row at the end, just above the tip, with its distance box ready to type into; it's skipped quietly (with a muted "fill in" note, not a warning) until it has a distance and chord. **Add station** on the plan toolbar instead places one on the current shape in the middle of the largest gap, so the outline doesn't jump. Leave a set-back blank ("auto") and the station takes its leading edge from the line through its neighbours.
  - **The table** starts with the panel's inner end (greyed: its chord comes from the panel inboard) and ends with its tip, whose distance, chord and set-back are the panel's length, tip chord and sweep: the same values as the boxes above, so they can't disagree.
  - **Distances** are measured from the panel's inner end by default; switch to **Spacing** to enter each as the gap from the row above. In spacing mode, changing a gap moves everything outboard of it, tip included, like chained dimensions on a drawing.
  - **Typing**: Enter moves to the next box, like Tab (Shift+Enter goes back). A row being edited keeps its place until you leave the row, then the table re-sorts by distance. Nothing is refocused after a re-sort.
  - **Problems** don't stop the panel drawing. A station before the inner end, on or beyond the tip, or at the same place as another is skipped: its row says why, the warnings list names it, and the plan shows it as a dashed rib in the warning colour.
  - **Keep straight**: choose the leading edge, the trailing edge or a chord line (at a percentage you set; 25% for a straight quarter-chord line) to stay straight from end to end. Stations then set only their chord, and the edges sit either side of the straight line in proportion. Converting a panel with only one curved edge keeps the other edge straight automatically.
  - **Segments**: between the station rows, each segment (inner end to station 1, station to station, last station to outer end) shows whether it's curved or straight; click to switch. All straight gives a faceted outline, like straight sheeting between ribs. A curved segment next to a straight one leaves along the straight one's direction, so the join has no kink. On the selected panel, drag a station's leading-edge handle to move it along the panel and set its set-back, and its trailing-edge handle to change its chord. Switching an existing panel to stations samples its current shape, so nothing changes until you edit.
- **Wingtip**: tick "Rounded tip" under Wingtip to add a rounded cap beyond the last panel. Drag its handle outward for the extension and along the chord for where it reaches furthest (0% rakes it back from the leading edge, 100% forward from the trailing edge).
- **Measure** (M; V returns to select): drag between two points to place a dimension. Ends snap to the wing's corners, stations, tip and root within 10 px (a green ring shows the target) or to the grid otherwise; Alt ignores snapping. Ends snapped to the wing are shown filled and follow it as it changes. Hold Shift for a purely spanwise or chordwise dimension. The readout shows the distance, its spanwise and chordwise parts and the angle while you drag. Click a dimension and press Delete to remove it, or use **Clear dimensions**. Dimensions are saved with the project and covered by undo.
- **Snap** to the grid is on by default; the grid adapts to the zoom (10 mm at the default view), and Alt disables snapping during a drag.
- **Navigate**: scroll to zoom about the pointer, drag empty space or a panel to pan, Fit to frame the wing. The view re-fits automatically when the wing changes from outside the editor (typing in the inputs column, undo, opening a project), but not during your own drags, so it doesn't move under the pointer.
- **Keyboard** (with the plan focused): arrow keys move the selected panel's tip leading edge one grid step (left/right for length, up/down for sweep), Alt with up/down changes its tip chord, Delete removes the selected panel or dimension, M and V switch tools, Escape cancels or deselects, Ctrl+Z / Ctrl+Y undo and redo.
- **Add panel** appends a new section at the tip, continuing the leading-edge line and dihedral of the last panel at about 40% of its length and 75% of its tip chord.
- **Insert after** (or + on a panel's fields) puts a new constant-chord panel just outboard of the selected one, continuing its leading-edge line and dihedral, so the panels further out keep their shape and the wing gets longer.
- **← / →** move the selected panel inward or outward. Each panel keeps its own length, chord, sweep, dihedral and shape; only the order changes. Panels can be deleted from either the plan or the inputs column.
- **Undo/redo** covers the whole wing shape and the dimensions: each drag is one step, and typed changes are grouped once they pause. Opening a project starts a fresh history.

The same values can be typed in the inputs column, which is the precise route; the plan updates as you type.

## Formulas

All calculation is done in SI units (`src/lib/calc.js`, `src/lib/wing.js`); conversion happens only at input and display.

| Quantity | Formula |
| --- | --- |
| Flat wing area (panels) | S = w c<sub>r</sub> + 2 Σ ∫ c ds, over the panels of one side |
| Projected wing area | S<sub>p</sub> = w c<sub>r</sub> + 2 Σ cos Γ<sub>i</sub> ∫ c ds |
| Exposed area | S − w c<sub>r</sub> |
| Wingspan (tip to tip, projected) | b = w + 2 Σ l<sub>i</sub> cos Γ<sub>i</sub> |
| Wing area (mean chord) | S = b c̄ |
| Mean aerodynamic chord | MAC = ∫c² dy / ∫c dy over a half wing (projected y). For a single straight taper this is ⅔ c<sub>r</sub> (1 + λ + λ²) / (1 + λ); it equals the mean chord when entered as mean chord or area |
| Aspect ratio | AR = b² / S<sub>p</sub> |
| Wing loading | WL = W / S |
| Wing cube loading | WCL = W / S<sup>1.5</sup> |
| Stall speed | V<sub>s</sub> = √(2 m g / (ρ S<sub>p</sub> C<sub>L,max</sub>)) |
| Wing C<sub>L,max</sub> | 0.9 × cos Λ<sub>¼</sub> × section C<sub>l,max</sub> |
| Reynolds number | Re = V<sub>s</sub> × MAC / ν |

Constants: g = 9.80665 m/s², ρ = 1.225 kg/m³ and ν = 1.4607 × 10⁻⁵ m²/s (ISA sea level).

Here w is the fuselage width, c<sub>r</sub> the root chord, l<sub>i</sub> a panel's length measured flat along the panel, c its chord at each point along the panel, Γ<sub>i</sub> its dihedral angle to the horizontal and Λ<sub>¼</sub> the quarter-chord sweep.

**Panel shape.** Each panel runs from the previous panel's tip (or the fuselage side) to its own tip. The tip leading edge sits `sweep` behind the inner leading edge; the tip chord is set directly. In between, the edges are either:

- straight;
- quadratic Bézier curves with one control point each, stored as a fraction along the panel plus an offset from the straight edge, so a curve keeps its shape when the panel is resized; or
- defined by **chord stations**: both edges pass through every station's leading- and trailing-edge points and the panel's ends, joined by monotone cubic interpolation (Fritsch–Carlson PCHIP). That is smooth, passes exactly through each dimensioned chord, and never bulges beyond the stations either side, which an ordinary spline can do near a tip.

Panels are integrated numerically (32 intervals per panel, plus a sample at every station, so straight and faceted panels are exact). A panel whose edges cross, or with a station outside it or two stations at the same place, is rejected with a warning.

**Rounded tip.** The tip cap is two quarter-ellipses meeting at the point of furthest reach: one from the leading edge, one from the trailing edge, each tangent to its edge where it starts. Its chord at fraction u of the extension e is c·√(1 − u²), so its area is (π/4)·e·c exactly, and it takes the tip panel's dihedral.

**Fuselage width.** Panels start at the fuselage sides. The section inside the fuselage is taken as flat with the root chord, and counted in the area used for loadings and stall speed, as is conventional (the fuselage carries roughly the lift of the wing it replaces). The exposed area outside the fuselage is shown separately.

**Sweep.** Λ<sub>¼</sub> is the slope of a chord-weighted straight-line fit to the quarter-chord line across the half wing, so a curved tip doesn't distort it. Sweep reduces the maximum lift a wing can reach roughly in proportion to cos Λ, the usual first-order correction, which is applied to wing C<sub>L,max</sub>. A straight-tapered wing with a straight leading edge has a slight forward quarter-chord sweep; the app only mentions sweep once it reaches 3°, since below that the effect is under 0.2%.

Dihedral can be entered per panel either as that angle or as the **rise** of the panel's outer end: how far it sits above the panel's inner end with the wing level (so for a polyhedral tip panel, measured from the break, not from the centre section). The two are related by Γ = asin(rise / l), and each entry mode shows the other as a hint. This is not the same as the "block the tip up X" figure on some plans, where the inner panel is pinned flat on the board: for a tip panel that measures the angle relative to the inner panel, so add the inner panel's angle to get Γ.

**Flat versus projected area.** Wing and cube loading use the flat (developed) area, because that's the figure normally quoted for a model and the one the cube-loading bands were drawn up against. Stall speed uses the projected area: each panel's lift acts perpendicular to the panel, so only its cos Γ component supports the weight. The difference is small for ordinary dihedral (0.4% at 5°) and becomes noticeable only with steep polyhedral tips (about 6% for a tip panel at 20°). Mean chord and area modes assume a flat wing.

**Wing C<sub>L,max</sub> factor.** A finite wing reaches a lower maximum lift coefficient than its 2D section. 0.9 is a common rule of thumb for straight, moderately tapered wings; it is a single constant (`WING_CLMAX_FACTOR`) if you want to change it.

**Clmax depends on Reynolds number, which depends on stall speed.** For sections with polars the app looks up section C<sub>l,max</sub> at the stall's own Reynolds number, interpolating linearly in log(Re) between the bundled polars (clamped at the ends of the 50k to 1M range), and iterates until stall speed and Reynolds number agree. Polars where XFOIL stopped converging at the peak are left out of the Clmax lookup, because their maximum is unreliable.

**Clmax for sections without polars.** For the UIUC sections that have coordinates only, C<sub>l,max</sub> is estimated from camber and thickness: at each bundled Reynolds number, a least-squares fit of C<sub>l,max</sub> = a + b·camber + c·thickness + d·thickness² (in % chord) across all 78 polar-backed sections, interpolated in log(Re) and iterated with stall speed as above. The fit's RMS error is 0.07 to 0.17 depending on Reynolds number (about 6–10%, so roughly 3–5% on stall speed); it is weakest for unusual high-lift sections (S1223: 2.20 from its polar, 1.94 estimated). The estimate is labelled as such. Custom sections use the same estimate from their camber and thickness.

### Units

1 oz/ft³ = 1.0012 g/dm³, so metric and imperial cube loadings are numerically almost identical. 1 oz/ft² = 3.0515 g/dm².

## Cube-loading bands

Wing loading grows with model size, so a given figure means different things on a 1 m and a 3 m model. Cube loading divides by area<sup>1.5</sup> instead, which makes it roughly size-independent: the same number feels similar in the air whatever the span. Thresholds are in oz/ft³ (≈ g/dm³) and follow the commonly used community guideline:

| Band | oz/ft³ |
| --- | --- |
| Glider / floater | below 4 |
| Trainer / park flyer | 4 to 7 |
| Sport / aerobatic | 7 to 10 |
| Sport scale | 10 to 13 |
| Warbird / scale | 13 to 16 |
| Racer / hotliner | 16 and above |

The thresholds are shown in the app under "Cube-loading bands" and live in `CUBE_BANDS` in `src/lib/calc.js`.

## Polars computed in the browser (XFOIL)

Every section gets a polar computed by [XFOIL](https://web.mit.edu/drela/Public/web/xfoil/) 6.996, running in the browser as WebAssembly ([WebXFOIL](https://github.com/PR-DC/WebXFOIL), the original Fortran compiled with flang and Emscripten). Results appear in two stages:

1. **Instantly:** the bundled airfoiltools.com polars for library sections, or the camber/thickness estimate for catalogue and custom sections.
2. **About 1 to 3 s later:** Clmax, the stall rating and the lift curve from the computed polar, labelled "from XFOIL … computed here".

XFOIL settings: 160 panels, Ncrit 9, 50 iterations per point, alpha −4° to 18° in 0.5° steps, swept out from 0° in both directions (a sweep cold-started at −4° can lose convergence and never recover). The 160 panels reproduce the airfoiltools.com polars most closely; the January 2023 XFOIL default of 240 is about three times slower and no closer. Settings are `XFOIL_SETTINGS` in `src/lib/xfoil.js`.

**Following the stall's Reynolds number.** Polars are solved on a grid of Reynolds numbers about 10% apart, so small edits reuse an earlier result. Starting from the instant answer's stall Re, the app solves there, recomputes stall speed and Re from the computed Clmax, and solves again if that lands on another grid point: usually one or two polars.

**Non-converged points** are left out, and the lift curve shows gaps there. A polar counts as usable with at least 8 converged points and either a point past the peak or every point straight after the peak failing (XFOIL losing convergence at the stall usually means the flow has separated; the rating is then low confidence). If XFOIL can't produce a usable polar, or takes more than 20 s, the instant answer stays and the app says so.

**Differences from airfoiltools.com.** For library sections the computed Clmax is compared with the bundled polars at the same Reynolds number, and a warning appears if they differ by more than 0.03; the lift curve then also shows the nearest bundled polar as a faint dashed line. They agree closely for conventional sections (NACA 2412 at Re 200k: Clmax 1.328 both). They differ for thin, highly cambered sections at low Reynolds number (E205, SD7037, S1223), where laminar separation bubbles make XFOIL sensitive to version and settings; for E205 and SD7037 an independent JavaScript port of XFOIL agrees with the WebAssembly build, so the bundled data is the outlier. Details in `docs/scope-xfoil-wasm.md`.

**Cost.** The solver is a separate 1.0 MB `.wasm` file (346 KB gzipped) plus a 44 KB worker script, loaded in a worker once the page is up. Results are kept in memory for the page's lifetime and not saved.

## Stall character

Implementation: `src/lib/stall.js`. The rating is indicative only and the app says so: it is not a substitute for flight testing.

### From a polar

The primary signal is the shape of the XFOIL lift curve: the polar computed in the browser once it's ready, or until then, for library sections, the bundled polar nearest the stall's Reynolds number.

1. **Post-stall drop**: the average lift lost per degree over the first 2° past max lift, as a fraction of C<sub>l,max</sub>.
   - under 2.5% per degree: **Gentle**
   - 2.5% to 8% per degree: **Moderate**
   - over 8% per degree: **Sharp**
2. **Pre-stall rounding** adjusts that by one step: the lift actually gained over the 3° before the peak, as a fraction of what the linear lift-curve slope predicts.
   - 0.5 or more (lift climbs almost linearly into the stall, little warning): one step sharper
   - 0.12 or less (lift flattens well before the peak, useful warning): one step gentler
3. If the polar stops at max lift (XFOIL didn't converge past it), the rating is Moderate, or Sharp if the lift curve was still nearly linear at the peak, and flagged as low confidence.

The lift curve is drawn in the app with the peak and the 2° band marked, so the rating can be checked by eye.

Thresholds were chosen by looking at all 39 bundled sections at 100k, 200k and 500k. At 200k they put well-known gentle sections (NACA 4412, 4415, 4418) in Gentle and thin sections (NACA 0009, NACA 1408, E180, E230) in Sharp, and show the expected trend with Reynolds number: at Re 50,000 most sections rate Sharp (laminar bubbles burst abruptly), at 1,000,000 most rate Gentle.

### Sections without polars: geometry heuristic

For custom sections and the coordinates-only UIUC sections, until the computed polar is ready (or if XFOIL can't produce one), the rating comes from the section shape, after Gault's (1957) correlation of stall type with the **upper-surface ordinate at 1.25% chord**. That one number captures thickness, leading-edge radius and camber near the nose together.

- under 1.6% chord: **Sharp** (thin, sharp nose)
- 1.6% to 2.1%: **Moderate**
- over 2.1%: **Gentle** (full, rounded nose)

Then, one step each:
- max camber at or forward of 20% chord: sharper (forward-cambered sections such as the NACA 230-series tend to break abruptly)
- Reynolds number at the stall below 100,000: sharper
- Reynolds number at the stall of 400,000 or more: gentler

Checked against the polar method across all 78 polar-backed sections at all five Reynolds numbers, the heuristic agrees exactly in 228 of 390 cases (58%), is one step out in 155, and two steps out in 7 (NACA 0015, 2415 and 63-3618, AG35, E474, S1223 and S8036 at low Reynolds number, which the heuristic calls Gentle and the polar calls Sharp). It is marked low confidence in the app.

**Indicative lift curve.** So the rating can still be read as a picture, sections without polars get an indicative lift curve, drawn dashed and captioned "Indicative curve, not computed data". It is linear from the zero-lift angle (computed from the section's mean line by thin-aerofoil theory, about −2.1° for NACA 2412) at the lift-curve slope averaged across the polar library at that Reynolds number, rounds over to C<sub>l,max</sub>, then falls away at a rate set by the rating (1.2%, 5% or 12% of C<sub>l,max</sub> per degree for Gentle, Moderate and Sharp, with pre-stall rounding to match). The shapes are chosen so that rating the drawn curve with the polar method returns the same rating, which the tests check.

### Custom section shape

The custom section is drawn from the NACA modified four-digit thickness form, with the leading-edge radius set directly instead of via the integer LE index, plus the standard NACA four-digit mean line. The drawing is to true proportion and shows the chord line, mean line and leading-edge circle, so the input can be sanity-checked by eye. Library sections are drawn from their real coordinates in the same view.

## Aerofoil data

Both data files are generated by `scripts/fetch-airfoils.mjs` and committed, so the app works offline and never fetches anything from the internet in the browser.

`src/data/airfoils.json` holds the 78 sections with polars: 19 NACA, 22 Eppler and 37 popular RC sections from other families (Clark Y, the Selig and Selig/Donovan S and SD series, Martin Hepperle MH, Drela AG, RG14/15, Wortmann FX 63-137, Göttingen 398 and others). For each it records:

- name, description and source URL
- thickness and camber (and their positions) as published by airfoiltools.com
- leading-edge radius and the 1.25%-chord upper ordinate, measured from the coordinates
- coordinates, decimated to about 90 points for drawing
- XFOIL lift curves (alpha and Cl from −4°) at Re 50k, 100k, 200k, 500k and 1M, Ncrit 9, each with its source URL and Reynolds number

`src/data/uiuc.json` holds every section in the UIUC Airfoil Coordinates Database (1,662; three malformed files are skipped): id, name, description from the UIUC index page, family, thickness and camber with positions, leading-edge radius and 1.25% ordinate measured from the full coordinates, and about 60 points for drawing, packed as integers. Sections are sorted into the NACA (`n…`, `naca…`), Eppler (`e` + digit) and Other tabs by their file name. Where a section also has polars it is listed once, from the polar library.

### Refreshing the data

```bash
npm run fetch-airfoils
```

Edit the `SECTIONS` list at the top of the script to add or remove polar-backed sections (use the airfoiltools.com id, e.g. `e205-il`); the family is worked out from the id. The UIUC part downloads the database's single coordinate archive and its index page, two requests in all. Responses are cached in `scripts/.cache/` (gitignored), so re-runs only fetch what's missing; delete that folder to force a full refresh.

The script makes one request at a time with a 1.5 s gap, and backs off and retries on HTTP 403 or 429. airfoiltools.com started refusing requests after about 40 in quick succession during development, so please don't lower the delay. A full uncached run is about 550 requests to airfoiltools.com and takes about 15 minutes.

### Source and terms of use

- Data comes from [airfoiltools.com](http://airfoiltools.com). Coordinates there come from the [UIUC Airfoil Coordinates Database](https://m-selig.ae.illinois.edu/ads/coord_database.html); the polars are XFOIL predictions generated by airfoiltools.com.
- airfoiltools.com does not publish terms of use. The site has a [privacy policy](http://airfoiltools.com/site/privacy) and a footer reading "Copyright © 2026 All Rights Reserved"; there is no licence for reuse of the data.
- The UIUC Airfoil Coordinates Database is publicly available, but neither its database page nor its home page states terms of use or a licence. The XFOIL polars are airfoiltools.com's own output and presumably fall under that copyright notice.
- Before publishing this app publicly, it is worth asking airfoiltools.com (via its contact page) for permission to redistribute the polar data, or regenerating the polars yourself with XFOIL from the UIUC coordinates.

## Tests

```bash
npm test
```

Covers unit conversions and formatting; wing geometry including panels, fuselage width, sweep, curved edges and dihedral or rise; wing and cube loading and the bands; stall speed, sweep correction and Reynolds number; input validation; section generation, measurement and zero-lift angle (checked against tabulated NACA 0012 and thin-aerofoil theory); the polar and geometry stall ratings and the indicative curve; the bundled data and UIUC catalogue; the Clmax estimate; undo/redo history; and XFOIL: the command script, polar parsing and comparison, real polars through the WebAssembly build (NACA 2412 at Re 200k must match the bundled polar), following the stall Reynolds number, and the worker queue (latest request wins, time limit, failures) against a fake worker. The Vue components themselves are not unit-tested; the plan editor was exercised in the running app.

## Licence

Wingcalc is licensed under the GNU General Public License, version 3 or later ([LICENSE](LICENSE)). It includes XFOIL and WebXFOIL, both GPL version 2 or later; see [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) for their source. The bundled aerofoil data has its own, unstated terms (see above).
