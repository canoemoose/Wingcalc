# Servo configurator and bays: review list, 25 October 2026

What's left open or unverified from the servo work (scope: `docs/scope-servo-v2.md`, commits `1d6a1c9` to `89d1897`). Go through it together; tick, decide or move to `docs/backlog.md`.

## Not yet looked at by eye

Everything below passes its tests and the app loads without errors, but nobody has looked at it on screen yet.

- [ ] Servo dialogue: the side view (the section at the horn, the bevel, the servo seen along its output, the horn's outline), the thumbnails in the three columns, and the layout.
- [ ] The dialogue fits without scrolling at 1080p (it's about 840 px tall). It still scrolls in a 768 px window.
- [ ] Each control surface's own section in the structure editor, and the hinge settings' section.
- [ ] The mount plate: the hole following the servo with no slivers, the arm's slot, the plate as one solid in 3D, the screw blocks in 3D and outlined on the plate drawing.
- [ ] The bevel the right way up (bottom face for the down throw) in 3D and on the cut list.

## Decisions to make

- [ ] **Hatch for a top-side servo.** A horn on top puts the servo under the upper skin, and it goes into its plate from above, but the hatch and rails are still in the lower skin. Should the hatch move to the upper skin?
- [ ] **Horn shape.** The horn's outline is a placeholder: its base on the surface behind the bevel, 70% of its height long, and a column 2.5 mm either side of the hinge for its holes. Which real horn shapes do we model?
- [ ] **Screw blocks.** These are spruce, 6 mm along the span, as long as the lug beyond the case, and 3 mm past the screw. Are the size and material right? On a servo with short lugs they may be too short to glue well.
- [ ] **Minimum ply between notches** is 4 mm (`MIN_PLY`). Is that right for 1.5 mm ply?
- [ ] **Arm room in the bay.** 5 mm beyond the output, doubled to keep the servo centred, makes bays about 14 mm wider than before, so fewer of them fit between the wing's own ribs. Is that acceptable, or should the bay sit off-centre instead?
- [ ] **Fore-aft position** is limited to between the lead strip behind the spar and the hinge spar, as the automatic position is. Should it be allowed further forward where the wing allows?

## Known gaps

- [ ] The arm's slot in the skin is drawn on the plan, but not cut from the sheeting parts, the hatch part or the DXF plan, and the cut list doesn't mention it.
- [ ] The horn isn't checked against the surface's own ribs, the moving hinge spar or the covering.
- [ ] The arm is a plain bar (no boss, no taper). The sizes in `PART_SIZES` are typical, not measured.
- [ ] The arm's slot in the plate allows for the servo's travel plus 15° each way about pointing square out through the skin, not the exact sweep the linkage solves.
- [ ] The pushrod-rubbing warning has never fired on a real wing; its test uses a wing with a bulge added.
- [ ] **Inset** moves the servo away from the skin with nothing holding it there but the plate; no packing is drawn or listed.
- [ ] **Turned round or upside down:** the lead's route to the root on the plan and the lead holes don't change, and the Part card still shows the servo's maker drawing unturned.
- [ ] The screw blocks' pilot holes aren't drawn as holes in 3D or on a part; only the blocks are.
- [ ] Hole positions on every arm and horn are estimated, not measured (see the backlog's servo catalogue entry for what to measure).
- [ ] In the dialogue the "Horn" readout can show a few tenths of a degree off square on a raked hinge. That's correct: it's measured at the servo's mid-travel, where the surface is slightly deflected. At neutral it's exact.

## Changed behaviour for older projects

- A bay that relied on the old default horn on top now has its horn underneath, and its servo on the lower skin.
- A bay saved flat, upright or turned a quarter loads on its side, unturned.
- The bevel swap changes the hinge spars and trailing-edge stock of every project with control surfaces.
- Bays are wider, so a bay that used to sit between the wing's own ribs may now get its own pair.
