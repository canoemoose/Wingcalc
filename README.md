# Wingcalc

A wing loading calculator for RC fixed-wing aircraft with spans of 600 mm to 3 m. Enter the all-up weight, the wing geometry and an aerofoil, and it reports:

- **Wing cube loading** with a verdict band (the headline figure)
- **Stall speed**, side by side with the verdict
- **Wing loading**, area, mean aerodynamic chord, aspect ratio and the Reynolds number at the stall
- **Stall character** of the aerofoil: Gentle, Moderate or Sharp

Every input and output works in metric or imperial, with a global toggle and per-field unit choice.

The wing can be entered as a root chord plus one or more panels per side (each with its own length, outer chord and dihedral), which covers straight, tapered, cranked, dihedral and polyhedral wings. Mean chord or area can be entered instead for a quick check.

Built with Vue 3 (plain JavaScript) and Vite.

## Setup

Node is pinned with Volta (see `package.json`).

```bash
npm install
npm run dev
```

The dev server serves the standalone page at `/` and an embedding demo at `/embed-demo.html`.

| Command | What it does |
| --- | --- |
| `npm run dev` | Development server |
| `npm test` | Run the unit tests (Vitest) |
| `npm run build` | Standalone page into `dist/` (relative paths, host anywhere) |
| `npm run build:embed` | Embeddable widget into `dist-embed/` |
| `npm run fetch-airfoils` | Refresh the bundled aerofoil data |

## Embedding

`npm run build:embed` produces a single self-contained script (Vue, styles and aerofoil data included) that registers a `<wing-calc>` custom element:

```html
<script src="wingcalc.js"></script>
<wing-calc units="imperial" theme="light"></wing-calc>
```

- `units`: `metric` (default) or `imperial`
- `theme`: `auto` (default, follows the OS light/dark setting) or `light`

The widget renders in a shadow root, so host page styles don't reach it and its styles don't leak out. Its layout responds to its own width (container queries), not the viewport, so it works in a narrow sidebar as well as full width. `wingcalc.mjs` is the ES-module version of the same thing.

To use the Vue component directly inside another Vue app instead, import `src/WingCalc.vue` and `src/styles/wingcalc.css`.

## Formulas

All calculation is done in SI units (`src/lib/calc.js`); conversion happens only at input and display.

| Quantity | Formula |
| --- | --- |
| Flat wing area (panels) | S = 2 Σ l<sub>i</sub> (c<sub>i−1</sub> + c<sub>i</sub>) / 2, over the panels of one side |
| Projected wing area | S<sub>p</sub> = 2 Σ l<sub>i</sub> cos Γ<sub>i</sub> (c<sub>i−1</sub> + c<sub>i</sub>) / 2 |
| Wingspan (tip to tip, projected) | b = 2 Σ l<sub>i</sub> cos Γ<sub>i</sub> |
| Wing area (mean chord) | S = b c̄ |
| Mean aerodynamic chord | MAC = ∫c² dy / ∫c dy over a half wing (projected y). For a single straight taper this is ⅔ c<sub>r</sub> (1 + λ + λ²) / (1 + λ); it equals the mean chord when entered as mean chord or area |
| Aspect ratio | AR = b² / S<sub>p</sub> |
| Wing loading | WL = W / S |
| Wing cube loading | WCL = W / S<sup>1.5</sup> |
| Stall speed | V<sub>s</sub> = √(2 m g / (ρ S<sub>p</sub> C<sub>L,max</sub>)) |
| Wing C<sub>L,max</sub> | 0.9 × section C<sub>l,max</sub> |
| Reynolds number | Re = V<sub>s</sub> × MAC / ν |

Constants: g = 9.80665 m/s², ρ = 1.225 kg/m³ and ν = 1.4607 × 10⁻⁵ m²/s (ISA sea level).

Here l<sub>i</sub> is a panel's length measured flat along the panel, c<sub>i</sub> its outer chord (c<sub>0</sub> is the root chord) and Γ<sub>i</sub> its dihedral angle to the horizontal.

Dihedral can be entered per panel either as that angle or as the **rise** of the panel's outer end: how far it sits above the panel's inner end with the wing level (so for a polyhedral tip panel, measured from the break, not from the centre section). The two are related by Γ = asin(rise / l), and each entry mode shows the other as a hint. This is not the same as the "block the tip up X" figure on some plans, where the inner panel is pinned flat on the board: for a tip panel that measures the angle relative to the inner panel, so add the inner panel's angle to get Γ.

**Flat versus projected area.** Wing and cube loading use the flat (developed) area, because that's the figure normally quoted for a model and the one the cube-loading bands were drawn up against. Stall speed uses the projected area: each panel's lift acts perpendicular to the panel, so only its cos Γ component supports the weight. The difference is small for ordinary dihedral (0.4% at 5°) and becomes noticeable only with steep polyhedral tips (about 6% for a tip panel at 20°). Mean chord and area modes assume a flat wing.

**Wing C<sub>L,max</sub> factor.** A finite wing reaches a lower maximum lift coefficient than its 2D section. 0.9 is a common rule of thumb for straight, moderately tapered wings; it is a single constant (`WING_CLMAX_FACTOR`) if you want to change it.

**Clmax depends on Reynolds number, which depends on stall speed.** For library sections the app looks up section C<sub>l,max</sub> at the stall's own Reynolds number, interpolating linearly in log(Re) between the bundled polars (clamped at the ends of the 50k to 1M range), and iterates until stall speed and Reynolds number agree. Polars where XFOIL stopped converging at the peak are left out of the Clmax lookup, because their maximum is unreliable.

### Units

1 oz/ft³ = 1.0012 g/dm³, so metric and imperial cube loadings are numerically almost identical. 1 oz/ft² = 3.0515 g/dm².

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

The thresholds are shown in the app under "Cube-loading bands" and live in `CUBE_BANDS` in `src/lib/calc.js`.

## Stall character

Implementation: `src/lib/stall.js`. The rating is indicative only and the app says so: it is not a substitute for flight testing.

### Library sections: from the polar

The primary signal is the shape of the XFOIL lift curve, taken from the bundled polar nearest the stall's Reynolds number.

1. **Post-stall drop**: the average lift lost per degree over the first 2° past max lift, as a fraction of C<sub>l,max</sub>.
   - under 2.5% per degree: **Gentle**
   - 2.5% to 8% per degree: **Moderate**
   - over 8% per degree: **Sharp**
2. **Pre-stall rounding** adjusts that by one step: the lift actually gained over the 3° before the peak, as a fraction of what the linear lift-curve slope predicts.
   - 0.5 or more (lift climbs almost linearly into the stall, little warning): one step sharper
   - 0.12 or less (lift flattens well before the peak, useful warning): one step gentler
3. If the polar stops at max lift (XFOIL didn't converge past it), the rating is Moderate, or Sharp if the lift curve was still nearly linear at the peak, and flagged as low confidence.

The lift curve is drawn in the app with the peak and the 2° band marked, so the rating can be checked by eye.

Thresholds were chosen by looking at all 39 bundled sections at 100k, 200k and 500k. At 200k they put well-known gentle sections (NACA 4412, 4415, 4418) in Gentle and thin sections (NACA 0009, NACA 1408, E180, E230) in Sharp, and show the expected trend with Reynolds number: at Re 50,000 most sections rate Sharp (laminar bubbles burst abruptly), at 1,000,000 most rate Gentle.

### Custom sections: geometry heuristic

With no polar, the rating comes from the section shape, after Gault's (1957) correlation of stall type with the **upper-surface ordinate at 1.25% chord**. That one number captures thickness, leading-edge radius and camber near the nose together.

- under 1.6% chord: **Sharp** (thin, sharp nose)
- 1.6% to 2.1%: **Moderate**
- over 2.1%: **Gentle** (full, rounded nose)

Then, one step each:
- max camber at or forward of 20% chord: sharper (forward-cambered sections such as the NACA 230-series tend to break abruptly)
- Reynolds number at the stall below 100,000: sharper
- Reynolds number at the stall of 400,000 or more: gentler

Checked against the polar method across all 39 library sections at all five Reynolds numbers, the heuristic agrees exactly in 122 of 195 cases (63%), is one step out in 70, and two steps out in 3 (NACA 0015, NACA 2415 and E474 at low Reynolds number, which the heuristic calls Gentle and the polar calls Sharp). It is marked low confidence in the app.

### Custom section shape

The custom section is drawn from the NACA modified four-digit thickness form, with the leading-edge radius set directly instead of via the integer LE index, plus the standard NACA four-digit mean line. The drawing is to true proportion and shows the chord line, mean line and leading-edge circle, so the input can be sanity-checked by eye. Library sections are drawn from their real coordinates in the same view.

## Aerofoil data

`src/data/airfoils.json` is generated by `scripts/fetch-airfoils.mjs` and committed, so the app works offline and never fetches anything in the browser. It holds 18 NACA (four-digit and 230-series) and 21 Eppler sections. For each it records:

- name, description and source URL
- thickness and camber (and their positions) as published by airfoiltools.com
- leading-edge radius and the 1.25%-chord upper ordinate, measured from the coordinates
- coordinates, decimated to about 90 points for drawing
- XFOIL lift curves (alpha and Cl from −4°) at Re 50k, 100k, 200k, 500k and 1M, Ncrit 9, each with its source URL and Reynolds number

### Refreshing the data

```bash
npm run fetch-airfoils
```

Edit the `SECTIONS` list at the top of the script to add or remove sections (use the airfoiltools.com id, e.g. `e205-il`). Responses are cached in `scripts/.cache/` (gitignored), so re-runs only fetch what's missing; delete that folder to force a full refresh.

The script makes one request at a time with a 1.5 s gap, and backs off and retries on HTTP 403 or 429. airfoiltools.com started refusing requests after about 40 in quick succession during development, so please don't lower the delay. A full uncached run is about 270 requests and takes 7 to 8 minutes.

### Source and terms of use

- Data comes from [airfoiltools.com](http://airfoiltools.com). Coordinates there come from the [UIUC Airfoil Coordinates Database](https://m-selig.ae.illinois.edu/ads/coord_database.html); the polars are XFOIL predictions generated by airfoiltools.com.
- airfoiltools.com does not publish terms of use. The site has a [privacy policy](http://airfoiltools.com/site/privacy) and a footer reading "Copyright © 2026 All Rights Reserved"; there is no licence for reuse of the data.
- The UIUC coordinate database is publicly available; its reuse terms weren't checked for this build, so check its own notes too. The XFOIL polars are airfoiltools.com's own output and presumably fall under that copyright notice.
- Before publishing this app publicly, it is worth asking airfoiltools.com (via its contact page) for permission to redistribute the polar data, or regenerating the polars yourself with XFOIL from the UIUC coordinates.

## Tests

```bash
npm test
```

Covers unit conversions and formatting, wing geometry, wing and cube loading, the cube-loading bands, stall speed and Reynolds number, input validation, section generation and measurement (checked against tabulated NACA 0012), the polar and geometry stall ratings, and the bundled data (sources recorded, sensible values, Reynolds lookup and the stall-speed iteration). The Vue components are not unit-tested.
