# Backlog

Open questions and notes that don't belong in the public docs.

## Bundled polar data licence

airfoiltools.com publishes no terms of use: a privacy policy and a footer reading "Copyright © 2026 All Rights Reserved", but no licence for reuse. The polars in `src/data/airfoils.json` are its own XFOIL output and presumably fall under that notice. The UIUC Airfoil Coordinates Database is publicly available, but neither its database page nor its home page states terms or a licence.

The app is now public on GitHub Pages. Options:

- Ask airfoiltools.com (via its contact page) for permission to redistribute the polars.
- Regenerate the bundled polars ourselves with the same WebXFOIL build the app runs, from the UIUC coordinates. Removes the airfoiltools question; UIUC remains.

Background on where the bundled and computed polars differ: `docs/scope-xfoil-wasm.md`.

## Questions for Sam

From Sam's feedback on the structure editor (2026-10-16). Each needs his detail before it can be fixed.

1. **Manual rib spacing**: "issues filling out rib spacing in manual mode, similar to the behaviour the chord tool had". What goes wrong, and what did the chord tool do? Suspect: the rows re-sort by distance while you type, so the field being edited jumps.
2. **Gussets "seem to have random issues"**: which ribs, and what looks wrong? A saved project file that shows it would be ideal.
3. **Ribs clash with the TE in the rib diagrams**: which trailing-edge stock is set, and is it every rib or only towards the tip? Suspect: the TE notch doesn't follow the rib's actual depth or washout.


## Control surfaces (v8 step 6)

- The bevel is the exact clearance about the middle of the gap, with no allowance for the covering or a stiff tab. Builders often bevel to the full throw; ask Sam which he'd rather see.
- Mylar thickness is entered in the "thin" unit, shown to 0.1 mm, so 0.13 mm (0.005 in) film shows as 0.1.
- On a fully sheeted wing the sheeting templates run over the hinge; they should stop at the fixed hinge spar, with the surface sheeted separately.
- Not yet: XFOIL flap deflection (CLmax and stall speed with flap and crow), dragging hinge ends in the plan, the surface drawn deflected in 3D, hinge moments.

## Servo bays (v8 step 8)

- Servos always stand upright (shaft vertical), so a thin wing can't take them: a micro servo needs about 24.5 mm clear behind the spar, more than a 12% section gives except near the root, and the bay warns. Real thin wings mount servos on their sides on a vertical tray or rails; that needs an orientation choice and a different plate. Ask Sam which he builds.
- Torque is listed but not compared with the hinge moment: that wants a top speed (there isn't one yet; v10) and the horn and servo arm lengths.
- Servo figures are rounded class values, not a particular servo. Worth Sam's eye, and a custom size (length, width, height, mass) might be wanted.
- Pushrods and horns aren't modelled, so nothing checks the servo is a sensible reach from the horn; the servo goes in the deepest place behind the spar, preferring the rear.
- The lead strip behind the spar is sized for every bay, so a wing with several bays on a narrow chord can refuse a bay ('no room between the main spar and the hinge') that would fit alone.
- Bays aren't drawn in the wing editor's plan, and can't be dragged; the centre is a number. No servo in the 3D section cut, and none in the thumbnails.
- The relief counts servos only. The wing's own weight stays ignored in the loads (safe side).
- The mount plate leaves about 1 mm of ply down each side of the case cut-out, which a laser kerf could take; a wider bay clearance would help.
