// Core calculations. All inputs and outputs are SI base units (m, m², kg, m/s)
// unless the name says otherwise.

import { panelWingGeometry, panelAngle } from './wing.js'

export { panelAngle }

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
//   'panels' – optional fuselage width, root chord, then one or more panels per side, each
//              with length, outer chord, sweep, dihedral and straight or curved edges.
//              See src/lib/wing.js.
//   'chords' – span, root and tip chord (a single flat, straight-tapered panel)
//   'mean'   – span and mean chord
//   'area'   – span and area entered directly
//
// Areas: `area` is the flat (developed) area, the figure usually quoted for a model and
// used for wing and cube loading. `projectedArea` is the area seen from above; it is what
// supports the weight (each panel's lift tilts inwards by its dihedral angle), so it is
// used for stall speed. `span` is the projected tip-to-tip span.
export function wingGeometry({ mode, span, rootChord, tipChord, meanChord, area, panels, fuselageWidth = 0, tip = null }) {
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
  if (mode === 'panels') return panelWingGeometry({ fuselageWidth, rootChord, panels, tip })
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
  g.exposedArea = g.area
  g.mac = g.meanChord
  g.macY = span / 4
  g.macX = 0
  g.sweepQuarter = 0
  g.fuselageHalf = 0
  g.outline = [
    [0, 0],
    [span / 2, 0],
    [span / 2, g.meanChord],
    [0, g.meanChord],
  ]
  g.aspectRatio = (span * span) / g.area
  g.stations = [
    { y: 0, z: 0, c: g.meanChord },
    { y: span / 2, z: 0, c: g.meanChord },
  ]
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
  // Stations that can't be used are skipped (the panel still draws); say which and why.
  const WHY = {
    inner: 'is at or before the inner end',
    'on-tip': 'sits on the tip',
    beyond: 'is beyond the tip',
    chord: 'has no chord',
    duplicate: 'is at the same place as another station',
  }
  // Blank stations are just not filled in yet, which isn't worth a warning.
  for (const ig of (geometry.ignoredStations ?? []).filter((x) => x.reason !== 'incomplete')) {
    const order = [...(panels?.[ig.panel]?.stations ?? [])].sort((a, b) => (a.d ?? 0) - (b.d ?? 0))
    const n = order.findIndex((st) => st.id === ig.id) + 1
    out.push({
      field: `station-${ig.panel}-${ig.id}`,
      message: `Panel ${ig.panel + 1}, station ${n || '?'} ${WHY[ig.reason] ?? 'is unusable'}, so it's ignored.`,
    })
  }
  if (geometry.invalid === 'edges-cross') {
    out.push({
      field: 'edges',
      message: 'A curved edge crosses the opposite edge of its panel. Reduce the curve or widen the chord.',
    })
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
