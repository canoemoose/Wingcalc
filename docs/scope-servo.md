# Wingcalc: servo configurator — scope

From Matt's brief of 18 October 2026 ("WinCalc – Servo Configurator Brief"), revised against the code as it stands. Draft, not started.

## Objective

Replace a bay's servo picker with a configurator for the whole servo-to-surface assembly (servo, arm, linkage, horn), placed on the plan as a linked pair, with the throw it actually gives worked out live and checked against the throw the surface was designed for. The 3D view shows the result and stays view-only.

The data model is laid out so torque and hinge-moment checks can be added in v10, when there's an airspeed, without rebuilding the catalogue.

## What exists (and where the brief differs from the code)

- **Servo catalogue** (`src/lib/servos.js`): four generic classes plus about 20 Hitec models. The Hitec figures were read by hand off the dimensioned drawings on each hitecrcd.com product page and typed in as mm (`drawn()` converts them). There is **no scrape script and no 3D model per servo**: the 3D servo is built parametrically from those figures (`servoFrame`, `servoParts`). "Reuse the pipeline" therefore means: reuse the schema and the hand-reading method, and write the Futaba entries the same way.
- **Stored per servo now**: case, lugs (including wing-servo lugs), output boss offset/top/diameter, lead exit, mass, one torque figure. **Not stored**: spline, gear type, analogue/digital, speed, torque at each voltage, travel.
- **Bays** (`placeBays`, `fitBaysToRibs`): one per control surface, positioned by `along` (a number, not dragged), mounted `upright`, `side` or `flat`, and fitted between the wing's own ribs on a ply tray. There's no rotation in plan, and the tray assumes the servo's length runs along the chord.
- **Fit check** already exists: a bay too shallow for its servo is warned (and its servo pokes through the skin in 3D). This round extends it, rather than adding a new one.
- **Hinges** are a bevelled hinge line with Mylar tabs slotted at the **centre line** (`bevelAngle` in `controlSurfaces.js`; tabs in `wing3d.js`, `ribs.js`). The pivot is the centre line; there is no skin-surface hinge and no "hinge face" field. Surface hinges are left out for now (Sam, 18 October 2026); the horn goes on the top or bottom face, its height measured from the centre line.
- **Throws**: each surface already has designed `up`/`down` throws in degrees (wing editor, `ControlSurfaceEditor.vue`), with role defaults. These are the requirement; the linkage geometry gives what's achieved.
- **Ownership split**: where a surface is and its throws are the wing editor's; its hinge gap and servo bay are the structure editor's (`SurfaceStructure.vue`, `StructurePlan.vue`).
- **Both halves in 3D** (`Structure3D.vue`) clones the half and sets `mirror.scale.x = -1`. three.js corrects the winding for a negative-determinant object, and nothing in 3D carries text, so this renders correctly today.

## Decisions (changes from the brief)

1. **Configure in the structure editor.** The configurator opens from a bay in `SurfaceStructure.vue`, and placement happens on the structure plan (`StructurePlan.vue`), where bays already live. The wing editor's plan keeps surfaces and throws only.
2. **Pushrod only, this round.** Pull-pull and torque rods are for tail surfaces and fuselage-mounted servos, which arrive in v9. The schema keeps `linkage.type` so they slot in then; the configurator shows only pushrod until there's somewhere they make sense.
3. **Throw is compared with the design, not just reported.** Outputs are the achieved up and down throw (degrees and mm at the trailing edge), set against the surface's designed `up`/`down`, with a warning when the linkage can't reach them within the servo's travel. Differential is shown as achieved up/down against designed.
4. **Servo travel is a choice, and the design throws set the servo's midpoint.** Each bay chooses ±45° (standard) or ±60° (extended end points). The surface's designed up and down throws (the existing deflection box) give, through the linkage, the servo angle needed each way. The servo's midpoint sits half way between those two angles, so its travel is used evenly; the travel needed each way is half their sum, and must be within the chosen ±45° or ±60°. Where the throws are unequal, surface neutral sits off the servo's midpoint: the app shows by how much, as the arm's angle at surface neutral.
5. **Arms belong to the servo model.** Each servo lists its compatible arms: every arm its maker offers for that model (Sam). The spline is stored too (Hitec isn't all 24T, Futaba isn't all 25T), but the list is what the Arm column shows. Generic classes keep generic arms.
6. **Horns: generic first, makers second.** Hole heights for horns are rarely published. The catalogue starts with parametric generic horns (holes at stated heights), built in 3D from their figures like the servos; maker horns are added where a drawing gives the hole positions, and reported where it doesn't. Maker arms are the same: an arm with no published hole radii is reported, not guessed.
7. **The servo's angle in plan is a setting, not a free rotation**: square to the chord, square to the hinge, or either of those turned a quarter turn (length across the span). Square to the hinge keeps the pushrod square to the horn on a tapered or swept surface. It's still an odd angle to the chord there, so the bay's geometry (the placed parts, the plate's cut-out and screw holes, the fit between ribs, 3D and DXF) moves from boxes aligned with the chord and span to turned ones. No rotation handle on the plan.
8. **Mirroring needs no new 3D code, and the "flag a difference" check is replaced by a test.** A servo case and arm are symmetric about the plane through the output shaft and the case's length, so the mirror image of an assembly is the same servo turned over, and its geometry and throws are identical. The existing `scale.x = -1` stays (it renders correctly); a test asserts the mirrored side's throws equal the designed side's. The UI note that the servo's direction reverses on the other side (set in the transmitter) stays. Two real asymmetries are handled: a spline can't always give the exact mirrored neutral angle (the nearest tooth, with the error shown, for subtrim), and a mounting that's genuinely different on the other side (upside down) is out of scope until someone builds that way.
9. **Differential comes from the throws, not a hand-set offset.** The brief's intentional neutral offset is the one decision 4 derives: the arm sits off square at surface neutral by the amount the unequal throws need. The "not square" warning checks squareness at the servo's midpoint, so a differential set this way isn't flagged. Dragging the arm in the drawing only picks which way it faces.
10. **Design, then place.** The configurator is a centred dialogue; placement is on the plan afterwards. Nothing in the dialogue depends on where things sit except whether a servo fits, which uses the bay's current position. A servo dragged somewhere it doesn't fit is warned on the plan, and clicking it reopens the dialogue.

## Data

Catalogue, in `src/lib/servos.js` (servos) and a new `src/lib/linkage.js` (arms, horns, the geometry), SI units throughout:

- **Servo**: as now, plus `spline` (tooth count and type), `arms` (the ids of its compatible arms), `gears` ('plastic', 'metal', 'karbonite'…), `digital`, and `ratings`: `[{ volts, torque, speed }]` (N·m, s per 60°). The existing `torque` stays as the 4.8–6 V figure the bays already use.
- **Arm**: id, maker (or generic), spline, `kind` ('single', 'double', 'cross', 'disc'), `holes` (radii from the pivot, m, per arm), seat height, thickness, mass.
- **Horn**: id, maker (or generic), `holes` (height above the surface's face, m), base footprint, mass.

Saved with the bay in `controls.bays` (anything new also in the defaults, so older saves migrate):

- `square` ('chord' or 'hinge') and `quarterTurn` (true for the length across the span), the servo's angle in plan (decision 7);
- `arm`, `armRotation` (which way it faces), `armHole`, `linkage: { type: 'pushrod' }`, `horn`, `hornHole`, `hornFace` ('top' or 'bottom'), `hornAt` (along the surface, m, and its rotation from square to the hinge), `travel` (45 or 60, degrees each way). The arm's angle at surface neutral is derived (decision 4), not saved.

## Steps

1. **Catalogue schema and data** (1½ rounds). *Done 18 October 2026, except hole positions: see below.* New fields on the Hitec entries. Futaba: the S3001 and every current analogue and digital standard, mini, micro and wing servo, read from Futaba's drawings the same way as the Hitec set, one request at a time with the same etiquette as the aerofoil fetch. Every arm each model is offered with. Generic horns. A backlog entry lists every model or arm whose figures couldn't be found. Tests: every servo has the fields and at least one arm, and every arm it lists exists and matches its spline.
2. **Linkage geometry** (½ round, pure, in `linkage.js`). Arm hole and horn hole positions in 3D from the placement; pushrod length at neutral; achieved surface angle for a given servo angle (closed form for the four-bar linkage, not a small-angle ratio), so up and down throws, differential and mm at the trailing edge; mechanical advantage; the servo angle needed for each designed throw, its midpoint and the travel needed each way (decision 4); squareness at the midpoint; mirrored side by reflection. Horn height is measured from the centre-line pivot. Tests against hand-worked cases.
3. **Configurator** (1 round). A centred dialogue from the bay (`ServoConfigurator.vue`), laid out in columns like a Finder column view: Servo › Arm › Horn, each filtering the next (the servo's own arms). Travel (±45° or ±60°) is a switch beside the linkage type. Linkage type is a small switch, not a column, while there's only pushrod. Below the columns, a side-on drawing of the assembly (SVG, from the same geometry):
   - holes are picked by clicking them on the arm or horn, and the arm is dragged round to choose which way it faces; its angle at surface neutral is shown, from the throws;
   - hole pairs that give the designed throws within the chosen travel are highlighted, the one using the most of it marked as best (finest control); the rest show how far off they are;
   - the surface's designed throw range is drawn faintly with the achieved range over it.

   Servos that won't fit the bay at its current position are greyed out, with the reason on hover (e.g. "needs 26 mm, bay has 21 mm"). A summary line along the top ("HS-5125MG › single arm, hole 2 › micro horn, hole 3") jumps to a column when clicked.
4. **Placement on the structure plan** (1½ rounds). The servo and horn as a linked pair with two handles, the pushrod drawn between them. The servo handle moves the servo; its angle is the setting in decision 7 (in the inspector), with the bay geometry turned to match. The horn handle snaps onto the moving surface and stays square to the hinge (rotatable from square). Fit and squareness are warned on the plan; clicking either end reopens the configurator. Undo/redo as for the other plan edits.
5. **3D and fit check** (½ round). Arm, horn and pushrod as solids with pieces (and picks where they're parts) per the `wing3d` conventions; `tests/partPick.test.js` covers them. The existing bay fit check extended to the arm's swept height and the horn and pushrod through the skin (the hatch or a slot), flagged in both views.
6. **Docs** (with each step). `docs/methods.md` for the linkage geometry, the midpoint and travel; `docs/user-guide.md` for the configurator and placement; `THIRD_PARTY_NOTICES.md` if any maker data or drawing is bundled.

About 5½ rounds in all.

### Step 1 as built

- `src/lib/servoCatalogue.js` holds the published figures; `servos.js` builds `HITEC`, `FUTABA` and `CATALOGUE` from them, each entry with `ratings`, `gears`, `digital`, `spline` ({ type, teeth }) and `current`. 29 Hitec and 31 Futaba servos.
- Futaba publishes no dimensioned drawings, so Futaba entries carry `estimated: ['lugs', 'output', 'lead']` and take those from their class (`servoFrame`).
- `src/lib/linkage.js` holds `ARMS` (27, Hitec and Futaba), `HORNS` (9 control horns) and `armsFor(servo)`. Compatibility is by the maker's spline name, or by a horn set naming the servo, rather than a stored list per servo: one rule, and a new arm reaches every servo it fits.
- **No hole positions anywhere**: no maker publishes them. Step 2's geometry needs them measured (backlog, "Servo catalogue"). Until then, step 3 could take an arm's and a horn's hole positions as typed-in figures.
- Generic horns were not added: with no published heights to base them on, they'd be invented.

## Out of scope

- Torque against hinge moment (needs airspeed: v10). The catalogue carries the ratings for it.
- Pull-pull and torque rods (v9, with the tail and fuselage).
- Editing in 3D.
- Surface (skin) hinges; the hinge stays on the centre line (Sam).
- Free servo rotation in plan (decision 7: square to the chord or hinge covers it).
- A non-modal configurator beside the plan (decision 10).
- A slider sweeping the linkage through its travel; the drawn throw range shows the same thing.
- Copying an assembly to other surfaces (worth it once v9 brings the tail).
- A different mounting on the mirrored side (upside down).

## Open questions

1. **Horn brands.** Sam named servos and arms but not horns. Generic horns to start with, or are there makers' horns he uses (Du-Bro, Hitec, Futaba, 3D-printed)?
2. **Hitec breadth.** Futaba is "every current standard, mini, micro and wing servo". Should the Hitec set be brought up to the same breadth, or stay at the 20-odd models it has?

Resolved (Sam, 18 October 2026): surface hinges left out, horn top or bottom; Futaba models and arms as in step 1; travel ±45° or ±60°, with the midpoint as decision 4 reads it (Matt: "probably about right"; check against Sam's first real setup). "WinCalc" in the brief is Wingcalc.
