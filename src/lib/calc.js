// Core calculations. All inputs and outputs are SI base units (m, m², kg, m/s)
// unless the name says otherwise.

export const G = 9.80665 // m/s²
export const RHO_SEA_LEVEL = 1.225 // kg/m³, ISA sea level
export const NU_SEA_LEVEL = 1.4607e-5 // m²/s, ISA sea-level kinematic viscosity

// A finite wing reaches a lower maximum lift coefficient than its 2D section, because of
// spanwise lift distribution and tip losses. 0.9 is a common rule of thumb for straight,
// moderately tapered wings of reasonable aspect ratio.
export const WING_CLMAX_FACTOR = 0.9

export const SPAN_MIN = 0.6 // m
export const SPAN_MAX = 3.0 // m

// Planform from one of four entry modes:
//   'panels' – root chord plus one or more panels per side, each with its length (measured
//              flat along the panel), outer chord and dihedral (see panelAngle). Covers
//              straight, tapered, dihedral and polyhedral wings.
//   'chords' – span, root and tip chord (a single flat, straight-tapered panel)
//   'mean'   – span and mean chord
//   'area'   – span and area entered directly
//
// Areas: `area` is the flat (developed) area, the figure usually quoted for a model and
// used for wing and cube loading. `projectedArea` is the area seen from above; it is what
// supports the weight (each panel's lift tilts inwards by its dihedral angle), so it is
// used for stall speed. `span` is the projected tip-to-tip span.
export function wingGeometry({ mode, span, rootChord, tipChord, meanChord, area, panels }) {
  if (mode === 'chords') {
    return wingGeometry({
      mode: 'panels',
      rootChord,
      panels: span > 0 ? [{ length: span / 2, tipChord, dihedral: 0 }] : [],
    })
  }
  const g = {
    span: mode === 'panels' ? null : span,
    flatSpan: null,
    rootChord: null,
    tipChord: null,
    area: null,
    projectedArea: null,
    meanChord: null,
    mac: null,
    macY: null,
    aspectRatio: null,
    stations: null,
    hasDihedral: false,
  }
  if (mode === 'panels') return panelGeometry(g, rootChord, panels)
  if (!(span > 0)) return g
  if (mode === 'mean') {
    if (!(meanChord > 0)) return g
    g.area = span * meanChord
    g.meanChord = meanChord
  } else if (mode === 'area') {
    if (!(area > 0)) return g
    g.area = area
    g.meanChord = area / span
  } else return g
  g.flatSpan = span
  g.projectedArea = g.area
  g.mac = g.meanChord
  g.macY = span / 4
  g.aspectRatio = (span * span) / g.area
  g.stations = [
    { y: 0, z: 0, c: g.meanChord },
    { y: span / 2, z: 0, c: g.meanChord },
  ]
  return g
}

// A panel's dihedral, in radians. It is given either as an angle to the horizontal
// (`dihedral`, degrees) or as `rise`: how far the outer end sits above the inner end with
// the wing level. Returns null if the rise is longer than the panel itself.
export function panelAngle(p) {
  if (Number.isFinite(p.rise)) {
    if (!(p.length > 0) || Math.abs(p.rise) > p.length) return null
    return Math.asin(p.rise / p.length)
  }
  return Number.isFinite(p.dihedral) ? (p.dihedral * Math.PI) / 180 : null
}

function panelGeometry(g, rootChord, panels) {
  if (!(rootChord > 0) || !panels?.length) return g
  if (!panels.every((p) => p.length > 0 && p.tipChord >= 0 && panelAngle(p) !== null)) return g
  // Integrate over one half-wing, panel by panel, in both flat and projected coordinates.
  const stations = [{ y: 0, z: 0, c: rootChord }]
  let flatHalf = 0
  let projHalf = 0
  let flatLen = 0
  let c2Integral = 0 // ∫ c² dy (projected)
  let cyIntegral = 0 // ∫ c y dy (projected)
  let y = 0
  let z = 0
  let c0 = rootChord
  for (const p of panels) {
    const rad = panelAngle(p)
    const L = p.length * Math.cos(rad) // projected width of the panel
    const c1 = p.tipChord
    const trap = ((c0 + c1) / 2)
    flatHalf += p.length * trap
    projHalf += L * trap
    c2Integral += (L * (c0 * c0 + c0 * c1 + c1 * c1)) / 3
    const dc = c1 - c0
    cyIntegral += L * (c0 * y + (c0 * L) / 2 + (dc * y) / 2 + (dc * L) / 3)
    flatLen += p.length
    y += L
    z += p.length * Math.sin(rad)
    c0 = c1
    stations.push({ y, z, c: c1 })
    if (rad !== 0) g.hasDihedral = true
  }
  g.span = 2 * y
  g.flatSpan = 2 * flatLen
  g.rootChord = rootChord
  g.tipChord = c0
  g.area = 2 * flatHalf
  g.projectedArea = 2 * projHalf
  g.meanChord = g.area / g.flatSpan
  g.mac = projHalf > 0 ? c2Integral / projHalf : null
  g.macY = projHalf > 0 ? cyIntegral / projHalf : null
  g.aspectRatio = g.projectedArea > 0 ? (g.span * g.span) / g.projectedArea : null
  g.stations = stations
  return g
}

// Wing loading, kg/m²
export function wingLoading(mass, area) {
  if (!(mass > 0) || !(area > 0)) return null
  return mass / area
}

// Wing cube loading, kg/m³ (numerically the same as g/dm³, and within 0.2% of oz/ft³)
export function cubeLoading(mass, area) {
  if (!(mass > 0) || !(area > 0)) return null
  return mass / Math.pow(area, 1.5)
}

// Cube-loading bands, thresholds in oz/ft³ (the usual RC convention). Lower bound inclusive.
export const CUBE_BANDS = [
  { id: 'glider', min: 0, max: 4, label: 'Glider / floater', note: 'Very light. Thermal and slope gliders, indoor and slow flyers.' },
  { id: 'trainer', min: 4, max: 7, label: 'Trainer / park flyer', note: 'Slow and forgiving. Ideal for learning and calm-day flying.' },
  { id: 'sport', min: 7, max: 10, label: 'Sport / aerobatic', note: 'Lively but manageable. Typical sport and 3D-capable models.' },
  { id: 'sportscale', min: 10, max: 13, label: 'Sport scale', note: 'Needs more speed on approach. Fine for a confident pilot.' },
  { id: 'warbird', min: 13, max: 16, label: 'Warbird / scale', note: 'Heavy for its size. Fast landings; keep the speed up.' },
  { id: 'racer', min: 16, max: Infinity, label: 'Racer / hotliner', note: 'Very highly loaded. Fast, demanding take-off and landing.' },
]

const OZ_PER_FT3_IN_KG_PER_M3 = 0.028349523125 / Math.pow(0.3048, 3)

export function cubeBand(cubeLoadingKgM3) {
  if (cubeLoadingKgM3 === null || !Number.isFinite(cubeLoadingKgM3)) return null
  const ozft3 = cubeLoadingKgM3 / OZ_PER_FT3_IN_KG_PER_M3
  return CUBE_BANDS.find((b) => ozft3 >= b.min && ozft3 < b.max) ?? null
}

// Level-flight stall speed: V = √(2 m g / (ρ S CLmax)), m/s
export function stallSpeed(mass, area, clMax, rho = RHO_SEA_LEVEL) {
  if (!(mass > 0) || !(area > 0) || !(clMax > 0) || !(rho > 0)) return null
  return Math.sqrt((2 * mass * G) / (rho * area * clMax))
}

export function reynolds(speed, chord, nu = NU_SEA_LEVEL) {
  if (!(speed > 0) || !(chord > 0)) return null
  return (speed * chord) / nu
}

// Input sanity checks. Returns a list of { field, level: 'warn', message }.
export function validate({ mass, geometry, panels = null }) {
  const out = []
  panels?.forEach((p, i) => {
    if (Number.isFinite(p.rise) && p.length > 0 && Math.abs(p.rise) > p.length) {
      out.push({
        field: `panel-${i}-rise`,
        message: `Panel ${i + 1}: the rise is more than the panel's length, which isn't possible.`,
      })
    }
  })
  const { span, stations, aspectRatio } = geometry
  if (span > 0 && (span < SPAN_MIN || span > SPAN_MAX)) {
    out.push({
      field: 'span',
      message: `Span is outside the 600 mm to 3 m range this tool is designed for; results may not be representative.`,
    })
  }
  if (mass > 0 && (mass < 0.05 || mass > 25)) {
    out.push({ field: 'mass', message: 'All-up weight looks unusual for an RC model (expected 50 g to 25 kg).' })
  }
  // Chord growing outboard is unusual enough to be worth a check.
  stations?.forEach((s, i) => {
    if (i > 0 && s.c > stations[i - 1].c) {
      out.push({
        field: `panel-${i - 1}`,
        message: `Panel ${i}: the outer chord is larger than the inner chord. Check the values are the right way round.`,
      })
    }
  })
  if (aspectRatio && (aspectRatio < 3 || aspectRatio > 25)) {
    out.push({
      field: 'area',
      message: `Aspect ratio of ${aspectRatio.toFixed(1)} is unusual (expected roughly 3 to 25). Check span and chord or area.`,
    })
  }
  return out
}
