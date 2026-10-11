# Wingcalc

A wing loading calculator for RC fixed-wing aircraft with spans of 600 mm to 3 m. Enter the all-up weight, the wing geometry and an aerofoil, and it reports:

- **Wing cube loading** with a verdict band (the headline figure)
- **Stall speed**, side by side with the verdict
- **Wing loading**, area, mean aerodynamic chord, aspect ratio and the Reynolds number at the stall
- **Stall character** of the wing: Gentle, Moderate or Sharp, with where along the span it stalls first
- **Structure and ribs** for a built-up wing: spar, covering and rib spacing checked against a design load, with ribs, gussets, braces and webs exported as DXF for a laser or router

Every input and output works in metric or imperial, with a global toggle and per-field unit choice. Numeric boxes accept sums (`700 - 20`, `(120 + 80) / 2`) and numbers with their own units (`24in + 50mm` in a millimetre box); commas are thousands separators. An unfinished sum leaves the last good value in place, and the result shows under the box while you type.

The wing can be drawn in a CAD-style **wing plan editor** or entered numerically: fuselage width, root chord, then one or more panels per side, each with its own length, outer chord, sweep, dihedral, and straight edges, Bézier curves or chords dimensioned at stations, plus an optional rounded wingtip. That covers straight, tapered, cranked, swept, elliptical, dihedral and polyhedral wings. The editor also has a measure tool for dimensions.

Projects can be saved in the browser, and the work in progress is kept automatically. Mean chord or area can be entered instead for a quick check.

Aerofoils come from a browsable catalogue of the whole UIUC Airfoil Coordinates Database (about 1,660 sections) in NACA, Eppler and Other tabs, with 78 popular sections backed by XFOIL polar data. A custom section can also be defined by its parameters.

Built with Vue 3 (plain JavaScript) and Vite.

## Setup

Node is pinned with Volta (see `package.json`).

```bash
npm install
npm run dev
```

The dev server serves the standalone page at `/` and an embedding demo at `/embed-demo.html`.

| Command | What it does |
| --- | --- |
| `npm run dev` | Development server |
| `npm test` | Run the unit tests (Vitest) |
| `npm run build` | Standalone page into `dist/` (relative paths, host anywhere) |
| `npm run build:embed` | Embeddable widget into `dist-embed/` |
| `npm run fetch-airfoils` | Refresh the bundled aerofoil data |

## Embedding

`npm run build:embed` produces a single self-contained script (Vue, styles and all aerofoil data included; about 1.7 MB, 530 KB gzipped) that registers a `<wing-calc>` custom element:

```html
<script src="wingcalc.js"></script>
<wing-calc units="imperial" theme="light"></wing-calc>
```

- `units`: `metric` (default) or `imperial`
- `theme`: `auto` (default, follows the OS light/dark setting) or `light`

The widget renders in a shadow root, so host page styles don't reach it and its styles don't leak out. Its layout responds to its own width (container queries), not the viewport, so it works in a narrow sidebar as well as full width. `wingcalc.mjs` is the ES-module version of the same thing; it loads the UIUC catalogue as a second file (`uiuc-*.js`) on demand, so copy both. In the standalone build the catalogue is likewise a separate chunk, loaded after first paint.

To use the Vue component directly inside another Vue app instead, import `src/WingCalc.vue` and `src/styles/wingcalc.css`.

## Projects

The bar at the top holds the project name and its controls, then the units and theme toggles.

- **Save** stores the project in this browser (localStorage) under its name; saving again updates it. A dot in the name box means there are unsaved changes.
- **New** starts a fresh project (asking first if there are unsaved changes).
- **Open** lists saved projects, newest first, with **Save as copy**, **Export file** and **Import file** underneath. Delete a saved project with its ×.
- **Auto / Light / Dark** sets the colour theme. Auto follows the system setting. The choice is remembered in this browser for whoever is using it; it isn't part of a project.
- The work in progress also **autosaves** and comes back on reload, saved or not.
- **Export file** downloads the project as a `.wingcalc.json` file; **Import file** opens one. Use these to back up or move projects between browsers, since localStorage belongs to one browser on one machine and is lost if site data is cleared.

A project holds the units, weight, wing shape (including stations, tip, washout, thickness taper and dimensions), the aerofoil choice, the structure and the export options. Files carry a format version, and anything missing from an older file is filled from the defaults. If the browser blocks storage, saving is disabled with a note and Export still works. On a page embedding more than one `<wing-calc>`, the instances share the same saved projects and autosave.

## Wing plan editor

In "Chords & panels" mode the results column shows the wing plan: one half of the wing, drawn flat (as built), with the other half ghosted.

**Open wing editor** expands it to fill the browser window: the plan takes most of the space, the wing and panel settings sit on the left (tabs switch between panels), and a strip along the top keeps span, area, aspect ratio, cube loading and stall speed in view as you edit. Done or Esc returns to the page. It works the same way when the calculator is embedded.

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

## Structure, ribs and export

In "Chords & panels" mode a **Structure and ribs** card sums up the built-up structure: spar, covering, rib count and spacing, the lowest margin of safety at the design load, the root bending moment and an estimate of the bare structure's weight. **Open structure editor** fills the window: settings on the left; the plan with every rib, the loads along the span and a preview of any part on the right. **Plan / 3D** switches the plan for a 3D view of the built-up half wing (`src/lib/wing3d.js` makes the geometry, three.js draws it): see-through skin, ribs at their thickness, spar, webs, edge stock and stringers, with twist and dihedral true to scale. Drag to turn, right-drag to move, scroll to zoom; tick **Both halves** for the whole wing, untick layers to see inside, click a rib to select it. three.js loads only when the 3D view is first opened (about 190 KB gzipped). **Export…** in its top strip opens the export options.

### What you set

- **Design loads**: load factor (6 g sport, 10 g or more for aerobatics or hard launches), a negative load factor, and a safety factor (1.5 by default) applied on top.
- **Spar**: caps and shear web, box (webs both faces), carbon tube, or a single solid spar (through a slot, or notched into the top or bottom of each rib). Its position is a chord fraction held at every panel end and straight across each panel; blank puts it at the section's thickest point. A tube can stop short of the tip.
- **Covering**: open (film covered, optional cap strips on each rib), D-box (sheeted from the leading edge back to the spar, cap strips behind it) or fully sheeted. The ribs are inset by whatever covers them.
- **Leading and trailing edges**: the depth of the stock along the chord, which the ribs are cut back by; triangular or flat trailing edge.
- **Stringers**: any number, by chord position, on the top, bottom or both surfaces. Each is notched into every rib and counted in bending; a top stringer just behind the leading edge doubles as a turbulator spar.
- **Ribs**: material and thickness; streamwise or square to the spar (the root, panel-break and tip ribs always stay streamwise so the panels and fuselage meet cleanly); one-piece wing (a centre rib shared by both halves) or two halves plugging in at the fuselage side. Spacing is **from loads** (as close as the structure needs, never wider than a maximum set for the covering), **even**, **tapered** from root to tip, or **manual**. **Hard points** add ribs at set distances (servo bays, aileron ends). Optional **lightening holes** (not in the root, break or tip ribs) and **jig tabs**.
- **Corner gussets** where ribs meet the leading or trailing edge, on the root, break and tip ribs or on every rib, one side or both. Each is cut to the actual angle between rib and edge.
- **Dihedral braces**: ply plates on both faces of the spar at every dihedral break, folded to the angle. Left blank, the thickness is the next standard ply thickness above what the bending at the break needs.

**Washout and thickness taper** are set per panel in the wing's own fields: washout is the total twist at a panel's outer end relative to the root (nose down), varying evenly across the panel; thickness is the section thickness at the outer end, blank to keep the inner end's. Only the thickness is scaled; the camber line stays the aerofoil's own. The section drawing shows the tip section dashed over the root.

### Loads and margins (Stage A)

Implementation: `src/lib/structure.js`. A first-order sizing check, and the app says so.

- **Load**: the lifting line's spanwise lift distribution at the stall (the design point at manoeuvring speed, where full load factor is reached at maximum lift), scaled so the half wing carries n × weight / 2. Negative g uses the distribution at the matching negative lift. The wing's own weight is ignored, which errs on the safe side.
- **Shear and bending** come from integrating that load inward from the tip.
- **Section**: modulus-weighted, so a D-box or fully sheeted wing's sheeting shares the bending with the spar (it typically carries more than half), and stringers count too. Stresses come from M·E·z / EI at each element's extreme fibre.
- **Margins of safety**, allowable ÷ (stress × safety factor) − 1, so 0 is just enough:
  - spar in compression and in tension (positive and negative g);
  - sheeting crushing;
  - shear web in shear (the D-box's own shear path is ignored, on the safe side);
  - shear web buckling between ribs (orthotropic balsa approximated with an effective modulus √(E<sub>L</sub>·E<sub>T</sub>), E<sub>T</sub> ≈ 5% E<sub>L</sub>);
  - **buckling between ribs**: in an open structure the compressed spar cap buckling sideways (Euler, pinned at each rib); in a sheeted one each sheet panel between its supports (leading edge stock, stringers, spar) buckling as a simply supported plate, σ<sub>cr</sub> = k π² E / 12(1 − ν²) · (t / b)², with k minimised over the number of half-waves for the panel's length between ribs.
- **Rib spacing from loads**: the buckling checks give the largest spacing allowed at each station. Each interval between hard points (root, fuselage side, panel breaks, tip, your hard points) gets the fewest bays that keep every bay within that limit along its whole length, never wider than the covering maximum. They're spaced out from the root taking the largest bay allowed each time, then evened out so there's no stub of a bay at the end.
- **Materials** are typical values along the grain, on the conservative side: three grades of balsa, spruce, basswood, birch and lite ply, pultruded carbon strip and carbon tube. Balsa varies two to three times from sheet to sheet, so weigh your wood and pick the grade it matches.

**Not covered**: torsion, flutter and divergence, glue joints, the wing joiner of a two-piece wing (the root bending moment is shown for sizing it), and local loads at fittings.

### Ribs and parts

Implementation: `src/lib/ribs.js`. Each rib is the wing cut along the rib's line through the lofted wing (each point along it takes the chord, thickness and twist of the streamwise section it crosses), so streamwise and square-to-spar ribs come from the same code. A rib square to a swept spar comes out shorter than the streamwise chord, by about cos Λ, at much the same depth. Then:

- inset for the covering, measured square to the surface;
- cut back square for the leading and trailing edge stock;
- notched for the spar caps (or holed for a tube, slotted or notched for a solid spar) and for each stringer;
- **washout** built in by rotating each section about the spar line, trailing edge up;
- **jig tabs** on every rib in a panel reach down to one flat line (below the lowest rib by the least tab height you set), so the panel builds on a flat board with its washout in; the line where each tab is cut off is etched;
- **lightening holes**: the largest circles that fit ahead of and behind the spar, leaving the margin you set around each and clear of notches;
- the rib's name (R1 from the root outward), etched in its deepest clear spot.

Ribs at dihedral breaks note their cant, half the change in dihedral. The same module makes the corner gussets (grouped by angle), dihedral braces (sized from the bending moment at the break; the fold line is etched), shear webs (one per bay, two for a box spar), approximate developed sheeting templates per panel and surface, and a plan template for a rounded tip's block. It also writes a cut list of strip stock (caps, leading and trailing edges, stringers, cap strips, tube), and estimates the structure's weight from every part's area or length and density, plus 10% for glue, without the covering.

### Export

Implementation: `src/lib/dxf.js`. Three downloads:

- **Parts (DXF)**: every part laid out flat in rows no longer than the sheet length you set, grouped by stock (material and thickness), each group titled. Grain runs left to right along the sheet; shear webs are turned so theirs runs up the web. One copy per piece needed, or one of each.
- **Plan (DXF)**: full size, to build over: the wing outline, leading and trailing edge stock, spar, stringers and every rib at its true thickness, with rib names. Right half, left half (mirrored) or both.
- **Cut list (CSV)**: every part with quantity, stock and size, and every length of strip.

The DXF is AutoCAD R12 (AC1009) in millimetres, which nearly all laser, router and CAD software reads, as closed polylines or (for older software) separate lines. Layers are cut (red), etch (blue) and notes (grey), with names you can change. Labels are single-stroke vector lines by default, so they etch the same everywhere; DXF text is an option.

- **Laser**: every cut moves half the kerf into the waste, so parts come out true size (set the kerf to 0 if your laser software compensates).
- **CNC router**: dogbones in every inside corner (a round cutter can't cut a square inside corner, and spar caps need one), and optionally the cutter-radius offset if your CAM doesn't apply it. Corners too tight for the cutter are listed.

Export options are saved with the project, so a re-export comes out the same.

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
| Wing C<sub>L,max</sub> | Panels: from the lifting line (below) × cos Λ<sub>¼</sub>. Mean chord or area: 0.9 × cos Λ<sub>¼</sub> × section C<sub>l,max</sub> |
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

**Wing C<sub>L,max</sub> from the lifting line.** In panel mode the wing's maximum lift comes from its spanwise lift distribution (`src/lib/liftingLine.js`): Prandtl's lifting-line theory, solved by Glauert's Fourier series with 24 odd terms (symmetric loading) collocated between root and tip on the projected span. Each station has its own chord, twist, section lift-curve slope (the polar library's mean at its own Reynolds number) and section C<sub>l,max</sub> (at its own Reynolds number and, with a thickness taper, adjusted by the change the library fit predicts for its thickness at the same camber). The solution is linear in angle of attack, so it is solved once for unit angle and once for the twist alone, and the wing stalls at the angle where the first station reaches its own C<sub>l,max</sub>; C<sub>L,max</sub> is the wing's lift there, and that station is where the stall starts. Sweep isn't modelled by the lifting line, so the usual cos Λ<sub>¼</sub> correction is applied afterwards. It is checked in the tests against the closed-form elliptic wing (C<sub>L,α</sub> = a₀ / (1 + a₀ / π AR), uniform lift) and the published rectangular-wing result (Glauert's τ ≈ 0.17 at AR 6). For the default 1.4 m wing it agrees with the old rule of thumb to within 3%.

**Wing C<sub>L,max</sub> factor.** In mean chord and area modes there's no planform to work from, so a finite wing is taken to reach 0.9 of its section's maximum lift, a common rule of thumb for straight, moderately tapered wings (`WING_CLMAX_FACTOR`).

**Clmax depends on Reynolds number, which depends on stall speed.** For sections with polars the app looks up section C<sub>l,max</sub> at the stall's own Reynolds number, interpolating linearly in log(Re) between the bundled polars (clamped at the ends of the 50k to 1M range), and iterates until stall speed and Reynolds number agree. Polars where XFOIL stopped converging at the peak are left out of the Clmax lookup, because their maximum is unreliable.

**Clmax for sections without polars.** For the UIUC sections that have coordinates only, C<sub>l,max</sub> is estimated from camber and thickness: at each bundled Reynolds number, a least-squares fit of C<sub>l,max</sub> = a + b·camber + c·thickness + d·thickness² (in % chord) across all 78 polar-backed sections, interpolated in log(Re) and iterated with stall speed as above. The fit's RMS error is 0.07 to 0.17 depending on Reynolds number (about 6–10%, so roughly 3–5% on stall speed); it is weakest for unusual high-lift sections (S1223: 2.20 from its polar, 1.94 estimated). The estimate is labelled as such, and a known C<sub>l,max</sub> can be entered to override it.

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

## Stall character

Implementation: `src/lib/stall.js`. The rating is indicative only and the app says so: it is not a substitute for flight testing.

The section's own character is rated as below. In panel mode the wing's is then adjusted by **where it stalls first** along the span, from the lifting line: past 60% of the semi-span the stall starts where the ailerons are, which drops a wing and costs roll control when it's most needed, so the rating goes one step sharper (the app says the section alone rates otherwise). Inside 40% it's described as the benign inboard stall. A chart shows each station's local C<sub>l</sub> at the stall against the C<sub>l,max</sub> its own section can reach, so the effect of taper, washout and a thinner tip can be seen directly.

### Library sections: from the polar

The primary signal is the shape of the XFOIL lift curve, taken from the bundled polar nearest the stall's Reynolds number.

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

For custom sections and the coordinates-only UIUC sections, the rating comes from the section shape, after Gault's (1957) correlation of stall type with the **upper-surface ordinate at 1.25% chord**. That one number captures thickness, leading-edge radius and camber near the nose together.

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

Covers the 3D geometry (every rib, placed in 3D, lands exactly where the lofted wing has that point, streamwise or square to the spar, with twist and dihedral); the lifting line (against the elliptic closed form and the rectangular-wing result) and the wing stall built on it; washout and thickness taper; Stage A loads (against textbook shear and bending), plate buckling, rib spacing and the structure analysis; rib and part geometry (notch sizes, jig tab datum, twist, the c·cos Λ length of a rib square to a swept spar, holes inside outlines, no self-intersecting outlines); the DXF writer (read back to check layers, sizes, kerf, dogbones and the plan); migration of saved structure settings; a server-side render of the whole app that fails on any error or Vue warning; unit conversions and formatting; wing geometry including panels, fuselage width, sweep, curved edges and dihedral or rise; wing and cube loading and the bands; stall speed, sweep correction and Reynolds number; input validation; section generation, measurement and zero-lift angle (checked against tabulated NACA 0012 and thin-aerofoil theory); the polar and geometry stall ratings and the indicative curve; the bundled data and UIUC catalogue; the Clmax estimate; and undo/redo history. The Vue components themselves are not unit-tested beyond that render; the plan editor, structure editor and export panel were exercised in the running app.
