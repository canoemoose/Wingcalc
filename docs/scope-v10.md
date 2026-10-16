# Wingcalc v10: make it fly — scope

Third of three bodies of work (see `docs/scope-v8.md` for all three). Power, electronics, mass and CG, flight loads and performance, on the airframe from v9. Draft, not started.

## Objective

Say where the CG actually sits and how to put it where v9 says it should be, whether the airframe is strong enough for how it will be flown, and how it performs under power.

## Decisions

Agreed with Matt on 2026-10-16:

- **Powered and glider both.** Brushless power with an ESC.
- **The fuselage is reinforced for the motor.** Side and down thrust angles are options, to limit torque roll and nose lift.
- **Powered flight is a load case.** Power changes the loads on the wing and the fuselage, and both the structure checks and the loading figures must reflect it.
- **Inverted flight is considered.**

### Assumptions (to confirm)

- "Wing loading changes under powered flight" is read as: the power system adds mass (raising wing and cube loading compared with the glider version), and it raises the top speed. Top speed drives the manoeuvre and gust loads. So loads come from a **V–n envelope**: a stall line from CLmax, positive and negative limit load factors, Vmax from the propulsion model, and gust lines at Vmax. The wing spar check and the fuselage check both read their design load from it instead of a fixed n·W. A glider uses the same envelope, with its own Vmax: dive, winch or tow.
- **Inverted flight** means the negative side of that envelope is designed for, not just checked. Both spar caps are sized for it, and aerobatic guidance covers symmetrical sections and a CG nearer neutral. The structure settings already carry a negative load factor (`loads.negativeG`), which isn't shown anywhere yet.
- Fuselage loads under power: thrust and motor torque at the firewall; motor and battery inertia in a hard landing; and the tail loads carried back along the fuselage or boom.
- The motor is nose-mounted (tractor) by default.

## Sequenced phases

Rough sizes are relative to the v5–v7 rounds.

1. **Propulsion** (1 round). Catalogues for brushless motors (Kv, mass, maximum current and power, mount pattern), propellers, LiPo batteries (cells, capacity, C rating, mass, size) and ESCs (current rating, mass). Thrust against airspeed, current draw, and a check that the motor, ESC and battery are matched. With v9's drag polar: Vmax, climb rate, thrust-to-weight and flight time.
2. **Mass and CG** (1 round). Mass build-up in fore–aft and vertical position: structure weights per surface, the fuselage, v8's servos, the power system, and an items list (receiver, ballast). Where the CG sits against v9's recommended range, and where the battery or ballast goes to put it there. Wing and cube loading for the powered all-up mass, and the glider version too if the same airframe flies both ways. Fuselage servo tray and battery bay with its hatch.
3. **Thrust line** (½ round). The thrust-line offset from the vertical CG gives the pitch change under power, turned into a suggested down-thrust angle. Motor torque gives a suggested side-thrust angle.
4. **Flight loads** (1 round). The V–n envelope, positive and negative. It replaces the fixed design load factor in the wing and tail structure checks, and drives the fuselage and boom checks. Inverted-flight guidance.
5. **Motor reinforcement** (½–1 round). A ply firewall sized to the motor's power and mount pattern, with bolt holes and an angled seat for the thrust angles, triangle stock behind it, and forward doublers. Margins from the flight loads (thrust, torque, hard landing). Parts, 3D and DXF.
6. **Dynamic stability** (optional, about 1 round). Stability derivatives from v9's lattice plus mass and inertia from the mass build-up give the eigenmodes: short period, phugoid, Dutch roll and spiral. Report spiral and Dutch roll in plain terms, since those are where tail and dihedral sizing go wrong; the rest on demand.

Total: roughly 4–5 rounds, 5–6 with dynamic stability.

## Open questions

- Confirm the V–n and inverted-flight readings above.
- Motor position: tractor nose only, or pushers and pylon mounts too (common on pod-and-boom and flying wings)?
- Propeller data: a simple momentum-and-efficiency model, or bundled measured propeller data? Bundled data raises the same redistribution question as the airfoiltools polars (`docs/backlog.md`).
- Catalogues: generic size classes (2212, 2826, 3536 and so on) that the user can override, or named products? Named products go out of date and raise trademark questions.
- Electric gliders: a folding propeller, and the glide polar with it folded?
