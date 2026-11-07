# Structure feedback (7 November 2026)

Handwritten notes, six items. Autonomous: work through, test, commit by concern, questions batched at the end.

## Objective

| # | Item | Plan |
|---|------|------|
| 1 | Ribs to support a servo bay | A servo tray sits between the wing's own ribs only when their gap is close to the servo's width. When the wing's ribs are much further apart than the servo needs, the bay gets its own pair of ribs a servo's width apart, whatever the rib spacing setting. |
| 2 | Lead hole vs lightening holes | On a rib with lightening holes, when a lightening hole behind the spar is at least as big as the lead hole, the leads go through it and the rib has no lead hole. |
| 3 | Several leads | Every lead through a rib shares one hole, sized for the largest plug plus room for each extra lead alongside it. |
| 4 | Loads chart zoom | In the expanded loads charts, zoom and pan along the span (wheel, drag, − + Fit, keys), both charts together; the moment axis rescales to what's in view. |
| 5 | Covering layer | The covering is back in the 3D view's Layers, off by default, see-through as before. |
| 6 | Section shows hidden layers (bug) | The 3D section's cut face only fills pieces whose layer is shown. |

## Constraints

- Pure logic in `src/lib/`, tested in `tests/`.
- User guide and methods updated where behaviour changes.

## Files

- 1: `src/lib/servos.js` (`fitBaysToRibs`), `src/lib/structure.js`.
- 2, 3: `src/lib/structure.js` (`bayLayouts`, lead offsets), `src/lib/ribs.js` (`buildRib` leads and lightening holes, `leadsAt`).
- 4: `src/components/LoadsChart.vue`, `src/styles/wingcalc.css`.
- 5, 6: `src/components/Structure3D.vue`.

## Status

- [x] 6 Section respects layers
- [x] 5 Covering layer
- [x] 4 Loads chart zoom
- [x] 2, 3 Lead holes
- [x] 1 Bay ribs
- [x] Docs, tests, commits

## Decisions taken

- Item 1 read as "the wing's ribs are too far apart to support the servo": a tray between the wing's own ribs is used only when their faces are within `TRAY_SLACK` (1.5) times the bay the servo needs; otherwise the bay gets its own pair of ribs.
- Item 3: the shared hole is the biggest plug's hole plus 1.5 mm per extra lead (`LEAD_EXTRA`).
- Item 2: only a lightening hole behind the spar counts (the leads run behind it); root, break, tip and a bay's own ribs have no lightening holes, so they keep the lead hole.
- Item 4: zoom is along the span only; the margin axis keeps its fixed -1 to +3 scale.
