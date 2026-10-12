# Wingcalc v6 — scope

Sixth round: feedback on the structure editor. Source of truth for this round; update as items land. Worked interactively, one item at a time.

## Objective

1. Leading and trailing edge stock from the standard profiles as sold (SLEC's range).
2. Hatch the sheeted areas on the structure plan.
3. Tidy the 3D view's header.
4. The same controls across the 3D view, the structure plan and the wing editor where they make sense: zoom +/−, fit, undo/redo on the plan, and so on.

## Decisions

- **Edge stock** (`src/lib/edgeStock.js`): catalogue of SLEC flat and symmetrical LE profiles, plain strip glued on edge (L2xx), and triangular TE (L4xx); all 915 mm lengths, SLEC's own metric figures (their page disagrees with itself on L429–L431; the description table's values are used).
  - Each edge is `stock: 'auto' | 'custom' | <code>`. Saves from before the catalogue migrate to `custom`, keeping their widths; new projects start on `auto`.
  - A stock fits if its profile contains the section over its whole depth at the root, each panel end and the tip, at its best height and a tilt of up to ±12°. The section's own trailing edge thickness is closed (the stock's edge becomes the TE); triangular stock has a 0.5 mm edge.
  - Profiles: symmetrical = flat back, half-ellipse front; flat = the symmetrical top half over a filled flat-bottomed lower half; strip = rectangle; triangular = flat-bottomed wedge.
  - Auto: of the stock at least the minimum depth along the chord (LE: 6 mm or 2.5% of the root chord, whichever is larger; TE: 5% of the root chord) that fits, the least waste (stock area less the section's area over its depth, summed over the check stations). If none fits, the one that falls least short.
  - Analysis resolves the stock up front: `analyseStructure` returns `structure` (widths set) and `edges`; buildParts, the plan, 3D and export use that structure, not the input.
  - Too-small stock gives a warning with the shortfall and the auto pick. The cut list names the part and says how many 915 mm lengths to buy.

## Steps

1. [x] Edge stock catalogue, fit check, auto pick, editor, cut list, migration, tests (`tests/edgeStock.test.js`). Checked by Matt.
2. [x] Plan hatch for sheeted areas: 45° SVG pattern, 7 px pitch at any zoom, over a lighter tint; the DXF plan gets 5 mm hatch lines on a HATCH layer (R12 has no hatch entity). Both start at the LE stock's inner edge (`sheetOutline` in structure.js). Checked by Matt (in-app).
3. [x] 3D view controls in the canvas, no toolbar: Layers and Section top left (drop-down cards after Screenvision's, one open at a time, until the button or Esc; capped to the view's height); Home and Perspective/Orthographic around the cube top right; − + Fit bottom right. Fit frames from the current angle, 44 px clear top and bottom; F, + and − work while the view has focus. Section's button is tinted while a cut is in place. Checked by Matt.
4. [x] Common view controls.
   - Rule: no toolbar above any view. − + Fit bottom right in the canvas, same shortcuts (F, +, −), with a Snap toggle beside them in views that edit (tooltip gives the grid step; Alt places freely). Editing tools in a vertical rail on the canvas's left edge, after Screenvision's ToolRail (icon over a short caption, 56 × 44 px buttons, radio-style tools, flyouts for families, separators, tooltips with shortcuts). Selection actions in a command bar at the top centre, shown only with a selection.
   - a. [x] Undo/Redo at window level (`UndoRedo.vue`): page header after the project bar, and each editor's header beside Done; Ctrl+Z / Ctrl+Y / Ctrl+Shift+Z anywhere except in a text field (handled in WingCalc). Removed from the plan editor.
   - b. [x] Wing editor: rail (Select, Measure; Add panel as an action at its foot), command bar (panel: Insert after, ← →, Add station, Delete; dimension: Delete; measuring: Clear dimensions), Snap + zoom corner (`StageZoom.vue`, `ToolRail.vue`, icons in `src/lib/icons.js`). The drawing sits in a stage element with the readout strip below it; Fit keeps clear of the rail, command bar and corner.
   - c. [x] Structure plan: rail in manual spacing (Select, Add rib: click on the wing to place one, with a preview line; A, V, Esc), command bar for a movable rib (Delete), Snap + zoom corner; zoom corner only otherwise. The 3D view uses the same zoom corner. Old toolbar CSS removed.

## Closed

- Round complete and checked by Matt (2026-10-12).
- TE strip laid flat: not added to the catalogue; Custom covers it.
- Also fixed: a crash sampling just past the last panel of a wing with no tip cap.
