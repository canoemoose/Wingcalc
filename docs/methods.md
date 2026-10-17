# Wingcalc methods

How Wingcalc works out its figures. For how to use the app, see the [user guide](user-guide.md).

## Formulas

All calculation is done in SI units (`src/lib/calc.js`, `src/lib/wing.js`); conversion happens only at input and display.

| Quantity | Formula |
| --- | --- |
| Flat wing area (panels) | S = w c<sub>r</sub> + 2 Σ ∫ c ds, over the panels of one side |
| Projected wing area | S<sub>p</sub> = w c<sub>r</sub> + 2 Σ cos Γ<sub>i</sub> ∫ c ds |
| Exposed area | S − w c<sub>r</sub> |
| Wingspan (tip to tip, projected) | b = w + 2 Σ l<sub>i</sub> cos Γ<sub>i</sub> |
| Wing area (mean chord) | S = b c̄ |
| Mean aerodynamic chord | MAC = ∫c² dy / ∫c dy over a half wing (projected y). For a single straight taper this is ⅔ c<sub>r</sub> (1 + λ + λ²) / (1 + λ); it equals the mean chord when entered as mean chord or area |
| Aspect ratio | AR = b² / S<sub>p</sub> |
| Wing loading | WL = W / S |
| Wing cube loading | WCL = W / S<sup>1.5</sup> |
| Stall speed | V<sub>s</sub> = √(2 m g / (ρ S<sub>p</sub> C<sub>L,max</sub>)) |
| Wing C<sub>L,max</sub> | Panels: from the lifting line (below) × cos Λ<sub>¼</sub>. Mean chord or area: 0.9 × cos Λ<sub>¼</sub> × section C<sub>l,max</sub> |
| Reynolds number | Re = V<sub>s</sub> × MAC / ν |

Constants: g = 9.80665 m/s², ρ = 1.225 kg/m³ and ν = 1.4607 × 10⁻⁵ m²/s (ISA sea level).

Here w is the fuselage width, c<sub>r</sub> the root chord, l<sub>i</sub> a panel's length measured flat along the panel, c its chord at each point along the panel, Γ<sub>i</sub> its dihedral angle to the horizontal and Λ<sub>¼</sub> the quarter-chord sweep.

**Units.** 1 oz/ft³ = 1.0012 g/dm³, so metric and imperial cube loadings are numerically almost identical. 1 oz/ft² = 3.0515 g/dm².

## Wing geometry

**Panel shape.** Each panel runs from the previous panel's tip (or the fuselage side) to its own tip. The tip leading edge sits `sweep` behind the inner leading edge; the tip chord is set directly. In between, the edges are either:

- straight;
- quadratic Bézier curves with one control point each, stored as a fraction along the panel plus an offset from the straight edge, so a curve keeps its shape when the panel is resized; or
- defined by **chord stations**: both edges pass through every station's leading- and trailing-edge points and the panel's ends, joined by monotone cubic interpolation (Fritsch–Carlson PCHIP). That is smooth, passes exactly through each dimensioned chord, and never bulges beyond the stations either side, which an ordinary spline can do near a tip. A curved segment next to a straight one leaves along the straight one's direction, so the join has no kink.

Panels are integrated numerically (32 intervals per panel, plus a sample at every station, so straight and faceted panels are exact). A panel whose edges cross, or with a station outside it or two stations at the same place, is rejected with a warning.

**Rounded tip.** The tip cap is two quarter-ellipses meeting at the point of furthest reach: one from the leading edge, one from the trailing edge, each tangent to its edge where it starts. Its chord at fraction u of the extension e is c·√(1 − u²), so its area is (π/4)·e·c exactly, and it takes the tip panel's dihedral.

**Fuselage width.** Panels start at the fuselage sides. The section inside the fuselage is taken as flat with the root chord, and counted in the area used for loadings and stall speed, as is conventional (the fuselage carries roughly the lift of the wing it replaces). The exposed area outside the fuselage is shown separately.

**Sweep.** Λ<sub>¼</sub> is the slope of a chord-weighted straight-line fit to the quarter-chord line across the half wing, so a curved tip doesn't distort it. Sweep reduces the maximum lift a wing can reach roughly in proportion to cos Λ, the usual first-order correction, which is applied to wing C<sub>L,max</sub>. A straight-tapered wing with a straight leading edge has a slight forward quarter-chord sweep; the app only mentions sweep once it reaches 3°, since below that the effect is under 0.2%.

**Dihedral.** Entered as an angle or as the rise of the panel's outer end, related by Γ = asin(rise / l).

**Flat versus projected area.** Wing and cube loading use the flat (developed) area, because that's the figure normally quoted for a model and the one the cube-loading bands were drawn up against. Stall speed uses the projected area: each panel's lift acts perpendicular to the panel, so only its cos Γ component supports the weight. The difference is small for ordinary dihedral (0.4% at 5°) and becomes noticeable only with steep polyhedral tips (about 6% for a tip panel at 20°). Mean chord and area modes assume a flat wing.

**Washout and thickness taper.** Washout varies evenly across each panel. With a thickness taper only the thickness is scaled; the camber line stays the aerofoil's own.

## Cube-loading bands

Wing loading grows with model size, so a given figure means different things on a 1 m and a 3 m model. Cube loading divides by area<sup>1.5</sup> instead, which makes it roughly size-independent: the same number feels similar in the air whatever the span. Thresholds are in oz/ft³ (≈ g/dm³) and follow the commonly used community guideline:

| Band | oz/ft³ |
| --- | --- |
| Glider / floater | below 4 |
| Trainer / park flyer | 4 to 7 |
| Sport / aerobatic | 7 to 10 |
| Sport scale | 10 to 13 |
| Warbird / scale | 13 to 16 |
| Racer / hotliner | 16 and above |

They live in `CUBE_BANDS` in `src/lib/calc.js`.

## Maximum lift

**Wing C<sub>L,max</sub> from the lifting line.** In panel mode the wing's maximum lift comes from its spanwise lift distribution (`src/lib/liftingLine.js`): Prandtl's lifting-line theory, solved by Glauert's Fourier series with 24 odd terms (symmetric loading) collocated between root and tip on the projected span. Each station has its own chord, twist, section lift-curve slope (the polar library's mean at its own Reynolds number) and section C<sub>l,max</sub> (at its own Reynolds number and, with a thickness taper, adjusted by the change the library fit predicts for its thickness at the same camber). The solution is linear in angle of attack, so it is solved once for unit angle and once for the twist alone, and the wing stalls at the angle where the first station reaches its own C<sub>l,max</sub>; C<sub>L,max</sub> is the wing's lift there, and that station is where the stall starts. Sweep isn't modelled by the lifting line, so the cos Λ<sub>¼</sub> correction is applied afterwards. It is checked in the tests against the closed-form elliptic wing (C<sub>L,α</sub> = a₀ / (1 + a₀ / π AR), uniform lift) and the published rectangular-wing result (Glauert's τ ≈ 0.17 at AR 6).

**Mean chord and area modes.** There's no planform to work from, so a finite wing is taken to reach 0.9 of its section's maximum lift, a common rule of thumb for straight, moderately tapered wings (`WING_CLMAX_FACTOR`).

**Reynolds number.** Section C<sub>l,max</sub> depends on Reynolds number, which depends on stall speed. For sections with polars the app looks up C<sub>l,max</sub> at the stall's own Reynolds number, interpolating linearly in log(Re) between the bundled polars (clamped at the ends of the 50k to 1M range), and iterates until stall speed and Reynolds number agree. Polars where XFOIL stopped converging at the peak are left out of the lookup, because their maximum is unreliable.

**Sections without polars.** For the UIUC sections that have coordinates only, and for custom sections, C<sub>l,max</sub> is estimated from camber and thickness: at each bundled Reynolds number, a least-squares fit of C<sub>l,max</sub> = a + b·camber + c·thickness + d·thickness² (in % chord) across all 78 polar-backed sections, interpolated in log(Re) and iterated with stall speed as above. The fit's RMS error is 0.07 to 0.17 depending on Reynolds number (about 6–10%, so roughly 3–5% on stall speed); it is weakest for unusual high-lift sections (S1223: 2.20 from its polar, 1.94 estimated). The estimate is labelled as such, and replaced by the XFOIL polar once that is ready.

## Polars computed in the browser (XFOIL)

Every section gets a polar computed by [XFOIL](https://web.mit.edu/drela/Public/web/xfoil/) 6.996, running in the browser as WebAssembly ([WebXFOIL](https://github.com/PR-DC/WebXFOIL), the original Fortran compiled with flang and Emscripten), in a worker. Results appear in two stages:

1. **Instantly:** the bundled airfoiltools.com polars for library sections, or the camber/thickness estimate for catalogue and custom sections.
2. **About 1 to 3 s later:** Clmax, the stall rating and the lift curve from the computed polar, labelled "from XFOIL … computed here".

**Settings:** 160 panels, Ncrit 9, 50 iterations per point, alpha −4° to 18° in 0.5° steps, swept out from 0° in both directions (a sweep cold-started at −4° can lose convergence and never recover). 160 panels reproduce the airfoiltools.com polars most closely; XFOIL's newer default of 240 is about three times slower and no closer. Settings are `XFOIL_SETTINGS` in `src/lib/xfoil.js`.

**Following the stall's Reynolds number.** Polars are solved on a grid of Reynolds numbers about 10% apart, so small edits reuse an earlier result. Starting from the instant answer's stall Re, the app solves there, recomputes stall speed and Re from the computed Clmax, and solves again if that lands on another grid point: usually one or two polars.

**Non-converged points** are left out, and the lift curve shows gaps there. A polar counts as usable with at least 8 converged points and either a point past the peak or every point straight after the peak failing (XFOIL losing convergence at the stall usually means the flow has separated; the rating is then low confidence). If XFOIL can't produce a usable polar, or takes more than 20 s, the instant answer stays and the app says so.

**Differences from airfoiltools.com.** For library sections the computed Clmax is compared with the bundled polars at the same Reynolds number, and a warning appears if they differ by more than 0.03; the lift curve then also shows the nearest bundled polar as a faint dashed line. They agree closely for conventional sections (NACA 2412 at Re 200k: Clmax 1.328 both). They differ for thin, highly cambered sections at low Reynolds number (E205, SD7037, S1223), where laminar separation bubbles make XFOIL sensitive to version and settings; for E205 and SD7037 an independent JavaScript port of XFOIL agrees with the WebAssembly build, so the bundled data is the outlier.

Results are kept in memory for the page's lifetime and not saved.

## Stall character

Implementation: `src/lib/stall.js`. The rating is indicative only, and the app says so: it is not a substitute for flight testing.

The section's own character is rated as below. In panel mode the wing's is then adjusted by **where it stalls first** along the span, from the lifting line: past 60% of the semi-span the stall starts where the ailerons are, which drops a wing and costs roll control when it's most needed, so the rating goes one step sharper. Inside 40% it's described as the benign inboard stall. A chart shows each station's local C<sub>l</sub> at the stall against the C<sub>l,max</sub> its own section can reach, so the effect of taper, washout and a thinner tip can be seen directly.

### From a polar

The primary signal is the shape of the lift curve: the polar computed in the browser once it's ready, or until then, for library sections, the bundled polar nearest the stall's Reynolds number.

1. **Post-stall drop**: the average lift lost per degree over the first 2° past max lift, as a fraction of C<sub>l,max</sub>.
   - under 2.5% per degree: **Gentle**
   - 2.5% to 8% per degree: **Moderate**
   - over 8% per degree: **Sharp**
2. **Pre-stall rounding** adjusts that by one step: the lift actually gained over the 3° before the peak, as a fraction of what the linear lift-curve slope predicts.
   - 0.5 or more (lift climbs almost linearly into the stall, little warning): one step sharper
   - 0.12 or less (lift flattens well before the peak, useful warning): one step gentler
3. If the polar stops at max lift (XFOIL didn't converge past it), the rating is Moderate, or Sharp if the lift curve was still nearly linear at the peak, and flagged as low confidence.

Thresholds were chosen by looking at the bundled sections at 100k, 200k and 500k. At 200k they put well-known gentle sections (NACA 4412, 4415, 4418) in Gentle and thin sections (NACA 0009, NACA 1408, E180, E230) in Sharp, and show the expected trend with Reynolds number: at Re 50,000 most sections rate Sharp (laminar bubbles burst abruptly), at 1,000,000 most rate Gentle.

### Sections without polars: geometry heuristic

For custom sections and the coordinates-only UIUC sections, until the computed polar is ready (or if XFOIL can't produce one), the rating comes from the section shape, after Gault's (1957) correlation of stall type with the **upper-surface ordinate at 1.25% chord**. That one number captures thickness, leading-edge radius and camber near the nose together.

- under 1.6% chord: **Sharp** (thin, sharp nose)
- 1.6% to 2.1%: **Moderate**
- over 2.1%: **Gentle** (full, rounded nose)

Then, one step each:
- max camber at or forward of 20% chord: sharper (forward-cambered sections such as the NACA 230-series tend to break abruptly)
- Reynolds number at the stall below 100,000: sharper
- Reynolds number at the stall of 400,000 or more: gentler

Checked against the polar method across all 78 polar-backed sections at all five Reynolds numbers, the heuristic agrees exactly in 228 of 390 cases (58%), is one step out in 155, and two steps out in 7 (NACA 0015, 2415 and 63-3618, AG35, E474, S1223 and S8036 at low Reynolds number, which the heuristic calls Gentle and the polar calls Sharp). It is marked low confidence in the app.

**Indicative lift curve.** So the rating can still be read as a picture, sections without polars get an indicative lift curve, drawn dashed and captioned "Indicative curve, not computed data". It is linear from the zero-lift angle (computed from the section's mean line by thin-aerofoil theory, about −2.1° for NACA 2412) at the lift-curve slope averaged across the polar library at that Reynolds number, rounds over to C<sub>l,max</sub>, then falls away at a rate set by the rating (1.2%, 5% or 12% of C<sub>l,max</sub> per degree for Gentle, Moderate and Sharp, with pre-stall rounding to match). The shapes are chosen so that rating the drawn curve with the polar method returns the same rating.

### Custom section shape

The custom section is drawn from the NACA modified four-digit thickness form, with the leading-edge radius set directly instead of via the integer LE index, plus the standard NACA four-digit mean line. Library sections are drawn from their real coordinates in the same view.

### Drawn sections

A drawn section (the section editor, see the [user guide](user-guide.md#section-editor)) is two surfaces, each y(x) as a spline in t = sqrt(x) through its control points. The square root spaces the points finely at the nose, and the surface's slope there is set to dy/dt = ±sqrt(2r) for a nose radius r, so the leading-edge radius of the outline is exactly the one set (the circle of radius r matches the parabola y² ≈ 2rx near the nose). Straight segments are joined to their neighbours with equal slope (G1). A point that is moved, or a segment that is bent, pulls the points beside it; a point smoothed by **Smooth** moves towards the cubic through its two neighbours on each side, in sqrt(x), and **Keep max thickness** optionally restores the maximum thickness afterwards. Changing the nose radius scales the forebody by sqrt(r_new / r_old), the scaling fading out by the point of maximum thickness or 30% chord, whichever comes first, so the rest of the section stays where it is. The section's coordinates for XFOIL are sampled from these surfaces on a cosine spacing (`sectionCoords` in `src/lib/sectionSpline.js`).

## Structure: loads and margins

Implementation: `src/lib/structure.js`. A first-order sizing check, and the app says so.

- **Load**: the lifting line's spanwise lift distribution at the stall (the design point at manoeuvring speed, where full load factor is reached at maximum lift), scaled so the half wing carries n × weight / 2. Negative g uses the distribution at the matching negative lift. The wing's own weight is ignored, which errs on the safe side, except for the servos: each pulls down on the half wing with n × its weight at its span station, so it takes that force off the shear inboard of it and (its force × its distance from the section) off the bending moment there (see Servo bays).
- **Shear and bending** come from integrating that load inward from the tip.
- **Section**: modulus-weighted, so a D-box or fully sheeted wing's sheeting shares the bending with the spar (it typically carries more than half), and stringers count too. Each surface's sheeting is taken to its own extent: a D-box may sheet the top, the bottom or both, each back to the spar or to a chord position of its own, so the section can be unsymmetrical and its neutral axis moves accordingly. Stresses come from M·E·z / EI at each element's extreme fibre.
- **Margins of safety**, allowable ÷ (stress × safety factor) − 1, so 0 is just enough:
  - spar in compression and in tension (positive and negative g);
  - sheeting crushing;
  - shear web in shear (the D-box's own shear path is ignored, on the safe side);
  - shear web buckling between ribs (orthotropic balsa approximated with an effective modulus √(E<sub>L</sub>·E<sub>T</sub>), E<sub>T</sub> ≈ 5% E<sub>L</sub>);
  - **buckling between ribs**: in an open structure the compressed spar cap buckling sideways (Euler, pinned at each rib); in a sheeted one each sheet panel between its supports (leading edge stock, stringers, spar) buckling as a simply supported plate, σ<sub>cr</sub> = k π² E / 12(1 − ν²) · (t / b)², with k minimised over the number of half-waves for the panel's length between ribs.
- **Rib spacing from loads**: the buckling checks (spar cap or sheeting between ribs, and the shear web) give the largest spacing allowed at each station. Each interval between hard points (root, fuselage side, panel breaks, tip, your hard points) gets the fewest bays that keep every bay within that limit along its whole length, never wider than the covering maximum. They're spaced out from the root taking the largest bay allowed each time, then evened out so there's no stub of a bay at the end. Rib spacing from loads never leaves a negative spacing margin.
- **Materials** are typical values along the grain, on the conservative side.

**Covering.** The finish over the ribs and sheeting is an explicit choice. Its weight is its mass per area times the area covered: both surfaces measured along the section from the root rib to the tip rib, plus both faces of a rounded tip's block taken as its plan area. The generic figures are at the heavy end of what makers and builders publish; the named products are the applied weights the editor lists, including adhesive or dope. All are estimates until weighed.

| Covering | g/m² | Basis |
|---|---|---|
| Lightweight heat-shrink film | 45 | generic, listed 30 to 45 g/m² |
| Heat-shrink film | 90 | generic, listed 70 to 90 g/m² |
| Fabric film | 130 | generic, listed 95 to 130 g/m² |
| Tissue and dope | 45 | lightweight tissue about 12 to 20 g/m², plus three coats of dope |
| Solarfilm / Solalite | 60 / 22 | applied, per product |
| Oracover / Oralight | 54 / 36 | applied, per product |
| Kavan film | 66 | applied, per product |
| Doculam 15 / 30 / 40 µm | 28 / 50 / 65 | laminating film with adhesive, applied |
| Glass cloth and epoxy, 0.6 / 1 / 1.5 oz | 37 / 61 / 92 | about 20, 34 and 51 g/m² of cloth, hand laid with epoxy (about 1.8 times the cloth), no filler |
| Carbon cloth and epoxy, 10 / 30 / 50 g/m² | 25 / 70 / 110 | hand laid with epoxy (2.2 to 2.5 times the cloth), no filler |

Films, fabric and tissue are counted as weight only: no strength or stiffness, on the safe side. Glass and carbon cloth with epoxy are laid over the sheeting only (the open bays behind a D-box take lightweight film). Each is modelled as a laminate on the outside of the sheeting, top and bottom, with a thickness that gives its applied weight at a density of 1600 kg/m³ for glass and 1500 kg/m³ for carbon, and a spanwise modulus of 10 GPa for glass, 8 GPa for the lightest carbon and 30 GPa for the heavier carbon. These are for a cloth at a wet lay-up's fibre fraction with about half the fibre running spanwise: conservative. The laminate enters the bending section with the sheeting, which lowers the stress in the spar and sheeting, and it stiffens each sheet panel against buckling between ribs: the panel buckles at the sheet stress a plain sheet of modulus E′ = E (1 + β) / (1 + η) would, where β is the bending stiffness the laminate adds about the pair's neutral axis and η the axial stiffness it adds, each as a fraction of the sheet's own (it stiffens the panel but also takes a share of its load). The laminate's own compressive stress, about three times the sheeting's for the same strain, stays far below its strength, so it isn't checked. Its benefit in torsion, which is where glass over a D-box matters most, isn't credited, since torsion isn't checked.

**Not covered**: torsion, flutter and divergence, glue joints, the wing joiner of a two-piece wing (the root bending moment is shown for sizing it), and local loads at fittings.

## Foam-core wings

Implementation: `src/lib/foam.js` (materials, settings, the sandwich formulas), `analyseStructure` in `src/lib/structure.js` (the check), `src/lib/foamParts.js` (templates, skins, pockets, weight).

**Layout.** A foam wing is a core of foam for each panel, skinned top and bottom, with leading and trailing edge stock as on a built-up wing, and no spar. Geometrically that's a fully sheeted wing with no spar and no ribs, and it's laid out as one: the skins follow the section from the leading edge stock to the trailing edge stock, and the control surfaces, servo bays and air brakes are placed exactly as on a built-up wing (with no rib thickness), against the line of the section's thickest point (or the spar position, if one is set) where a built-up wing would have its spar.

**Loads** are the same as a built-up wing's: the lifting line's distribution at the stall, scaled to the design load factor, with each servo's inertia relief.

**Bending.** Modulus-weighted, as for a built-up wing: the skins (in strips across the chord, following the section) and any glass and epoxy over them carry the bending; the foam (a few MPa) and the edge stock are left out, on the safe side.

**Margins of safety**, allowable ÷ (stress × safety factor) − 1:

- **skin crushing**: the skin's compressive strength against the most compressed skin;
- **skin wrinkling**: a thin skin on a soft core fails in compression by wrinkling into the core long before it buckles as a plate. The wrinkling stress is σ<sub>w</sub> = Q (E<sub>f</sub> E<sub>c</sub> G<sub>c</sub>)<sup>1/3</sup> (Hoff and Mautner 1945), with E<sub>f</sub> the skin's modulus along the span (stiffened as for sheet buckling when glass and epoxy is laid over it), E<sub>c</sub> and G<sub>c</sub> the foam's compressive and shear moduli, and Q = 0.5, the usual design value (the theory gives 0.825; the lower figure covers imperfect bonding and core variation: Allen, *Analysis and Design of Structural Sandwich Panels*, 1969; Zenkert, *An Introduction to Sandwich Construction*, 1995). It's checked against the most compressed skin stress;
- **core shear**: the thin-face sandwich result τ = V / (b d), with b the core's width (its chord, from the leading edge stock to the trailing edge stock) and d its mean depth between the skins over that chord. The closed skin round the section carries much of the shear in practice; leaving it out errs on the safe side.

There are no ribs, so nothing is checked between ribs.

**Materials.** Foam figures are conservative indicative values for the EN 13163 (EPS) and EN 13164 (XPS) product classes, as published in manufacturers' technical data (BASF Styropor, Dow Styrofoam); the shear modulus is taken as 0.4 E. Obechi (*Triplochiton scleroxylon*) is from the USDA Forest Products Laboratory *Wood Handbook* (FPL-GTR-190) and the Wood Database (about 380 kg/m³, modulus 6.9 GPa, crushing strength 27 MPa, rupture 51 MPa), taken down.

| Material | Density, kg/m³ | E | G | Compression | Shear |
|---|---|---|---|---|---|
| EPS 15 (EPS 70) | 15 | 2.5 MPa | 1.0 MPa | 70 kPa | 50 kPa |
| EPS 20 (EPS 100) | 20 | 4 MPa | 1.6 MPa | 100 kPa | 75 kPa |
| EPS 30 (EPS 200) | 30 | 7 MPa | 2.8 MPa | 200 kPa | 135 kPa |
| XPS (blue or pink foam) | 33 | 10 MPa | 4 MPa | 250 kPa | 200 kPa |
| Obechi veneer | 380 | 6 GPa | | 22 MPa | 4 MPa (tension 35 MPa) |

Balsa skins use the same figures as on a built-up wing.

**Weight.** The core is the foam's density times its volume: the area of its section (between the skins, from the leading edge stock to the trailing edge stock) integrated along each panel by Simpson's rule. The skins are weighed from their developed outlines (the surface's length round the section along the span) at their thickness, plus the glue allowance per square metre of skin (100 g/m² by default, typical of epoxy laid up thin and vacuum bagged; set it to suit), without the 10% glue allowance the other parts get. Caps, edge stock, hinge spars, servo plates, braces and the finish are weighed as on a built-up wing, and the servos added. The foam blocks, skin sheets and templates in the cut list aren't part of the wing.

**Hot-wire templates.** Each panel's core is cut in one piece between a template at each end: the core's section there, in plan position x (so the sweep is in it) and height with the twist about the spar line (as the ribs and 3D view have it). Both templates of a pair share one frame, whose origin is a vertical mark at a whole 5 mm in the middle of where the two cores overlap along the chord and a level line midway between where both sections are at that mark. The outline is the core's section offset outward by half the wire kerf (mitred corners), so a wire that melts a cut that wide leaves the core true size. Chord ticks are at the same tenths of each end's core chord; the caps' slots are drawn at the spar's faces (square to the spar line). The lead-in and lead-out are straight lines along the profile's mid-depth at the trailing edge and the front, the set length beyond the kerf.

**Control surfaces** aren't cut as separate cores: a surface rarely spans a whole panel, so separate cores would mean splitting the panel at each surface's ends, and a core skinned whole keeps the surface true to the wing. The core is cut whole and skinned, then the surface is sawn off along its hinge line and both faces capped with the hinge spars, as set for a built-up wing. In the 3D view the core stops at the fixed hinge spar along each surface, and the surface's own core runs from its hinge spar back.

**Skins** are developed per panel and surface, from the back of the leading edge stock to the front of the trailing edge stock, the straight edge along the leading edge (approximate: cut oversize). The sheets for each are counted without nesting: the number across (the widest the skin gets over the sheet width) times the number along (its length over the sheet length).

## Control surfaces and hinges

Implementation: `src/lib/controlSurfaces.js` (placement, bevel, tabs, crow; it works on any wing, so a tailplane's surfaces will use it too) and `surfaceLayouts` in `src/lib/structure.js` (the built-up hinge).

- **Placement**: each surface lies on one panel, between two distances from the panel's inner end. Its hinge line is straight in plan between the given chord fractions at its two ends, so on a tapered or curved panel the hinge's chord fraction varies in between. A hinge has to be straight to turn, which is why a surface can't run across a panel break.
- **The hinge**: a bevelled hinge line with Mylar tabs slotted at the centre line (midway between the skins). Across the hinge line, centred on it, is the gap; ahead of it the fixed part's hinge spar (square, its width across the hinge), behind it the moving surface's hinge spar, its front bevelled to a point at the centre line. The fixed part's ribs stop at the front of its hinge spar; the surface's own ribs run from the back of its hinge spar to the trailing edge stock. The hinge must leave both spars between the main spar's rear face (2 mm clear) and the trailing edge stock (5 mm clear), or the surface isn't built and a warning says why.
- **Ends**: a full rib (a hard point) at each end of every surface. The fixed hinge spar runs between those ribs' faces; the moving surface stops a gap short of each, with an end rib of its own there, and has the part behind the hinge of every wing rib in between (a wing rib closer than a rib thickness to the surface's end rib is left to the end rib).
- **Bevel**: the surface turns about the middle of the gap. Its top face must clear the fixed part's rear face when the trailing edge goes down by δ, its bottom face likewise going up. A face bevelled β from square, with half-gap a and half-depth h (half the moving hinge spar's greatest depth between the skins), turns to a·cos δ + h·(tan β cos δ − sin δ) from the hinge at its outer edge, which must be no further forward than −a. So tan β = (h sin δ − a(1 + cos δ)) / (h cos δ). With no gap β = δ; the gap would let it be a little shallower, more so on a thin surface (square, on thin trailing edge stock), but each face is bevelled to at least its throw, as builders do: it leaves room for the covering and a stiff hinge, and a surface cut from the stock is bevelled like any other. The cut list rounds it up to the next whole degree.
- **Tabs**: spaced evenly along the hinge, the end ones a set distance in from the moving surface's ends, no further apart than the spacing you set, two at least. Each tab goes into both hinge spars by half its length less half the gap; a warning says if that's deeper than the narrower spar is wide.
- **Weight**: the surfaces' ribs and both hinge spars (in the hinge spar material, at their greatest depth) are weighed with the rest of the structure, plus the tabs as Mylar at 1390 kg/m³. The strength check doesn't count the hinge spars in bending, and hinge moments and the loads on the surfaces themselves aren't checked.
- **Crow**: offered only when the wing has ailerons and flaps as separate surfaces and no flaperons. When it's on, each aileron goes up and each flap down by the crow setting, never past its own throw. Its effect on lift and the stall is below, under "Flaps and crow".

## Flaps and crow

Implementation: `src/lib/flaps.js`, with the deflected polars from XFOIL (`xfoilScript` in `src/lib/xfoil.js`) and the stall in `wingStallAt` (`src/lib/airfoils.js`) and `progressiveStall` (`src/lib/liftingLine.js`).

**Configurations.** Stall speed and stall character are worked out for up to three: **clean** (the headline, and what the structure is checked for), **flaps** (every flap and flaperon down to the landing setting, by default its own most down, never past its own throw) and **crow** (when it's on: ailerons up and flaps down by the crow settings). Each deflected surface is a plain flap hinged on the centre line at its hinge line's chord fraction (taken at the middle of its span).

**The section with a surface deflected.** A deflected plain flap does two things to the sections behind it, both taken as increments on the clean section, so the clean section model (Clmax by Reynolds number and thickness, station by station) still applies underneath:

- it shifts the zero-lift angle (down: more negative), which the lifting line takes as a change of local twist, so a flap down is wash-in over its span;
- it changes the section's maximum lift.

**From XFOIL.** Once the clean polar is in, each deflected surface's section is solved too, at the same Reynolds number, with XFOIL's `GDES FLAP` (hinge at the chord fraction, its height half the local thickness, the deflection; then repanelled as usual). The increment is the difference between the two polars: Clmax from their peaks, and the zero-lift shift as the mean change in lift over −2° to 3° (where both converged) divided by the clean lift-curve slope. It is taken at the clean polar's Reynolds number for every station, as it changes little with Re. Deflected polars are cached by hinge (to 1% of the chord) and deflection (to 0.5°). For NACA 2412 with a 25% chord flap at Re 200,000, XFOIL gives Clmax 1.33 clean, 1.65 at 20° and 1.80 at 45°, and moves the zero-lift angle about 6.5° at 20°.

**When XFOIL can't.** Until those polars are ready, when the clean polar isn't from XFOIL, and when a deflected polar isn't usable (XFOIL rarely converges with a surface well up), the increment is estimated:

- zero-lift shift Δα₀ = −τ η δ, where τ = (π − θ_h + sin θ_h) / π is thin-aerofoil flap effectiveness for a hinge at x_h = (1 − cos θ_h) / 2 (Glauert, *Theoretical relationships for an aerofoil with hinged flap*, ARC R&M 1095, 1927; Abbott and von Doenhoff, *Theory of Wing Sections*): 0.61 for a 25% flap. η corrects thin-aerofoil theory for a real, viscous flap at large deflections: 0.8 up to 10°, 0.6 at 20°, 0.5 at 30°, 0.4 at 45° and beyond, linear between. That sits under the plain-flap correction in USAF DATCOM §6.1.1.1 and matches the XFOIL case above (about 0.55 at 20°, 0.43 at 45°), so it errs towards less lift and a higher stall speed;
- Clmax increment 0.45 × the lift gained at a fixed angle (a plain flap stalls the section earlier, so it gets less than the full gain; the XFOIL case gives 0.46 at 20° and 0.39 at 45°), at most 0.9 (Raymer, *Aircraft Design: A Conceptual Approach*, for plain and split flaps at landing settings). A surface going up takes the same with the sign reversed, and a section keeps a Clmax of at least 0.2.

**The wing's stall.** The lifting line is solved with each station's twist and Clmax changed by the surface over it. The stall starts where the first station reaches its Clmax, which is the stall onset shown. With flaps that is usually in the flapped stretch or right beside it, and that stall is progressive: separation creeps forward from the flap rather than breaking at the nose, and XFOIL polars of flapped sections stay within about 5% of their peak for 3° or more past it. So stations behind a deflected surface, or within half a chord of its ends (the lifting line spreads the jump in lift at a flap's end over a few stations), hold their Clmax once stalled, the excess taken off as extra washout at those stations through the lifting line's influence of each station's twist on the others, while the angle of attack goes on rising. Wing CLmax is the lift when the first other station stalls, or 3° of wing angle of attack past the onset, whichever comes first. With nothing deflected this is exactly the clean result.

Flaps down lower the stall speed a little (the default 1.4 m wing with a quarter-span flap at 45°: about 4 to 5%). Crow raises it: the ailerons up take a lot of lift off the outer wing, which also keeps that part well short of its stall, so the stall starts inboard. The stall character is the clean section's, adjusted for where the stall starts as usual, and the lift curve shown is the clean section's. Hinge gaps, slotted flaps and the drag of deflected surfaces aren't modelled.

## Servo bays

Implementation: `src/lib/servos.js` (the catalogue, which bay each surface gets and where, the masses for the loads; it works on any wing) and `bayLayouts` in `src/lib/structure.js` (the built-up bay), with the plate, hatch and lead holes in `src/lib/ribs.js`.

**Catalogue.** Four generic classes, no brands. Each is the rounded figures of the common hobby servos of its class, as published by their makers, with the torque taken at 4.8 V (the lower of the usual supply voltages) and rounded down, so it is not the rating of any one servo: check the servo you mean to use.

| Class | Typical | Case L × W × H (mm) | Across lugs (mm) | Lug thickness (mm) | Mass | Torque |
|---|---|---|---|---|---|---|
| Sub-micro | about 4 g | 20.5 × 8.5 × 16 | 27.5 | 1.5 | 4 g | 0.06 N·m (0.6 kgf·cm) |
| Micro | the 9 g class | 23 × 12.2 × 22.5 | 32.5 | 2.5 | 9 g | 0.15 N·m (1.5 kgf·cm) |
| Mini | the 17 g class | 28.5 × 12.5 × 26 | 39 | 2.5 | 17 g | 0.28 N·m (2.8 kgf·cm) |
| Standard | the 40 g class | 40.5 × 20 × 36.5 | 55 | 2.5 | 45 g | 0.40 N·m (4 kgf·cm) |

Length is along the chord, width across the span and height from the base to the top of the case (the output shaft end), with the servo standing with its shaft vertical. The underside of the lugs is taken about two thirds of the way up the case. With no class chosen a bay takes the one that suits the all-up weight: sub-micro up to 0.6 kg, micro to 2.5 kg, mini to 6 kg, standard beyond.

**Placement.** Each built control surface or air brake has a bay unless it's removed. An air brake's bay is beside its box, its outer rib the box's inner rib, or outboard of the box if the inboard place is off the panel (see Air brakes). The servo is a third of the way out along the surface (where the linkage is short and the surface stiff), or where you say, measured from the surface's inner end (projects saved before that keep their position from the panel's inner end until it's changed). Its installed size follows its mounting: upright it needs its height of depth, on its side its width, and laid flat (any servo) its thickness. The tray sits between two of the wing's own ribs (laid out without the bays) when the servo and 1.5 mm clear each side fit between their faces with no rib in the way; otherwise the bay gets a pair of hard points (full ribs) of its own, the servo's width plus the clearance apart, and no plain rib runs through it. It must lie inside its panel, 5 mm clear of the panel's ends, and not overlap another bay; a bay may stick out past the ends of its surface, which is noted.

**Servo, plate and hatch.** The servo lies with its length along the chord, its lugs' span between the leads' strip behind the main spar and 2 mm ahead of the fixed hinge spar's front face (with a 3 mm margin each end for the plate), placed in the deepest spot in that stretch (the rearmost if several are as deep, so the pushrod to the horn is short). It stands on the inside of the lower skin at the highest that surface gets under it, and needs its case height plus 2 mm clear under the upper skin at the lowest, or a warning says how much depth is short and to use a smaller class or move the bay. Pushrods aren't modelled.

The mount plate is birch ply (1.5 mm for sub-micro and micro, 2 mm mini, 3 mm standard) between the rib faces, its underside at the lugs' underside, with a cut-out for the case (0.5 mm clear all round) and four 1.2 mm pilot holes for the lug screws, two per lug. The servo goes in from below and its lugs screw up into the plate. The hatch is the opening in the lower surface under it, the plate's size; on a fully sheeted wing it is a part cut from the lower sheeting, with two 5 × 5 mm spruce rails across the bay at its front and back edges for it to screw to. On other wings the opening is cut in the covering, and drawn in the plan.

**Lead holes.** Each bay's lead passes through every rib from the bay's inner rib in to the root rib. The holes sit in a strip just behind the main spar's rear face, one hole wide per bay (4, 6, 7 or 10 mm by class), the outermost bay's hole nearest the spar, with the lead margin of material (3 mm unless set, never under 1.5 mm, the least rib material anywhere) between the spar and the first hole, measured along each rib from its spar notch or hole, between the holes, and from each hole to the rib's edges and notches, sliding back a millimetre at a time (up to 20 mm) where the rib is too thin or the place is taken; where it won't fit at all the hole is left out and the rib's note and a warning say so. The label and lightening holes keep clear of them. A bay needs room for the strip, the servo and the hinge spar between the main spar and the hinge, or it isn't built.

**Weight and loads.** The servos are weighed with the wing (their catalogue mass, per half wing, so a pair counts two of each), as are the plates, hatches, rails and the lead holes' loss of rib. In the strength check each servo is a point mass on the half wing: at load factor n it pulls down with n·m·g at its span station s<sub>b</sub>, which reduces the shear inboard of it by that force and the bending moment at a section s by n·m·g·(s<sub>b</sub> − s) (the wing's own weight stays ignored, so the servos are the one inertia relief taken). For a 9 g servo 0.25 m out at 6 g that is 6 × 0.009 × 9.81 × 0.25 = 0.13 N·m off the root moment. It applies at positive and negative load factor. Only built bays count.

**Not covered**: the hinge moment against the servo's torque (so the catalogue's torque is shown, not checked), servo lead and connector bulk beyond the hole size, the horn and pushrod, and servos lying on their sides in thin wings.

## Air brakes

Implementation: `src/lib/airBrakes.js` (placement, openings and the lattice slots; it works on any wing sampler) and `brakeLayouts` in `src/lib/structure.js` (the box in the built-up wing, depth and clash checks), with the parts in `src/lib/ribs.js`.

**Placement.** A brake is a centre (from its panel's inner end, flat), a length along the span, a chord position (a fraction of the chord at its centre) and a width or chord. The box or plate is a rectangle in plan, straight along the span whatever the taper. Its two ribs are hard points with their faces the length plus a clearance each end apart: 1.5 mm for a blade box, 6 mm for a spoiler so its frame has ply either side of the opening. They must lie inside the panel, 5 mm clear of its ends, and not within 5 mm of another brake's ribs. Brakes are named AB1, AB2 root outward.

**Blade brake.** The box is the gap between the two ribs' faces, closed along the front and back by a ply wall (1 mm birch ply) running skin to skin: its height is the least depth between the inner faces of the skins along its length, so it never stands proud. The blades are 1 mm ply, as long as chosen and as high as chosen, spaced evenly across the box's width; each passes through a slot in the covering 0.5 mm clear each side (the blade is 1 mm thick). A lattice (more than one blade) is the blades side by side; blades through both skins double them. Each blade has lattice slots to lighten it: 10 mm long on a 16 mm pitch, centred along it, from 30% to 80% of its height, leaving a solid foot as a guide and a bar along the top. A blade shorter than about 26 mm or lower than 12 mm gets none. Retracted, a blade stands wholly inside the box, so the section must be at least its height plus 2 mm deep between the skins everywhere over the box; with blades through both skins the two share the depth, so it needs twice the height plus 4 mm. If it isn't deep enough the brake is still built and a warning says how much depth there is.

**Pop-up spoiler.** A plate of 1.5 mm ply, the chosen length and chord, hinged along its front edge (hinge tape along the engraved line, half on the plate and half on the frame) and opening to the chosen angle at the back. It sits in a 1.5 mm ply frame under the top surface, as wide as the gap between the ribs and the plate's chord plus 5 mm each side, with the opening a millimetre clear of the plate all round. The opening is also the cut-out in the covering. Its depth isn't checked: the plate lies in the surface.

**Clashes.** Sampled across the box (seven stations along it, five across it), the box must be wholly ahead of the main spar's front face or behind its rear face (1 mm), clear of the leading edge stock by 2 mm and of the trailing edge stock by 2 mm, and, where it is alongside a control surface, ahead of that surface's fixed hinge spar by 2 mm. It must not overlap a servo bay in plan, and the lead holes of any servo bay further out run through its ribs, so its box mustn't cover the strip behind the spar those holes use (2 mm clear). Each is a warning rather than a refusal.

**Servo bay.** An air brake's bay is built like a control surface's (see Servo bays), the servo placed between the leads' strip and the trailing edge stock's front face (a control surface's is stopped by its hinge spar), in the deepest place there.

**Weight.** The box walls, blades, plates and frames are weighed as parts (with the glue allowance), by their area less the lattice slots, thickness and density, per half wing in a pair; the bay's servo and mount plate as for any servo bay, and the servo relieves the spar in bending in the same way. The aerodynamic drag of the brakes isn't calculated: the drag added by an open brake belongs to the performance work in v9 and v10, which will take it from the dimensions here (blade count, height, length, plate chord and angle).

**Not covered**: the linkage (pushrod, bellcrank and guide rails), a blade's hold-down and end stops, the forces on the blades, the slot or opening in the sheeting parts (they are developed templates, so cut it from the plan), and the brake's effect on lift and stall.

## Edge stock

Implementation: `src/lib/edgeStock.js`. The catalogue is SLEC's flat and symmetrical leading edges, plain strip, and triangular trailing edges, all in 915 mm lengths. A stock fits if its profile contains the section over its whole depth at the root, each panel end and the tip, at its best height and a tilt of up to ±12°. A catalogue leading edge that doesn't fit with its front at the nose may be **set forward** of it, by up to 60% of its depth in sixteen steps, the least that makes it fit: the stock ahead of the nose is carved away and it reaches less far into the wing, where the section is thinner, so the ribs are cut back by what's left of its depth. It keeps at least the minimum depth below in the wing. A custom leading edge, round stock and trailing edges always sit at the edge, and stock that fits nowhere stays at the nose. Auto picks, from the stock at least a minimum depth along the chord, the one with the least waste that fits at the nose; failing that, the one with the least waste that fits set forward; if none fits, the one that falls least short. The cut list gives the stock at its own size.

The shortfall is how much taller (in total, top and bottom together) the stock would need to be to contain the section at its best height and tilt. The warning gives it at the station where it's worst, and the editor draws that station: the stock as sold at its best placement, the section, and the section outside the stock in red.

**Round leading edges.** A carbon rod (1.5 to 8 mm, 1 m lengths, pultruded carbon at 1550 kg/m³) or hardwood dowel (3 to 10 mm, 915 mm lengths, beech or ramin at 700 kg/m³) sits with its front at the nose and forms the nose itself. The ribs stop at its centre line, notched there with a half-round seat (widened along a rib that crosses it at an angle), and the sheeting or covering meets it at that line. It can't be carved, so it fits if its rear half is inside the section at its best height, at every rib. Ahead of 2% of the chord the section is taken as rounded (its height off the nose point growing with the square root of the distance back, scaled from 2%), since the coordinate points there are too sparse to follow the nose's curve; for a NACA nose that's slightly inside the true shape. A rod bigger than the section's own nose radius makes the nose a little blunter. Its weight is its round section times its length and density.

**Sheeted nose.** With no leading edge stock, the ribs run forward until the sheeting each side leaves less than 1.5 mm of rib between them, and the sheeting starts at the nose.

## Ribs and parts

Implementation: `src/lib/ribs.js`. Each rib is the wing cut along the rib's line through the lofted wing (each point along it takes the chord, thickness and twist of the streamwise section it crosses), so streamwise and square-to-spar ribs come from the same code. A rib square to a swept spar comes out shorter than the streamwise chord, by about cos Λ, at much the same depth. Then:

- inset for the covering, measured square to the surface;
- cut back square for the leading and trailing edge stock;
- notched for the spar caps (or holed for a tube, slotted or notched for a solid spar) and for each stringer. Every cut is placed where the rib line actually crosses the stock, and stock sizes are the stock's own, square to its length, so a rib crossing a swept spar at an angle gets a notch a little wider than the cap (and an oval hole for a tube);
- **washout** built in by rotating each section about the spar line, trailing edge up;
- **jig tabs** on every rib in a panel reach down to one flat line (below the lowest rib by the least tab height you set), so the panel builds on a flat board with its washout in; the line where each tab is cut off is engraved;
- **lightening holes**: the largest circles that fit ahead of and behind the spar, leaving the margin you set around each and clear of notches;
- the rib's name (R1 from the root outward), engraved in the roomiest clear stretch (ahead of the spar if there's room, else behind it), placed before the lightening holes so they keep clear of it.

Ribs at dihedral breaks note their cant, half the change in dihedral. The same module makes the corner gussets (grouped by angle; each must fit between the inset upper and lower surfaces over its whole triangle: one thickness for top or bottom, two for both), dihedral braces (sized from the bending moment at the break; the break line is engraved), shear webs (one per bay, two for a box spar), approximate developed sheeting templates per panel and surface, and a plan template for a rounded tip's block. Ribs across a control surface are cut at the hinge (see Control surfaces and hinges): their trailing-edge gussets are left off, since they don't reach the trailing edge. It also writes a cut list of strip stock (caps, leading and trailing edges, rods or dowels, stringers, cap strips, tube, hinge spars), and estimates the wing's weight from every part's area or length and density, plus 10% for glue, plus the covering (see Covering).

**Dihedral braces.** Each break gets two plates, one on each face of the spar, sharing the bending moment at the break. Their thickness is t = 6 M SF / (2 σ h²), where M is the bending moment at the break (N·m), SF the safety factor, σ the lower of the material's compression and tension strength, and h the brace depth: the spar depth at the break less two skins. The margin is the chosen thickness over the thickness needed, less one (0 means just enough). A brace with h below 10 mm can't be made and is flagged. Each brace's thickness is its own (entered, else the next standard ply above t). The plates are laid out with the face grain at half the dihedral angle from the inner arm, so it's on average along the whole brace rather than along one arm.

The 3D view (`src/lib/wing3d.js`) is built from the same geometry as the cut parts, and the tests check every joint where a rib meets the spar, caps, webs, stringers or edge stock.

DXF export is `src/lib/dxf.js`, and the PDF templates are written directly by `src/lib/pdf.js`. Labels are engraved in Hershey Sans 1-stroke (`src/lib/strokeFont.js`). Other than the ribs (whose label is placed with the rib), each part takes the tallest label from 4 mm down to 2 mm that lies wholly on it, clear of its holes, centred on its bounding box or its centroid; a part with no room for 2 mm has its label engraved 1 mm below it on the sheet instead.
