# Structure and ribs editor: review feedback (Part 2)

Part 2 of the review brief of 25 October 2026 (Part 1, the servo configurator, was done separately).
Autonomous: work through, test, run the app, commit by concern, questions batched at the end.

## Objective

| # | Item | Plan |
|---|------|------|
| 2.1 | Cap strips with a D-box | On a D-box, every surface that isn't sheeted gets full cap strips: from the rib's front (the LE stock) back. The cap-strip start (`capStripStart`) is an open-structure setting only, so a D-box ignores it. |
| 2.2 | Spar too deep for the rib | A solid spar tapers to what each rib can hold. Each affected rib takes one of two fits: keep `spar.ribMargin` (4 mm) of rib above and below the spar, or split the rib in two at the spar, the spar standing the full height there. Wing-wide default `spar.thinRibs`, per-rib choice `spar.ribFits` keyed by rib name (as the braces' thicknesses are). Strength uses the tapered depth. |
| 2.3 | Spar template | A tapered solid spar is exported as a part (group `spars`), its outline the spar's depth along its length, so it can be cut or used as a template. |
| 2.4 | Cap-and-web spar's web | The web sits on the caps' leading-edge face, the rib's full height less any sheeting (between the inset surfaces). Optional second web on the trailing-edge face (the old Box spar, now a checkbox under Caps and web). |
| 2.5 | Carbon reinforcement | Stringers gain a profile: rectangular (as now), carbon rod, carbon tube or flat carbon strip. Any size. Placed on the top, bottom or both skins (a notch) or inside the wing at a height (a hole through each rib). |
| 2.6 | Hard-point sheeting | Each sheeted hard point has its own sheet thickness, and a D-box sheet thickness of its own for its bays. Sheeting thickness can be set per panel (blank: the wing's). |

## Constraints

- Pure logic in `src/lib/`; new nested settings in `defaultStructure()` so `fillDefaults` migrates older saves.
- Warnings beside their settings (`src/lib/warnings.js`).
- `docs/methods.md` and `docs/user-guide.md` kept current.
- Older saves unchanged where possible: a hard point with no thickness of its own keeps the covering's; a Box spar is a caps spar with the second web on.

## Files in play

`src/lib/structure.js` (skinAt, capStripStart, sheetExtent, hardPatches, sparSection, sectionElements, analyseStructure),
`src/lib/ribs.js` (buildRib, buildParts, cut list), `src/lib/wing3d.js` (sparBoxes, webBoxes, stringerBox, sheetSection, patchSection),
`src/lib/dxf.js` (part groups), `src/components/StructureEditor.vue`, `src/lib/warnings.js`, tests, docs.

## Steps

1. 2.1 cap strips (structure.js skinAt, ribs.js capFrom).
2. 2.6 per-panel and hard-point sheeting: `sheetThicknessAt(structure, s)`, `skinAt` takes s; hard patches carry their own thickness.
3. 2.4 web on the caps' faces (wing3d webBoxes, ribs.js web parts, strength web height).
4. 2.5 reinforcement profiles and inside placement.
5. 2.2 spar taper and rib fits; 2.3 spar template part.
6. Editor UI, warnings, docs, tests, run the app, commit.

## Status

- [ ] 2.1
- [ ] 2.6
- [ ] 2.4
- [ ] 2.5
- [ ] 2.2
- [ ] 2.3

## Open questions (for the end-of-task batch)

- 2.2 "split the rib at the spar's maximum height": read as the spar keeping its full depth (as much as the rib allows) and the rib cut in two, fore and aft of it. Confirm.
- 2.2 applies to solid spars. A caps spar follows the section already; a tube can't taper (it keeps its fit warning).
