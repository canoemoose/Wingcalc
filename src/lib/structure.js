// Built-up wing structure: what it's made of, where the spar and ribs go, and a first-order
// strength check (Stage A) at the design load factor.
//
// All lengths in metres, stresses in pascals, forces in newtons. Flat spanwise distance s is
// measured along the panels from the centreline, as in wing.js.
//
// Stage A, in short:
//  - Loads: the lifting line's spanwise lift distribution at the stall (the design point at
//    manoeuvring speed, where the full load factor is reached at maximum lift), scaled to
//    n × weight. Negative g uses the distribution at the matching negative lift. The wing's
//    own weight is ignored (inertia relief), which errs on the safe side.
//  - Shear and bending along the span by integrating the load from the tip inward.
//  - Spar: bending carried by the caps (or the tube, or the solid spar) alone; sheeting is
//    ignored for strength (safe side) but checked for buckling at the strain it sees.
//  - Margins of safety: allowable / (actual × safety factor) − 1 per failure mode, so 0 is
//    just enough and negative is not.
//  - Rib spacing: the largest spacing at which the upper spar cap (open structure) or the
//    compressed sheeting (sheeted) won't buckle between ribs, capped by the covering limit.
//
// Not covered: torsion, flutter, divergence, glue joints, the wing joiner itself, and
// local crushing at fittings. Material values are typical, not guaranteed: balsa varies two
// to three times from sheet to sheet, so weigh your wood and pick the grade it matches.

import { wingSampler } from './wing.js'
import { surfaceFns } from './airfoilGeom.js'
import { G } from './calc.js'
import { clDistribution } from './liftingLine.js'

// Typical properties along the grain. E modulus, strengths in Pa, density kg/m³. Balsa
// scales roughly with density; these are on the conservative side of published data.
export const MATERIALS = {
  'balsa-light': { label: 'Balsa, light (100 kg/m³)', density: 100, E: 2.1e9, compression: 6.5e6, tension: 9e6, shear: 1.1e6 },
  'balsa-medium': { label: 'Balsa, medium (160 kg/m³)', density: 160, E: 3.4e9, compression: 10.5e6, tension: 15e6, shear: 1.8e6 },
  'balsa-hard': { label: 'Balsa, hard (220 kg/m³)', density: 220, E: 4.6e9, compression: 14.5e6, tension: 20e6, shear: 2.4e6 },
  spruce: { label: 'Spruce', density: 450, E: 9.5e9, compression: 33e6, tension: 55e6, shear: 5.5e6 },
  basswood: { label: 'Basswood / lime', density: 420, E: 9e9, compression: 28e6, tension: 45e6, shear: 5e6 },
  'ply-birch': { label: 'Birch aircraft plywood', density: 680, E: 7e9, compression: 25e6, tension: 35e6, shear: 6e6 },
  'ply-lite': { label: 'Lite ply (poplar)', density: 450, E: 4e9, compression: 12e6, tension: 16e6, shear: 3e6 },
  carbon: { label: 'Carbon strip (pultruded)', density: 1550, E: 110e9, compression: 550e6, tension: 1000e6, shear: 40e6 },
  'carbon-tube': { label: 'Carbon tube (roll-wrapped)', density: 1550, E: 85e9, compression: 400e6, tension: 600e6, shear: 40e6 },
}

export const material = (id) => MATERIALS[id] ?? MATERIALS['balsa-medium']

const POISSON = 0.3
// Vertical-grain balsa webs are much less stiff across the grain; for shear buckling an
// effective modulus of √(E_L · E_T) with E_T ≈ 5% of E_L is a common first estimate.
const WEB_STIFFNESS_RATIO = Math.sqrt(0.05)
// Smallest rib spacing the suggestion will use; below it the spar or sheeting needs to change.
export const MIN_SPACING = 0.015
// Least rib material left around a hole or notch before it's flagged.
export const MIN_MATERIAL = 0.0015

// A new wing's structure: a D-box with spruce caps and a balsa web, film-covered aft of the
// spar, for a typical 1.4 m sport model.
export function defaultStructure() {
  return {
    spar: {
      type: 'caps', // 'caps' (caps + shear web) | 'box' | 'tube' | 'solid'
      position: null, // chord fraction at each panel end; null = the section's thickest point
      capWidth: 0.006,
      capThickness: 0.003,
      capMaterial: 'spruce',
      webThickness: 0.0015,
      webMaterial: 'balsa-medium',
      tubeDiameter: 0.008,
      tubeWall: 0.001,
      tubeLength: null, // m from the root rib; null = to the tip
      tubeMaterial: 'carbon-tube',
      solidWidth: 0.006,
      solidDepth: 0.009,
      solidMaterial: 'spruce',
      solidMount: 'through', // 'through' (slot) | 'top' | 'bottom' (notch)
    },
    covering: {
      type: 'dbox', // 'open' | 'dbox' | 'sheeted'
      sheetThickness: 0.0015,
      sheetMaterial: 'balsa-medium',
      capStrips: true,
      capStripWidth: 0.006,
      capStripThickness: 0.0015,
      capStripMaterial: 'balsa-medium',
    },
    le: { width: 0.006, material: 'balsa-hard' },
    te: { width: 0.015, type: 'triangular', material: 'balsa-medium' }, // 'triangular' | 'flat'
    stringers: [], // { id, position (chord fraction), surface: 'upper' | 'lower' | 'both', width, height, material }
    ribs: {
      material: 'balsa-medium',
      thickness: 0.002,
      orientation: 'streamwise', // 'streamwise' | 'perpendicular' (to the spar)
      spacing: 'suggested', // 'uniform' | 'tapered' | 'suggested' | 'manual'
      pitch: 0.075, // uniform spacing, and the most the suggestion will use (covering limit)
      rootPitch: 0.05,
      tipPitch: 0.09,
      manual: [], // { id, d }: distance from the root rib
      hardPoints: [], // { id, d, label }: ribs that must be there (servo bays, aileron ends)
      rootJoint: 'one-piece', // 'one-piece' (continuous through the centreline) | 'two-piece'
      lightening: false,
      lighteningMargin: 0.004,
      jigTabs: false,
      tabWidth: 0.006,
      tabClearance: 0.003,
    },
    gussets: { le: false, te: false, where: 'ends', size: 0.01, thickness: 0.0015, material: 'balsa-medium', sides: 'both' },
    braces: { enabled: true, material: 'ply-birch', thickness: null, length: 0.08 },
    loads: { designG: 6, negativeG: 3, safetyFactor: 1.5 },
  }
}

// --- Spar line and section depth ------------------------------------------------------------

// The spar position as a chord fraction: as set, or the aerofoil's thickest point.
export function sparFraction(structure, airfoilParams) {
  const p = structure.spar.position
  if (Number.isFinite(p) && p > 0.05 && p < 0.8) return p
  const t = airfoilParams?.thicknessPos
  return Number.isFinite(t) && t > 0.1 && t < 0.6 ? t : 0.28
}

// The spar line in plan (flat s, chordwise x): straight across each panel between the spar
// points at its ends, and across the fuselage section. Returns x(s).
export function sparLine(sampler, fraction) {
  const knots = [{ s: 0, x: fraction * sampler.at(0).c }]
  if (sampler.half > 0) knots.push({ s: sampler.half, x: fraction * sampler.at(sampler.half).c })
  for (const e of sampler.ends) knots.push({ s: e.outer.s, x: e.outer.x + fraction * e.outer.c })
  return (s) => {
    if (s <= 0) return knots[0].x
    for (let i = 1; i < knots.length; i++) {
      if (s <= knots[i].s + 1e-12) {
        const a = knots[i - 1]
        const b = knots[i]
        const t = b.s > a.s ? (s - a.s) / (b.s - a.s) : 0
        return a.x + (b.x - a.x) * t
      }
    }
    return knots.at(-1).x
  }
}

// The wing's section at any s: depth and surfaces in metres, chord fraction helpers.
// coords is the aerofoil's own section; its thickness is scaled to the local thickness.
export function sectionAt(sampler, coords, baseThickness) {
  const { upper, lower } = surfaceFns(coords)
  return (s) => {
    const w = sampler.at(s)
    if (!w) return null
    const k = baseThickness > 0 && w.thickness > 0 ? w.thickness / baseThickness : 1
    const surf = (xi) => {
      const yu = upper(xi)
      const yl = lower(xi)
      const m = (yu + yl) / 2
      const h = ((yu - yl) / 2) * k
      return { upper: (m + h) * w.c, lower: (m - h) * w.c }
    }
    return { ...w, k, surf, depth: (xi) => (surf(xi).upper - surf(xi).lower) }
  }
}

// --- Rib positions -------------------------------------------------------------------------

// Where the wing's ribs start: the centreline for a one-piece wing, else the fuselage side.
export function rootRibS(sampler, structure) {
  return structure.ribs.rootJoint === 'two-piece' ? sampler.half : 0
}

// The tip rib: the outer end of the last panel (a rounded tip is a block beyond it).
export function tipRibS(sampler) {
  return sampler.ends.at(-1).outer.s
}

const round = (v, step = 0.0005) => Math.round(v / step) * step

// Ribs that must be there: the root, the fuselage side (one-piece wing with a fuselage),
// each panel break, the tip, and the user's hard points.
export function hardPoints(sampler, structure) {
  const s0 = rootRibS(sampler, structure)
  const tip = tipRibS(sampler)
  const pts = [{ s: s0, kind: 'root', label: s0 === 0 && structure.ribs.rootJoint !== 'two-piece' ? 'Centre' : 'Root' }]
  if (s0 < sampler.half) pts.push({ s: sampler.half, kind: 'break', label: 'Fuselage side' })
  sampler.ends.forEach((e, i) => {
    const kind = i === sampler.ends.length - 1 ? 'tip' : 'break'
    pts.push({ s: e.outer.s, kind, label: kind === 'tip' ? 'Tip' : `Panel ${i + 1}/${i + 2}` })
  })
  for (const h of structure.ribs.hardPoints ?? []) {
    if (!Number.isFinite(h.d)) continue
    const s = s0 + h.d
    if (s > s0 + 1e-4 && s < tip - 1e-4) pts.push({ s, kind: 'hard', label: h.label || 'Hard point', id: h.id })
  }
  return mergeClose(pts.sort((a, b) => a.s - b.s))
}

// Two ribs within 3 mm of each other are one rib; keep the more important kind.
const RANK = { root: 0, tip: 1, break: 2, hard: 3, manual: 4, normal: 5 }
function mergeClose(pts, tol = 0.003) {
  const out = []
  for (const p of pts) {
    const last = out.at(-1)
    if (last && p.s - last.s < tol) {
      if (RANK[p.kind] < RANK[last.kind]) out[out.length - 1] = p
    } else out.push(p)
  }
  return out
}

// The largest bay starting at s that stays within the limit everywhere along it.
function bayFrom(s, limit, end) {
  let L = Math.max(MIN_SPACING, limit(s))
  for (let it = 0; it < 6; it++) {
    let m = Infinity
    for (let k = 0; k <= 8; k++) m = Math.min(m, limit(Math.min(end, s + (L * k) / 8)))
    const next = Math.max(MIN_SPACING, m)
    if (Math.abs(next - L) < 1e-6) break
    L = Math.min(L, next)
  }
  return L
}

// Rib positions between the hard points. limit(s) is the largest spacing allowed at s. Each
// interval gets the fewest bays that keep every bay within the limit all along it: march
// out from the inner end taking the largest bay allowed each time, then scale the limit down
// (by bisection) until that number of bays lands exactly on the outer end, so the spacing
// still grows where it may but there's no stub of a bay at the end.
export function spacedRibs(points, limit) {
  const out = [points[0]]
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1].s
    const b = points[i].s
    if (b - a > 1e-6) {
      const march = (kappa, n = Infinity) => {
        const xs = []
        let s = a
        while (xs.length < n && s < b - 1e-9) {
          s += kappa * bayFrom(s, limit, b)
          xs.push(s)
        }
        return xs
      }
      const n = march(1).length
      let lo = 0.05
      let hi = 1
      for (let it = 0; it < 50; it++) {
        const mid = (lo + hi) / 2
        if (march(mid, n).at(-1) >= b) hi = mid
        else lo = mid
      }
      const xs = march(hi, n)
      // The last one is the outer end itself
      for (const x of xs.slice(0, -1)) if (x < b - 1e-4) out.push({ s: round(x), kind: 'normal' })
    }
    out.push(points[i])
  }
  return mergeClose(out)
}

// The wing's rib stations for the chosen spacing mode. strengthLimit(s) is the structural
// spacing limit from the loads (Infinity where nothing limits it); see analyseStructure.
export function ribStations(sampler, structure, strengthLimit = () => Infinity) {
  const r = structure.ribs
  const hard = hardPoints(sampler, structure)
  const s0 = hard[0].s
  const s1 = hard.at(-1).s
  const pitch = Math.max(MIN_SPACING, r.pitch || 0.075)
  if (r.spacing === 'manual') {
    const extra = (r.manual ?? [])
      .filter((m) => Number.isFinite(m.d) && s0 + m.d > s0 + 1e-4 && s0 + m.d < s1 - 1e-4)
      .map((m) => ({ s: s0 + m.d, kind: 'manual', id: m.id }))
    return mergeClose([...hard, ...extra].sort((a, b) => a.s - b.s))
  }
  if (r.spacing === 'tapered') {
    const a = Math.max(MIN_SPACING, r.rootPitch || pitch)
    const b = Math.max(MIN_SPACING, r.tipPitch || pitch)
    return spacedRibs(hard, (s) => a + ((b - a) * (s - s0)) / Math.max(1e-9, s1 - s0))
  }
  if (r.spacing === 'suggested') return spacedRibs(hard, (s) => Math.min(pitch, strengthLimit(s)))
  return spacedRibs(hard, () => pitch)
}

// --- Loads ------------------------------------------------------------------------------

// Shear and bending along the half wing for a load factor n, from the lifting line's lift
// distribution at wing lift coefficient CL. Returns rows root to tip:
// { s, w (N/m along the span), V (N), M (N·m) }, plus the half-wing lift.
export function spanLoads(sampler, ll, CL, { mass, n, steps = 240 }) {
  const dist = clDistribution(ll, CL) // stations root to tip by eta
  // Lift per unit projected span ∝ c·cl, looked up by eta = y / semi-span
  const reach = sampler.reach
  const ySemi = sampler.at(reach).y
  const ccl = (y) => {
    const eta = Math.min(1, Math.max(0, y / ySemi))
    let i = 1
    while (i < dist.length - 1 && dist[i].eta < eta) i++
    const a = dist[i - 1]
    const b = dist[i]
    const t = b.eta > a.eta ? Math.min(1, Math.max(0, (eta - a.eta) / (b.eta - a.eta))) : 0
    // Beyond the outermost collocation point the load falls to zero at the tip
    const va = a.c * a.cl
    const vb = b.c * b.cl
    if (eta > dist.at(-1).eta) return vb * Math.max(0, (1 - eta) / (1 - dist.at(-1).eta))
    if (eta < dist[0].eta) return dist[0].c * dist[0].cl
    return va + (vb - va) * t
  }
  const rows = []
  for (let k = 0; k <= steps; k++) {
    const s = (reach * k) / steps
    const p = sampler.at(s)
    rows.push({ s, y: p.y, raw: ccl(p.y) })
  }
  // Scale so the vertical lift of the half wing is n × W / 2. Integrating over projected y
  // gives the vertical component; the load along the panel is the same per unit y.
  let total = 0
  for (let k = 1; k < rows.length; k++) total += ((rows[k].y - rows[k - 1].y) * (rows[k].raw + rows[k - 1].raw)) / 2
  const half = (n * mass * G) / 2
  const q = total !== 0 ? half / total : 0
  // Load per unit flat span: w_s = q c cl (normal to the panel)
  for (const r of rows) r.w = q * r.raw
  let V = 0
  let M = 0
  rows.at(-1).V = 0
  rows.at(-1).M = 0
  for (let k = rows.length - 2; k >= 0; k--) {
    const a = rows[k]
    const b = rows[k + 1]
    const ds = b.s - a.s
    // Load varying linearly across the step: its moment about a is ds² (w_a + 2 w_b) / 6
    M += V * ds + (ds * ds * (a.w + 2 * b.w)) / 6
    V += ((a.w + b.w) / 2) * ds
    a.V = V
    a.M = M
  }
  return { rows: rows.map(({ s, y, w, V, M }) => ({ s, y, w, V, M })), halfLift: half }
}

// Interpolate a row value (V or M) at s.
export function loadAt(rows, s, key) {
  if (s <= rows[0].s) return rows[0][key]
  for (let k = 1; k < rows.length; k++) {
    if (s <= rows[k].s) {
      const a = rows[k - 1]
      const b = rows[k]
      return a[key] + ((b[key] - a[key]) * (s - a.s)) / (b.s - a.s)
    }
  }
  return rows.at(-1)[key]
}

// --- Section strength ---------------------------------------------------------------------

// Skin thickness over the spar caps (they sit under the sheeting).
function skinAtSpar(structure) {
  return structure.covering.type === 'open' ? 0 : structure.covering.sheetThickness || 0
}

// Spar properties at a station with outside depth h (m) at the spar. Returns null where
// there's no spar (beyond a short tube) or what's there doesn't fit.
export function sparSection(structure, h, dFromRoot = 0) {
  const sp = structure.spar
  const skin = skinAtSpar(structure)
  const inner = h - 2 * skin
  if (sp.type === 'tube') {
    if (Number.isFinite(sp.tubeLength) && dFromRoot > sp.tubeLength + 1e-6) return { type: 'none', inner }
    const D = sp.tubeDiameter
    const Di = Math.max(0, D - 2 * sp.tubeWall)
    const I = (Math.PI / 64) * (D ** 4 - Di ** 4)
    return { type: 'tube', inner, I, c: D / 2, fits: D + 2 * MIN_MATERIAL <= inner, mat: material(sp.tubeMaterial) }
  }
  if (sp.type === 'solid') {
    const b = sp.solidWidth
    const d = sp.solidDepth
    return { type: 'solid', inner, I: (b * d ** 3) / 12, c: d / 2, fits: d <= inner + 1e-9, mat: material(sp.solidMaterial), b }
  }
  // Caps (+ one web, or two for a box)
  const b = sp.capWidth
  const tc = sp.capThickness
  const d = inner - tc // between cap centroids
  const area = b * tc
  return {
    type: sp.type,
    inner,
    d,
    area,
    I: 2 * area * (d / 2) ** 2 + (2 * b * tc ** 3) / 12,
    c: inner / 2,
    fits: d > tc,
    mat: material(sp.capMaterial),
    b,
    webs: sp.type === 'box' ? 2 : 1,
    web: material(sp.webMaterial),
    tw: sp.webThickness,
  }
}

// Largest rib spacing at which a strut of width b (buckling sideways) carries stress sigma.
function eulerSpacing(E, b, sigma) {
  if (!(sigma > 0)) return Infinity
  return Math.PI * b * Math.sqrt(E / (12 * sigma))
}

// Plate buckling coefficient factor for a simply supported sheet: σcr = K (t/b)², K = π² E / 12(1−ν²).
const plateK = (E) => (Math.PI * Math.PI * E) / (12 * (1 - POISSON * POISSON))

// Buckling stress of a sheet panel b wide (chordwise, between supports) and a long
// (spanwise, between ribs), compressed spanwise.
export function sheetBuckling(E, t, b, a) {
  const r = a / b
  // Minimum over the number of half-waves m along the panel
  let k = Infinity
  for (let m = 1; m <= 8; m++) k = Math.min(k, (m / r + r / m) ** 2)
  return k * plateK(E) * (t / b) ** 2
}

// The rib spacing at which a sheet panel of width b just carries stress sigma, or Infinity
// if it never buckles below sigma whatever the spacing, or 0 if it can't however close.
export function sheetSpacing(E, t, b, sigma) {
  if (!(sigma > 0)) return Infinity
  const K = sigma / (plateK(E) * (t / b) ** 2)
  if (K <= 4) return Infinity // long-plate minimum k = 4: stable at any spacing
  const r = (Math.sqrt(K) + Math.sqrt(K - 4)) / 2 // b / a
  return b / r
}

/// The bending section at a station: the spar, plus the sheeting and stringers when there
// are any, as elements { part, E, A, z, I0, top, bottom } (z the height of the centroid,
// top and bottom its extreme fibres). Sheeting is split into strips across the chord so it
// follows the section's curve. sec comes from sectionAt; xi values are chord fractions.
export function sectionElements(structure, sec, { sparXi, leXi, teXi, dFromRoot = 0, strips = 12 }) {
  const els = []
  const cov = structure.covering
  const sp = sparSection(structure, sec.depth(sparXi), dFromRoot)
  const skin = skinAtSpar(structure)
  const at = sec.surf(sparXi)
  const top = at.upper - skin
  const bot = at.lower + skin
  if (sp.type === 'caps' || sp.type === 'box') {
    const tc = structure.spar.capThickness
    const I0 = (sp.b * tc ** 3) / 12
    els.push({ part: 'spar', E: sp.mat.E, A: sp.area, z: top - tc / 2, I0, top, bottom: top - tc })
    els.push({ part: 'spar', E: sp.mat.E, A: sp.area, z: bot + tc / 2, I0, top: bot + tc, bottom: bot })
  } else if (sp.type === 'tube') {
    const D = structure.spar.tubeDiameter
    const Di = Math.max(0, D - 2 * structure.spar.tubeWall)
    const mid = (top + bot) / 2
    els.push({ part: 'spar', E: sp.mat.E, A: (Math.PI / 4) * (D * D - Di * Di), z: mid, I0: sp.I, top: mid + D / 2, bottom: mid - D / 2 })
  } else if (sp.type === 'solid') {
    const d = structure.spar.solidDepth
    const mount = structure.spar.solidMount
    const mid = mount === 'top' ? top - d / 2 : mount === 'bottom' ? bot + d / 2 : (top + bot) / 2
    els.push({ part: 'spar', E: sp.mat.E, A: structure.spar.solidWidth * d, z: mid, I0: sp.I, top: mid + d / 2, bottom: mid - d / 2 })
  }
  const end = cov.type === 'sheeted' ? teXi : cov.type === 'dbox' ? sparXi : leXi
  if (cov.type !== 'open' && cov.sheetThickness > 0 && end > leXi) {
    const t = cov.sheetThickness
    const E = material(cov.sheetMaterial).E
    const dx = (end - leXi) / strips
    for (let i = 0; i < strips; i++) {
      const xm = leXi + dx * (i + 0.5)
      const f = sec.surf(xm)
      const A = t * dx * sec.c
      els.push({ part: 'sheet', surface: 'upper', x: xm, E, A, z: f.upper - t / 2, I0: 0, top: f.upper, bottom: f.upper - t })
      els.push({ part: 'sheet', surface: 'lower', x: xm, E, A, z: f.lower + t / 2, I0: 0, top: f.lower + t, bottom: f.lower })
    }
  }
  for (const st of structure.stringers ?? []) {
    if (!Number.isFinite(st.position) || !(st.width > 0) || !(st.height > 0)) continue
    const f = sec.surf(st.position)
    const sheeted = cov.type === 'sheeted' || (cov.type === 'dbox' && st.position <= sparXi)
    const under = sheeted ? cov.sheetThickness : 0
    const E = material(st.material).E
    const A = st.width * st.height
    const I0 = (st.width * st.height ** 3) / 12
    if (st.surface !== 'lower') {
      const t = f.upper - under
      els.push({ part: 'stringer', surface: 'upper', E, A, z: t - st.height / 2, I0, top: t, bottom: t - st.height })
    }
    if (st.surface !== 'upper') {
      const b = f.lower + under
      els.push({ part: 'stringer', surface: 'lower', E, A, z: b + st.height / 2, I0, top: b + st.height, bottom: b })
    }
  }
  return { els, spar: sp, top, bot }
}

// Modulus-weighted bending properties: neutral-axis height and flexural rigidity EI.
export function bendingProps(els) {
  let EA = 0
  let EAz = 0
  for (const e of els) {
    EA += e.E * e.A
    EAz += e.E * e.A * e.z
  }
  const zbar = EA > 0 ? EAz / EA : 0
  let EI = 0
  for (const e of els) EI += e.E * (e.I0 + e.A * (e.z - zbar) ** 2)
  return { zbar, EI }
}

// Sheet panels on one surface between supports (the LE stock, stringers on that surface,
// the spar and, when fully sheeted, the TE stock), as [from, to] chord fractions.
function sheetPanels(structure, surface, sparXi, leXi, teXi) {
  const cov = structure.covering.type
  if (cov === 'open') return []
  const end = cov === 'sheeted' ? teXi : sparXi
  const supports = [leXi, sparXi, end]
  for (const st of structure.stringers ?? []) {
    if (Number.isFinite(st.position) && (st.surface === 'both' || st.surface === surface)) supports.push(st.position)
  }
  const xs = [...new Set(supports)].filter((x) => x >= leXi && x <= end).sort((a, b) => a - b)
  const out = []
  for (let i = 1; i < xs.length; i++) if (xs[i] - xs[i - 1] > 1e-4) out.push([xs[i - 1], xs[i]])
  return out
}

// --- The analysis ---------------------------------------------------------------------------

// Everything Stage A works out, for a wing, its aerofoil and structure, at the lifting
// line's stall (perf.spanwise). Returns null if the wing or stall can't be resolved.
export function analyseStructure({ wing, airfoil, structure, mass, spanwise, steps = 160 }) {
  if (!airfoil?.valid || !spanwise?.ll || !(mass > 0)) return null
  const base = airfoil.params.thickness
  const sampler = wingSampler(wing, base)
  if (!sampler) return null
  const loads = structure.loads
  const sf = loads.safetyFactor >= 1 ? loads.safetyFactor : 1.5
  const nPos = loads.designG > 0 ? loads.designG : 6
  const nNeg = loads.negativeG > 0 ? loads.negativeG : 0
  const CL = spanwise.CLmax
  const pos = spanLoads(sampler, spanwise.ll, CL, { mass, n: nPos })
  const neg = nNeg > 0 ? spanLoads(sampler, spanwise.ll, (-CL * nNeg) / nPos, { mass, n: nNeg }) : null

  const xi = sparFraction(structure, airfoil.params)
  const sparX = sparLine(sampler, xi)
  const section = sectionAt(sampler, airfoil.coords, base)
  const s0 = rootRibS(sampler, structure)
  const sTip = tipRibS(sampler)
  const cov = structure.covering
  const sheet = material(cov.sheetMaterial)
  const ms = (allow, actual) => (actual > 0 ? allow / (actual * sf) - 1 : Infinity)

  const stations = []
  for (let k = 0; k <= steps; k++) {
    const s = s0 + ((sTip - s0) * k) / steps
    const sec = section(s)
    if (!sec || !(sec.c > 1e-4)) continue
    const sparXi = Math.min(0.95, Math.max(0.02, (sparX(s) - sec.xl) / sec.c))
    const h = sec.depth(sparXi)
    const leXi = Math.min(sparXi, (structure.le.width || 0) / sec.c)
    const teXi = Math.max(sparXi, 1 - (structure.te.width || 0) / sec.c)
    const M = loadAt(pos.rows, s, 'M')
    const V = loadAt(pos.rows, s, 'V')
    const Mn = neg ? Math.abs(loadAt(neg.rows, s, 'M')) : 0
    const { els, spar: sp } = sectionElements(structure, sec, { sparXi, leXi, teXi, dFromRoot: s - s0 })
    const row = { s, d: s - s0, c: sec.c, h, sparXi, M, V, Mneg: Mn, spar: sp.type, fits: sp.fits ?? false, ms: {}, limit: Infinity }
    stations.push(row)
    if (sp.type === 'none') {
      row.note = 'no spar'
      continue
    }
    const { zbar, EI } = bendingProps(els)
    row.EI = EI
    // Stress (compression positive) at height z in material of modulus E: positive g bends
    // the upper side into compression, negative g the lower side.
    const comp = (E, z) => Math.max((E * M * (z - zbar)) / EI, (E * Mn * (zbar - z)) / EI, 0)
    const tens = (E, z) => Math.max((E * M * (zbar - z)) / EI, (E * Mn * (z - zbar)) / EI, 0)
    const sparEls = els.filter((e) => e.part === 'spar')
    const zTop = Math.max(...sparEls.map((e) => e.top))
    const zBot = Math.min(...sparEls.map((e) => e.bottom))
    const Es = sparEls[0].E
    const sigC = Math.max(comp(Es, zTop), comp(Es, zBot))
    const sigT = Math.max(tens(Es, zTop), tens(Es, zBot))
    row.sigma = sigC
    row.ms.compression = ms(sp.mat.compression, sigC)
    row.ms.tension = ms(sp.mat.tension, sigT)
    if (sp.type === 'caps' || sp.type === 'box') {
      // Shear web(s) between the caps; the D-box's own shear path is ignored (safe side)
      const tau = V / (sp.webs * sp.tw * Math.max(1e-6, sp.d))
      row.tau = tau
      row.ms.webShear = ms(sp.web.shear, tau)
      // Roughly the cap thickness that would give a margin of zero at this width
      const ratio = Math.max((sigC * sf) / sp.mat.compression, (sigT * sf) / sp.mat.tension)
      row.capThicknessNeeded = structure.spar.capThickness * ratio
      // An open structure leaves the compressed cap free to buckle sideways between ribs
      if (cov.type === 'open') row.limit = Math.min(row.limit, eulerSpacing(sp.mat.E, sp.b, sigC * sf))
    }
    // Sheeting: crushing, and buckling between ribs panel by panel
    if (cov.type !== 'open' && cov.sheetThickness > 0) {
      const strips = els.filter((e) => e.part === 'sheet')
      const sheetC = strips.reduce((m, e) => Math.max(m, comp(e.E, e.top), comp(e.E, e.bottom)), 0)
      row.sheetStress = sheetC
      row.ms.sheet = ms(sheet.compression, sheetC)
      for (const surface of ['upper', 'lower']) {
        for (const [x0, x1] of sheetPanels(structure, surface, sparXi, leXi, teXi)) {
          const inPanel = strips.filter((e) => e.surface === surface && e.x >= x0 && e.x <= x1)
          if (!inPanel.length) continue
          const avg = inPanel.reduce((acc, e) => acc + comp(e.E, e.z), 0) / inPanel.length
          row.limit = Math.min(row.limit, sheetSpacing(sheet.E, cov.sheetThickness, (x1 - x0) * sec.c, avg * sf))
        }
      }
    }
  }

  // Rib positions, then the margins that depend on the actual spacing. Stations are evenly
  // spaced in s, so the limit at any s is a direct lookup.
  const limitAt = (s) => {
    const k = Math.round(((s - s0) / Math.max(1e-9, sTip - s0)) * steps)
    const r = stations[Math.min(stations.length - 1, Math.max(0, k))]
    return r ? r.limit : Infinity
  }
  const ribs = ribStations(sampler, structure, limitAt)
  const bayAt = (s) => {
    for (let i = 1; i < ribs.length; i++) if (s <= ribs[i].s + 1e-9) return ribs[i].s - ribs[i - 1].s
    return 0
  }
  for (const r of stations) {
    const a = bayAt(r.s)
    r.bay = a
    if (Number.isFinite(r.limit) && a > 0) r.ms.spacing = r.limit / a - 1
    if ((r.spar === 'caps' || r.spar === 'box') && a > 0 && r.tau > 0) {
      // Web shear buckling: a panel between ribs (a) by the web height
      const sp = sparSection(structure, r.h, r.d)
      const b = Math.min(a, sp.d)
      const l = Math.max(a, sp.d)
      const ks = 5.35 + 4 * (b / l) ** 2
      const tcr = ks * plateK(sp.web.E * WEB_STIFFNESS_RATIO) * (sp.tw / b) ** 2
      r.ms.webBuckling = tcr / (r.tau * sf) - 1
    }
  }

  const summary = summarise(stations)
  const warnings = []
  const misfit = stations.find((r) => r.spar !== 'none' && !r.fits)
  if (misfit) {
    warnings.push({
      id: 'spar-fit',
      message: `The spar doesn't fit inside the wing from ${Math.round(misfit.d * 1000)} mm out from the root rib (depth there ${(misfit.h * 1000).toFixed(1)} mm).`,
    })
  }
  if (structure.spar.type === 'tube' && stations.some((r) => r.spar === 'none')) {
    warnings.push({
      id: 'tube-short',
      message: "Beyond the end of the tube there's no spar; the sheeting and edges carry the load there, which this check doesn't cover.",
    })
  }
  if (structure.ribs.spacing === 'suggested' && stations.some((r) => r.limit < MIN_SPACING)) {
    warnings.push({
      id: 'too-close',
      message: 'The structure would need ribs closer than 15 mm somewhere. Use stiffer or wider caps, thicker sheeting or stringers instead.',
    })
  }
  return {
    stations,
    ribs,
    pos,
    neg,
    sparFraction: xi,
    sparX,
    sampler,
    section,
    rootS: s0,
    tipS: sTip,
    rootMoment: loadAt(pos.rows, s0, 'M'),
    rootShear: loadAt(pos.rows, s0, 'V'),
    safetyFactor: sf,
    summary,
    warnings,
  }
}

export const MODES = {
  compression: 'Spar in compression',
  tension: 'Spar in tension',
  sheet: 'Sheeting crushing',
  webShear: 'Shear web',
  webBuckling: 'Shear web buckling',
  spacing: 'Buckling between ribs',
}

// Lowest margin per mode, and where.
export function summarise(stations) {
  const out = {}
  for (const r of stations) {
    for (const [k, v] of Object.entries(r.ms)) {
      if (!Number.isFinite(v)) continue
      if (!out[k] || v < out[k].ms) out[k] = { ms: v, s: r.s, d: r.d }
    }
  }
  let worst = null
  for (const [k, v] of Object.entries(out)) if (!worst || v.ms < worst.ms) worst = { mode: k, ...v }
  return { modes: out, worst }
}
