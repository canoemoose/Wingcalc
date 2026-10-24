# Wingcalc: servo configurator, second round — scope

From the review brief of 24 October 2026 (Part 1, the servo configurator) and Matt's answers the same day. Part 2 of that brief (structure and ribs) is a separate round. Worked autonomously.

## Objective

Rework the linkage to how wing servos are actually fitted (arm out through the skin, pushrod outside the wing, horn on the moving surface with its holes over the hinge), give the servo a real place in the wing (orientation, fore-aft position, height), redraw the side view on the true section, and lay the dialogue out so it fits without scrolling.

## Decisions

1. **On its side is the only mounting.** Flat and the quarter turn go. Older saves' `mounting` and `quarterTurn` are ignored (read as on its side, unturned). "Servo square to chord / hinge" (the yaw) stays.
2. **Two orientation switches, independent of the horn's face** (Matt: the arm can be re-mounted on the spline, so the flip and "Horn on" are separate):
   - `rotate`: turned 180° about the vertical, so the output is at the other end of the case and its shaft points the other way along the span;
   - `flip`: turned 180° about the fore-aft axis, upside down, so the shaft points the other way along the span.
   Both are true rigid turns of the servo (servos.js `mountMap`).
3. **Horn face defaults to the bottom** (Matt). The arm comes out on the horn's face, through the hatch when the bay's servo sits over it.
4. **Height**: `inset`, the gap from the inside of the skin on the horn's face to the servo, null (0) for as close as it goes. The servo sits on the lower skin for a bottom horn, under the upper for a top horn. Clamped to the depth the bay has.
5. **Fore-aft**: `fore`, the case's centre from the leading edge at the bay's station, saved as `{ value, by: 'length' | 'chord' }` (m, or a fraction of the chord) so either unit survives a chord change. null keeps the automatic place (the deepest spot between the leads' strip and the hinge spar). Clamped to that stretch, with a warning when it is.
6. **Pushrod outside the wing.** The arm through the skin is expected, not warned: its slot is drawn and listed. Warned instead: an arm hole that goes inside the wing over the travel (the pushrod would have to enter the wing), and a pushrod that touches the surface between its holes. The rod-exit slot and the hinge-spar warning go.
7. **Horn on the surface only**: its holes over the hinge line (as the geometry already had them), its base on the moving surface's face from just behind the bevel, leaning forward to the holes. A placeholder outline, no maker detail.
8. **Live preview.** The dialogue edits a draft of the bay that WingCalc analyses in place of the saved one while it's open, so the drawing, the plan and 3D show the real layout (fore-aft, height, orientation, another servo). Cancel drops it; Use this is one undo step. Analysis plus parts is about 20 ms, so this is affordable.
9. **Side view**: the section at the horn's station, fixed part and moving surface with its bevel, the servo as seen along its shaft (case, lugs, output; no mount plate outline).
10. **Pickers keep their columns** (Matt), each row with a thumbnail like the aerofoil picker: the servo's outline at one scale, the arm's hole row, the horn's outline.
11. **Summary line is plain text**; long readout rows keep a short value with the explanation on hover.
12. **Layout**: drawing with the results and footnote under it on the left; explanation, hole grid and warning on the right.

## Files

- `src/lib/servos.js`: pose (`rotate`, `flip`, yaw), MOUNTINGS and quarter turn out, bay settings `rotate`, `flip`, `fore`, `inset`.
- `src/lib/structure.js` `bayLayouts`: fore-aft from `fore`.
- `src/lib/wing3d.js` `servoBox`: base from the horn's face and `inset`.
- `src/lib/bayLinkage.js`: horn face default, frame (section, bevel, horn base), horn solid, `linkageFit` rework.
- `src/components/ServoConfigurator.vue`, `SurfaceStructure.vue`, `StructurePlan.vue`, `WingCalc.vue`.
- Tests: `servos`, `servoBays`, `linkage`, `bayLinkage`, `servoCatalogue`, `partPick`.
- Docs: `methods.md`, `user-guide.md`, `backlog.md`, `scope-servo.md` (pointer).

## Steps

1. Pose and bay settings in servos.js; tests. 
2. Fore-aft and height in the layout; tests.
3. Linkage rework (horn, fit, solids, default face); tests.
4. Live preview plumbing (WingCalc, SurfaceStructure).
5. Configurator: controls, drawing, thumbnails, summary, layout.
6. Plan and 3D follow-ups; docs; run the app; commit.

## Status

Done 24 October 2026, all six steps, except as noted.

- Built as above. Two additions: the hole table counts a pair as fitting only if its arm hole stays outside the skin over the travel (the default micro arm's inner holes don't, from a servo lying on the skin), and the readout gains an "Arm hole" row (how far clear of the skin it stays).
- The fore-aft position is the case's centre, not the output: turning the servo round then keeps the case where it is.
- Thumbnails are drawn inline in the dialogue rather than through a shared component: the existing pickers (aerofoil, edge stock) are drop-downs with their own thumbnail code, and Matt asked to keep the columns.
- Tests: `servos`, `servoBays` (poses, against either skin, inset, fore by length and by chord, clamped), `linkage` (pivot for each pose), `bayLinkage` (default link outside the wing, ranking, section and horn geometry, the slot, the inside and rod-rubbing warnings, solids), `render` (the dialogue every way).
- Checked in the running app by script: every control drives the live preview, Cancel restores the saved bay, Use this saves it as one undo step, no console errors. The dialogue is about 840 px tall: it fits at 1080 p, and scrolls in a 768 px high window. Not looked at by eye: Matt to check the drawing, the thumbnails and the layout.
- Open items are in `docs/backlog.md`, "Servo configurator, second round".

Feedback the same day, done: the moving surface's bevel was upside down (the top face had the down throw's bevel; going down swings the bottom face forward), fixed in `surfaceLayouts`; each control surface is its own section in the structure editor, and the shared hinge settings another; a greyed servo says why under its name (depth only: the arm never filters servos); the orientation switches read as where the output is (rear or front, outboard or inboard); the sticky group headings sit over the rows; the horn defaults to in line with the servo and lined up with the pushrod (`hornAngle` null); the position box is one percent-of-chord box that takes a typed length.
