# Scope: v8 feedback round (17 October 2026)

Matt and Sam's feedback on the overnight and morning sessions (see `review-2026-10-17.md`). Autonomous round: Claude plans small tasks, hands them to Haiku worker agents (in parallel where files don't overlap), reviews each result, runs the tests and commits by concern. Nothing is pushed.

## Decisions taken

- **Sharp trailing edge.** The section editor always closes the profile: the upper and lower trailing-edge points are one point. The buildable thickness is the structure's trailing-edge stock, not the profile.
- **Inputs commit on Enter or leaving the field**, never while typing; Escape reverts. No debounce timer.
- **Accordion** in every left-hand properties column: opening a section closes the one that was open.
- **Control surfaces:** outlined in the wing editor (drag in plan, with dimensions); everything structural (hinge, servo, tray, Mylar) in the structure editor. Default depth from the trailing-edge stock already chosen.
- **Mylar hinges:** roll stock 0.2 mm thick, 25 mm wide; tab length user-set, default 25 mm.
- **Servos:** Hitec catalogue, with wing (thin), side-mounted and horizontally mounted installations.

## Work, in waves

Each wave's tasks touch different files so they can run at once. Status: ☐ to do, ◐ in progress, ☑ done.

### Wave 1
- ☑ Sharp trailing edge in the section editor (`sectionSpline.js`, `SectionEditor.vue`, `SectionSide.vue`).
- ☑ Inputs commit on Enter / blur (`UnitInput.vue` and inline inputs).
- ☑ Research: covering weights; Hitec servo catalogue (data only).

### Wave 2 (general UI)
- ☑ Accordion side panels (`InspectorSection.vue` and its hosts).
- ☑ Drag-select picks only drawing items, never labels or frames.
- ☑ Graph editor: equal tick spacing on both axes.
- ☑ Dustbin icon for delete everywhere.
- ☑ Wheel zoom/scroll only once the view has been clicked (focused).
- ☑ Warnings beside the field that fixes them.
- ☑ Section editor: draw in millimetres, switch to % chord once normalised.

### Wave 3 (edges, coverings, structure)
- ☑ Edge-stock picker shows a profile image for every size; shortfall drawing always shown; flat leading edge removed; custom leading edge with depth and height.
- ☑ New covering list (Solarfilm, Solalite, Oracover, Oralight, Doculam 15/30/40 µm, Kavan, glass + epoxy 0.6/1/1.5 oz, carbon 10/30/50 g/m²; keep tissue and dope and the generic films).
- ☑ Rib labels in the 3D section view.
- ☑ Dowel / carbon leading-edge cutouts missing from some rib drawings.
- ☑ Dihedral braces in the loads graph and the warnings, with clearer descriptions of the numbers.
- ☑ D-box sheeting top, bottom or both, depth set separately for each.
- ☑ Open structure: cap strips stop short of the leading edge.
- ☑ Hard points: sheeting top/bottom/both between span start/stop and chord start/stop.
- ◐ Foam-core wings: square trailing-edge stock added as a bolster (☑); stray built-up parts not found (see questions).
- ◐ Blue square in the structure plan: not found (see questions).
- ☑ Grain direction: shear webs vertical, gussets parallel to the hypotenuse.

### Wave 4 (control surfaces)
- ☑ Drag-to-define surfaces in the wing editor with dimensions; default depth from the TE stock.
- ☑ Move structural settings to the structure editor; remove the old split.
- ◐ Surfaces and servo bays drawn properly in the structure plan: needs specifics (see questions).
- ☑ Mylar hinge stock and tab length.
- ☑ Servo trays between ribs, default a third along the aileron, aligned with the rib spacing.
- ☑ Hitec servo catalogue; wing, side and horizontal mounting.

### Backlog
- Design booklet (downloadable, LaTeX-styled equations). Spec to follow; logged in `backlog.md`.

## Notes on what was done

- Small rods (1.5 and 2 mm): under a D-box the sheeting thins each rib's nose to nothing a little behind the leading edge, so a rod that small sits ahead of the rib and there is nothing to notch. Not a bug.
- Shear webs were already laid out with the sheet grain running up the web; only gussets were wrong. The web report needs a closer look with Matt.

## Open questions

- Foam-core wings: which stray parts? In the default foam wing with an aileron, the 3D model has the spar caps, skins, edge stock, hinge spars, cores and a servo with its ply mount plate; the parts are templates, skins, the servo plate and hatch. Is it the servo mount plate (no ribs to sit between), or something in the plan view?
- Control surfaces and servo bays "not shown properly" in the structure editor: what's wrong or missing?
- Mylar tabs: read as 25 mm roll width across the hinge (12.5 mm into each spar) and each tab cut 25 mm long along it, with the hinge spars widened to 13 mm by default to take them. Right way round?
- Servo mountings: upright, on its side, and flat (thin wing servos). Is "horizontally mounted" one of these, or something else?
- A new surface is as deep as the trailing edge stock, so by default the stock is the surface (no surface ribs or hinge spar). Is that the intent, or should the default depth be the stock plus a built-up surface?
- Cap strips start 10% back from the leading edge by default. A sensible figure?
- The 13 mm hinge spars (to take 25 mm Mylar) leave no room for a 75%-chord aileron near the tip of a small wing with deep trailing-edge stock, so such a surface isn't built. New surfaces default to the stock instead, and saved projects keep their own spar widths. Keep 13 mm, or go back to 8 and 10 mm with shorter tabs?

- Shear-web grain: what looks wrong in the export window? (A screenshot, or which way the web's long side runs on the sheet.)
- The blue square in the structure plan: where it appears and what's selected at the time (a screenshot would settle it).
