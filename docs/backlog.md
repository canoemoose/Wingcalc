# Backlog

Open questions and notes that don't belong in the public docs.

## Bundled polar data licence

airfoiltools.com publishes no terms of use: a privacy policy and a footer reading "Copyright © 2026 All Rights Reserved", but no licence for reuse. The polars in `src/data/airfoils.json` are its own XFOIL output and presumably fall under that notice. The UIUC Airfoil Coordinates Database is publicly available, but neither its database page nor its home page states terms or a licence.

The app is now public on GitHub Pages. Options:

- Ask airfoiltools.com (via its contact page) for permission to redistribute the polars.
- Regenerate the bundled polars ourselves with the same WebXFOIL build the app runs, from the UIUC coordinates. Removes the airfoiltools question; UIUC remains.

Background on where the bundled and computed polars differ: `docs/scope-xfoil-wasm.md`.

## Design booklet

Requested in the 17 October feedback: a complete downloadable design booklet for a wing, with its equations typeset LaTeX-style. Spec to follow from Matt and Sam; nothing built yet.

## From the 17 October feedback round

- The Hitec servo figures come from Hitec's product pages and retailers, with the case dimensions mapped as length × width × height in the order printed (not labelled on the pages) and the lug spans estimated (Hitec publishes none). Check against a drawing before relying on a tight fit. Round 2 (October 2026) added fifteen models Phoenix sells (HS-55, 65HB, 5055MG, 5065MG, 85BB, 225BB, 77BB, 311, 322HD, 485HB, 5485HB, 625MG, 645MG, 5625MG, 5645MG) from hitecrcd.com. HS-311 and HS-322HD print identical figures; several pages give torque only as a range (the top used). HS-625MG is back: it was dropped as discontinued, but Hitec and Phoenix both still list it. Still missing: HS-50, HS-82MG, HS-325HB (no figures found). The servo 3D models are still boxes with lugs: Hitec's drawings (lug positions, output boss, lead exit) weren't to hand.
- The covering weights for Doculam, and for glass and carbon cloth with epoxy, are estimates (film thickness plus adhesive; cloth weight times a hand-laid wet-out). Oracover's figure is a retailer's. Weigh some samples.
- Cap strips are still listed full length where a sheeted hard point covers a rib (the sheet now covers the whole chord, so they aren't needed there).
- Air brakes' servo bays are still set in the wing editor, with the brake; control surfaces' moved to the structure editor.

## Questions for Sam

From Sam's feedback on the structure editor (2026-10-16). Each needs his detail before it can be fixed.

1. **Manual rib spacing**: "issues filling out rib spacing in manual mode, similar to the behaviour the chord tool had". What goes wrong, and what did the chord tool do? Suspect: the rows re-sort by distance while you type, so the field being edited jumps.
2. **Gussets "seem to have random issues"**: which ribs, and what looks wrong? A saved project file that shows it would be ideal.
3. **Ribs clash with the TE in the rib diagrams**: which trailing-edge stock is set, and is it every rib or only towards the tip? Suspect: the TE notch doesn't follow the rib's actual depth or washout.


## Control surfaces (v8 step 6)

- The bevel is the exact clearance about the middle of the gap, with no allowance for the covering or a stiff tab. Builders often bevel to the full throw; ask Sam which he'd rather see.
- Mylar thickness is entered in the "thin" unit, shown to 0.1 mm, so 0.13 mm (0.005 in) film shows as 0.1.
- On a fully sheeted wing the sheeting templates run over the hinge; they should stop at the fixed hinge spar, with the surface sheeted separately.
- Not yet: dragging hinge ends in the plan, the surface drawn deflected in 3D, hinge moments.

## Flaps and crow aerodynamics (v8 step 6, deferred part)

- Wing CLmax with flaps rests on the 3° progressive-stall allowance (`PROGRESSIVE_STALL_DEG`): it decides the flapped and crow CLmax whenever the clean part of the wing doesn't reach its own stall first, which is usual. Chosen from the XFOIL flapped polars' post-stall plateau; worth checking against a flown model's flapped stall speed.
- The empirical fallback (flap correction 0.8 to 0.4, Clmax ratio 0.45, cap 0.9) is fitted to XFOIL on NACA 2412 at Re 200k and checked against DATCOM and Raymer only in outline; the DATCOM chart values weren't to hand. XFOIL rarely gives a usable polar for an aileron well up, so crow's ailerons are nearly always the estimate.
- Increments are solved once, at the clean polar's Re, on the root section at the hinge's mid-span chord fraction; a thickness-tapered tip or a tapering hinge uses the same increment along the surface.
- The Configuration choice isn't saved with the project, and the editor strips' stall speed stays clean.
- The lift curve and the section stall rating stay the clean section's in every configuration.

## Air brakes (v8 step 7)

- The linkage isn't modelled: no pushrod, bellcrank, blade guide rails or end stops, and blades are drawn straight up. A real box needs the blades guided and the servo's throw turned into lift; the bay beside the brake is just a servo bay.
- The slots or opening in the covering are drawn in the plan only. The sheeting parts are developed templates and have no holes in them.
- Brake sizes are plausible defaults, not published figures: a 12 mm blade, 1 mm ply blades and walls, a 40 mm spoiler plate opening to 60 degrees. A thin wing can't take much blade height (the depth check warns). Worth Sam's eye, and what he flies.
- A box right behind the main spar blocks the strip the lead holes of outer servo bays use, so the order matters; warned, not solved.
- Brakes can't be dragged in the plan; the centre is a number. They aren't in the 3D section cut or the rib thumbnails (the plan thumbnail has their outline).
- Drag isn't calculated: v9 and v10's performance work needs a drag figure per open brake (the dimensions are all saved).
- A spoiler is always on the top surface and hinged at its front edge; no rear-hinged or bottom-surface spoilers.

## Servo bays (v8 step 8)

- Servos always stand upright (shaft vertical), so a thin wing can't take them: a micro servo needs about 24.5 mm clear behind the spar, more than a 12% section gives except near the root, and the bay warns. Real thin wings mount servos on their sides on a vertical tray or rails; that needs an orientation choice and a different plate. Ask Sam which he builds.
- Torque is listed but not compared with the hinge moment: that wants a top speed (there isn't one yet; v10) and the horn and servo arm lengths.
- Servo figures are rounded class values, not a particular servo. Worth Sam's eye, and a custom size (length, width, height, mass) might be wanted.
- Pushrods and horns aren't modelled, so nothing checks the servo is a sensible reach from the horn; the servo goes in the deepest place behind the spar, preferring the rear.
- The lead strip behind the spar is sized for every bay, so a wing with several bays on a narrow chord can refuse a bay ('no room between the main spar and the hinge') that would fit alone.
- Bays aren't drawn in the wing editor's plan, and can't be dragged; the centre is a number. No servo in the 3D section cut, and none in the thumbnails.
- The relief counts servos only. The wing's own weight stays ignored in the loads (safe side).
- The mount plate leaves about 1 mm of ply down each side of the case cut-out, which a laser kerf could take; a wider bay clearance would help.

## Foam-core wings (v8 step 9)

- Hot-wire templates are DXF for hand or bow cutting (Matt's call). No G-code or four-axis CNC output; a CNC cutter wants the two profiles resampled to matched point counts with synchronised speeds, which the templates' common frame would make straightforward.
- Foam, obechi and carbon tow figures are conservative indicative values (EN 13163/13164 classes, Wood Handbook), not tested. The wrinkling coefficient Q = 0.5 and the core shear's 45-degree spread (b = cap width + depth) are textbook design assumptions worth checking against a real wing, and Sam's experience of what breaks.
- The check leaves out the skins' own share of the shear (the closed skin round the section), so core shear governs most light EPS wings and is pessimistic. A shear-flow model of the skin box would credit it.
- Cap slots, the web slot and pockets aren't cut out of the 3D core, and the core runs through the servo and brake pockets in the weight (a few grams, safe side).
- Hatch rails are listed for a foam wing's servo hatches, as for a sheeted built-up wing; a foam pocket may want a ply frame or magnets instead.
- The servo leads run in a channel in the core behind the spar (noted on the pocket templates); the channel isn't drawn or checked.
- Skins are developed per panel as a strip along the leading edge, with no allowance for sweep in the developed shape beyond the section's own, and their sheet count doesn't nest pieces; the skins' DXF is off by default. No grain-direction or joint-line layout across sheets.
- Templates are drawn for the panel ends only: a curved (Bézier) leading or trailing edge between them can't be cut with a straight wire, and the core comes out with straight edges between the templates. No warning yet when the planform is curved.
- The dihedral bevel at a joint is noted on the template, not drawn. No joiner or dihedral brace layout specific to foam (the built-up brace plates are kept).
- Balsa as a skin on foam is checked for wrinkling with its grain-wise modulus, though the cross-grain stiffness of balsa is far lower; a balsa-skinned core should probably be checked more conservatively.
