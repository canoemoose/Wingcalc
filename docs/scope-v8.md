# Wingcalc v8: the wing, finished — scope

First of three bodies of work towards designing a whole model:

1. **v8, the wing, finished** (this file): everything that works on one wing.
2. **v9, the rest of the plane** (`docs/scope-v9.md`): tail, foreplane, fins, fuselage, layout, stability.
3. **v10, make it fly** (`docs/scope-v10.md`): power, electronics, mass and CG, flight loads, performance.

Each body depends only on the ones before it, and each ends with something usable. Draft, not started.

## Objective

Fix and round off the structure editor from Sam's feedback (2026-10-16). Then add what a finished wing needs: control surfaces with their hinges and servo bays, foam-core construction, and a drawn section editor. The tail surfaces in v9 reuse the control-surface and servo work unchanged.

## Decisions

- **Control surfaces**: ailerons and flaps, either as separate surfaces or mixed (flaperons). **Crow** braking only when ailerons and flaps are separate surfaces.
- **Air brakes**: lattice brakes or pop-up spoilers, as physical parts.
- **Hinges**: the default is a bevelled hinge line with Mylar tabs slotted at the centre line.
- **Servo bays are modelled; pushrods are not.** Servo positions count in the wing's weight (see the assumptions below).
- **Foam-core wings** with obechi or balsa skins, alongside built-up construction.
- **Custom sections** get an "Advanced" mode: a 2D CAD-like section editor.

### Assumptions (to confirm)

- Servo and bay mass adds to the wing's estimated weight. The servos' position along the span also relieves spar bending (inertia relief), so it counts in the structure check too.
- "Lattice" air brakes are Schempp-Hirth style: lattice or slotted blades that rise vertically out of a box in the wing. Pop-up spoilers are a hinged plate on the top surface.

## Part A: fixes and tweaks (about ½ round)

1. **Sam's three reports**: manual rib spacing, gussets, and ribs clashing with the TE. Each one waits on his answers (`docs/backlog.md`, Questions for Sam).
2. **Leading-edge types**: carbon rod, dowel and none (a sheeted nose), alongside balsa stock. Round stock sits in a notch or hole in each rib. Add fit, weight and cut list for each type.
   - [x] Done. `le.type` ('balsa' default, so older saves are unchanged; 'rod', 'dowel', 'none') and `le.diameter` in `defaultStructure()`. Round stock forms the nose and sits in a half-round notch at the front of each rib (notch only, no hole option), ribs stopping at its centre line; it fits if its rear half is inside the section at every rib, with the nose taken as rounded ahead of 2% chord (the coordinate polyline makes a wedge nose that no circle fits). Sizes: carbon rod 1.5–8 mm in 1 m lengths, hardwood dowel 3–10 mm in 915 mm lengths (new materials `carbon-rod`, `hardwood` at 700 kg/m³). 'none' runs the ribs to the nose and warns on an open wing. LE corner gussets only against balsa stock.
3. **Edge-stock messages**: rewrite "… is too small to carve to the section: about N mm short" (`structure.js`) in a builder's terms, and show the shortfall on the section drawing.
   - [x] Done. The warning now names the edge, the stock, where it's worst (root rib, a panel end or the tip rib), what goes wrong when carved and what to use instead. The editor's "Leading and trailing edges" section draws the fit where it's worst whenever it doesn't fit (`EdgeFit.vue`, geometry from `fitDrawing` in `edgeStock.js`), red where the stock falls short or a rod stands proud. There was no section drawing in the structure editor to add it to, so it's a new small figure there rather than an overlay on `SectionView`/`PartPreview`. The thin-at-the-TE warning and rib note lost their "TE"/"cut" jargon too.
4. **Margin chart legend**: the "Lowest margin of safety" panel in `LoadsChart.vue` draws one line per failure mode with no labels.
   - [x] Done. In fact it drew a single lowest-margin line; it now draws one line per mode (colour fixed per mode, categorical palette validated with the dataviz checker, light and dark steps as `--wc-series-*`), a legend below with each mode's lowest margin, the governing one heavier, and a native tooltip per line.
5. **Coverings**: make the covering an explicit, visible choice rather than an unstated assumption of film over open bays. Options: heat-shrink film (light and heavy), fabric film, tissue and dope, and glass and epoxy over sheeting. Each has a weight per area, and stiffness where it counts (torsion in a D-box or sheeted wing). The editor says what the check assumes, and the methods doc says how covering enters the sums.
   - [x] Done. `covering.finish` (default 'film', heat-shrink film at 90 g/m²; older saves migrate to it): margins on every existing test and the default wing are unchanged, only the weight estimate grows (by about 55 g on the default wing, which stays inside the existing plausibility test). Glass and epoxy counts in bending and sheet buckling (as a laminate on the sheeting); torsion isn't checked, so it gets no torsion credit. Per-area figures are typical published ones taken at the heavy end, not measured: worth Sam's eye. Covering doesn't yet change the "most the ribs may be apart" default (75 mm, set for film); tissue might want closer.

## Part B: wing features (about 3–3½ rounds)

6. **Control surfaces and hinges** (1 round). Per panel: the hinge line as a chord fraction (it may taper) over a span range. Each surface has a role (aileron, flap, flaperon) and a deflection range. Rib split at the hinge; hinge spars on both sides with a centre slot for the Mylar tabs; bevel angle from the maximum deflection; the gap. Tab count and spacing along the hinge, and tabs in the cut list. Separate parts for each moving surface, in the plan, 3D and DXF. XFOIL's flap deflection gives CLmax and stall speed with flap and crow. The mechanism doesn't know which surface it's on, so v9's elevators, rudders, elevons and ruddervators use it unchanged.
   - [x] Done, all but the XFOIL flap deflection (below). `input.controls = { surfaces, crow }` (`defaultControls()`; older saves get none). A surface is `{ id, role, panel (id), from, to (m from the panel's inner end), hingeIn, hingeOut (chord fractions), up, down (°), gap }`. **One panel per surface**, not a free span range: a hinge has to be straight, and across a dihedral break or a kink in the edges it can't be; panel-relative ends also follow the panel when inboard panels change. Placement, bevel, tabs and crow are in `src/lib/controlSurfaces.js`, generic over a `wingSampler`, so v9 can reuse it; the built-up hinge is `surfaceLayouts` in `structure.js`, and parts in `ribs.js`.
     - Hinge: fixed hinge spar (default 8 mm, square) ahead of the gap, moving hinge spar (10 mm) behind it bevelled to a point at the centre line; both slotted for Mylar tabs (12 × 15 mm, 0.2 mm, at most 75 mm apart, end ones 20 mm in). Bevel from the throws and gap, exact geometry about the mid-gap, no extra allowance (worth Sam's eye: builders often just bevel to the full throw). Defaults on adding: 75% chord hinge, aileron 20° up / 15° down, flap 5° / 45°, flaperon 20° / 30°, 1 mm gap.
     - Ends: a full rib (hard point) at each end; the moving surface stops a gap short with its own end ribs. Ribs between are split (`split` on the fixed part, group `surfaces` for the moving parts, named A1-1 …). Tabs are part H1 (group `hinges`, Mylar); both hinge spars are cut list strips with bevel and slot notes. All weighed; the hinge spars don't count in bending, and hinge moments aren't checked.
     - Shown in the plan editor (add from the command bar on the selected panel, select, Delete), inspector (`ControlSurfaceEditor.vue`, in the inputs column and the wing editor), structure plan, 3D (own layer; trailing edge broken at each surface), parts and plan DXF (HINGE layer), cut list and thumbnails. Crow: a flag with aileron-up and flap-down settings, available only with separate ailerons and flaps and no flaperons.
     - Deferred: XFOIL flap deflection for CLmax and stall speed with flap and crow (step 6's last sentence; needs a flapped polar per deflection); dragging hinge ends in the plan; sheeting templates on a fully sheeted wing aren't split at the hinge; the trailing edge stock's cut-list length isn't split at the surfaces' ends; surfaces aren't drawn deflected in 3D; hinge moments and servo sizing (step 8).
7. **Air brakes** (½ round). Lattice blade brakes in a box between ribs, and pop-up spoilers as a hinged top-surface plate. Placement along the span, a cut-out in the sheeting, a box or mounts, and parts. Their drag is used later, in the performance work in v9 and v10.
8. **Servo bays** (½ round). A servo catalogue by class (sub-micro, micro, mini, standard), with case size, mounting-lug size, mass and torque. A bay sits between ribs (a hard point at each end), with a mount plate or rails, a hatch in the sheeting and a lead route through the ribs. One bay per control surface or air brake by default. Servo mass goes into the wing weight and the spar loads. Optional: compare the servo's torque with the hinge moment.
9. **Foam-core construction** (1 round). A wing construction type alongside built-up. Foam (EPS and XPS densities), obechi or balsa veneer skins, spar caps under the skins (carbon or spruce), and hardwood or balsa leading and trailing edges. Structure check as a sandwich: the skins and caps carry bending, plus skin buckling. Exports: hot-wire templates per panel (root and tip, kerf allowance, lead-in, alignment marks), a skin cut list, and pockets for servos and brakes. Control surfaces are cut from the core at the hinge line (step 6).
10. **Section editor** (½–1 round). "Advanced" on a custom section opens a 2D editor in the house style (`StageZoom`, command bar, no tool rail). It edits spline control points on the upper and lower surfaces, starting from any section. Readouts for thickness, camber and leading-edge radius, plus a curvature check. XFOIL runs on the result as for any other section. The drawn section is saved with the project.

Total: about 4 rounds.

## Open questions

- Confirm the two assumptions above (servo mass in the spar loads, and what "lattice" means).
- Hinge types besides the slotted Mylar default (pinned, live sheeted hinges): add them in v8, or leave them for later?
- Foam cores: is a hot-wire template DXF enough, or do CNC hot-wire cutters (G-code, four-axis) matter?
