# Wingcalc v8: whole aircraft — scope

Eighth round, likely spanning several sessions: from a single wing to a whole model aeroplane or glider. Source of truth for this work. Draft, not started.

## Objective

Design an entire model: wing, tail or foreplane, control surfaces and fuselage. Say whether it is stable, where the CG goes, how it performs, and export every part.

Aerodynamic target: XFLR5 parity for what modellers ask (lattice plus XFOIL sections: stability, polars, control authority, optionally dynamic modes), with structure and cutting files on top. Not CFD; post-stall, propwash and fuselage aerodynamics stay empirical.

## Decisions (agreed with Matt, 2026-10-13)

- **Configurations**: conventional, T-tail, V-tail, flying wing, canard.
- **Control surfaces are designed in**: ailerons, elevator, rudder, and their mixed forms (elevons on a flying wing, ruddervators on a V-tail). Cut as separate hinged parts.
- **Fuselages**: box (flat sides, formers) and pod-and-boom. No lofted, moulded or foam fuselages.

## Consequences of those decisions

- Flying wings and canards rule out the textbook wing-plus-tail neutral-point formula. Stability needs a **multi-surface vortex lattice (VLM)** covering sweep, dihedral, twist, V-tails and surfaces ahead of the wing. The main wing stops being special and becomes one lifting surface among several.
- Flying wings need the section pitching moment. XFOIL polars already carry `cm` (`src/lib/xfoil.js`); the bundled airfoiltools polars need checking.
- Canards need "the foreplane stalls first", which builds on the existing stall-onset work (`stall.js`, `liftingLine.js`).
- Control surfaces need a hinge (rear) spar in the structure, which the wing doesn't have yet.
- The lattice is cheap in the browser (a few hundred panels, a dense solve in milliseconds), but runs in a worker like XFOIL so typing stays smooth.

## Sequenced phases

Rough sizes are relative to the v5–v7 rounds.

1. **Aircraft model** (1 round). State becomes `{ units, mass, layout, surfaces: [...], fuselage, items }`. Each surface has a role (main, tailplane, fin, V-tail, foreplane, winglet fin), position, incidence, mirror/vertical flag, panels, aerofoil, structure and export options. Configuration presets create the surfaces. `migrate` turns old saves into a single main wing. `WingCalc.vue` stops reading a flat `input`; undo history and projects follow.
2. **Surfaces in the UI** (½–1 round). One card per surface; the existing plan, panel and structure editors open on the chosen surface. The fin is a half-surface standing vertically in 3D; a V-tail is dihedral. Tail design load case (tail lift or gust) rather than n·W.
3. **Control surfaces** (1 round). Per panel: hinge line as a chord fraction (may taper) over a span range. Rib split at the hinge, hinge spar on both sides, bevel and gap, separate parts for the moving surface, plan, 3D and DXF. One mechanism serves every surface and role. Once the lattice exists (phase 4), **control authority**: deflect a surface and read off its derivatives, to answer whether the elevator can rotate and flare, and what roll rate the ailerons give.
4. **Stability engine** (1 round). VLM across all surfaces in `src/lib/vlm.js`: CLα, neutral point, Cm0 (section `cm` plus twist), with a fuselage term (Gilruth/Munk style). Static margin, recommended CG range, trim and decalage at cruise. Per-configuration checks: tail volumes against typical bands, canard stall order, flying-wing Cm0 and reflex, a T-tail deep-stall warning. Tests check the VLM against the lifting line for a single wing and against published results.
   **Whole-aircraft polar and performance** (about ½ round more): drag build-up from XFOIL section drag per strip, induced drag from the lattice, and empirical fuselage and interference drag. Gives L/D, minimum sink, best glide and the speed polar; for gliders, the headline number.
5. **Layout and mass** (1 round). Whole-aircraft side and plan views: place surfaces by dragging or typing, with NP and CG markers. Mass build-up from structure weights per surface, the fuselage, and a list of items with positions (motor, battery, servos, receiver, ballast); the app suggests where the battery or ballast goes to hit the CG.
6. **Fuselage geometry** (1 round). Box: side and top profiles as Bézier curves, stations. Pod-and-boom: pod outline, boom from a tube catalogue (like edge stock). Side-view editor in the house style (`StageZoom`, command bar, no tool rail).
7. **Fuselage structure** (1½–2 rounds). Box: sides, doublers, formers with cut-outs (wing saddle, tail seat, T-tail fin mount, servo tray), longerons. Pod-and-boom: pod formers and sides, boom clamp, tail mounts on the boom. Parts, 3D and DXF.
8. **Integration** (½–1 round). Whole-aircraft 3D, combined export and nesting, the page cards, user guide and methods. Name and front page review.
9. **Dynamic stability** (optional, about 1 round). Stability derivatives from the lattice plus mass and inertia from the mass build-up give the eigenmodes: short period, phugoid, Dutch roll and spiral. Report spiral and Dutch roll in plain terms, since those are where tail and dihedral sizing go wrong; the rest on demand.

Total: roughly 8–10 rounds without dynamic stability, 9–11 with it. More than the app so far.

## Open questions

- Name: "Wingcalc" undersells a whole-aircraft designer. Rename now, at the end, or keep it?
- Hinge types to support: CA hinges with a bevel as the default; pinned and live (sheeted) hinges?
- Servo bays and pushrod exits: model them as geometry, or leave them to the builder?
- Powered and glider both? This affects the items list (motor, ESC) and the default presets.
- Flying-wing fins: winglets only, or a centre fin too?
- Performance needs a propulsion model for powered aircraft (thrust, climb rate), or just the gliding polar?
