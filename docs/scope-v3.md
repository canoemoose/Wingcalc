# Wingcalc v3 — scope

Source of truth for the third round. Update as items land.

## Objective

1. Save and open projects (localStorage for now).
2. Define a panel's shape by dimensioned chords at stations along it, as an alternative to straight edges or Bézier curves.
3. Curved wingtips.
4. Measure / dimension tool in the plan editor.
5. Auto-fit the plan view when the wing is changed from the inputs column.

## Decisions (assumed; flag in hand-over)

- **Projects**: named projects in localStorage (`wingcalc.projects.v1`), each holding units, all inputs, the wing shape, dimensions and the aerofoil selection, with a format version for later migration. The working state also autosaves (`wingcalc.autosave.v1`) and is restored on reload, so nothing is lost between saves. Export/import as a `.json` file as a backup route, since localStorage is per browser and easily cleared. Every storage access wrapped in try/catch; the app works without it.
- **Chord stations**: a panel's edges are straight, Bézier curves (existing), or **stations**. A station is { distance from the panel's inner end (flat), chord, leading-edge set-back from the panel's inner leading edge }. LE and TE run through the stations and the panel ends by monotone cubic (PCHIP) interpolation: smooth, and never overshoots between stations. New stations are placed on the current shape so adding one doesn't change it.
- **Curved tips**: an optional cap beyond the outermost panel, set by its extension (spanwise) and the chordwise position of its farthest point. Built from two quarter-ellipses, so it meets the leading and trailing edges tangentially. Area (π/4)·e·c, exact in tests. It takes the tip panel's dihedral.
- **Dimensions**: persistent, stored with the project and in undo history. Measure mode: click-drag between points, snapping to wing key points (panel corners, stations, tip, root, fuselage) within 10 px, else the grid. Endpoints snapped to key points are associative (they follow the wing). Shift constrains to a spanwise or chordwise dimension. Readout shows length, Δspan, Δchord and angle. Select and Delete to remove; "Clear dimensions" removes all.
- **Auto-fit**: the plan re-fits when the wing changes from outside the editor (inputs column, undo/redo, opening a project), not during its own drags, so the view doesn't jump while you work.

## Steps

1. [x] wing.js: edge functions with stations (PCHIP), tip cap, key points; tests
2. [x] projects.js storage + tests
3. [x] PanelEditor: edge mode, stations table, tip section
4. [x] Plan editor: stations, tip handle, measure tool, auto-fit
5. [x] Project bar, autosave, export/import; WingCalc wiring
6. [x] README, scope, commit

## Status (2026-10-11)

All steps done; 116 tests pass; exercised in the browser (save, dirty marker, reload restore, new, open; stations mode, add station, typed and dragged station edits; tip on, tip drag, undo; measure with associative ends following a length change; auto-fit after inputs-column edits). Visual layout not reviewed by eye. Export/import tested in unit tests only (the download and file picker weren't driven in the browser).

## Open questions

- Station LE datum: set-back from the panel's inner leading edge (local). A global datum (root LE) might suit plans better.
- Dimensions are plan-view (flat) only.
- Two `<wing-calc>` instances on one page share saved projects and autosave (last writer wins).
- The autosave restores over the embed's `units` attribute: the user's last choice wins.
