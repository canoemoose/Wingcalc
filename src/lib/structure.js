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
//  - Covering (the finish over everything): weight only, except glass cloth and epoxy over
//    sheeting, which shares the bending and stiffens the sheet panels against buckling.
//
// Not covered: torsion, flutter, divergence, glue joints, the wing joiner itself, and
// local crushing at fittings. Material values are typical, not guaranteed: balsa varies two
// to three times from sheet to sheet, so weigh your wood and pick the grade it matches.

import { wingSampler } from './wing.js'
import { surfaceFns } from './airfoilGeom.js'
import { G } from './calc.js'
import { clDistribution } from './liftingLine.js'
import { resolveEdges, applyEdges, fitOver, fitDrawing, roundItem, KIND_LABELS, LE_TYPES } from './edgeStock.js'
import { resolveSurfaces, bevelAngle, hingeTabs } from './controlSurfaces.js'

// Typical properties along the grain. E modulus, strengths in Pa, density kg/m³. Balsa
// scales roughly with density; these are on the conservative side of published data.
export const MATERIALS = {
  'balsa-light': { label: 'Balsa, light (100 kg/m³)', short: 'light balsa', density: 100, E: 2.1e9, compression: 6.5e6, tension: 9e6, shear: 1.1e6 },
  'balsa-medium': { label: 'Balsa, medium (160 kg/m³)', short: 'medium balsa', density: 160, E: 3.4e9, compression: 10.5e6, tension: 15e6, shear: 1.8e6 },
  'balsa-hard': { label: 'Balsa, hard (220 kg/m³)', short: 'hard balsa', density: 220, E: 4.6e9, compression: 14.5e6, tension: 20e6, shear: 2.4e6 },
  spruce: { label: 'Spruce', short: 'spruce', density: 450, E: 9.5e9, compression: 33e6, tension: 55e6, shear: 5.5e6 },
  basswood: { label: 'Basswood / lime', short: 'basswood', density: 420, E: 9e9, compression: 28e6, tension: 45e6, shear: 5e6 },
  'ply-birch': { label: 'Birch aircraft plywood', short: 'birch ply', density: 680, E: 7e9, compression: 25e6, tension: 35e6, shear: 6e6 },
  'ply-lite': { label: 'Lite ply (poplar)', short: 'lite ply', density: 450, E: 4e9, compression: 12e6, tension: 16e6, shear: 3e6 },
  carbon: { label: 'Carbon strip (pultruded)', short: 'carbon strip', density: 1550, E: 110e9, compression: 550e6, tension: 1000e6, shear: 40e6 },
  'carbon-tube': { label: 'Carbon tube (roll-wrapped)', short: 'carbon tube', density: 1550, E: 85e9, compression: 400e6, tension: 600e6, shear: 40e6 },
  'carbon-rod': { label: 'Carbon rod (pultruded)', short: 'carbon rod', density: 1550, E: 110e9, compression: 550e6, tension: 1000e6, shear: 40e6 },
  // Beech or ramin dowel
  hardwood: { label: 'Hardwood dowel (beech, ramin)', short: 'hardwood', density: 700, E: 10e9, compression: 40e6, tension: 60e6, shear: 7e6 },
  // Polyester film for hinge tabs: weight only
  mylar: { label: 'Mylar (polyester film)', short: 'Mylar', density: 1390, E: 4e9, compression: 50e6, tension: 150e6, shear: 50e6 },
}

export const material = (id) => MATERIALS[id] ?? MATERIALS['balsa-medium']

const POISSON = 0.3
// Vertical-grain balsa webs are much less stiff across the grain; for shear buckling an
// effective modulus of √(E_L · E_T) with E_T ≈ 5% of E_L is a common first estimate.
const WEB_STIFFNESS_RATIO = Math.sqrt(0.05)
// Smallest rib spacing the suggestion will use; below it the spar or sheeting needs to change.
// A plain rib between the fixed ones (spaced for you, or placed by hand), as opposed to a
// root, break, hard-point or tip rib
export const isPlainRib = (kind) => kind === 'normal' || kind === 'manual'

// How a corner gusset sits at the LE or TE: 'top', 'bottom' or 'both'
export const gussetLayer = (gussets, edge) => (edge === 'te' ? (gussets.teLayer ?? gussets.layer) : gussets.layer) ?? 'top'

// What the wing is covered with, over the ribs and any sheeting. mass is per unit area
// covered, in kg/m², at the heavy end of published figures with adhesive or dope (see
// docs/methods.md). Only glass cloth and epoxy counts in the strength check: a laminate
// of thickness t and modulus E (spanwise, a plain weave at a wet lay-up's fibre fraction)
// over the sheeting. It's laid over sheeting only, so any open bays (behind a D-box) take
// lightweight film.
export const FINISHES = {
  'film-light': { label: 'Heat-shrink film, lightweight', short: 'lightweight film', mass: 0.045, examples: 'Oralight, Solarfilm Lite' },
  film: { label: 'Heat-shrink film', short: 'film', mass: 0.09, examples: 'Oracover, Solarfilm' },
  fabric: { label: 'Fabric film', short: 'fabric film', mass: 0.13, examples: 'Solartex, Oratex' },
  tissue: { label: 'Tissue and dope', short: 'tissue and dope', mass: 0.045, examples: 'lightweight tissue, three coats of dope' },
  glass: { label: 'Glass cloth and epoxy over sheeting', short: 'glass and epoxy', mass: 0.07, examples: '25 g/m² cloth, about as much epoxy, and filler', laminate: { t: 0.00005, E: 10e9 }, sheetedOnly: true },
}
export const finishOf = (cov) => FINISHES[cov?.finish] ?? FINISHES.film
// The finish over open bays and over sheeting: glass only goes on sheeting
export function finishes(cov) {
  const f = finishOf(cov)
  return { sheeted: f, open: f.sheetedOnly ? FINISHES['film-light'] : f }
}

// A sheet panel of thickness t and modulus E with a laminate (t, E) bonded on its outer
// face: the modulus a plain sheet of the same thickness would need to buckle at the same
// stress in the sheet. The laminate adds bending stiffness (about the pair's neutral axis)
// but also takes its share of the load, so E' = E (1 + β) / (1 + η), β the added bending
// stiffness and η the added axial stiffness, each as a fraction of the sheet's own.
export function laminatedSheetE(E, t, lam) {
  if (!lam || !(lam.t > 0) || !(t > 0)) return E
  const zg = t / 2 + lam.t / 2
  const EA = E * t + lam.E * lam.t
  const zbar = (lam.E * lam.t * zg) / EA
  const D = E * ((t ** 3) / 12 + t * zbar ** 2) + lam.E * ((lam.t ** 3) / 12 + lam.t * (zg - zbar) ** 2)
  const beta = D / ((E * t ** 3) / 12) - 1
  const eta = (lam.E * lam.t) / (E * t)
  return (E * (1 + beta)) / (1 + eta)
}

// The edges that get corner gussets: the leading edge only against balsa stock (there's
// nothing square to glue to on a rod, or with a sheeted nose)
export const gussetEdges = (structure) =>
  ['le', 'te'].filter((e) => structure.gussets[e] && (e === 'te' || !structure.le.type || structure.le.type === 'balsa'))

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
      finish: 'film', // FINISHES: what covers the ribs and sheeting
    },
    // type: 'balsa' (stock) | 'rod' (carbon) | 'dowel' (hardwood) | 'none' (the sheeting forms the nose)
    // stock: 'auto' (a standard size picked to suit) | 'custom' (width as entered) | a catalogue id (edgeStock.js)
    // diameter: a rod or dowel's, null for the type's default (edgeStock.js LE_TYPES)
    le: { type: 'balsa', stock: 'auto', width: 0.006, material: 'balsa-hard', diameter: null },
    te: { stock: 'auto', width: 0.015, type: 'triangular', material: 'balsa-medium' }, // 'triangular' | 'flat' (custom only)
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
    // layer: flush with the rib's 'top', 'bottom' or 'both'; teLayer the same at the trailing
    // edge, null to follow layer (as saves from before it did)
    gussets: { le: false, te: false, where: 'ends', size: 0.01, thickness: 0.0015, material: 'balsa-medium', sides: 'both', layer: 'top', teLayer: null },
    braces: { enabled: true, material: 'ply-birch', thickness: null, length: 0.08 },
    // Control-surface hinges: a bevelled hinge line with Mylar tabs slotted into a hinge spar
    // on each side at its centre line. fixedWidth and movingWidth are the hinge spars' widths
    // across the hinge (the fixed part's, square; the moving surface's, bevelled); tabs are
    // tabWidth along the hinge by tabLength across it, no more than tabSpacing apart, the end
    // ones tabInset in from the ends of the moving surface.
    hinges: {
      fixedWidth: 0.008,
      movingWidth: 0.01,
      material: 'balsa-medium',
      tabWidth: 0.012,
      tabLength: 0.015,
      tabThickness: 0.0002,
      tabSpacing: 0.075,
      tabInset: 0.02,
    },
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
// each panel break, the tip, the user's hard points, and any extra ({ s, label }: each end
// of a control surface).
export function hardPoints(sampler, structure, extra = []) {
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
  for (const h of extra) if (h.s > s0 + 1e-4 && h.s < tip - 1e-4) pts.push({ s: h.s, kind: 'hard', label: h.label })
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
          // 1% in hand, so rounding the positions to 0.5 mm never stretches a bay past its limit
          s += kappa * 0.99 * bayFrom(s, limit, b)
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
export function ribStations(sampler, structure, strengthLimit = () => Infinity, extra = []) {
  const r = structure.ribs
  const hard = hardPoints(sampler, structure, extra)
  const s0 = hard[0].s
  const s1 = hard.at(-1).s
  const pitch = Math.max(MIN_SPACING, r.pitch || 0.075)
  if (r.spacing === 'manual') {
    const manual = (r.manual ?? [])
      .filter((m) => Number.isFinite(m.d) && s0 + m.d > s0 + 1e-4 && s0 + m.d < s1 - 1e-4)
      .map((m) => ({ s: s0 + m.d, kind: 'manual', id: m.id }))
    return mergeClose([...hard, ...manual].sort((a, b) => a.s - b.s))
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

// Width of the spar across the chord, whatever its type.
export function sparWidth(sp) {
  return sp.type === 'caps' || sp.type === 'box' ? sp.capWidth : sp.type === 'solid' ? sp.solidWidth : sp.tubeDiameter
}

// The two faces of something of width w laid along a line x = line(s) in plan (a spar, a
// stringer): the width is the stock's own, square to its length, so on a swept line the
// faces sit w / 2 · √(1 + slope²) either side in x. Returns [front(s), rear(s)].
export function lineFaces(line, w) {
  const h = 1e-4
  const halfAt = (s) => {
    const slope = (line(s + h) - line(s - h)) / (2 * h)
    return (w / 2) * Math.sqrt(1 + slope * slope)
  }
  return [(s) => line(s) - halfAt(s), (s) => line(s) + halfAt(s)]
}

// Skin over the ribs at chord fraction q: sheeting where there is any (a D-box's runs back
// to the spar's rear face, sparXiRear), cap strips elsewhere if used. Ribs are inset by it
// and stringers sit under it, so ribs, stringers and the 3D view all agree.
export function skinAt(structure, q, sparXiRear) {
  const cov = structure.covering
  const strip = cov.capStrips ? cov.capStripThickness || 0 : 0
  if (cov.type === 'sheeted') return cov.sheetThickness || 0
  if (cov.type === 'dbox') return q <= sparXiRear ? cov.sheetThickness || 0 : strip
  return strip
}

// Skin thickness over the spar: sheeting, or cap strips on an open wing (they run over
// the caps).
export function skinAtSpar(structure) {
  // The spar is under whatever covers the ribs there: the rib notches are cut from below it
  return skinAt(structure, 0, 1)
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

// Shear buckling stress of a web panel between ribs a apart, with web height d.
export function webBuckling(sp, a) {
  const b = Math.min(a, sp.d)
  const l = Math.max(a, sp.d)
  const ks = 5.35 + 4 * (b / l) ** 2
  return ks * plateK(sp.web.E * WEB_STIFFNESS_RATIO) * (sp.tw / b) ** 2
}

// The largest rib spacing at which the web carries shear stress tau without buckling, or
// Infinity if it holds at any spacing.
function webSpacing(sp, tau) {
  if (!(tau > 0) || !(sp.d > 0)) return Infinity
  if (webBuckling(sp, 1e3) >= tau) return Infinity
  let lo = 1e-4
  let hi = 1e3
  if (webBuckling(sp, lo) < tau) return lo
  for (let i = 0; i < 80; i++) {
    const m = Math.sqrt(lo * hi)
    if (webBuckling(sp, m) >= tau) lo = m
    else hi = m
  }
  return lo
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
    // Glass and epoxy laid over the sheeting, outside it
    const lam = finishOf(cov).laminate
    if (lam?.t > 0) {
      for (let i = 0; i < strips; i++) {
        const xm = leXi + dx * (i + 0.5)
        const f = sec.surf(xm)
        const A = lam.t * dx * sec.c
        els.push({ part: 'laminate', surface: 'upper', x: xm, E: lam.E, A, z: f.upper + lam.t / 2, I0: 0, top: f.upper + lam.t, bottom: f.upper })
        els.push({ part: 'laminate', surface: 'lower', x: xm, E: lam.E, A, z: f.lower - lam.t / 2, I0: 0, top: f.lower, bottom: f.lower - lam.t })
      }
    }
  }
  for (const st of structure.stringers ?? []) {
    if (!Number.isFinite(st.position) || !(st.width > 0) || !(st.height > 0)) continue
    const f = sec.surf(st.position)
    const under = skinAt(structure, st.position, sparXi + sparWidth(structure.spar) / 2 / sec.c)
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

// --- Plan ---------------------------------------------------------------------------------

// The sheeted area in plan, as a closed (s, x) outline: from the LE stock's inner edge back to
// the spar's rear face (D-box) or the TE stock (fully sheeted). Null when it's open.
export function sheetOutline(a, structure, n = 80) {
  const cov = structure.covering.type
  if (cov !== 'dbox' && cov !== 'sheeted') return null
  const sec = (s) => a.section(s)
  const [, sparRear] = lineFaces(a.sparX, sparWidth(structure.spar))
  const back = cov === 'sheeted' ? (s) => sec(s).xl + sec(s).c - structure.te.width : sparRear
  const ss = Array.from({ length: n + 1 }, (_, i) => a.rootS + ((a.tipS - a.rootS) * i) / n)
  return [...ss.map((s) => [s, sec(s).xl + structure.le.width]), ...[...ss].reverse().map((s) => [s, back(s)])]
}

// --- Control surfaces and their hinges ---------------------------------------------------------

// A line a fixed distance d (+ aft) from a straight hinge line, as x(s): the distance is
// square to the hinge, as the hinge spars' widths are.
const offsetLine = (r, d) => {
  const f = Math.sqrt(1 + r.slope * r.slope)
  return (s) => r.hingeX(s) + d * f
}

// Each control surface laid out in the built-up wing (controlSurfaces.js places it; this
// builds it). At each end of a surface there's a full rib (a hard point, at s0 and s1); the
// fixed part's hinge spar runs between those ribs' faces, behind the main spar, and the
// fixed part's ribs stop at its front face. Across the gap, the moving surface's own hinge
// spar is bevelled to a point at the centre line, and the moving surface runs a gap clear of
// the end ribs, with an end rib of its own at each end and the wing's other ribs (cut at the
// hinge) between. The Mylar tabs are slotted into both hinge spars at the centre line.
//
// Returns the surfaces in order along the span, each with ok (built) or problem, and for the
// built ones: faces (plan lines x(s): fixedFront, fixedRear, apex, movingRear), fixed (the
// fixed hinge spar's span [s, s]), moving (the moving surface's span), endRibs (the moving
// surface's end rib stations), depth (the deepest each hinge spar gets, between the skins),
// bevel ({ top, bottom }, degrees from square: the top face clears the down throw), tabs (s
// of each tab's centre), slot (how deep each tab goes into each spar) and warnings.
export function surfaceLayouts({ sampler, section, sparX, structure, rootS, tipS }, controls) {
  const list = resolveSurfaces(sampler, controls?.surfaces)
  const h = structure.hinges
  const t = structure.ribs.thickness || 0
  const [, sparRear] = lineFaces(sparX, sparWidth(structure.spar))
  const teFront = (s) => section(s).xl + section(s).c - (structure.te.width || 0)
  // Depth between the skins at plan position x
  const depthAt = (s, x) => {
    const sec = section(s)
    if (!sec || !(sec.c > 1e-4)) return 0
    const q = Math.min(1, Math.max(0, (x - sec.xl) / sec.c))
    const f = sec.surf(q)
    const skin = skinAt(structure, q, 0)
    return Math.max(0, f.upper - f.lower - 2 * skin)
  }
  const mm = (v) => `${(v * 1000).toFixed(1)} mm`
  for (const r of list) {
    r.warnings = []
    if (!r.ok) continue
    const g = Math.max(0, r.gap || 0)
    const faces = {
      fixedFront: offsetLine(r, -(g / 2 + h.fixedWidth)),
      fixedRear: offsetLine(r, -g / 2),
      apex: offsetLine(r, g / 2),
      movingRear: offsetLine(r, g / 2 + h.movingWidth),
    }
    const ss = Array.from({ length: 9 }, (_, k) => r.s0 + ((r.s1 - r.s0) * k) / 8)
    let problem = null
    if (r.s0 < rootS - 1e-6 || r.s1 > tipS + 1e-6) problem = 'outside'
    // Room for both hinge spars between the main spar and the trailing edge stock
    else if (ss.some((s) => faces.fixedFront(s) < sparRear(s) + 0.002)) problem = 'forward'
    else if (ss.some((s) => faces.movingRear(s) > teFront(s) - 0.005)) problem = 'aft'
    const fixed = [r.s0 + t / 2, r.s1 - t / 2]
    const moving = [r.s0 + t / 2 + g, r.s1 - t / 2 - g]
    if (!problem && !(moving[1] - moving[0] > 2 * t + 0.005)) problem = 'short'
    if (problem) {
      r.ok = false
      r.problem = problem
      continue
    }
    const fixedDepth = Math.max(...ss.map((s) => depthAt(s, faces.fixedFront(s))), ...ss.map((s) => depthAt(s, faces.fixedRear(s))))
    const movingDepth = Math.max(...ss.map((s) => depthAt(s, faces.apex(s))))
    const bevel = { top: bevelAngle(r.down, g, movingDepth / 2), bottom: bevelAngle(r.up, g, movingDepth / 2) }
    // Tabs along the moving surface's span, measured along the hinge
    const k = Math.sqrt(1 + r.slope * r.slope)
    const tabs = hingeTabs((moving[1] - moving[0]) * k, { spacing: h.tabSpacing, inset: h.tabInset, width: h.tabWidth }).map((d) => moving[0] + d / k)
    const slot = Math.max(0, (h.tabLength - g) / 2)
    const narrow = Math.min(h.fixedWidth, h.movingWidth)
    if (slot > narrow + 1e-9) {
      r.warnings.push(`The hinge tabs on ${r.label} go ${mm(slot)} into each hinge spar, deeper than the narrower spar is wide (${mm(narrow)}): use shorter tabs or wider hinge spars.`)
    }
    const run = (movingDepth / 2) * Math.tan(Math.max(bevel.top, bevel.bottom) * (Math.PI / 180))
    if (run > h.movingWidth - 0.001) {
      r.warnings.push(`The bevel on ${r.label}'s hinge spar runs ${mm(run)} back, nearly all of its ${mm(h.movingWidth)} width: use a wider hinge spar on the moving side, or less throw.`)
    }
    Object.assign(r, { faces, fixed, moving, endRibs: [moving[0] + t / 2, moving[1] - t / 2], depth: { fixed: fixedDepth, moving: movingDepth }, bevel, tabs, slot })
  }
  return list
}

// The built surface whose span (between its end ribs) contains s, strictly, or null.
export function surfaceAt(surfaces, s) {
  return (surfaces ?? []).find((r) => r.ok && s > r.s0 + 1e-6 && s < r.s1 - 1e-6) ?? null
}

// Why a surface couldn't be built, in a builder's words.
const SURFACE_PROBLEMS = {
  panel: 'its panel is gone',
  span: 'its ends are back to front, less than 20 mm apart, or off the end of its panel',
  hinge: 'its hinge line is outside the chord',
  overlap: 'it overlaps another surface on the same panel',
  outside: 'it lies outside the ribs',
  forward: "its hinge line is too far forward: the hinge spar on the fixed side would run into the main spar. Move the hinge line back",
  aft: "its hinge line is too far back: there's no room for the moving side's hinge spar ahead of the trailing edge stock. Move the hinge line forward",
  short: 'it is too short to build between its end ribs',
}

// --- The analysis ---------------------------------------------------------------------------

// Everything Stage A works out, for a wing, its aerofoil and structure, at the lifting
// line's stall (perf.spanwise). Returns null if the wing or stall can't be resolved.
// The result's structure has the edge stock resolved to widths (and edges says which
// stock); pass that one, not the input, to buildParts and the views.
export function analyseStructure({ wing, airfoil, structure, mass, spanwise, controls = null, steps = 160 }) {
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
  // Edge stock resolved to a width from here on (auto picks are checked at the root rib,
  // each panel end and the tip rib)
  const checkAt = [s0, ...sampler.ends.map((e) => e.outer.s).filter((s) => s > s0 && s < sTip), sTip]
  const edges = resolveEdges(structure, section, checkAt)
  structure = applyEdges(structure, edges)
  const cov = structure.covering
  const sheet = material(cov.sheetMaterial)
  // The sheeting's modulus for buckling between ribs, stiffened by any laminate over it
  const sheetE = laminatedSheetE(sheet.E, cov.sheetThickness, finishOf(cov).laminate)
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
      // The web buckles in shear more readily the further apart the ribs are
      row.limit = Math.min(row.limit, webSpacing(sp, tau * sf))
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
          row.limit = Math.min(row.limit, sheetSpacing(sheetE, cov.sheetThickness, (x1 - x0) * sec.c, avg * sf))
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
  // Control surfaces, each with a rib at both ends
  const surfaces = surfaceLayouts({ sampler, section, sparX, structure, rootS: s0, tipS: sTip }, controls)
  const surfaceEnds = surfaces.filter((r) => r.ok).flatMap((r) => [
    { s: r.s0, label: `${r.label}, inner end` },
    { s: r.s1, label: `${r.label}, outer end` },
  ])
  const ribs = ribStations(sampler, structure, limitAt, surfaceEnds)
  // A rod or dowel can't be carved to suit, so check it at every rib, not just the ends
  if (edges.le.round) {
    const f = fitOver(roundItem(edges.le.round.diameter), section, ribs.map((r) => r.s), 'le')
    if (f.shortfall > edges.le.shortfall) Object.assign(edges.le, { shortfall: f.shortfall, worstS: f.worstS, fits: f.fits })
  }
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
      r.ms.webBuckling = webBuckling(sp, a) / (r.tau * sf) - 1
    }
  }

  const summary = summarise(stations)
  const warnings = []
  // Each mode that falls short: what it is, where, and what would help. Closer ribs only fix
  // the buckling modes; the rest need a stronger section.
  const where = (d) => (d < 0.002 ? 'at the root rib' : `${Math.round(d * 1000)} mm out from the root rib`)
  const short = (k) => `${Math.round(-summary.modes[k].ms * 100)}%`
  const sp = structure.spar
  for (const k of ['compression', 'tension']) {
    const m = summary.modes[k]
    if (!m || m.ms >= 0) continue
    const row = stations.find((r) => r.s === m.s)
    const remedy =
      sp.type === 'tube'
        ? 'a larger tube or a thicker wall'
        : sp.type === 'solid'
          ? 'a deeper or wider spar, or a stronger wood'
          : `thicker caps (about ${(Math.ceil((row?.capThicknessNeeded ?? 0) * 2000) / 2).toFixed(1)} mm there), wider caps, a stronger material, or sheeting the leading edge so it shares the load`
    warnings.push({
      id: `short-${k}`,
      mode: k,
      message: `The spar is ${short(k)} short of strength in ${k} ${where(m.d)}. Closer ribs won't help: try ${remedy}.`,
    })
  }
  if (summary.modes.webShear?.ms < 0) {
    warnings.push({
      id: 'short-webShear',
      mode: 'webShear',
      message: `The shear web is ${short('webShear')} short of strength ${where(summary.modes.webShear.d)}. Closer ribs won't help: try a thicker web, a stronger web material${sp.type === 'caps' ? ', or a box spar (two webs)' : ''}.`,
    })
  }
  if (summary.modes.sheet?.ms < 0) {
    warnings.push({
      id: 'short-sheet',
      mode: 'sheet',
      message: `The sheeting is ${short('sheet')} short of strength in compression ${where(summary.modes.sheet.d)}. Closer ribs won't help: try thicker or harder sheeting, or stronger spar caps to take more of the load.`,
    })
  }
  for (const k of ['spacing', 'webBuckling']) {
    const m = summary.modes[k]
    if (!m || m.ms >= 0) continue
    warnings.push({
      id: `short-${k}`,
      mode: k,
      message: `The ribs are too far apart for the ${k === 'webBuckling' ? 'shear web' : 'spar or sheeting'} ${where(m.d)} (${short(k)} short). Put ribs closer there, or set the spacing to From loads.`,
    })
  }
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
  const mmText = (v) => `${(v * 1000).toFixed(1)} mm`
  const whereS = (s) => (Math.abs(s - sTip) < 1e-4 ? 'at the tip rib' : where(s - s0))
  const le = edges.le
  if (le.round && !le.fits) {
    const t = LE_TYPES[le.round.type]
    const name = `${mmText(le.round.diameter).replace('.0 ', ' ')} ${t.short}`
    const fix = le.roundFits ? `a ${mmText(le.roundFits).replace('.0 ', ' ')} ${t.short.split(' ').at(-1)} (the largest that fits)` : 'balsa stock, which is carved to the section'
    warnings.push({
      id: 'le-round',
      message: `The ${name} leading edge stands about ${mmText(le.shortfall)} proud of the section ${whereS(le.worstS)}: the nose is too thin there to hold it. Use ${fix}.`,
    })
  }
  if (finishOf(cov).sheetedOnly && cov.type === 'open') {
    warnings.push({
      id: 'finish-open',
      message: "Glass cloth and epoxy goes over sheeting, and this wing has none, so it's weighed as lightweight film. Choose a film, fabric film or tissue, or sheet the wing.",
    })
  }
  if (le.none && cov.type === 'open') {
    warnings.push({
      id: 'le-none-open',
      message: 'With no leading edge stock the sheeting forms the nose, but this wing has no sheeting. Choose D-box or Fully sheeted, or a leading edge stock.',
    })
  }
  // Catalogue edge stock too small to carve the section from, where it's worst and what to do
  for (const [k, name, part] of [
    ['le', 'leading edge', "the wing's nose"],
    ['te', 'trailing edge', "the wing's trailing edge"],
  ]) {
    const e = edges[k]
    if (e.fits || !e.item) continue
    const it = e.item
    const fix =
      e.auto.id !== it.id && e.autoFits
        ? `Use ${e.auto.code} ${KIND_LABELS[e.auto.kind]}${structure[k].stock === 'auto' ? '' : ' (what Auto picks)'}, or a bigger custom size.`
        : "None of the standard sizes is big enough there: use a custom size at least that much bigger."
    warnings.push({
      id: `${k}-stock`,
      message: `The ${name} stock (${it.code} ${KIND_LABELS[it.kind]}) is too small to carve ${part} from ${whereS(e.worstS)}: it falls about ${mmText(e.shortfall)} short of the section, so the carved edge would sit below the wing's surface there. ${fix}`,
    })
  }
  for (const r of surfaces) {
    if (!r.ok) warnings.push({ id: `surface-${r.id}`, message: `${r.label} isn't built: ${SURFACE_PROBLEMS[r.problem] ?? r.problem}.` })
    for (const [k, m] of (r.warnings ?? []).entries()) warnings.push({ id: `surface-${r.id}-${k}`, message: m })
  }
  // Each fit drawn where it's worst, for the editor (edge stock, rods and dowels)
  for (const k of ['le', 'te']) {
    const e = edges[k]
    const item = e.round ? roundItem(e.round.diameter) : e.item
    const sec = item && section(e.worstS)
    if (sec && sec.c > 1e-4) e.drawing = { ...fitDrawing(item, sec, k), where: whereS(e.worstS), shortfall: e.shortfall, fits: e.fits }
  }
  return {
    wing,
    structure,
    edges,
    stations,
    ribs,
    surfaces,
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

// The modes closer ribs can fix; the others need a stronger section.
export const SPACING_MODES = ['spacing', 'webBuckling']

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
