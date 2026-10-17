# Scope: v8 feedback, round 2 (17 October 2026)

Matt and Sam's second round of feedback on the v8 wing work (the first round is `scope-v8-feedback.md`). Same working pattern: small tasks to Haiku worker agents, in parallel where files don't overlap, each reviewed and tested before it's committed by concern. Nothing is pushed.

## Constraints

- **Leading-edge dowels and carbon tubes are done.** Don't touch the round-stock notching or fitting while working on the other leading-edge items (the "fit by area" and drawing fixes apply to profiled stock only).
- Saved projects keep working: anything added to `input` goes in `defaultState()`; the old hard-point shape migrates to the new one.

## Answers to the previous round's questions

Confirmed by Matt against the round-1 open questions.

1. Mylar tabs (25 mm roll across the hinge, 12.5 mm into each spar, tabs cut 25 mm long): **yes**, right way round.
2. Hinge spar width (13 mm to take the tabs, against 8 and 10 mm with shorter tabs): **unsure, to discuss**. Keep 13 mm for now.
3. "Horizontally mounted" against flat servos: **unsure, to discuss**. Superseded in part by "every servo can change orientation" below.
4. A new surface as deep as the TE stock, the stock itself the surface: **yes**, that's the intent. Keep, and make it a proper surface (bevels; see below).
5. Cap strips' default start: **depends on the leading-edge section**. Default to just behind the LE stock (its depth at that rib) rather than a fixed 10%.
6. The rest (control surfaces "not shown properly", shear-web grain): **answered by this feedback**. Come back if not.

## Answers to this round's questions

- **Full Hitec catalogue?** No. We have 14 models; Phoenix lists 27 (19 analogue, 8 digital), and we lack 20 of them: HS-50, HS-55, HS-65HB, HS-65MG+, HS-75BB, HS-77BB, HS-82MG, HS-85BB, HS-225BB, HS-311, HS-322HD, HS-325HB, HS-485HB, HS-625MG, HS-645MG, HS-5055MG, HS-5065MG, HS-5485HB, HS-5625MG, HS-5645MG. We carry some Phoenix doesn't (D89MW, D131MW, D141SW, D145SW, HS-5070MH, HS-7115TH). Several missing ones are standard size (HS-311, 322, 485, 645), only of use in a large wing.
- **Do hinge spars, servo trays and hard points count in the loads?** No. Bending counts the spar, the sheeting, any laminate and the stringers. Hinge spars, LE and TE stock, trays and hard-point sheeting are left out, which errs on the safe side (a stiffer section would show lower stresses). Servos count only as point masses for inertia relief. Recommendation: leave the calculation alone, and say what's counted on the chart and in `methods.md`.

## Work, in waves

Status: ☐ to do, ◐ in progress, ☑ done.

### Wave 1: general UI and quick fixes (separate files)
- ☑ Accordion: on a new project open the first section of each column; afterwards remember the last-open section per view (per browser, not saved in the project). `InspectorSection.vue` and hosts.
- ☑ Layers popover closes on losing focus or a click elsewhere. `Structure3D.vue`.
- ☑ Cap strip "starts at" only for open structure, default from the LE stock depth (answer 5). `StructureEditor.vue`, `structure.js`.
- ☑ Section editor: grid at 2% not 2.5%; reject any edit that would make the curve self-intersect (the point stops at the last valid position). `sectionSpline.js`, `SectionEditor.vue`.
- ☑ Control surface and air brake panels fit the column. `ControlSurfaceEditor.vue`, `AirBrakeEditor.vue`, CSS.
- ☑ Edge-stock dropdowns: the list may be wider than its field and overlap the view, so entries don't wrap. `EdgeStockPicker.vue`, CSS.

### Wave 2: edges and sections
- ☑ Edge profile drawings: symmetric shapes drawn symmetric (squares square, half-ellipses even); custom drawn as a rectangle; the fit drawing and the dropdown thumbnails share one outline. `edgeStock.js` (`profileOutline`, `fitDrawing`), `EdgeFit.vue`.
- ☑ Predefined (profiled) LE sections fit by area: slide the section forward from tangent to the LE until it best fills the space, so more sizes fit. Not round stock. `edgeStock.js`, tests.
- ☑ Percentage fields accept millimetres (e.g. "12 mm") and convert to % on commit. Needs a reference chord; see questions. `UnitInput.vue`, `units.js`.

### Wave 3: control surfaces
- ☑ New surfaces sit parallel to the trailing edge (constant depth in mm) until the hinge is moved by hand. `controlSurfaces.js`.
- ☐ Dimensions on the drawing are editable: click one, type, Enter. `WingPlanEditor.vue`.
- ☑ A surface that is the TE stock alone is built like any other: bevel on the hinge side, Mylar tabs, gap. `controlSurfaces.js`, `ribs.js`, `structure.js`.
- ☑ Hinge spars the full height of the rib plus capping; cap strips stop at them. `ribs.js`, `structure.js`, `wing3d.js`.
- ☐ Mylar tabs drawn in the 2D plan and the 3D view. `StructurePlan.vue`, `wing3d.js`, `Structure3D.vue`.

### Wave 4: structure
- ☐ Hard points replaced: a hard point runs from one rib to another over any number of whole bays, sheeted full chord on the top, bottom or both. Old span/chord patches migrate to the whole bays they cover. `structure.js` (`hardPatches`), `StructureEditor.vue`, `projects.js`.
- ☐ Dihedral braces: a thickness for each brace position; simpler hint. Grain rotated by half the V angle so it runs along the brace as a whole. `structure.js`, `ribs.js`, `StructureEditor.vue`.
- ☐ Servo lead holes: minimum remaining material setting, like lightening holes, so they keep clear of the spar holes. `ribs.js`, `StructureEditor.vue`.
- ☐ Gussets clipped to the rib: never across the hinge gap, a slot or a cut-out. `ribs.js`. (Probably also Sam's earlier "random gusset issues", backlog question 2.)

### Wave 5: servos
- ☑ Every servo can take every orientation (upright, side, flat), not only thin ones; the depth check decides if it fits. `servos.js`, `SurfaceStructure.vue`.
- ☑ Bay position dimensioned from the inner end of its surface. `servos.js`, `SurfaceStructure.vue`, `projects.js` (migrate).
- ☑ Add the missing Hitec models (list above), with dimensions from Hitec's drawings rather than order-of-print guesses, and the lug spans where the drawings give them.
- ◐ Better servo 3D models: Hitec's CAD where it exists, otherwise built from the dimensioned drawings on hitec.uk and hitecrcd.com (case, lugs, output boss, lead exit). Tray outlines checked against Phoenix's wing servo mounts. `wing3d.js`, `servos.js`.

### Wave 6: 3D view, layers, foam, loads chart
- ☐ No covering (film, tissue, cloth) in 3D; sheeting stays. `wing3d.js`, `Structure3D.vue`.
- ☐ More layers: each control surface its own (already per surface; check), plus hinges and tabs, servos and trays, braces, gussets. Layers that don't apply to the wing (foam or not) aren't listed.
- ☐ Layers menu in the 2D structure plan, sharing the 3D layer list. `StructurePlan.vue`.
- ☐ Foam wings: the home page's structure card (plan and 3D thumbnails) shows the cores, skins and caps, not ribs and spars. `thumbnails.js`.
- ☑ Loads chart: expand to a larger view; a hover crosshair that reads every series at that span position. Note on the chart what the bending counts. `LoadsChart.vue`, `methods.md`.

### Docs
- ☐ User guide and methods updated as each wave lands (hard points, servo orientations and positions, edge fitting by area, what the loads count).

## Notes on what was done

- Haiku workers ran out of context on most tasks (the big files); from wave 3 the code was done in the main session, Haiku kept for research and small isolated edits.
- Bevels: every surface is bevelled to at least its throws (the exact-clearance rule gave a thin stock surface none).
- Edge stock set forward of the nose only when it doesn't fit at the nose; Auto still prefers stock that fits at the nose. Custom stock never moves.
- Hitec: fifteen models added; HS-50, HS-82MG and HS-325HB not found. Servo 3D models not improved yet: no dimensioned drawings were reached.

## Recommendations

- **Traceable cursors:** one crosshair with a readout of every series is enough; separate draggable cursors are more UI than the chart needs. Suggest building the crosshair and stopping there.
- **Layers in 2D:** worth it, but only once the 3D layer list is sorted, so both views share one definition.

## Decisions taken

- **Millimetres in a % field** convert against the root chord for wing-wide settings (D-box depth, cap start) and the local chord for a setting at one station (a hinge end, an air brake, a panel's outer thickness); the line under the box says which.
- **Hard points** run over any number of whole bays, rib to rib, sheeted top, bottom or both across the full chord (LE stock to TE stock, or to the fixed hinge spar where there's a surface).
- **No covering in 3D**: film, tissue and cloth are never drawn. Sheeting is structure and stays, on its own layer.
- **Servo models**: Hitec's CAD where it can be found; otherwise built from the dimensioned drawings on hitec.uk and hitecrcd.com.

## Still to discuss

- Hinge spar width and Mylar tab length (answer 2).
- Horizontally mounted against flat servos (answer 3).
