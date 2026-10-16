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

## Structure: loads and margins

Implementation: `src/lib/structure.js`. A first-order sizing check, and the app says so.

- **Load**: the lifting line's spanwise lift distribution at the stall (the design point at manoeuvring speed, where full load factor is reached at maximum lift), scaled so the half wing carries n × weight / 2. Negative g uses the distribution at the matching negative lift. The wing's own weight is ignored, which errs on the safe side.
- **Shear and bending** come from integrating that load inward from the tip.
- **Section**: modulus-weighted, so a D-box or fully sheeted wing's sheeting shares the bending with the spar (it typically carries more than half), and stringers count too. Stresses come from M·E·z / EI at each element's extreme fibre.
- **Margins of safety**, allowable ÷ (stress × safety factor) − 1, so 0 is just enough:
  - spar in compression and in tension (positive and negative g);
  - sheeting crushing;
  - shear web in shear (the D-box's own shear path is ignored, on the safe side);
  - shear web buckling between ribs (orthotropic balsa approximated with an effective modulus √(E<sub>L</sub>·E<sub>T</sub>), E<sub>T</sub> ≈ 5% E<sub>L</sub>);
  - **buckling between ribs**: in an open structure the compressed spar cap buckling sideways (Euler, pinned at each rib); in a sheeted one each sheet panel between its supports (leading edge stock, stringers, spar) buckling as a simply supported plate, σ<sub>cr</sub> = k π² E / 12(1 − ν²) · (t / b)², with k minimised over the number of half-waves for the panel's length between ribs.
- **Rib spacing from loads**: the buckling checks (spar cap or sheeting between ribs, and the shear web) give the largest spacing allowed at each station. Each interval between hard points (root, fuselage side, panel breaks, tip, your hard points) gets the fewest bays that keep every bay within that limit along its whole length, never wider than the covering maximum. They're spaced out from the root taking the largest bay allowed each time, then evened out so there's no stub of a bay at the end. Rib spacing from loads never leaves a negative spacing margin.
- **Materials** are typical values along the grain, on the conservative side.

**Not covered**: torsion, flutter and divergence, glue joints, the wing joiner of a two-piece wing (the root bending moment is shown for sizing it), and local loads at fittings.

## Edge stock

Implementation: `src/lib/edgeStock.js`. The catalogue is SLEC's flat and symmetrical leading edges, plain strip, and triangular trailing edges, all in 915 mm lengths. A stock fits if its profile contains the section over its whole depth at the root, each panel end and the tip, at its best height and a tilt of up to ±12°. Auto picks, from the stock at least a minimum depth along the chord that fits, the one with the least waste; if none fits, the one that falls least short.

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

Ribs at dihedral breaks note their cant, half the change in dihedral. The same module makes the corner gussets (grouped by angle; each must fit between the inset upper and lower surfaces over its whole triangle: one thickness for top or bottom, two for both), dihedral braces (sized from the bending moment at the break; the break line is engraved), shear webs (one per bay, two for a box spar), approximate developed sheeting templates per panel and surface, and a plan template for a rounded tip's block. It also writes a cut list of strip stock (caps, leading and trailing edges, rods or dowels, stringers, cap strips, tube), and estimates the structure's weight from every part's area or length and density, plus 10% for glue, without the covering.

The 3D view (`src/lib/wing3d.js`) is built from the same geometry as the cut parts, and the tests check every joint where a rib meets the spar, caps, webs, stringers or edge stock.

DXF export is `src/lib/dxf.js`, and the PDF templates are written directly by `src/lib/pdf.js`. Labels are engraved in Hershey Sans 1-stroke (`src/lib/strokeFont.js`). Other than the ribs (whose label is placed with the rib), each part takes the tallest label from 4 mm down to 2 mm that lies wholly on it, clear of its holes, centred on its bounding box or its centroid; a part with no room for 2 mm has its label engraved 1 mm below it on the sheet instead.
