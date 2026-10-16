# Wingcalc v9: the rest of the plane — scope

Second of three bodies of work (see `docs/scope-v8.md` for all three). From a single wing to a whole airframe: tail or foreplane, fins, fuselage, layout and stability. Builds on v8's control surfaces and servo bays; v10 adds power, electronics and flight loads. Draft, not started.

## Objective

Design the whole airframe and say whether it is stable: the neutral point and the CG range it needs, how it glides, and the parts to build it.

Aerodynamic target, across v9 and v10: XFLR5 parity for what modellers ask (lattice plus XFOIL sections: stability, polars, control authority, optionally dynamic modes), with structure and cutting files on top. Not CFD; post-stall, propwash and fuselage aerodynamics stay empirical.

## Decisions

Agreed with Matt on 2026-10-13 and 2026-10-16:

- **Configurations**: conventional, T-tail, V-tail, flying wing, canard.
- **Control surfaces** on every surface, from v8's mechanism: elevator, rudder, and their mixed forms (elevons on a flying wing, ruddervators on a V-tail).
- **Flying-wing fins**: winglets and a centre fin are both available, each with an optional rudder.
- **Fuselages**: box (flat sides, formers), pod-and-boom, and a box that tapers to a boom joint aft of the wing. No lofted, moulded or foam fuselages.
- **Booms**: carbon or aluminium tube (circular hollow section).

## Consequences of those decisions

- Flying wings and canards rule out the textbook wing-plus-tail neutral-point formula. Stability needs a **multi-surface vortex lattice (VLM)** covering sweep, dihedral, twist, V-tails and surfaces ahead of the wing. The main wing stops being special and becomes one lifting surface among several.
- Flying wings need the section pitching moment. XFOIL polars already carry `cm` (`src/lib/xfoil.js`); the bundled airfoiltools polars need checking.
- Canards need "the foreplane stalls first", which builds on the existing stall-onset work (`stall.js`, `liftingLine.js`).
- The lattice is cheap in the browser (a few hundred panels, a dense solve in milliseconds), but runs in a worker like XFOIL so typing stays smooth.
- The neutral point and the recommended CG range come from geometry alone. Where the CG actually sits, and where the battery goes to put it there, is v10.

## Sequenced phases

Rough sizes are relative to the v5–v7 rounds.

1. **Aircraft model** (1 round). State becomes `{ units, layout, surfaces: [...], fuselage, ... }`; v10 adds power and items. Each surface has a role (main, tailplane, fin, V-tail, foreplane, winglet fin, centre fin), position, incidence, mirror or vertical flag, panels, aerofoil, structure, control surfaces and export options. Configuration presets create the surfaces. `migrate` turns old saves into a single main wing. `WingCalc.vue` stops reading a flat `input`; undo history and projects follow.
2. **Surfaces in the UI** (½–1 round). One card per surface; v8's plan, panel, structure and section editors open on the chosen surface. Fins are half-surfaces standing vertically in 3D; a V-tail is dihedral. Tail and fin design load cases (tail lift and gust) rather than n·W.
3. **Stability engine** (1 round). VLM across all surfaces in `src/lib/vlm.js`: CLα, neutral point, Cm0 (section `cm` plus twist), with a fuselage term (Gilruth/Munk style). Recommended CG range for a chosen static margin, and trim and decalage at a cruise speed. Per-configuration checks: tail volumes against typical bands, canard stall order, flying-wing Cm0 and reflex, a T-tail deep-stall warning. **Control authority**: deflect a surface and read off its derivatives, to answer whether the elevator can rotate and flare, and what roll rate the ailerons give. Tests check the VLM against the lifting line for a single wing and against published results.
4. **Glide polar** (½ round). Drag build-up from XFOIL section drag per strip, induced drag from the lattice, and empirical fuselage and interference drag. Gives L/D, minimum sink, best glide and the speed polar, with flaps, crow and air brakes from v8. For gliders, the headline number. v10 adds powered performance.
5. **Layout** (½–1 round). Whole-aircraft side and plan views: place surfaces by dragging or typing, with NP and recommended CG markers.
6. **Fuselage geometry** (1 round). Box: side and top profiles as Bézier curves, stations. Pod-and-boom: pod outline. Box to boom: the taper and the boom joint aft of the wing. Booms from a tube catalogue (carbon and aluminium, like edge stock). Side-view editor in the house style (`StageZoom`, command bar, no tool rail).
7. **Fuselage structure** (1½ rounds). Box: sides, doublers, formers with cut-outs (wing saddle, tail seat, T-tail fin mount), longerons. Pod-and-boom and box to boom: pod formers and sides, the boom clamp or socket, tail mounts on the boom. Nose former left plain for v10's firewall. Boom check for bending and torsion under tail loads. Parts, 3D and DXF.
8. **Integration** (½–1 round). Whole-aircraft 3D, combined export and nesting, the page cards, user guide and methods. Name and front page review.

Total: roughly 6½–8 rounds.

## Open questions

- Name: "Wingcalc" undersells a whole-aircraft designer. Rename now, at the end of v9, or keep it?
- Boom joint: a socket in the fuselage, a clamp, or both? Bonded or removable for transport?
