# Wingcalc v5 — scope

Fifth round: rib generator, structure layout and DXF export. Source of truth for this round; update as items land.

## Objective

1. Generate ribs for a built-up wing from the existing planform and aerofoil, with set and varied rib spacing.
2. Standard LE and TE strips, main spar, stringers / turbulator spars, corner gussets and dihedral braces.
3. Place the spar and tighten rib spacing on a structural basis where it earns it.
4. Thickness taper towards the tip and washout, with optional jig tabs.
5. DXF export of ribs and a build plan, driven by an export options panel.

## Decisions

- **Gussets**: corner bracing where a rib meets the LE or TE stock (triangles; size and thickness set; every rib or chosen ribs). Dihedral braces (ply plates / joiner box) at panel breaks, cut to the dihedral angle.
- **Thickness taper**: thickness % set at panel ends, interpolated between. Library sections are split into camber line and thickness; only thickness is scaled, then rebuilt. Generated sections already work this way (`airfoilGeom.js`).
- **Washout**: added this round (it is what makes jig tabs worth having). Per panel end, about the spar line, so jig tab heights vary at both LE and TE.
- **Jig tabs**: optional feet down to a common board datum, carrying washout.
- **Rib orientation**: streamwise or perpendicular to the spar line, per user choice. Perpendicular ribs are the section stretched by 1/cos(local sweep). The spar line is therefore placed before ribs.
- **Curved tip cap**: built as a tip block, no ribs in the cap.
- **Spar default position**: at the section's maximum thickness, straight along each panel; ribs notched to where it falls.
- **Sheeting / cap strips**: rib profile inset by the skin thickness.
- **Flutter / divergence**: out of scope; say so in the UI.
- **Export options panel**: what to export (ribs, plan, gussets, braces, cut list); machine (laser kerf / router tool diameter with dogbones); DXF version, units (mm default), layers (cut, etch, construction); rib labels; lightening holes; jig tab depth and datum; handedness (left / right / pair, quantities doubled, plan and tabs mirrored). Stored with the project.
- **Layout**: ribs in a simple row. Nesting onto stock sheets deferred.
- **DXF writer**: hand-written, no library.

## Stress analysis (staged)

- **Stage A**: lifting-line loads (Glauert/Multhopp series; taper, sweep, thickness taper and washout) at a design load factor, beam bending, margins of safety for spar cap crushing / column buckling between ribs, lower cap tension, web shear and buckling, sheeting buckling between ribs. Safety factor 1.5 on limit load, conservative material values. Drives spar cap taper, rib spacing and brace sizing.
- **Stage B** (undecided whether it earns its place): inertia relief (wing mass, servos, batteries), torsion from section Cm, D-box torsional stiffness.
- **Not planned**: flutter and divergence.

## Answered (2026-10-11)

- **Spar types**: caps + shear web, carbon tube, box spar, single solid spar.
- **Covering structures**: open with cap strips, D-box, fully sheeted.
- **Machines**: laser and router, chosen in the export panel.
- **Load model**: Stage A this round.
- **Thickness taper**: feeds Clmax along the span, so stall speed and stall character reflect a thin tip.
- **Washout**: angle at each panel's outer end, linear across each panel; twists about the spar line; feeds the aero calculations and the Stage A loads.

- **Lifting-line**: pulled forward into this round (Schrenk can't model twist). The rest of Stage B is undecided, so this round must stand on its own.

## Working notes

- Work is on the `ribs` branch in its own worktree (`.claude/worktrees/ribs`), so the XFOIL session in the main checkout is unaffected.
- The embed build is being removed on another branch: nothing here depends on it or adds to it.
- The browser preview can't start a second dev server here (port clash with the XFOIL session's server). `tests/render.test.js` renders the whole app on the server from a saved state and fails on any error or Vue warning, as a crash check; interactive behaviour still needs checking in a browser.

## Files in play (planned)

- `src/lib/ribs.js`, `src/lib/structure.js` (loads, margins), `src/lib/dxf.js`, with tests in `tests/`.
- `src/lib/wing.js` (washout, thickness at station), `src/lib/airfoilGeom.js` (camber/thickness split for library sections).
- `src/lib/projects.js` `defaultState()` for every new input.
- New structure view and export options panel components.

## Steps

Each step lands with tests and is checked in the running app before the next.

1. [x] Washout and thickness taper in the model: per-panel-end inputs, `defaultState()` migration, section at any span station (camber/thickness split for library sections), twist about the spar line. Section view shows root and tip.
2. [x] Lifting-line solver (`src/lib/liftingLine.js`): spanwise Cl and lift from planform, twist and per-station Clmax; validate against elliptic and rectangular closed-form results. Stall speed and stall character switch over to it.
3. [ ] Structure definition (`src/lib/structure.js`): spar type and position, covering, LE/TE stock, stringers, materials table. Inputs UI.
4. [ ] Stage A loads and margins: shear, bending, margins per failure mode; suggested rib spacing and spar cap taper. Structure view with ribs and margins overlaid.
5. [ ] Rib generation (`src/lib/ribs.js`): stations from spacing (manual, suggested, hard points), streamwise or perpendicular, skin inset, LE/TE cut-backs, spar and stringer notches, lightening holes, jig tabs, labels, tip block outline. Single-rib preview.
6. [ ] Gussets and dihedral braces (brace sized from the bending moment at the break).
7. [ ] DXF writer (`src/lib/dxf.js`) with kerf / tool offset and dogbones; parse-back tests on dimensions.
8. [ ] Export options panel and plan-view export; settings stored with the project.
9. [ ] README, scope, commit.
