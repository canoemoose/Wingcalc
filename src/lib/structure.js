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
//    own weight is ignored (inertia relief), which errs on the safe side; the servos are the
//    exception, each relieving the spar by n × its weight at its span station.
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
import { resolveEdges, applyEdges, fitOver, fitDrawing, roundItem, KIND_LABELS, LE_TYPES, isRound } from './edgeStock.js'
import { resolveSurfaces, bevelAngle, hingeTabs } from './controlSurfaces.js'
import { placeBays, servoMasses, fitBaysToRibs, BAY_MARGIN, SERVO_HEADROOM, PLATE_EDGE } from './servos.js'
import { resolveBrakes, brakeHosts, brakeOpenings, BRAKE } from './airBrakes.js'
import { FOAM_MATERIALS, defaultFoam, foamStructure, isFoam, wrinklingStress, coreShearStress } from './foam.js'
import { braceSizing } from './ribs.js'

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
  // Foam cores, obechi veneer, carbon tow and template stock (foam.js)
  ...FOAM_MATERIALS,
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

// What the wing is covered with, over the ribs and any sheeting. mass is the applied weight
// per unit area covered, in kg/m²: films from makers' and retailers' published weights;
// Doculam from film thickness plus adhesive; glass and carbon from cloth weight with a
// hand-laid epoxy wet-out (about 1.8x cloth for glass, 2.2-2.5x for carbon), no filler.
// See docs/methods.md. A cloth with a laminate (t, E) counts in the strength check: t is
// its cured thickness (cloth weight over fibre density at a wet lay-up's fibre fraction),
// E its spanwise modulus, bonded over the sheeting. Cloth is laid over sheeting only, so
// any open bays (behind a D-box) take lightweight film.
export const FINISHES = {
  'film-light': { group: 'Generic', label: 'Heat-shrink film, lightweight', short: 'lightweight film', mass: 0.045, examples: 'Generic lightweight heat-shrink film, about 45 g/m² applied' },
  film: { group: 'Generic', label: 'Heat-shrink film', short: 'film', mass: 0.09, examples: 'Generic heat-shrink film, about 90 g/m² applied' },
  fabric: { group: 'Generic', label: 'Fabric film', short: 'fabric film', mass: 0.13, examples: 'Solartex, Oratex, about 130 g/m² applied' },
  tissue: { group: 'Generic', label: 'Tissue and dope', short: 'tissue and dope', mass: 0.045, examples: 'Lightweight tissue, three coats of dope' },

  solarfilm: { group: 'Solarfilm', label: 'Solarfilm', short: 'Solarfilm', mass: 0.060, examples: 'Solarfilm, about 60 g/m² applied' },
  solalite: { group: 'Solarfilm', label: 'Solalite', short: 'Solalite', mass: 0.022, examples: 'Solalite, about 22 g/m² applied' },

  oracover: { group: 'Oracover', label: 'Oracover', short: 'Oracover', mass: 0.054, examples: 'Oracover, about 54 g/m² applied' },
  oralight: { group: 'Oracover', label: 'Oralight', short: 'Oralight', mass: 0.036, examples: 'Oralight, about 36 g/m² applied' },

  kavan: { group: 'Kavan', label: 'Kavan film', short: 'Kavan film', mass: 0.066, examples: 'Kavan heat-shrink film, about 66 g/m² applied' },

  'doculam-15': { group: 'Doculam laminating film', label: 'Doculam 15 µm', short: 'Doculam 15 µm', mass: 0.028, examples: 'Doculam 15 µm laminating film with adhesive, about 28 g/m²' },
  'doculam-30': { group: 'Doculam laminating film', label: 'Doculam 30 µm', short: 'Doculam 30 µm', mass: 0.050, examples: 'Doculam 30 µm laminating film with adhesive, about 50 g/m²' },
  'doculam-40': { group: 'Doculam laminating film', label: 'Doculam 40 µm', short: 'Doculam 40 µm', mass: 0.065, examples: 'Doculam 40 µm laminating film with adhesive, about 65 g/m²' },

  glass: { group: 'Glass cloth and epoxy, over sheeting', label: 'Glass 0.6 oz and epoxy', short: 'glass 0.6 oz and epoxy', mass: 0.037, examples: '0.6 oz (about 20 g/m²) glass cloth with epoxy, about 37 g/m² applied', laminate: { t: 0.037 / 1600, E: 10e9 }, sheetedOnly: true },
  'glass-1': { group: 'Glass cloth and epoxy, over sheeting', label: 'Glass 1 oz and epoxy', short: 'glass 1 oz and epoxy', mass: 0.061, examples: '1 oz (about 34 g/m²) glass cloth with epoxy, about 61 g/m² applied', laminate: { t: 0.061 / 1600, E: 10e9 }, sheetedOnly: true },
  'glass-1-5': { group: 'Glass cloth and epoxy, over sheeting', label: 'Glass 1.5 oz and epoxy', short: 'glass 1.5 oz and epoxy', mass: 0.092, examples: '1.5 oz (about 51 g/m²) glass cloth with epoxy, about 92 g/m² applied', laminate: { t: 0.092 / 1600, E: 10e9 }, sheetedOnly: true },

  'carbon-10': { group: 'Carbon cloth and epoxy, over sheeting', label: 'Carbon 10 g/m² and epoxy', short: 'carbon 10 g/m² and epoxy', mass: 0.025, examples: 'Light carbon cloth (about 10 g/m²) with epoxy, about 25 g/m² applied', laminate: { t: 0.025 / 1500, E: 8e9 }, sheetedOnly: true },
  'carbon-30': { group: 'Carbon cloth and epoxy, over sheeting', label: 'Carbon 30 g/m² and epoxy', short: 'carbon 30 g/m² and epoxy', mass: 0.070, examples: 'Carbon cloth (about 30 g/m²) with epoxy, about 70 g/m² applied', laminate: { t: 0.070 / 1500, E: 30e9 }, sheetedOnly: true },
  'carbon-50': { group: 'Carbon cloth and epoxy, over sheeting', label: 'Carbon 50 g/m² and epoxy', short: 'carbon 50 g/m² and epoxy', mass: 0.110, examples: 'Carbon cloth (about 50 g/m²) with epoxy, about 110 g/m² applied', laminate: { t: 0.110 / 1500, E: 30e9 }, sheetedOnly: true },
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
    // 'built-up' (ribs, spar and covering, as below) | 'foam' (a hot-wire cut core with skins:
    // foam holds its settings; the edges, finish, hinges, braces and loads are shared)
    construction: 'built-up',
    foam: defaultFoam(),
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
      // D-box only, per surface: whether that surface is sheeted, and where its sheeting stops as
      // a chord fraction from the LE (null: back to the spar's rear face)
      dbox: { top: true, bottom: true, topTo: null, bottomTo: null },
      // Open covering only: where cap strips start, as a chord fraction. null (the default) starts
      // them behind the leading-edge stock, so the rib's own nose sets the leading-edge shape
      capStripStart: null,
    },
    // type: 'balsa' (stock) | 'rod' (carbon) | 'dowel' (hardwood) | 'none' (the sheeting forms the nose)
    // stock: 'auto' (a standard size picked to suit) | 'custom' (width as entered) | a catalogue id (edgeStock.js)
    // diameter: a rod or dowel's, null for the type's default (edgeStock.js LE_TYPES)
    // fit: 'square' (the stock's back face square to the chord, flat on the square-cut rib face),
    // 'rotated' (turned to follow the camber, the rib face cut to its angle) or, the leading edge
    // only, 'inset' (let into the ribs); lay: a let-in strip on 'edge', 'flat' or the 'best' way
    // up. See edgeStock.js
    le: { type: 'balsa', stock: 'auto', width: 0.006, height: null, material: 'balsa-hard', diameter: null, fit: 'square', lay: 'best' }, // height: custom stock only (null: as deep)
    te: { stock: 'auto', width: 0.015, type: 'triangular', material: 'balsa-medium', fit: 'square' }, // 'triangular' | 'flat' (custom only)
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
      // { id, d, label, to, sheet }: ribs that must be there, at d from the root rib and, if to
      // is set, at to as well, the bays between them sheeted over the whole chord on the top,
      // bottom or both (sheet; 'none' leaves them open). See hardPatches.
      hardPoints: [],
      rootJoint: 'one-piece', // 'one-piece' (continuous through the centreline) | 'two-piece'
      lightening: false,
      lighteningMargin: 0.004,
      // Material left round each servo lead hole: from the spar, between holes, and to the
      // rib's edges and notches
      leadMargin: 0.003,
      jigTabs: false,
      tabWidth: 0.006,
      tabClearance: 0.003,
    },
    // layer: flush with the rib's 'top', 'bottom' or 'both'; teLayer the same at the trailing
    // edge, null to follow layer (as saves from before it did)
    gussets: { le: false, te: false, where: 'ends', size: 0.01, thickness: 0.0015, material: 'balsa-medium', sides: 'both', layer: 'top', teLayer: null },
    // thicknesses: each brace's ply, by name ({ B1: 0.003 }); a brace not listed takes thickness
    // (as older saves set one for all), and with neither, the next standard ply the loads need
    braces: { enabled: true, material: 'ply-birch', thickness: null, thicknesses: {}, length: 0.08 },
    // Control-surface hinges: a bevelled hinge line with Mylar tabs slotted into a hinge spar
    // on each side at its centre line. fixedWidth and movingWidth are the hinge spars' widths
    // across the hinge (the fixed part's, square; the moving surface's, bevelled); tabs are
    // tabWidth along the hinge by tabLength across it, no more than tabSpacing apart, the end
    // ones' nearer edges tabInset in from the ends of the moving surface. The tabs are cut from 25 mm Mylar
    // roll, 0.2 mm thick: the roll's width goes across the hinge (12.5 mm into each spar, so
    // the spars are 13 mm wide), and each tab is cut 25 mm long along it unless set otherwise.
    hinges: {
      fixedWidth: 0.013,
      movingWidth: 0.013,
      material: 'balsa-medium',
      tabWidth: 0.025,
      tabLength: 0.025,
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
    // A rib at its start and, if it runs to a second distance, one at its end too
    for (const d of Number.isFinite(h.to) && h.to > h.d + 1e-4 ? [h.d, h.to] : [h.d]) {
      const s = s0 + d
      if (s > s0 + 1e-4 && s < tip - 1e-4) pts.push({ s, kind: 'hard', label: h.label || 'Hard point', id: h.id })
    }
  }
  for (const h of extra) if (h.s > s0 + 1e-4 && h.s < tip - 1e-4) pts.push({ s: h.s, kind: 'hard', label: h.label })
  return mergeClose(pts.sort((a, b) => a.s - b.s))
}

// The sheeted hard points: each hard point that runs from d to a second distance `to`, a rib at
// each end, sheeted on its top, bottom or both, as { id, label, s0, s1 (flat span positions),
// from, to (chord fractions: always the whole chord, 0 to 1), sides: ['top', 'bottom'] }. The
// sheet covers the bays between, any number of them, over the whole chord: from the leading
// edge stock to the trailing edge stock, or to a control surface's fixed hinge spar
// (patchSpan). It's the covering's sheeting (its thickness and material; 1.5 mm balsa if none
// is set), laid over the ribs, so the ribs there are inset by it.
export function hardPatches(structure, rootS) {
  const out = []
  for (const h of structure.ribs?.hardPoints ?? []) {
    if (!Number.isFinite(h.d) || !Number.isFinite(h.to) || !(h.to > h.d + 1e-4)) continue
    const sides = h.sheet === 'both' ? ['top', 'bottom'] : h.sheet === 'top' || h.sheet === 'bottom' ? [h.sheet] : []
    if (!sides.length) continue
    out.push({ id: h.id, label: h.label || 'Hard point', s0: rootS + h.d, s1: rootS + h.to, from: 0, to: 1, sides })
  }
  return out
}
// Where a hard point's sheet runs across the chord at span position s, as plan positions
// [x0, x1]: from the back of the leading edge stock to the front of the trailing edge stock, or
// alongside a control surface to the rear face of its fixed hinge spar. a from analyseStructure
// (its section and surfaces), structure the resolved one.
export function patchSpan(a, structure, s) {
  const sec = a.section(s)
  if (!sec || !(sec.c > 1e-4)) return null
  const x0 = sec.xl + Math.min(structure.le.width || 0, sec.c / 2)
  const sf = (a.surfaces ?? []).find((x) => x.ok && s >= x.s0 - 1e-9 && s <= x.s1 + 1e-9)
  const x1 = sf ? sf.faces.fixedRear(s) : sec.xl + sec.c - Math.min(structure.te.width || 0, sec.c / 2)
  return x1 > x0 ? [x0, x1] : null
}
export const patchSheet = (structure) => ({
  thickness: structure.covering.sheetThickness || 0.0015,
  material: structure.covering.sheetMaterial || 'balsa-medium',
})

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
// Manual spacing: ribs for panels that have none. Each of the given panels (indices into
// sampler.ends; all of them if null) with no manual rib between its ends gets ribs evenly spaced
// at the pitch, as Even spacing would put them there. Returns the manual list with them added,
// each { id, d } with d in metres from the root rib (to 0.5 mm), or the list as it was.
export function fillManualRibs(sampler, structure, panels = null) {
  const r = structure.ribs
  const list = r.manual ?? []
  const s0 = rootRibS(sampler, structure)
  const pitch = Math.max(MIN_SPACING, r.pitch || 0.075)
  let id = list.reduce((m, x) => Math.max(m, x.id ?? 0), 0)
  const out = [...list]
  sampler.ends.forEach((e, i) => {
    if (panels && !panels.includes(i)) return
    const a = Math.max(s0, e.inner.s)
    const b = e.outer.s
    if (!(b - a > 2 * MIN_SPACING)) return
    if (list.some((m) => Number.isFinite(m.d) && s0 + m.d > a + 1e-4 && s0 + m.d < b - 1e-4)) return
    const n = Math.max(1, Math.ceil((b - a) / pitch - 1e-9))
    for (let k = 1; k < n; k++) out.push({ id: ++id, d: Math.round((a + ((b - a) * k) / n - s0) * 2000) / 2000 })
  })
  return out.length === list.length ? list : out
}

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
// { s, w (N/m along the span), V (N), M (N·m) }, plus the half-wing lift. relief: point masses
// carried by the half wing, [{ s, mass }]: each pulls down n × its weight at s, which takes
// that force off the shear inboard of it and its moment about each section off the bending.
export function spanLoads(sampler, ll, CL, { mass, n, steps = 240, relief = [] }) {
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
  for (const sv of relief ?? []) {
    const F = n * sv.mass * G
    if (!(F > 0)) continue
    for (const r of rows) {
      if (sv.s > r.s) {
        r.V -= F
        r.M -= F * (sv.s - r.s)
      }
    }
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
  if (sp.type === 'none') return 0
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
// Which surface a sheet is on: 'top' or 'bottom' (the analysis calls them 'upper' and 'lower').
export function sheetSide(surface) {
  return surface === 'upper' ? 'top' : surface === 'lower' ? 'bottom' : surface
}

// Where one surface's sheeting runs, as chord fractions from the LE: { from, to }, or null if
// that surface has no sheeting. 'sheeted' runs to the TE on both sides and 'open' has none. On
// a D-box, a surface is sheeted only if its dbox flag is on, and it runs to its own topTo or
// bottomTo when set, else to sparXi (the caller's choice of spar fraction: the centreline for
// the analysis, the rear face for the plan). Either end is clamped to the LE and TE stock.
export function sheetExtent(structure, side, sparXi, { leXi = 0, teXi = 1 } = {}) {
  const cov = structure.covering
  if (cov.type === 'open') return null
  if (cov.type === 'sheeted') return { from: leXi, to: teXi }
  if (cov.type !== 'dbox') return null
  const d = cov.dbox ?? {}
  if (d[side] === false) return null
  const set = side === 'top' ? d.topTo : d.bottomTo
  const to = Math.min(Math.max(set ?? sparXi, leXi), teXi)
  return { from: leXi, to }
}

// Skin over the ribs at chord fraction q: sheeting where there is any (a D-box's runs back
// to the spar's rear face, sparXiRear), cap strips elsewhere if used. Ribs are inset by it
// and stringers sit under it, so ribs, stringers and the 3D view all agree. With a side
// ('top' or 'bottom'), a D-box is judged on that surface's own sheeting extent.
// How far the leading-edge stock reaches back from the nose, m: a rod or dowel's diameter, a
// strip's width, nothing when the sheeting forms the nose
export function leStockDepth(le) {
  if (isRound(le)) return le.diameter || 0
  return le?.type === 'none' ? 0 : le?.width || 0
}
// Chord fraction where cap strips start: the set value, or with null just behind the
// leading-edge stock, as a fraction of the chord (chord in m; without one, from the nose).
// Under a leading edge let into the ribs (side 'bottom'), behind the strip's bottom back
// corner, where its bottom stops being the lower surface.
export function capStripStart(structure, chord, side = null) {
  const v = structure.covering.capStripStart
  if (v != null) return v
  if (side === 'bottom' && Number.isFinite(structure.le?.inset?.bottomXi)) return structure.le.inset.bottomXi
  // Turned to the camber: where its leaning face meets that surface
  const face = structure.le?.face
  if (side && face && Number.isFinite(face[side === 'top' ? 'topXi' : 'bottomXi'])) return face[side === 'top' ? 'topXi' : 'bottomXi']
  return chord > 0 ? leStockDepth(structure.le) / chord : 0
}

// chord (m) is the station's chord; it's only needed for a null capStripStart. caps false
// leaves the cap strips out: hinge spars stand the full height of a rib and its capping, the
// strips stopping at them, so only sheeting covers them.
export function skinAt(structure, q, sparXiRear, side, chord, caps = true) {
  const cov = structure.covering
  // Cap strips stop short of the leading edge (capStripStart), so the rib's nose is uncovered
  const strip = caps && cov.capStrips && q >= capStripStart(structure, chord, side) - 1e-9 ? cov.capStripThickness || 0 : 0
  if (cov.type === 'sheeted') return cov.sheetThickness || 0
  if (cov.type === 'dbox') {
    if (!side) return q <= sparXiRear ? cov.sheetThickness || 0 : strip
    const ext = sheetExtent(structure, side, sparXiRear)
    return ext && q <= ext.to ? cov.sheetThickness || 0 : strip
  }
  return strip
}

// Skin thickness over the spar: sheeting, or cap strips on an open wing (they run over
// the caps). With a side, that surface's own skin.
export function skinAtSpar(structure, side) {
  // The spar is under whatever covers the ribs there: the rib notches are cut from below it.
  // On an open wing that's the cap strips, which start ahead of the spar.
  if (structure.covering.type === 'open') return structure.covering.capStrips ? structure.covering.capStripThickness || 0 : 0
  // Tested at the spar itself (not the nose), so a null cap-strip start still lies ahead of it
  return skinAt(structure, sparFraction(structure), 1, side)
}

// Spar properties at a station with outside depth h (m) at the spar. Returns null where
// there's no spar (beyond a short tube) or what's there doesn't fit.
export function sparSection(structure, h, dFromRoot = 0) {
  const sp = structure.spar
  const skin = skinAtSpar(structure)
  const inner = h - 2 * skin
  // No spar at all (a foam wing): the skins carry the bending
  if (sp.type === 'none') return { type: 'none', inner }
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
  // Each surface's own skin: a D-box may sheet one side only
  const at = sec.surf(sparXi)
  const top = at.upper - skinAtSpar(structure, 'top')
  const bot = at.lower + skinAtSpar(structure, 'bottom')
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
  // Each surface sheets to its own extent (a D-box may sheet one side only)
  const ext = {
    upper: cov.type !== 'open' && cov.sheetThickness > 0 ? sheetExtent(structure, 'top', sparXi, { leXi, teXi }) : null,
    lower: cov.type !== 'open' && cov.sheetThickness > 0 ? sheetExtent(structure, 'bottom', sparXi, { leXi, teXi }) : null,
  }
  if (ext.upper || ext.lower) {
    const t = cov.sheetThickness
    const E = material(cov.sheetMaterial).E
    for (const surface of ['upper', 'lower']) {
      const e = ext[surface]
      if (!e || !(e.to > e.from)) continue
      const dx = (e.to - e.from) / strips
      for (let i = 0; i < strips; i++) {
        const xm = e.from + dx * (i + 0.5)
        const f = sec.surf(xm)
        const A = t * dx * sec.c
        if (surface === 'upper') els.push({ part: 'sheet', surface, x: xm, E, A, z: f.upper - t / 2, I0: 0, top: f.upper, bottom: f.upper - t })
        else els.push({ part: 'sheet', surface, x: xm, E, A, z: f.lower + t / 2, I0: 0, top: f.lower + t, bottom: f.lower })
      }
    }
    // Glass and epoxy laid over the sheeting, outside it
    const lam = finishOf(cov).laminate
    if (lam?.t > 0) {
      for (const surface of ['upper', 'lower']) {
        const e = ext[surface]
        if (!e || !(e.to > e.from)) continue
        const dx = (e.to - e.from) / strips
        for (let i = 0; i < strips; i++) {
          const xm = e.from + dx * (i + 0.5)
          const f = sec.surf(xm)
          const A = lam.t * dx * sec.c
          if (surface === 'upper') els.push({ part: 'laminate', surface, x: xm, E: lam.E, A, z: f.upper + lam.t / 2, I0: 0, top: f.upper + lam.t, bottom: f.upper })
          else els.push({ part: 'laminate', surface, x: xm, E: lam.E, A, z: f.lower - lam.t / 2, I0: 0, top: f.lower, bottom: f.lower - lam.t })
        }
      }
    }
  }
  const rear = sparXi + sparWidth(structure.spar) / 2 / sec.c
  for (const st of structure.stringers ?? []) {
    if (!Number.isFinite(st.position) || !(st.width > 0) || !(st.height > 0)) continue
    const f = sec.surf(st.position)
    const E = material(st.material).E
    const A = st.width * st.height
    const I0 = (st.width * st.height ** 3) / 12
    if (st.surface !== 'lower') {
      const t = f.upper - skinAt(structure, st.position, rear, 'top', sec.c)
      els.push({ part: 'stringer', surface: 'upper', E, A, z: t - st.height / 2, I0, top: t, bottom: t - st.height })
    }
    if (st.surface !== 'upper') {
      const b = f.lower + skinAt(structure, st.position, rear, 'bottom', sec.c)
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
  const ext = sheetExtent(structure, sheetSide(surface), sparXi, { leXi, teXi })
  if (!ext) return []
  const end = ext.to
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
// the spar's rear face (D-box) or the TE stock (fully sheeted). Null when it's open. With a
// side ('top' or 'bottom'), that surface's own sheeting only; without, the larger of the two
// sheeted surfaces, so the plan shows whichever side reaches furthest aft.
export function sheetOutline(a, structure, n = 80, side = null) {
  const cov = structure.covering.type
  if (cov !== 'dbox' && cov !== 'sheeted') return null
  const d = structure.covering.dbox ?? {}
  const sec = (s) => a.section(s)
  const [, sparRear] = lineFaces(a.sparX, sparWidth(structure.spar))
  const backAt = (s, sd) => {
    if (cov === 'sheeted') return sec(s).xl + sec(s).c - structure.te.width
    const set = sd === 'top' ? d.topTo : d.bottomTo
    return set == null ? sparRear(s) : sec(s).xl + Math.min(Math.max(set, 0), 1) * sec(s).c
  }
  const sides = (side ? [side] : ['top', 'bottom']).filter((sd) => cov === 'sheeted' || d[sd] !== false)
  if (!sides.length) return null
  const back = (s) => Math.max(...sides.map((sd) => backAt(s, sd)))
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
// bevel ({ top, bottom }, degrees from square: the bottom face clears the down throw, the top the up), tabs (s
// of each tab's centre), slot (how deep each tab goes into each spar) and warnings.
export function surfaceLayouts({ sampler, section, sparX, structure, rootS, tipS }, controls) {
  const list = resolveSurfaces(sampler, controls?.surfaces)
  const h = structure.hinges
  const t = structure.ribs.thickness || 0
  const [, sparRear] = lineFaces(sparX, sparWidth(structure.spar))
  const teFront = (s) => section(s).xl + section(s).c - (structure.te.width || 0)
  // Depth between the skins at plan position x: the hinge spars' depth, so any sheeting but
  // not the cap strips, which stop at the spars
  const depthAt = (s, x) => {
    const sec = section(s)
    if (!sec || !(sec.c > 1e-4)) return 0
    const q = Math.min(1, Math.max(0, (x - sec.xl) / sec.c))
    const f = sec.surf(q)
    const top = skinAt(structure, q, 0, 'top', sec.c, false)
    const bot = skinAt(structure, q, 0, 'bottom', sec.c, false)
    return Math.max(0, f.upper - f.lower - top - bot)
  }
  const mm = (v) => `${(v * 1000).toFixed(1)} mm`
  for (const r of list) {
    r.warnings = []
    if (!r.ok) continue
    const g = Math.max(0, r.gap || 0)
    const ss = Array.from({ length: 9 }, (_, k) => r.s0 + ((r.s1 - r.s0) * k) / 8)
    // A surface whose hinge is at the trailing edge stock's front face (within STOCK_HINGE) is the
    // stock itself: no hinge spar or ribs of its own, its front face bevelled
    const apexAt = offsetLine(r, g / 2)
    const stock = ss.every((s) => Math.abs(apexAt(s) - teFront(s)) <= STOCK_HINGE)
    const faces = {
      fixedFront: offsetLine(r, -(g / 2 + h.fixedWidth)),
      fixedRear: offsetLine(r, -g / 2),
      apex: apexAt,
      movingRear: stock ? apexAt : offsetLine(r, g / 2 + h.movingWidth),
    }
    let problem = null
    if (r.s0 < rootS - 1e-6 || r.s1 > tipS + 1e-6) problem = 'outside'
    // Room for both hinge spars between the main spar and the trailing edge stock
    else if (ss.some((s) => faces.fixedFront(s) < sparRear(s) + 0.002)) problem = 'forward'
    else if (!stock && ss.some((s) => faces.movingRear(s) > teFront(s) - 0.005)) problem = 'aft'
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
    // Each face bevelled to its full throw, as builders do (it leaves room for the covering and
    // a stiff hinge), or more where the gap alone wouldn't clear it: a surface cut from the
    // trailing edge stock is bevelled like any other, though its depth is small enough that the
    // gap would clear it square
    const bevel = { top: Math.max(r.up, bevelAngle(r.up, g, movingDepth / 2)), bottom: Math.max(r.down, bevelAngle(r.down, g, movingDepth / 2)) }
    // Tabs along the moving surface's span, measured along the hinge. Each lies square to the
    // hinge, so on a raked hinge its nearest corner to an end is tabLength/2 × slope further
    // along it than its half width: the end ones go in that far plus tabInset, which is to
    // that corner
    const k = Math.sqrt(1 + r.slope * r.slope)
    const reach = h.tabWidth / 2 + (h.tabLength / 2) * Math.abs(r.slope)
    const tabs = hingeTabs((moving[1] - moving[0]) * k, { spacing: h.tabSpacing, inset: Math.max(0, h.tabInset) + reach, width: 2 * reach }).map((d) => moving[0] + d / k)
    const slot = Math.max(0, (h.tabLength - g) / 2)
    const narrow = stock ? Math.min(h.fixedWidth, structure.te.width || h.fixedWidth) : Math.min(h.fixedWidth, h.movingWidth)
    if (slot > narrow + 1e-9) {
      r.warnings.push(`The hinge tabs on ${r.label} go ${mm(slot)} into each hinge spar, deeper than the narrower spar is wide (${mm(narrow)}): use shorter tabs or wider hinge spars.`)
    }
    const run = (movingDepth / 2) * Math.tan(Math.max(bevel.top, bevel.bottom) * (Math.PI / 180))
    if (!stock && run > h.movingWidth - 0.001) {
      r.warnings.push(`The bevel on ${r.label}'s hinge spar runs ${mm(run)} back, nearly all of its ${mm(h.movingWidth)} width: use a wider hinge spar on the moving side, or less throw.`)
    }
    Object.assign(r, { faces, fixed, moving, stock, endRibs: stock ? [] : [moving[0] + t / 2, moving[1] - t / 2], depth: { fixed: fixedDepth, moving: movingDepth }, bevel, tabs, slot })
  }
  return list
}

// How close (m) a surface's hinge must be to the trailing edge stock's front face for the stock
// itself to be the moving surface
export const STOCK_HINGE = 0.003

// The built surface whose span (between its end ribs) contains s, strictly, or null.
export function surfaceAt(surfaces, s) {
  return (surfaces ?? []).find((r) => r.ok && s > r.s0 + 1e-6 && s < r.s1 - 1e-6) ?? null
}

// --- Air brakes ---------------------------------------------------------------------------------

// Why a brake isn't built, in a builder's words.
const BRAKE_PROBLEMS = {
  panel: 'its panel is gone',
  size: 'a size or position is missing or out of range',
  span: 'its ribs would run off its panel or too close to the root or tip rib of it: move it along the span or make it shorter',
  overlap: 'its ribs would be on top of another air brake',
  outside: 'it lies outside the ribs',
}

// Each air brake laid out in the built-up wing (airBrakes.js resolveBrakes places it; this builds
// it). A brake sits between two ribs, hard points a little further apart than its length. A
// blade brake is a box: the ribs' faces are its ends, a ply wall along each side runs between
// them from skin to skin, and the blades slide up through slots in the covering. A spoiler is a
// plate hinged along its front edge in an opening in the top surface, framed in ply between
// the ribs. Either fits if the section is deep enough, and its box or frame keeps clear of the
// main spar, the edge stock and any control surface's hinge spars; where it doesn't it's still
// built, with a warning saying what's wrong and how far to move it.
//
// Returns the brakes in order along the span, each with ok (built) or problem, and for the
// built ones: inner (the rib faces' s), bx (the box's chord range with its walls), walls (each
// { x0, x1, height }: the ply wall's chord range and the room between the skins there), room
// (the least depth between the skins over the box), need (what the blades need when retracted),
// openings (the slots or opening in the covering, in plan), surfaces ('upper', 'lower' the
// blades come through) and warnings.
export function brakeLayouts({ sampler, section, sparX, structure, rootS, tipS }, controls, surfaces = []) {
  const t = structure.ribs.thickness || 0
  const list = resolveBrakes(sampler, controls?.brakes, { ribThickness: t })
  const [sparFront, sparRear] = lineFaces(sparX, sparWidth(structure.spar))
  const mm = (v) => `${(v * 1000).toFixed(1)} mm`
  // Depth between the skins at plan position x
  const depthAt = (s, x) => {
    const sec = section(s)
    if (!sec || !(sec.c > 1e-4)) return 0
    const q = Math.min(1, Math.max(0, (x - sec.xl) / sec.c))
    const f = sec.surf(q)
    return Math.max(0, f.upper - f.lower - skinAt(structure, q, 0, 'top', sec.c) - skinAt(structure, q, 0, 'bottom', sec.c))
  }
  const built = surfaces.filter((x) => x.ok)
  for (const r of list) {
    r.warnings = []
    if (!r.ok) continue
    if (r.sA < rootS + 0.003 || r.sB > tipS - 0.003) {
      r.ok = false
      r.problem = 'outside'
      continue
    }
    const blade = r.type === 'blade'
    const w = blade ? BRAKE.wall : 0
    const bx = [r.x0 - w, r.x1 + w]
    const inner = [r.sA + t / 2, r.sB - t / 2]
    const ss = Array.from({ length: 7 }, (_, k) => inner[0] + ((inner[1] - inner[0]) * k) / 6)
    const xs = Array.from({ length: 5 }, (_, k) => r.x0 + ((r.x1 - r.x0) * k) / 4)
    let room = Infinity
    for (const s of ss) for (const x of xs) room = Math.min(room, depthAt(s, x))
    const wallHeight = (x) => Math.min(...ss.map((s) => depthAt(s, x)))
    const both = blade && r.surface === 'both'
    // Retracted, a blade stands its height down inside the box: two blades share the depth
    const need = blade ? (both ? 2 * r.height + 0.004 : r.height + 0.002) : 0
    Object.assign(r, {
      inner,
      bx,
      room,
      need,
      walls: blade ? [{ x0: r.x0 - w, x1: r.x0, height: wallHeight(r.x0) }, { x0: r.x1, x1: r.x1 + w, height: wallHeight(r.x1) }] : [],
      surfaces: blade ? (both ? ['upper', 'lower'] : ['upper']) : ['upper'],
      openings: brakeOpenings(r),
    })
    if (blade && !(room >= need)) {
      r.warnings.push(
        `${r.label} needs ${mm(need)} of depth inside for ${both ? 'blades through both skins' : 'its blades'} ${mm(r.height)} high, and the wing has ${mm(Math.max(0, room))} there: use shorter blades${both ? ', blades through the top only' : ''}, or move it to where the wing is deeper.`,
      )
    }
    // Clear of the main spar: the box has to be wholly ahead of it or behind it
    const sparBlock = ss.filter((s) => bx[1] > sparFront(s) - 0.001 && bx[0] < sparRear(s) + 0.001)
    if (sparBlock.length) {
      const back = Math.max(...ss.map(sparRear)) + 0.002 - bx[0]
      r.warnings.push(`${r.label} crosses the main spar. Move it about ${mm(Math.max(0, back))} back, or forward of the spar's front face.`)
    }
    if (ss.some((s) => bx[0] < section(s).xl + (structure.le.width || 0) + 0.002)) {
      r.warnings.push(`${r.label} runs into the leading edge stock: move it back.`)
    }
    if (ss.some((s) => bx[1] > section(s).xl + section(s).c - (structure.te.width || 0) - 0.002)) {
      r.warnings.push(`${r.label} runs into the trailing edge stock: move it forward or make it narrower.`)
    }
    // Clear of any control surface's hinge spars alongside it
    for (const sf of built) {
      const over = ss.filter((s) => s > sf.s0 - 0.001 && s < sf.s1 + 0.001)
      if (over.length && over.some((s) => bx[1] > sf.faces.fixedFront(s) - 0.002)) {
        r.warnings.push(`${r.label} runs into the hinge spar of ${sf.label}: move it forward of the hinge line, or out of the surface's length.`)
      }
    }
  }
  return list
}

// Warnings that need the servo bays as well: a bay (or its leads' route to the root) in the way
// of an air brake's box. A bay alongside its own brake shares a rib with it, so only an
// overlap of the two in plan counts. Adds to each brake's warnings.
export function brakeBayClashes(brakes, bays, { sparX, structure }) {
  const [, sparRear] = lineFaces(sparX, sparWidth(structure.spar))
  for (const r of brakes.filter((x) => x.ok)) {
    for (const b of bays.filter((x) => x.ok)) {
      const over = b.sA < r.inner[1] - 1e-4 && b.sB > r.inner[0] + 1e-4 && b.plate.x0 < r.bx[1] && b.plate.x1 > r.bx[0]
      if (over) r.warnings.push(`${r.label} is in the way of ${b.label}: move one of them along the span.`)
      // The leads from this bay pass every rib inboard of it, this brake's two among them
      else if (b.lead && r.sB <= b.sA + 1e-6 && b.s > r.s) {
        const mid = (r.sA + r.sB) / 2
        const lead = [sparRear(mid) + b.lead.offset, sparRear(mid) + b.lead.offset + b.lead.diameter]
        if (r.bx[0] < lead[1] + 0.002 && r.bx[1] > lead[0] - 0.002) {
          r.warnings.push(`The leads for ${b.label} would run through ${r.label}'s box: move the brake back from the main spar.`)
        }
      }
    }
  }
}

// --- Servo bays ---------------------------------------------------------------------------------

// Why a bay isn't built, in a builder's words.
const BAY_PROBLEMS = {
  surface: "the control surface or air brake it works isn't built",
  span: 'it would run off its panel or past the root or tip rib: move it along the span',
  overlap: 'it overlaps another servo bay',
  forward: "there's no room between the main spar and the hinge for the servo and the lead holes: use a smaller servo or move the hinge back",
}

// Each servo bay laid out (servos.js placeBays says where it goes; this builds it). The bay
// is the gap between two ribs, the whole servo's width (servos.js installedServo: lugs, boss
// and lead included) and its clearance across, with a hard point (a full rib) at each end. The
// servo's run along the chord (all of it) and the plate round it go between the leads' strip
// behind the spar and the fixed hinge spar; a ply mount plate spans the bay between the ribs'
// faces, its underside on the lugs' top face, with a cut-out for what passes through it and
// at least PLATE_EDGE of ply round that (the servo goes in from below, the lugs bearing up on
// the plate). Lower stringers under the run raise the servo, upper ones lower its ceiling. The
// hatch is the opening in the lower surface under it, the plate's size. The leads leave
// through a hole in each rib inboard of the bay (the bay's own inner rib included), in a strip
// just behind the main spar, one hole's width per bay, the outermost bay's nearest the spar.
//
// Returns the bays (surfaces: the built ones from surfaceLayouts), each with ok (built) or
// problem, and for the built ones: plate ({ x0, x1 } chord, { s0, s1 } span, thickness), lugs
// (the servo's whole run) and case ({ x0, x1 }), cut ({ x0, x1, s0, s1 }, the plate's cut-out),
// screws ([x, s], the plate's pilot holes), hatch ({ x0, x1, s0, s1 }), inner (the rib faces'
// s), lead ({ diameter, offset }: the hole's near edge's distance behind the spar's rear face),
// room (the depth there, between the skins), need and warnings.
export function bayLayouts({ sampler, section, sparX, structure, rootS, tipS }, surfaces, bays) {
  const t = structure.ribs.thickness || 0
  const [, sparRear] = lineFaces(sparX, sparWidth(structure.spar))
  const built = new Map((surfaces ?? []).filter((r) => r.ok).map((r) => [r.id, r]))
  for (const b of bays) {
    b.warnings = []
    if (b.ok && !built.has(b.surface)) {
      b.ok = false
      b.problem = 'surface'
    }
    if (b.ok && (b.sA < rootS + 0.003 || b.sB > tipS - 0.003)) {
      b.ok = false
      b.problem = 'span'
    }
  }
  const live = bays.filter((b) => b.ok).sort((a, b) => b.s - a.s)
  // Lead holes side by side behind the spar, the outermost bay's first, with the rib's lead
  // margin of material between the spar and the first and between each
  const leadMargin = Math.max(MIN_MATERIAL, structure.ribs?.leadMargin ?? 0.003)
  let offset = leadMargin
  for (const b of live) {
    b.lead = { diameter: b.servo.leadHole, offset, margin: leadMargin }
    offset += b.servo.leadHole + leadMargin
  }
  const mm = (v) => `${(v * 1000).toFixed(1)} mm`
  for (const b of live) {
    const r = built.get(b.surface)
    const sv = b.servo
    const ss = Array.from({ length: 9 }, (_, k) => b.sA + ((b.sB - b.sA) * k) / 8)
    // Between the leads' strip behind the spar and the fixed hinge spar's front face
    const hingeFront = Math.min(...ss.map((s) => r.faces.fixedFront(s)))
    const leadsEnd = Math.max(...ss.map(sparRear)) + offset
    const free = [leadsEnd + 0.002, hingeFront - 0.002]
    // From the case's centre: the whole servo's run, and the plate, a margin beyond the run and
    // never less than the plate's edge of ply round its cut-out
    const half = (sv.run ?? sv.lugSpan) / 2
    const cut = sv.plan?.cut
    const pf = Math.min(-half - BAY_MARGIN, cut ? cut.x[0] - PLATE_EDGE : -Infinity)
    const pr = Math.max(half + BAY_MARGIN, cut ? cut.x[1] + PLATE_EDGE : Infinity)
    if (free[1] - free[0] < pr - pf) {
      b.ok = false
      b.problem = 'forward'
      continue
    }
    // Depth for the servo with its centre at xc: from the highest the lower skin's inside (or a
    // lower stringer's top) gets to the lowest the upper's (or an upper stringer's underside)
    // does, over its run and the bay's length
    const depthFrom = (xc) => {
      const x0 = xc - half
      const x1 = xc + half
      let base = -Infinity
      let ceil = Infinity
      for (let i = 0; i <= 4; i++) {
        const s = b.sA + ((b.sB - b.sA) * i) / 4
        const sec = section(s)
        if (!sec || !(sec.c > 1e-4)) continue
        const xiRear = (sparRear(s) - sec.xl) / sec.c
        for (let k = 0; k <= 6; k++) {
          const x = x0 + ((x1 - x0) * k) / 6
          const q = Math.min(1, Math.max(0, (x - sec.xl) / sec.c))
          const f = sec.surf(q)
          base = Math.max(base, f.lower + skinAt(structure, q, xiRear, 'bottom', sec.c))
          ceil = Math.min(ceil, f.upper - skinAt(structure, q, xiRear, 'top', sec.c))
        }
        for (const st of structure.stringers ?? []) {
          if (!Number.isFinite(st.position) || !(st.width > 0) || !(st.height > 0)) continue
          const xs = sec.xl + st.position * sec.c
          if (xs + st.width / 2 <= x0 || xs - st.width / 2 >= x1) continue
          const f = sec.surf(st.position)
          if (st.surface !== 'upper') base = Math.max(base, f.lower + skinAt(structure, st.position, xiRear, 'bottom', sec.c) + st.height)
          if (st.surface !== 'lower') ceil = Math.min(ceil, f.upper - skinAt(structure, st.position, xiRear, 'top', sec.c) - st.height)
        }
      }
      return ceil - base
    }
    // Where it goes in the free stretch: where it's set (b.fore, from the leading edge), kept in
    // the stretch; else the deepest place, the rearmost if several are as deep (a millimetre in
    // hand), so the pushrod to the horn is short
    const lo = free[0] - pf
    const hi = free[1] - pr
    let xc = hi
    let room = depthFrom(hi)
    const sec = b.fore ? section(b.s) : null
    if (sec) {
      const want = sec.xl + (b.fore.by === 'chord' ? b.fore.value * sec.c : b.fore.value)
      xc = Math.min(hi, Math.max(lo, want))
      room = depthFrom(xc)
      if (Math.abs(xc - want) > 0.0005) {
        b.warnings.push(`${b.label}'s servo can't go ${mm(want - sec.xl)} from the leading edge: its case's centre has to be between ${mm(lo - sec.xl)} and ${mm(hi - sec.xl)} there, clear of the leads behind the spar and the hinge spar, so it's at ${mm(xc - sec.xl)}.`)
      }
    } else {
      for (let k = 1; k <= 16; k++) {
        const x = hi - ((hi - lo) * k) / 16
        const d = depthFrom(x)
        if (d > room + 0.001) {
          room = d
          xc = x
        }
      }
    }
    // The plate's top must be under the upper skin too
    const need = Math.max(sv.height, sv.lugHeight + sv.lugThickness + sv.plate) + SERVO_HEADROOM
    const inner = [b.sA + t / 2, b.sB - t / 2]
    Object.assign(b, {
      inner,
      plate: { x0: xc + pf, x1: xc + pr, s0: inner[0], s1: inner[1], thickness: sv.plate },
      lugs: { x0: xc - half, x1: xc + half },
      case: { x0: xc - sv.length / 2, x1: xc + sv.length / 2 },
      cut: cut ? { x0: xc + cut.x[0], x1: xc + cut.x[1], s0: b.s + cut.s[0], s1: b.s + cut.s[1] } : null,
      // The cut-out, the case and the whole servo in plan, turned with the servo ([x, s])
      cutPoly: sv.plan?.cutPoly?.map(([x, s]) => [xc + x, b.s + s]) ?? null,
      body: sv.caseOutline?.map(([x, s]) => [xc + x, b.s + s]) ?? null,
      footprint: sv.outline?.map(([x, s]) => [xc + x, b.s + s]) ?? null,
      screws: (sv.plan?.screws ?? []).map(([x, s]) => [xc + x, b.s + s]),
      hatch: { x0: xc + pf, x1: xc + pr, s0: inner[0], s1: inner[1] },
      room,
      need,
    })
    if (!(room >= need)) {
      b.warnings.push(`${b.label} needs ${mm(need)} of depth for a ${sv.label.toLowerCase()} servo and the wing has ${mm(Math.max(0, room))} there: use a smaller class, or move the bay to where the wing is deeper.`)
    }
    if (b.beyond) b.warnings.push(`${b.label} sticks out past the ends of ${r.label}. The ribs beside it are still its hard points.`)
  }
  return bays
}

// Why a bay isn't built, with the bay's name.
export const bayProblem = (b) => `${b.label} isn't built: ${BAY_PROBLEMS[b.problem] ?? b.problem}.`

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
  // A foam wing is laid out as a fully sheeted wing with no ribs (foam.js), checked as a sandwich
  const foam = isFoam(structure)
  if (foam) structure = foamStructure(structure)
  const core = foam ? (MATERIALS[structure.foam.core] ?? MATERIALS['eps-20']) : null
  const loads = structure.loads
  const sf = loads.safetyFactor >= 1 ? loads.safetyFactor : 1.5
  const nPos = loads.designG > 0 ? loads.designG : 6
  const nNeg = loads.negativeG > 0 ? loads.negativeG : 0
  const CL = spanwise.CLmax

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

  // Control surfaces, each with a rib at both ends, then the air brakes, then the servo bays on
  // both. The servos' weight is carried by the wing, so each takes load off the spar at its
  // station.
  const ctx = { sampler, section, sparX, structure, rootS: s0, tipS: sTip }
  const surfaces = surfaceLayouts(ctx, controls)
  const brakes = brakeLayouts(ctx, controls, surfaces)
  const teFront = (s) => section(s).xl + section(s).c - (structure.te.width || 0)
  const hosts = [...surfaces, ...brakeHosts(brakes, teFront)]
  // How far the cap strips stand proud of a rib's faces, which a bay keeps its servo and arm clear of
  const capOverhang = !foam && structure.covering.capStrips ? Math.max(0, ((structure.covering.capStripWidth || 0) - (structure.ribs.thickness || 0)) / 2) : 0
  const placement = () => placeBays({ sampler, surfaces: hosts, controls, mass, ribThickness: structure.ribs.thickness, capOverhang })
  let bays = bayLayouts(ctx, hosts, placement())
  // The servos hang where they are placed, whichever ribs their trays end up between
  const relief = servoMasses(bays)
  const pos = spanLoads(sampler, spanwise.ll, CL, { mass, n: nPos, relief })
  const neg = nNeg > 0 ? spanLoads(sampler, spanwise.ll, (-CL * nNeg) / nPos, { mass, n: nNeg, relief }) : null

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
    // A built-up wing past the end of a short tube spar has nothing to check; a foam wing has no
    // spar anywhere, its skins carrying the bending
    if (sp.type === 'none' && !foam) {
      row.note = 'no spar'
      continue
    }
    const { zbar, EI } = bendingProps(els)
    row.EI = EI
    // Stress (compression positive) at height z in material of modulus E: positive g bends
    // the upper side into compression, negative g the lower side.
    const comp = (E, z) => Math.max((E * M * (z - zbar)) / EI, (E * Mn * (zbar - z)) / EI, 0)
    const tens = (E, z) => Math.max((E * M * (zbar - z)) / EI, (E * Mn * (z - zbar)) / EI, 0)
    if (foam) {
      // Shear: carried by the core across its whole chord, between the skins (sandwich theory,
      // core shear stress V / (b d)), with d the core's mean depth over that chord
      const n = 24
      let sumD = 0
      for (let i = 0; i < n; i++) sumD += sec.depth(leXi + ((teXi - leXi) * (i + 0.5)) / n)
      const skins = 2 * (cov.sheetThickness || 0)
      const d = Math.max(1e-6, sumD / n - skins)
      row.coreTau = coreShearStress(V, { width: (teXi - leXi) * sec.c, d })
      row.ms.coreShear = ms(core.shear, row.coreTau)
    }
    const sparEls = foam ? [] : els.filter((e) => e.part === 'spar')
    if (sparEls.length) {
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
    }
    // Sheeting: crushing, and buckling between ribs panel by panel
    if (cov.type !== 'open' && cov.sheetThickness > 0) {
      const strips = els.filter((e) => e.part === 'sheet')
      const sheetC = strips.reduce((m, e) => Math.max(m, comp(e.E, e.top), comp(e.E, e.bottom)), 0)
      row.sheetStress = sheetC
      row.ms.sheet = ms(sheet.compression, sheetC)
      if (foam) {
        row.sigma = sheetC
        // A skin on a foam core doesn't buckle between supports: it wrinkles into the core
        row.wrinkle = wrinklingStress(sheetE, core)
        row.ms.wrinkling = ms(row.wrinkle, sheetC)
        continue
      }
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
  const surfaceEnds = surfaces.filter((r) => r.ok).flatMap((r) => [
    { s: r.s0, label: `${r.label}, inner end` },
    { s: r.s1, label: `${r.label}, outer end` },
  ])
  const brakeEnds = brakes.filter((r) => r.ok).flatMap((r) => [
    { s: r.sA, label: `${r.label}, inner end` },
    { s: r.sB, label: `${r.label}, outer end` },
  ])
  // Servo trays: a bay whose servo fits between two of the wing's own ribs (laid out without the
  // bays) spans that rib bay; the rest get a pair of ribs of their own a servo's width apart
  if (!foam && bays.some((b) => b.ok)) {
    const plain = ribStations(sampler, structure, limitAt, [...surfaceEnds, ...brakeEnds])
    const trays = fitBaysToRibs(bays, plain, structure.ribs.thickness, capOverhang)
    if (trays.size) {
      const again = placement()
      for (const b of again) if (trays.has(b.id)) Object.assign(b, trays.get(b.id), { onRibs: true })
      bays = bayLayouts(ctx, hosts, again)
    }
  }
  brakeBayClashes(brakes, bays, { sparX, structure })
  const bayEnds = bays.filter((b) => b.ok && !b.onRibs).flatMap((b) => [
    { s: b.sA, label: `${b.label}, inner rib` },
    { s: b.sB, label: `${b.label}, outer rib` },
  ])
  // A foam wing has no ribs: its cores run between the panel ends
  // (never a plain rib through a bay that has ribs of its own: the servo is there)
  const ownBays = bays.filter((b) => b.ok && !b.onRibs)
  const ribs = foam
    ? []
    : ribStations(sampler, structure, limitAt, [...surfaceEnds, ...brakeEnds, ...bayEnds]).filter(
        (r) => !((r.kind === 'normal' || r.kind === 'manual') && ownBays.some((b) => r.s > b.sA + 1e-4 && r.s < b.sB - 1e-4)),
      )
  // A rod or dowel can't be carved to suit, so check it at every rib, not just the ends (on a
  // foam wing, about every 20 mm)
  if (edges.le.round) {
    const n = Math.max(2, Math.ceil((sTip - s0) / 0.02))
    const along = foam ? Array.from({ length: n + 1 }, (_, i) => s0 + ((sTip - s0) * i) / n) : ribs.map((r) => r.s)
    const f = fitOver(roundItem(edges.le.round.diameter), section, along, 'le')
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
    const remedy = foam
      ? `thicker caps (about ${(Math.ceil((row?.capThicknessNeeded ?? 0) * 20000) / 20).toFixed(2)} mm there), wider caps, or a stiffer, stronger cap material`
      : sp.type === 'tube'
        ? 'a larger tube or a thicker wall'
        : sp.type === 'solid'
          ? 'a deeper or wider spar, or a stronger wood'
          : `thicker caps (about ${(Math.ceil((row?.capThicknessNeeded ?? 0) * 2000) / 2).toFixed(1)} mm there), wider caps, a stronger material, or sheeting the leading edge so it shares the load`
    warnings.push({
      id: `short-${k}`,
      mode: k,
      message: foam
        ? `The spar caps are ${short(k)} short of strength in ${k} ${where(m.d)}. Try ${remedy}.`
        : `The spar is ${short(k)} short of strength in ${k} ${where(m.d)}. Closer ribs won't help: try ${remedy}.`,
    })
  }
  if (summary.modes.webShear?.ms < 0) {
    warnings.push({
      id: 'short-webShear',
      mode: 'webShear',
      message: foam
        ? `The shear web is ${short('webShear')} short of strength ${where(summary.modes.webShear.d)}. Try a thicker web or a stronger web material.`
        : `The shear web is ${short('webShear')} short of strength ${where(summary.modes.webShear.d)}. Closer ribs won't help: try a thicker web, a stronger web material${sp.type === 'caps' ? ', or a box spar (two webs)' : ''}.`,
    })
  }
  if (summary.modes.sheet?.ms < 0) {
    warnings.push({
      id: 'short-sheet',
      mode: 'sheet',
      message: foam
        ? `The skin is ${short('sheet')} short of strength in compression ${where(summary.modes.sheet.d)}. Try a thicker or stronger skin, or a thicker section there.`
        : `The sheeting is ${short('sheet')} short of strength in compression ${where(summary.modes.sheet.d)}. Closer ribs won't help: try thicker or harder sheeting, or stronger spar caps to take more of the load.`,
    })
  }
  if (summary.modes.wrinkling?.ms < 0) {
    warnings.push({
      id: 'short-wrinkling',
      mode: 'wrinkling',
      message: `The compressed skin would wrinkle into the core ${where(summary.modes.wrinkling.d)} (${short('wrinkling')} short). Try a denser foam, or a thicker or stiffer skin.`,
    })
  }
  if (summary.modes.coreShear?.ms < 0) {
    warnings.push({
      id: 'short-coreShear',
      mode: 'coreShear',
      message: `The foam core is ${short('coreShear')} short of strength in shear ${where(summary.modes.coreShear.d)}. Use a denser foam, or a thicker section there.`,
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
  for (const r of brakes) {
    if (!r.ok) warnings.push({ id: `brake-${r.id}`, message: `${r.label} isn't built: ${BRAKE_PROBLEMS[r.problem] ?? r.problem}.` })
    for (const [k, m] of (r.warnings ?? []).entries()) warnings.push({ id: `brake-${r.id}-${k}`, message: m })
  }
  for (const b of bays) {
    if (!b.ok && b.problem !== 'surface') warnings.push({ id: `bay-${b.id}`, message: bayProblem(b) })
    for (const [k, m] of (b.warnings ?? []).entries()) warnings.push({ id: `bay-${b.id}-${k}`, message: m })
  }
  // Dihedral braces: one warning per brace that is too thin for its bending, or cannot be made
  const braces = braceSizing({ sampler, rootS: s0, tipS: sTip, section, sparX, pos, safetyFactor: sf }, structure)
  for (const b of braces) {
    const from = Math.round((b.s - s0) * 1000)
    if (!b.ok) warnings.push({ id: `brace-${b.name}`, message: `Dihedral brace ${b.name} (at ${from} mm from the root) isn't built: ${b.reason}.` })
    else if (b.margin < 0) {
      const need = (Math.ceil(b.needT * 10000) / 10).toFixed(1)
      const have = (b.chosenT * 1000).toFixed(1)
      warnings.push({ id: `brace-${b.name}`, message: `Dihedral brace ${b.name} (at ${from} mm from the root) is ${have} mm ply but the bending there needs at least ${need} mm. Use thicker ply, or leave the thickness blank for the next standard size.` })
    }
  }
  // Each fit drawn where it's worst, for the editor (edge stock, rods and dowels)
  for (const k of ['le', 'te']) {
    const e = edges[k]
    const item = e.round ? roundItem(e.round.diameter) : e.item
    const sec = item && section(e.worstS)
    if (sec && sec.c > 1e-4) e.drawing = { ...fitDrawing(item, sec, k, { d: e.offset || 0, mode: e.mode, theta: e.round ? null : e.angle ?? 0 }), where: whereS(e.worstS), shortfall: e.shortfall, fits: e.fits }
  }
  // A foam wing's cores: one per panel (and the centre section), root outward
  const cores = []
  if (foam) {
    if (s0 < sampler.half - 1e-6) cores.push({ name: 'centre section', from: s0, to: sampler.half })
    sampler.ends.forEach((e, i) => {
      const from = Math.max(s0, e.inner.s)
      if (e.outer.s - from > 1e-4) cores.push({ name: `panel ${i + 1}`, from, to: e.outer.s })
    })
  }
  return {
    wing,
    construction: foam ? 'foam' : 'built-up',
    cores,
    modeLabels: foam ? { ...MODES, ...FOAM_MODE_LABELS } : MODES,
    structure,
    edges,
    stations,
    ribs,
    surfaces,
    brakes,
    bays,
    relief,
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
    braces,
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
  wrinkling: 'Skin wrinkling',
  coreShear: 'Core shear',
}
// A foam wing's names for the modes it shares with a built-up one
export const FOAM_MODE_LABELS = { sheet: 'Skin crushing' }
// The chart colour slot of each mode (1 to 6). A foam wing's own two never appear with the
// two rib-spacing modes, so they take those slots.
export const MODE_SLOTS = { compression: 1, tension: 2, sheet: 3, webShear: 4, webBuckling: 5, spacing: 6, coreShear: 5, wrinkling: 6 }

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
