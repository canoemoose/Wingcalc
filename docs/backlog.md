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

- The Hitec servo sizes now come from the dimensioned drawings on each model's hitecrcd.com product page (18 October 2026): case, lug span, thickness and height, gear tower, horn seat and output offset are printed figures; the output boss's diameter and the lead's exit point are scaled off the drawing (about ±0.5 mm). No CAD (STEP) was found: none on the hitecrcd.com product pages, nor on hitec.uk's HS-125MG page (the one checked there). Some drawings differ from the spec table beside them (HS-65MG's drawing is 26 mm tall to its gear tower, the table says 24; the older datasheet PDF matches the table), and the drawings are what's used. D141SW is no longer listed; its figures are the D141SH's (same case). D131MW's motor bulge below its base (8.2 mm) isn't drawn: its case is a plain block. Masses and torques are still the pages' figures, HS-311 and HS-322HD identical, several torques the top of a range. Still missing: HS-50, HS-82MG, HS-325HB (no figures found).
- Phoenix's wing servo mounts (phoenixmp.com, Wing_Servo_Mounts) are 4 mm CNC ply cheeks cut to each servo's side profile, the servo lying on its side between two of them with its lugs screwed to blocks; the page gives no dimensions. Our tray is a flat plate (1.5 to 3 mm ply) under an upright servo's lugs, so the two can't be compared outline for outline. If Sam builds that way, the side mounting wants a cheek-pair tray of its own (the servo's side profile, 4 mm ply) in place of the plate.
- A servo whose lugs stand on edge in its mounting (an ordinary servo on its side or flat, a wing servo upright) has no screw holes in its plate, which is then only a frame; the note says to fix it with blocks or a strap. Cheek or rail mounts for those (see the Phoenix note) would do better. The D131MW's lugs are too short for a screw with 1 mm of ply round it.
- A bay that's too shallow for its servo is still built, with a warning; its servo then pokes through the upper skin in 3D. The hatch is cut through any lower stringer crossing it, which isn't noted.
- The covering weights for Doculam, and for glass and carbon cloth with epoxy, are estimates (film thickness plus adhesive; cloth weight times a hand-laid wet-out). Oracover's figure is a retailer's. Weigh some samples.
- Cap strips are still listed full length where a sheeted hard point covers a rib (the sheet now covers the whole chord, so they aren't needed there).
- Air brakes' servo bays are still set in the wing editor, with the brake; control surfaces' moved to the structure editor.
- Possible bug, not yet checked (found by a throwaway probe, 18 October 2026): two panels (0.4 m to a 0.22 m chord, then 0.35 m to 0.15 m with 5° dihedral and sweep 0.15), even rib spacing, ribs perpendicular. `analyseStructure` places 12 ribs, but `buildParts` skips R11 at 680 mm as "outside", so it has no part and isn't in 3D. Suggested spacing on the same wing (sweep 0.05, and streamwise at 0.15) builds all 12. It may already be fixed; reproduce before chasing it.

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

## Servo catalogue (servo configurator step 1)

- **To measure (Sam).** No maker publishes the hole positions of a servo arm or the hole heights of a control horn, so every arm's and horn's holes in `linkage.js` are estimated (`estimated: true`, each arm with its `basis`; the rules are in `docs/methods.md`, Servo bays). Measured figures should replace them: for each arm Sam uses, its part number and the distance of each hole from the pivot; for each horn, the height of each hole above its base, and how far ahead of or behind the hinge line its holes sit. The published figures they rest on: a Hitec-fit 24T nylon set at wirelessmadness.com (single arm 11.5, 15.5, 19, 22.5 mm; double 17, 19, 21, 25 mm), not tied to a Hitec part but used for Hitec's standard sets; 24T aluminium arms at HobbyKing (19, 24 mm) and Axial (19.75, 24.25 mm); a Futaba-fit cross 44 mm across (lindinger.at); hole pitches of 3/32 in on small horns and 3/16 in on large (a Parallax forum measurement); arm lengths in the part names, read as pivot to tip with the outer hole 2 to 2.5 mm in (unconfirmed: they might be overall lengths, which would put a single arm's holes about the boss's radius further in and halve a double's; measure a Futaba FSH-T1 or FSH-6E to settle it); horn heights from retailers. Least certain: Futaba's round horns (FSH-6G, 6R, 6W, sized by eye from photos), the T horn's cross-bar, the micro sets, and the Great Planes horns' heights (taken from Du-Bro's of the same size). An arm's thickness, hole diameter and mass are still not in the catalogue; its seat (the holes' plane above the spline top) is 1.5, 2 or 2.5 mm by size.
- **Linkage geometry (step 2).** The mounting 'flat' turns the servo's output axis along the chord (`placeServo`), so its arm swings across the span and can't drive a pushrod to a spanwise hinge: the solver returns 'reach' or a useless throw. Decision 7's quarter turn (step 4) is what makes a flat wing servo work; until then, only upright and side mountings give a real linkage. An upright servo's arm swings in the wing's plane, which works as a spatial linkage but needs the arm above the plate, through the skin; whether it fits is step 5's check.
- **Servo placement (step 4).** A turned servo's cylinders lying along the chord (a flat servo's output boss and gear tower) are drawn in 3D as the box round them, slightly fuller than they are. The plate's least ply round a turned cut-out is checked against the cut-out's bounding box in the cut list's note. Dragging the servo on the plan keeps it within its surface's span; the bay can still be set beyond it by number. In the configurator, another servo is worked out where the current one stands (and its horn station), until the bay is laid out again with it.
- The midpoint search scans the surface angle between the designed throws (160 steps) and bisects; if two midpoints exist (unlikely in a sane linkage), the one nearest neutral is taken. Horns are assumed to put their holes over the hinge line (`forward` 0); a horn whose holes sit ahead of it can pass `forward`, but none in the catalogue does.
- Futaba's dimensioned drawings are on futaba.uk (not rc.futaba.co.jp or futabausa.com, whose pages and manuals have none). Every servo futaba.uk sells has one except the BLS-A600 (photos only). futaba.uk's spare case sets name the models sharing a case, so S-U306, S3155 and S3114 use the S-U400's, S3150's and S3154's drawings. Still without (not sold on futaba.uk, no drawn case-mate): S3001, BLS-A600, HPS-A701, S-AG300, S3016, S3102, S3107, S3114M, S3173SVi, S3176SV, PS-10, PS-14; their lugs, output and lead are the class's, marked `estimated`. HPS-A701 publishes the same size and mass as HPS-A704 but isn't in its case set (HPS-A704/HPS-CT501), so isn't assumed to share it. S-A400, S-A601 and HPS-A704's drawings don't show the lead (class's used). S-AG500's lead height (16 mm) is scaled off a photo; its drawing isn't to scale, so only printed figures are used, and its tab is drawn centred though the drawing puts it 3 mm off centre. Output top is the spline's top on some drawings and the fitted horn's underside on others (within about 2 mm of each other).
- Futaba publishes no tooth counts: its splines are named by size (Φ4, Φ6), and only where a Japan page lists the horn type (S-U300, S-U301, S-U400, S-A400, S-A401, S-A501, HPS-A701, HPS-A703, HPS-AA702 are Φ6; S3114 is Φ4). The rest have no spline and so no arms on offer, except the S3107 (named by the FSH-63 horn pack). The FSH-6 series are assumed to be the Φ6 horns from their part numbers, and the FSH-T aluminium horns and EBS0170 clamping horn fit nothing until their spline is known.
- Hitec splines as read: HS-65HB, HS-5065MG and HS-5070MH are given as Micro 25 because Hitec's Micro 25T horn set (55706) names them, though their own pages say Feather 15/8 (HS-65HB) and 24T (the other two). HS-65MG's page gives both Micro 25 and 23. D89MW and D145SW publish "25 / 6" and "23 / 6", taken as 25T and 23T on a 6 mm output. Hitec's 24T arms are taken as Standard 24.
- Hitec ratings: most pages give torque and speed as a range across 4.8 to 6 V (or 6 to 7.4 V) with no voltage against each end; the low torque and slow speed are taken as the lower voltage's. HS-225MG and HS-5245MG were read from their product page and Hitec's chart directly.
- Conflicts kept to one figure: HS-5125MG's spec table says nylon gears, its name and features metal (metal used). HS-85BB, HS-311, HS-77BB: nylon vs resin (both plastic). HS-322HD and HS-485HB: Karbonite vs "HD resin" (Karbonite used). Futaba S-U305 and S-U306 have identical figures and are listed as both digital and analogue on futabausa.com (digital left unknown); S3306 is listed as an airplane servo but described as a 1/5-scale car servo (left out). S-A300, S-A501 and S-A601's heights differ between Japan and the USA (Japan's used). S3150's "81 oz" and PS-14's "6 oz" are packaging weights (the product's used).
- Rated at one voltage only: S3016 (6 V), S3102, S3107, S3150, S3155 (4.8 V), PS-10 (5 V); PS-14 gives its speed at 4.8 V and its torque at 6 V. Several masses and sizes were published in ounces and inches only and are converted (S3114M, S3155, S3176SV).
- Possibly discontinued but listed: HS-5485HB (a Hitec listing names D485HW as its successor), HS-5625MG. Left in, as current, until Hitec's page says otherwise.
- Not in the catalogue: travel (no maker publishes it per model; the configurator's ±45° or ±60° choice stands in), and arms' and horns' thickness, hole diameter and mass.

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
