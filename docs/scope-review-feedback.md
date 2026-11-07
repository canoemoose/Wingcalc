# Review feedback (25 October list, gone through 7 November)

Matt and Sam's comments on `docs/review-2026-10-25.md`. Interactive: small steps, each shown before the next; nothing committed until asked.

## Decisions taken

- Horn checks, the XFOIL warning and Ncrit: fine as they are.
- Leads never run ahead of the spar; `TRAY_SLACK` 1.5 and `LEAD_EXTRA` 1.5 mm stand.
- Polar data licence: dropped (personal use).
- Older interface questions (v2, v3): thrown away.
- Foam wings: "finish" is called Covering, as on built-up wings.
- Hitec: add the models with published figures, to sit alongside the Futaba set.
- Screw blocks, horn shapes, inset packing, `MIN_PLY`: fine as they are.
- Servo position fore-aft: never through the spar (as built).

## Work

### Smaller fixes

| # | Item | Plan |
|---|------|------|
| 1 | Carbon colour | Carbon rods and tubes drawn carbon-coloured in 3D; tubes hollow. |
| 2 | Split rib gap | A split rib whose spar is shorter than the rib leaves no gap: the pieces meet the spar. |
| 3 | PDF plan | Reinforcement and stringers drawn as outlines, not single lines. |
| 4 | Loads zoom | − + Fit over the chart, not the readout; zoom the vertical axis too. |
| 5 | Plan hatching | Hatch a hard point's own sheeting, as the D-box's is. |
| 6 | HINGE layer | Hinge lines and control surface outlines on separate DXF layers. |
| 7 | Bay width | The servo needn't be centred: the arm's room is added on its side only, so bays are narrower. |

### Medium

| # | Item | Plan |
|---|------|------|
| 8 | Arm slot | Cut from the sheeting parts, the hatch and the DXF plan; listed in the cut list. |
| 9 | Plate slot | Sized from the linkage's solved sweep plus a clearance, not ±15°. |
| 10 | Arms | Modelled with a boss and taper. |
| 11 | Hatch | Optional (a servo may be sealed in); when there is one, in the skin the servo is reached from. |
| 12 | Webs | Front, back or both, replacing "second web" (older `box` saves load as both). |
| 13 | Notches | Stringer and reinforcement notches shaped to the stock and open to the edge, so it slides in. |
| 14 | Rib fit list | The per-rib spar choices as a table. |
| 15 | Strength | Hard points' own sheeting counted in the strength check. |
| 16 | Covering section | Covering and sheeting settings separated; closer maximum rib spacing for tissue. |
| 17 | Hinge spars | Not sized from the Mylar tab (Mylar is cut to fit). |
| 18 | Caps and web at thin ribs | Where the rib between the cap notches would be under 4 mm: split the rib (default) or make the caps shallower there to keep 4 mm. Same choice as the solid spar's thin ribs. |

### Bigger

| # | Item | Plan |
|---|------|------|
| 19 | Hard point sheeting, fully sheeted wing | Its own part; the wing's sheeting cut to clear it; no overlap in 3D; D-box hard point sheeting shown in the cut list and parts. |
| 20 | Dihedral braces | Solid in 3D; inside the wing's profile; ribs clear them; sized between the hard point's sheeting where that's thicker. |
| 21 | Hinge types | Pinned and live (sheeted) hinges besides slotted Mylar. |

### Backlog moves

Flaps' 3° progressive-stall allowance; crow offering and saving the configuration; the air brake servo's place; the design booklet; air brakes reworked; a 3D solid export for CNC. Arm and horn hole measurements stay in the backlog.

## Status

Mode: autonomous (7 November). Commits by concern on master, not pushed.

- [x] 1 carbon colour, hollow tubes (`41b3386`)
- [ ] 2 split rib gap: **parked, question for Matt** (deepen the spar to fill the rib at a split rib, or keep thin strips of rib above and below it?)
- [x] 3, 5, 6 plan outlines, hard point hatch, SURFACE layer (`00fb5e6`)
- [x] 4 loads zoom both axes, buttons over the chart (`6bc145a`)
- [x] 7 bay off-centre (`fcdbd2e`)
- [x] 8, 9 arm slot in sheeting/hatch/plan; plate slot from solved swing (`752012d`)
- [x] 10 arm boss and taper (`32b991e`)
- [x] 11 optional hatch, on the servo's side (`fa7d0e4`)
- [x] 12 front/back/both webs (`1e770c8`)
- [x] 13 round-bottomed rod notches (`dd6d2e1`)
- [x] 14, 18 thin ribs as a table; caps split (default) or thinned at thin ribs (`ec4e39e`)
- [x] 15 hard points' sheeting in the strength check (`ba8d4db`)
- [x] 16 Sheeting and Covering sections; foam "finish" is Covering; tissue wants 50 mm ribs (`ed789da`)
- [x] 17 Mylar tabs trimmed to the hinge spars; spars back to 8 and 10 mm (`803572b`)
- [x] 19 hard point sheeting its own pieces; wing sheeting cut to clear it; parts under it inset by it (`806f32b`)
- [x] 20 braces as solids inside the wing, sized for the skins beside the spar, ribs they cross cut in two (`de67c73`)
- [x] 21 pinned and live hinges (`884519d`); seven Hitec models from their spec tables (`7656bf9`)
- [x] Backlog moves; polar licence item dropped
- [ ] Review list tidied: left for Matt, who is working in it (it has his uncommitted edits)

## Assumptions made while working

- 6: HINGE keeps the fixed hinge spar and tabs; SURFACE has the moving surface's hinge spar faces and ends.
- 9: the plate's slot covers the servo's whole travel (±45° or ±60°) about where the solved linkage puts the arm, not just the throws' travel; the bay is still placed with the old wider allowance, then re-cut.
- 10: arm sizes (boss 7/9.5/12 mm, tip 3.2/4.2/5.5 mm) are typical, not measured.
- 11: a sealed-in servo's arm slot goes in the skin (sheeting part, or the covering).
- 13: inside rods and tubes still go through holes (threaded along the span); only skin notches are round-bottomed.
- 15: a hard point's sheet is counted to the trailing edge even beside a control surface (it really stops at the hinge spar): a small overestimate there.
- 16: tissue's limit is 50 mm; choosing tissue lowers the "most apart" to 50 mm if it was more, and a warning beside the rib spacing says if it's later set wider.
- 17: hinge spar defaults go back to 8 mm (fixed) and 10 mm (moving) for new projects; saved projects keep theirs. Tabs stop 1 mm short of the narrower spar's far face.
- 18: the caps' "Thin the caps" option means sanding them down towards that rib; the caps strip is still cut at full thickness in the cut list.
- 19: everything fitted under the skin in a hard point's bays (ribs, caps, stringers, webs, braces) is now inset by the hard point's own sheet where it covers that chord.
- 20: every rib between a brace's arm ends is cut in two round the spar and plates (0.2 mm clearance). Brace depth is measured at the spar and 4 mm outside its outer faces.
- 21: pins default to 3.2 mm × 32 mm (1/8 × 1 1/4 in), which is too long for the default 8 mm fixed spar, so pinned wings warn until the spars are widened or shorter pins set. A live hinge turns about the top skin only. The seven new Hitec models have no drawn figures (their drawings are images); lugs and output come from the class. D485HW's page disagrees with itself; the lower torque is used.

## Second batch (7 November, after the round)

- [x] Brace plates built as strips that don't cross the break; filled in the section cut (`d067ce4`)
- [x] Thin-rib table: per-rib Split / Taper spar (Thin caps) choice, "Internal height"; hard point fields "Sheet thickness" and "D-box sheet thickness", the latter on a D-box only (`b95b446`)
- [x] No cap strips on ribs under a sheeted hard point's sheet (`18c43aa`)
- [x] D-box sheeting over a sheeted hard point always its own piece (`f7c1a18`)
- [x] Arm slot turned with the servo (`05a73b3`)
- [x] Loads charts zoom and pan their height together (`5aec22c`)
- [x] Plan DXF layers split (`7b408c8`)
- [ ] DXF hatching as real hatch or fill: **question for Matt** (R12 has no HATCH entity)

Assumptions: the "part of the servo not rotated" was the arm's slot (the small square box beside the turned servo); "more layers" read as one layer per kind of thing, names as listed in the user guide.
