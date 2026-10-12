# Wingcalc v7 — scope

Seventh round: small tweaks after v6, mostly the structure editor, export and the page header. Source of truth for this round. Worked autonomously, then follow-ups interactively. Closed.

## Objective

Tidy the rough edges Matt listed on 2026-10-12, plus the two extras agreed (3D caption into tooltips, Export as the editor's primary action).

## Decisions

- **Structure card thumbnails**: a static SVG of the plan and an isometric SVG wireframe (ribs, spar, edges) from `wing3d.js` arrays. No three.js on the main page. Clicking one opens the structure editor with that view expanded.
- **3D section**: Section is an on/off button; when on, a bar along the bottom of the view: a track the length of the span with a tick per rib, a handle (kept off the ribs), readout "N mm, R3–R4", Flip, Look at the cut, ×. Replaces the popover (checkbox, bay select, slider).
- **Projection**: orthographic by default; one icon button under Home beside the cube.
- **Edges in 3D**: crease lines (30°) on every solid, not the skin; a layer toggle "Outlines". The old "Edges" layer becomes "Leading/Trailing edges" (or "LE/TE stock" if it won't fit).
- **No tool rail**: structure plan always selects; double-click adds a rib; "Add rib" in the command bar when nothing is selected. Wing editor: Measure as a toggle top left; Add panel in the command bar.
- **Header**: File menu (New, saved projects with delete, Save as copy, Export file, Import file), name, Save, undo/redo on the left; Units and theme on the right.
- **Units**: a Units popover replaces the Metric/Imperial toggle: system, then length (mm/m or in/ft), mass (g/kg or oz/lb), speed. Saved with the project. Fields show a fixed unit label, no per-field dropdowns. Area and loading follow the length/mass choice.
- **Labels**: Hershey Simplex replaces the home-made stroke font. DXF text option removed (vector lines only). Parts too small for a legible label get it engraved in the waste beside them.
- **Engrave** replaces "Etch" in UI copy and the default layer name (`ENGRAVE`). Saved projects keep their own layer names.
- **Export**: lightening holes and jig tabs leave the export dialogue (structure editor only), with a one-line summary. Fix the preview's empty space (a later 60vh cap overrode the wide layout's flex fill). Export… becomes the primary button at the end of the editor header.

## Steps

1. [x] Export dialogue: CSS fix (the 60vh cap came after the wide layout's flex fill), rib details out (a one-line note instead), DXF text option removed. The lightening-holes bug was hand-placed ribs (kind `manual`) being skipped by checks for `normal`; also fixed for perpendicular orientation and end-only gussets (`isPlainRib`).
2. [x] Engrave rename (UI, default layer name `ENGRAVE`, docs). The data key stays `etch` so saved names carry over.
3. [x] Hershey Sans 1-stroke from `hersheytext` (dev dependency) via `npm run build-stroke-font` into `src/data/strokeFont.json`; glyphs spaced by ink width plus a gap, digits in fixed cells, narrow glyphs in a least cell.
4. [x] Labels: on the part if a 2 mm+ label fits its shape (checked against outline and holes), else engraved 1 mm below it in the waste.
5. [x] Header: File menu (New project, Save as copy, Open list, Export/Import to file), name, Save, undo/redo left; Units and theme right. Menus close on outside click or Esc (`useMenuDismiss`).
6. [x] Units: `{ system, length, mass, speed }` saved with the project (`normaliseUnits` migrates the old system string); areas follow length, wing loading follows mass. `UnitsMenu.vue`; `UnitInput` shows a fixed unit.
7. [x] 3D: orthographic default, projection icon under Home; outlines (30° creases) on every solid with a layer toggle; "Leading/Trailing edges" fits; section bar (native range over a tick track, cut kept off ribs, bay readout, Flip, Look at cut, ×); caption trimmed, hints in tooltips.
8. [x] Tool rails removed (`ToolRail.vue` deleted). Structure plan: double-click or Add rib (longest bay, or A). Wing editor: Measure toggle top left, Add panel in the command bar when nothing is selected.
9. [x] Card thumbnails (`src/lib/thumbnails.js`): plan from `planEntities`, wireframe from `ribPlacement` (factored out of `wing3d`) in a root/back three-quarter view, so both read root left, tip right, LE at the top. Plain figures, not links (the card's button opens the editor). three.js stays a lazy chunk.
10. [x] Export… is the structure editor's primary action beside undo/redo; Done goes plain there (`quietDone`).
11. [x] Docs: user guide, methods, CLAUDE.md conventions.
12. [x] Trailing-edge gussets: placement per edge (`teLayer`, null follows `layer`); `gussetFit` in wing3d.js measures the room over each gusset's triangle; placements without room are disabled, and a warning names the ribs where the chosen one doesn't fit.

## Follow-ups (checked by Matt)

- Wireframe thumbnail drawn in millimetres (metres rounded to 0.01 gave a 10 mm staircase); root/back three-quarter view, shared with the 3D view's home (`HOME_VIEW` in wing3d.js). Thumbnails are plain figures, not links.
- View cube top and bottom: square up to the front or back, whichever the camera is on (`faceView`); swings move in heading and elevation (`orbitLerp`), so they never cross the pole and flip.
- Home, − / + and Fit ease (`moveTo`). Fit uses the covering's outline as seen from the camera, 5% margin, not the bounding box. The view opens fitted in orthographic (it used to be framed for perspective, then converted).
- Expanding the plan or 3D card eases its height; an untouched 3D view refits as it grows, a moved one keeps its scale.

## Notes

- Verified by tests (273) and by driving the running app for errors; the visual result of each item is for Matt to check.

## Closed

- Round complete and checked by Matt (2026-10-12).
- Left open: multi-element aerofoils (such as 30P-30N) give nonsense ribs; offered as a separate task.
