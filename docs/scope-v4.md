# Wingcalc v4 — scope

Fourth round: layout, top bar, theme, expanded wing editor, straight lines and faceted segments, panel insert/reorder.

## Decisions

- **Layout**: standalone page up to 1,760 px wide; inputs column up to 380 px; stall character beside the drawings from 1,150 px of widget width.
- **Top bar**: title left; project controls (name with unsaved dot, Save as the one filled button, New, Open menu) and preference toggles (units, theme) right; all on one 34 px control height. Status messages float below the bar.
- **Theme**: Auto / Light / Dark, remembered per browser (`wingcalc.theme`), not per project. Embeds accept `theme="dark"`. The standalone page background follows it.
- **Expanded editor (option A)**: full-window overlay, panel fields on the **left** to match the page's inputs column, plan filling the rest, live results strip on top. Rendered via Teleport beside the calculator root (fixed positioning inside a container-query element is browser-dependent). The page's plan editor unmounts while it's open. Body scroll locked while open.
- **Straight line with stations**: `straightLine` chord fraction (0 LE, 1 TE, else a chord line); stations then set chord only.
- **Faceted segments**: `straightIn` per station, `straightToTip` per panel; tangent-continuous joins into curved segments.
- **Insert/reorder**: insert a constant-chord panel after the selected one (outboard panels unchanged, span grows); move panels inward/outward by swapping.
- **Station distance typing**: display order held while a row is being edited; re-sorted when focus leaves that row. No refocus afterwards (tried; Matt preferred without). The earlier timed re-sort was removed: it moved the row being typed in and dropped focus.
- **Station table**: inner-end row (greyed, read-only) and tip row (length, tip chord, sweep) bracket the stations. Distances from the inner end (default) or as spacing (chained: a change moves everything outboard, tip included). Enter acts as Tab.
- **New stations**: the table's Add station adds a blank row at the end (before the tip) and focuses its distance; blank rows sort last and are skipped without a warning until distance and chord are filled. A blank set-back means "auto": the leading edge follows the line through the stations that have one. The plan toolbar's Add station still places one on the current shape.
- **Unusable stations**: skipped with a reason (before inner end, on tip, beyond tip, duplicate, missing value) instead of invalidating the panel; shown on the row, in warnings, and as a dashed rib on the plan.
- **Maths in entry boxes**: `src/lib/expr.js`, recursive descent (no eval); + - * / × ÷, brackets, per-number units; commas as thousands separators.

## Status (2026-10-11)

Built; 135 tests pass; exercised in the browser. Not committed: awaiting Matt's check. The testing browser has no window focus, so focus and blur events don't fire there: the sum preview under a box and the re-sort on leaving a row couldn't be checked in it.

## Open questions

- Bézier "Curves" mode already allows curving one edge only; the straight chord-line option is only offered for chord stations.
