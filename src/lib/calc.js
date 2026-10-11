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

// Planform from one of three entry modes:
//   'chords' – span, root and tip chord (straight-tapered wing)
//   'mean'   – span and mean chord
//   'area'   – span and area entered directly
export function wingGeometry({ mode, span, rootChord, tipChord, meanChord, area }) {
  const g = { span, rootChord: null, tipChord: null, area: null, meanChord: null, mac: null, taper: null }
  if (!(span > 0)) return g
  if (mode === 'chords') {
    if (!(rootChord > 0) || !(tipChord >= 0)) return g
    const taper = tipChord / rootChord
    g.rootChord = rootChord
    g.tipChord = tipChord
    g.taper = taper
    g.area = (span * (rootChord + tipChord)) / 2
    g.meanChord = g.area / span
    // Mean aerodynamic chord of a straight-tapered wing
    g.mac = ((2 / 3) * rootChord * (1 + taper + taper * taper)) / (1 + taper)
  } else if (mode === 'mean') {
    if (!(meanChord > 0)) return g
    g.area = span * meanChord
    g.meanChord = meanChord
    g.mac = meanChord
  } else if (mode === 'area') {
    if (!(area > 0)) return g
    g.area = area
    g.meanChord = area / span
    g.mac = g.meanChord
  }
  g.aspectRatio = g.area ? (span * span) / g.area : null
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
export function validate({ mass, geometry }) {
  const out = []
  const { span, area, rootChord, tipChord, aspectRatio } = geometry
  if (span > 0 && (span < SPAN_MIN || span > SPAN_MAX)) {
    out.push({
      field: 'span',
      message: `Span is outside the 600 mm to 3 m range this tool is designed for; results may not be representative.`,
    })
  }
  if (mass > 0 && (mass < 0.05 || mass > 25)) {
    out.push({ field: 'mass', message: 'All-up weight looks unusual for an RC model (expected 50 g to 25 kg).' })
  }
  if (rootChord > 0 && tipChord > rootChord) {
    out.push({ field: 'tipChord', message: 'Tip chord is larger than root chord. Check the values are the right way round.' })
  }
  if (aspectRatio && (aspectRatio < 3 || aspectRatio > 25)) {
    out.push({
      field: 'area',
      message: `Aspect ratio of ${aspectRatio.toFixed(1)} is unusual (expected roughly 3 to 25). Check span and chord or area.`,
    })
  }
  return out
}
