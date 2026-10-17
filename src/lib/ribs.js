// Rib and part geometry for a built-up wing, from the structure analysis (structure.js).
//
// A rib is drawn in its own plane: u runs along the rib from the leading edge (u = 0), z is
// height above the panel's building board plane (the panel's chord plane at the root of the
// twist), both in metres. The rib is cut through the wing as lofted from its streamwise
// sections, so streamwise and perpendicular ribs come from the same code: a perpendicular rib
// simply crosses the sections at an angle. On a swept panel it comes out shorter than the
// streamwise chord (about c·cos Λ) at much the same depth, so it's relatively thicker.
//
// Washout rotates each section about the spar line (TE up for positive washout), so with jig
// tabs the ribs sit on a flat board and the twist builds itself in.
//
// Every part is { id, name, group, material, thickness, qty, outline: [[u, z]...] closed,
// holes: [[[u, z]...]], etch: [[[u, z]...]], label: { text, u, z, h }, notes: [] }, in
// metres. qty is per the handedness asked for (a pair doubles everything except parts on
// the centreline).

import { material, MATERIALS, sparSection, MIN_MATERIAL, skinAt, skinAtSpar, capStripStart, sheetExtent, hardPatches, patchSheet, patchSpan, lineFaces, sparWidth, isPlainRib, gussetLayer, gussetEdges, finishes, surfaceAt } from './structure.js'
import { flatPanels } from './wing.js'
import { textWidth } from './strokeFont.js'
import { BRAKE, bladeSlots } from './airBrakes.js'
import { KIND_LABELS, lengthsToBuy, STOCK_LENGTH, LE_TYPES, isRound, roundFitAt } from './edgeStock.js'
import { isFoam } from './foam.js'
import { foamParts, WIRE_KERF, LEAD_IN } from './foamParts.js'

const RAD = Math.PI / 180
const PROFILE_POINTS = 120
const HOLE_POINTS = 40

// --- Small geometry helpers -------------------------------------------------------------------

function interp(us, zs, u) {
  if (u <= us[0]) return zs[0]
  const n = us.length
  if (u >= us[n - 1]) return zs[n - 1]
  let lo = 0
  let hi = n - 1
  while (hi - lo > 1) {
    const m = (lo + hi) >> 1
    if (us[m] <= u) lo = m
    else hi = m
  }
  const t = (u - us[lo]) / (us[hi] - us[lo] || 1)
  return zs[lo] + (zs[hi] - zs[lo]) * t
}

export function polygonArea(pts) {
  let a = 0
  for (let i = 0; i < pts.length; i++) {
    const [x0, y0] = pts[i]
    const [x1, y1] = pts[(i + 1) % pts.length]
    a += x0 * y1 - x1 * y0
  }
  return a / 2
}

export function bounds(pts) {
  let x0 = Infinity
  let y0 = Infinity
  let x1 = -Infinity
  let y1 = -Infinity
  for (const [x, y] of pts) {
    x0 = Math.min(x0, x)
    y0 = Math.min(y0, y)
    x1 = Math.max(x1, x)
    y1 = Math.max(y1, y)
  }
  return { x0, y0, x1, y1, w: x1 - x0, h: y1 - y0 }
}

function circle(cx, cy, r, n = HOLE_POINTS) {
  const pts = []
  for (let i = 0; i < n; i++) {
    const a = (2 * Math.PI * i) / n
    pts.push([cx + r * Math.cos(a), cy + r * Math.sin(a)])
  }
  return pts
}

const rect = (u0, z0, u1, z1) => [
  [u0, z0],
  [u1, z0],
  [u1, z1],
  [u0, z1],
]

// Remove consecutive duplicate points.
function clean(pts, tol = 1e-7) {
  const out = []
  for (const p of pts) {
    const q = out.at(-1)
    if (!q || Math.abs(p[0] - q[0]) > tol || Math.abs(p[1] - q[1]) > tol) out.push(p)
  }
  if (out.length > 1) {
    const a = out[0]
    const b = out.at(-1)
    if (Math.abs(a[0] - b[0]) <= tol && Math.abs(a[1] - b[1]) <= tol) out.pop()
  }
  return out
}

// --- The profile cut ---------------------------------------------------------------------------

// The direction of a rib in plan, as a unit vector (ds, dx) pointing aft. Streamwise ribs run
// straight back; perpendicular ribs run square to the spar line where they cross it.
function ribDirection(a, s, perpendicular) {
  if (!perpendicular) return [0, 1]
  const h = 1e-4
  const slope = (a.sparX(s + h) - a.sparX(s - h)) / (2 * h) // dx/ds of the spar line
  const n = Math.hypot(slope, 1)
  return [-slope / n, 1 / n]
}

// Cut the wing along a rib line through the spar point at s. Returns the outer surfaces in
// rib coordinates, or null if the line leaves the wing (a perpendicular rib too close to a
// panel end) or the wing has no chord there.
export function cutProfile(a, s, { perpendicular = false, points = PROFILE_POINTS } = {}) {
  const sec0 = a.section(s)
  if (!sec0 || !(sec0.c > 1e-4)) return null
  const [ds, dx] = ribDirection(a, s, perpendicular)
  const xs = a.sparX(s)
  const at = (t) => ({ s: s + ds * t, x: xs + dx * t })
  // Where the line meets an edge: solve x = edge(s) by bisection along t.
  const solve = (edge, t0, t1) => {
    const f = (t) => {
      const p = at(t)
      const sec = a.section(p.s)
      if (!sec) return NaN
      return p.x - (edge === 'le' ? sec.xl : sec.xl + sec.c)
    }
    let lo = t0
    let hi = t1
    let flo = f(lo)
    if (!Number.isFinite(flo) || !Number.isFinite(f(hi)) || Math.sign(flo) === Math.sign(f(hi))) return null
    for (let i = 0; i < 60; i++) {
      const m = (lo + hi) / 2
      const fm = f(m)
      if (!Number.isFinite(fm)) return null
      if (Math.sign(fm) === Math.sign(flo)) {
        lo = m
        flo = fm
      } else hi = m
    }
    return (lo + hi) / 2
  }
  let tLe
  let tTe
  if (!perpendicular) {
    tLe = sec0.xl - xs
    tTe = sec0.xl + sec0.c - xs
  } else {
    const reach = 2 * sec0.c
    tLe = solve('le', -reach, 0)
    tTe = solve('te', 0, reach)
    if (tLe === null || tTe === null) return null
    const sLo = Math.min(at(tLe).s, at(tTe).s)
    const sHi = Math.max(at(tLe).s, at(tTe).s)
    if (sLo < a.rootS - 1e-6 || sHi > a.tipS + 1e-6) return null
  }
  const L = tTe - tLe
  const us = []
  const up = []
  const lo = []
  const xi = []
  for (let i = 0; i <= points; i++) {
    const f = 0.5 * (1 - Math.cos((Math.PI * i) / points))
    const t = tLe + L * f
    const p = at(t)
    const sec = a.section(Math.min(a.tipS, Math.max(a.rootS, p.s)))
    const q = Math.min(1, Math.max(0, (p.x - sec.xl) / sec.c))
    const surf = sec.surf(q)
    // Washout: rotate about the local spar point, TE up
    const lift = (p.x - a.sparX(p.s)) * Math.sin(sec.twist * RAD)
    us.push(L * f)
    up.push(surf.upper + lift)
    lo.push(surf.lower + lift)
    xi.push(q)
  }
  return {
    us,
    up,
    lo,
    xi,
    length: L,
    sparU: -tLe,
    chord: sec0.c,
    twist: sec0.twist,
    panel: sec0.panel,
    angle: Math.atan2(ds, dx) / RAD, // degrees off streamwise
    // Chord fraction to distance along the rib (xi rises monotonically along the cut)
    uAt: (q) => interp(xi, us, q),
  }
}

// --- One rib -----------------------------------------------------------------------------------

// Build one rib: outline with notches and tabs, holes, engraved lines and label.
// rib: { s, kind, label } from the analysis; board: panel datum height (for jig tabs) or null.
// split: across a control surface, { surface, side }: 'fixed' is the part ahead of the hinge,
// stopping at the fixed hinge spar's front face; 'moving' the moving surface's part, from its
// hinge spar's rear face to the trailing edge stock (surface from structure.js surfaceLayouts).
// leads: the servo leads that pass through this rib, [{ name, diameter, offset }] (a bay's lead,
// the hole's near edge offset behind the spar's rear face): each gets a hole, kept clear of the
// rib's edges and of the other holes, or a note and a mention in `leadFails` if there's no room.
export function buildRib(a, structure, rib, { board = null, split = null, leads = [] } = {}) {
  const r = structure.ribs
  const perpendicular = r.orientation === 'perpendicular' && isPlainRib(rib.kind)
  const prof = cutProfile(a, rib.s, { perpendicular })
  if (!prof) return { ok: false, reason: 'outside', s: rib.s }
  const notes = []
  const { us, length: L } = prof
  const scale = L / prof.chord // along-rib length per unit of streamwise chord
  const uSpar = prof.sparU
  const sp = structure.spar

  // Where the rib line crosses a line x = fx(s) in plan (an edge of the stock, a face of the
  // spar or a stringer), near u = guess. Every cut is placed this way, so the parts meet the
  // stock exactly whichever way the rib runs.
  const sn = Math.sin(prof.angle * RAD)
  const cs = Math.cos(prof.angle * RAD)
  const xs0 = a.sparX(rib.s)
  const clampS = (s) => Math.min(a.tipS, Math.max(a.rootS, s))
  const crossing = (fx, guess) => {
    if (Math.abs(sn) < 1e-12) return uSpar + (fx(rib.s) - xs0) / cs
    const f = (u) => xs0 + cs * (u - uSpar) - fx(clampS(rib.s + sn * (u - uSpar)))
    let lo = guess - 0.05
    let hi = guess + 0.05
    if (Math.sign(f(lo)) === Math.sign(f(hi))) return guess
    for (let i = 0; i < 50; i++) {
      const m = (lo + hi) / 2
      if (Math.sign(f(m)) === Math.sign(f(lo))) lo = m
      else hi = m
    }
    return (lo + hi) / 2
  }
  const [sparFront, sparRearX] = lineFaces(a.sparX, sparWidth(sp))
  const uSpar0 = crossing(sparFront, uSpar - sparWidth(sp) / 2)
  const uSpar1 = crossing(sparRearX, uSpar + sparWidth(sp) / 2)
  const halfSpar = (uSpar1 - uSpar0) / 2 // half the notch along the rib
  const sparXiRear = interp(us, prof.xi, uSpar1)
  // Rib station where one surface's cap strips start: behind that side's sheeting, or where no
  // sheeting is ahead of them, short of the leading edge (capStripStart), so the rib's own nose
  // sets the leading-edge shape
  const capFrom = (side) => {
    const cov = structure.covering
    if (movingSide) return uA
    // As set, or with none set just behind the LE stock (capStripStart)
    const start = capStripStart(structure, a.section(rib.s).c)
    const open = !(start > 0) ? uA : Math.max(uA, crossing((s) => a.section(s).xl + start * a.section(s).c, start * a.section(rib.s).c))
    if (cov.type !== 'dbox') return open
    const ext = sheetExtent(structure, side, sparXiRear)
    if (!ext) return open
    const set = side === 'top' ? cov.dbox?.topTo : cov.dbox?.bottomTo
    if (set == null) return uSpar1
    return crossing((s) => a.section(s).xl + set * a.section(s).c, uSpar1)
  }

  // Inset surfaces: offset by the skin, measured square to the surface
  const n = us.length
  const upIn = new Array(n)
  const loIn = new Array(n)
  // Sheeted hard points over this rib: the rib is inset by their sheeting where they cover it
  const patches = split?.side === 'moving' ? [] : hardPatches(structure, a.rootS).filter((h) => rib.s >= h.s0 - 1e-6 && rib.s <= h.s1 + 1e-6)
  const patchT = patchSheet(structure).thickness
  const patchAt = (q, side) => (patches.some((h) => h.sides.includes(side) && q >= h.from - 1e-9 && q <= h.to + 1e-9) ? patchT : 0)
  for (let i = 0; i < n; i++) {
    const i0 = Math.max(0, i - 1)
    const i1 = Math.min(n - 1, i + 1)
    const du = us[i1] - us[i0] || 1e-9
    const su = (prof.up[i1] - prof.up[i0]) / du
    const sl = (prof.lo[i1] - prof.lo[i0]) / du
    const tUp = Math.max(skinAt(structure, prof.xi[i], sparXiRear, 'top', a.section(rib.s).c), patchAt(prof.xi[i], 'top'))
    const tLo = Math.max(skinAt(structure, prof.xi[i], sparXiRear, 'bottom', a.section(rib.s).c), patchAt(prof.xi[i], 'bottom'))
    // Never past the middle: right at the nose (a sheeted nose) the skin is the whole depth
    const mid = (prof.up[i] + prof.lo[i]) / 2
    upIn[i] = Math.max(mid, prof.up[i] - tUp * Math.sqrt(1 + su * su))
    loIn[i] = Math.min(mid, prof.lo[i] + tLo * Math.sqrt(1 + sl * sl))
  }
  const top = (u) => interp(us, upIn, u)
  const bot = (u) => interp(us, loIn, u)

  // Cut back for the LE and TE stock (their depth is along the streamwise chord)
  let uA = crossing((s) => a.section(s).xl + (structure.le.width || 0), (structure.le.width || 0) * scale)
  // A sheeted nose: the rib runs forward until the sheeting leaves no room for it
  if (structure.le.type === 'none') while (uA < L / 2 && top(uA) - bot(uA) < MIN_MATERIAL) uA += 0.0002
  let uB = crossing((s) => a.section(s).xl + a.section(s).c - (structure.te.width || 0), L - (structure.te.width || 0) * scale)
  // Either side of a control surface's hinge
  const guessAt = (fx) => uSpar + (fx(rib.s) - xs0) / cs
  const fixedSide = split?.side === 'fixed'
  const movingSide = split?.side === 'moving'
  if (fixedSide) uB = crossing(split.surface.faces.fixedFront, guessAt(split.surface.faces.fixedFront))
  if (movingSide) uA = crossing(split.surface.faces.movingRear, guessAt(split.surface.faces.movingRear))
  if (!(uB > uA + (movingSide ? 0.005 : 0.01))) return { ok: false, reason: 'short', s: rib.s }
  if (!fixedSide && top(uB) - bot(uB) < MIN_MATERIAL) notes.push('Very thin where it meets the trailing edge stock')

  // Notches from the top (upper) and bottom (lower): { u0, u1, depth }
  const upper = []
  const lower = []
  const holes = []
  const sparHere = sparSection(structure, interp(us, prof.up, uSpar) - interp(us, prof.lo, uSpar), rib.s - a.rootS)
  // The moving surface's part is behind the main spar: nothing of it to notch
  if (movingSide) {
    // no spar notches
  } else if (sp.type === 'caps' || sp.type === 'box') {
    upper.push({ u0: uSpar0, u1: uSpar1, depth: sp.capThickness, what: 'spar' })
    lower.push({ u0: uSpar0, u1: uSpar1, depth: sp.capThickness, what: 'spar' })
  } else if (sp.type === 'solid') {
    const d = sp.solidDepth
    if (sp.solidMount === 'top') upper.push({ u0: uSpar0, u1: uSpar1, depth: d, what: 'spar' })
    else if (sp.solidMount === 'bottom') lower.push({ u0: uSpar0, u1: uSpar1, depth: d, what: 'spar' })
    else {
      const mid = (top(uSpar) + bot(uSpar)) / 2
      holes.push(rect(uSpar0, mid - d / 2, uSpar1, mid + d / 2))
    }
  } else if (sp.type === 'tube' && sparHere.type === 'tube') {
    // Round where the rib is square to the tube, an ellipse where it crosses at an angle
    const mid = (top(uSpar) + bot(uSpar)) / 2
    const r = sp.tubeDiameter / 2 + 0.0001
    holes.push(circle(0, 0, 1).map(([x, y]) => [(uSpar0 + uSpar1) / 2 + x * (halfSpar + 0.0001), mid + y * r]))
  }
  if (!movingSide && sparHere.type !== 'none' && sparHere.fits === false) notes.push("The spar doesn't fit at this rib")
  for (const st of structure.stringers ?? []) {
    if (!Number.isFinite(st.position) || !(st.width > 0) || !(st.height > 0)) continue
    const u = prof.uAt(st.position)
    const line = (s) => {
      const sec = a.section(clampS(s))
      return sec.xl + st.position * sec.c
    }
    const [f0, f1] = lineFaces(line, st.width)
    const u0 = crossing(f0, u - st.width / 2)
    const u1 = crossing(f1, u + st.width / 2)
    if (u0 < uA || u1 > uB) continue
    const notch = { u0, u1, depth: st.height, what: 'stringer' }
    if (st.surface !== 'lower') upper.push({ ...notch })
    if (st.surface !== 'upper') lower.push({ ...notch })
  }

  // Jig tabs: down to the panel's board datum, near each end, clear of lower notches
  const tabs = []
  if (r.jigTabs && Number.isFinite(board)) {
    const w = r.tabWidth || 0.006
    const clear = (u0, u1) => lower.every((nt) => u1 <= nt.u0 - 0.001 || u0 >= nt.u1 + 0.001)
    const place = (u, dir) => {
      for (let k = 0; k < 40; k++) {
        const u0 = u - w / 2
        const u1 = u + w / 2
        if (u0 > uA + 0.0005 && u1 < uB - 0.0005 && clear(u0, u1)) return { u0, u1 }
        u += dir * 0.001
      }
      return null
    }
    const front = place(uA + w / 2 + 0.002, 1)
    const rear = place(uB - w / 2 - 0.002, -1)
    for (const t of [front, rear]) if (t) tabs.push({ ...t, z: board })
  }

  // Walk the outline: top from the LE cut to the TE cut, down the TE cut, bottom back.
  const inside = (list, u) => list.some((nt) => u > nt.u0 + 1e-9 && u < nt.u1 - 1e-9)
  const edgeUs = (list) => list.flatMap((nt) => [nt.u0, nt.u1])
  const breaks = [...new Set([uA, uB, ...us.filter((u) => u > uA && u < uB)])]

  const topChain = []
  const tops = [...new Set([...breaks, ...edgeUs(upper)])].filter((u) => u >= uA && u <= uB).sort((p, q) => p - q)
  for (const u of tops) {
    const nt = upper.find((x) => Math.abs(x.u0 - u) < 1e-9)
    const nt1 = upper.find((x) => Math.abs(x.u1 - u) < 1e-9)
    if (nt) {
      // Into a notch: down to a flat bottom
      topChain.push([u, top(u)], [u, Math.min(top(nt.u0), top(nt.u1)) - nt.depth])
    } else if (nt1) {
      topChain.push([u, Math.min(top(nt1.u0), top(nt1.u1)) - nt1.depth], [u, top(u)])
    } else if (!inside(upper, u)) topChain.push([u, top(u)])
  }
  const bottomItems = [...lower.map((x) => ({ ...x, kind: 'notch' })), ...tabs.map((x) => ({ ...x, kind: 'tab' }))]
  const bots = [...new Set([...breaks, ...edgeUs(bottomItems)])].filter((u) => u >= uA && u <= uB).sort((p, q) => q - p)
  const botChain = []
  for (const u of bots) {
    const startItem = bottomItems.find((x) => Math.abs(x.u1 - u) < 1e-9) // walking backwards: enter at u1
    const endItem = bottomItems.find((x) => Math.abs(x.u0 - u) < 1e-9)
    const level = (x) => (x.kind === 'tab' ? x.z : Math.max(bot(x.u0), bot(x.u1)) + x.depth)
    if (startItem) botChain.push([u, bot(u)], [u, level(startItem)])
    else if (endItem) botChain.push([u, level(endItem)], [u, bot(u)])
    else if (!inside(bottomItems, u)) botChain.push([u, bot(u)])
  }
  let outline = clean([...topChain, ...botChain])
  // A rod or dowel sits in a half-round notch in the rib's front, its centre line on the cut
  if (!movingSide && isRound(structure.le) && structure.le.diameter > 0) {
    const r = structure.le.diameter / 2
    const ru = Math.max(r, uA - crossing((s) => a.section(s).xl, 0)) // along the rib, wider where it crosses at an angle
    const sec = a.section(rib.s)
    const lift = interp(us, prof.up, uA) - sec.surf(Math.min(1, r / sec.c)).upper
    const zc = roundFitAt(structure.le.diameter, sec).centre + lift
    const notched = notchFront(outline, uA, zc, ru + 0.0001, r + 0.0001)
    if (notched) outline = notched
    if (!notched) notes.push('The leading-edge rod is deeper than the rib at its notch')
  }

  // Engraved: where to cut each tab off, along the rib's lower edge
  const etch = tabs.map((t) => [
    [t.u0, bot(t.u0)],
    [t.u1, bot(t.u1)],
  ])

  // The clear height of the rib at u, keeping `m` from the edges and from any notch
  const band = (u, m) => {
    let t = top(u) - m
    let b = bot(u) + m
    for (const nt of upper) if (u > nt.u0 - m && u < nt.u1 + m) t = Math.min(t, top(u) - nt.depth - m)
    for (const nt of lower) if (u > nt.u0 - m && u < nt.u1 + m) b = Math.max(b, bot(u) + nt.depth + m)
    return { t, b }
  }
  const clearOver = (u0, u1, m) => {
    let t = Infinity
    let b = -Infinity
    for (let k = 0; k <= 8; k++) {
      const bd = band(u0 + ((u1 - u0) * k) / 8, m)
      t = Math.min(t, bd.t)
      b = Math.max(b, bd.b)
    }
    return { t, b }
  }

  // Lead holes, in a strip behind the main spar. Each keeps MIN_MATERIAL clear of the rib's edges
  // and notches, sliding aft a millimetre at a time (up to 2 cm) if the nominal place is too
  // thin or taken; the label and lightening holes keep clear of them.
  const leadBlocks = []
  const leadFails = []
  if (!movingSide) {
    for (const ld of leads) {
      const D = ld.diameter
      const fx = (s) => sparRearX(clampS(s)) + ld.offset + D / 2
      const u0 = crossing(fx, uSpar + (fx(rib.s) - xs0) / cs)
      let placed = null
      for (let k = 0; k <= 20 && !placed; k++) {
        const u = u0 + k * 0.001
        if (u + D / 2 > uB - MIN_MATERIAL) break
        if (leadBlocks.some(([b0, b1]) => u - D / 2 < b1 + 0.001 && u + D / 2 > b0 - 0.001)) continue
        const c = clearOver(u - D / 2, u + D / 2, MIN_MATERIAL)
        if (c.t - c.b >= D) placed = { u, z: (c.t + c.b) / 2 }
      }
      if (placed) {
        holes.push(circle(placed.u, placed.z, D / 2))
        leadBlocks.push([placed.u - D / 2, placed.u + D / 2])
      } else {
        leadFails.push(ld.name)
        notes.push(`No room for the ${(D * 1000).toFixed(0)} mm lead hole for ${ld.name}: the rib is too thin behind the spar. Use a smaller servo, thinner skins or stringers elsewhere`)
      }
    }
    if (leadBlocks.length) notes.push(`Lead hole${leadBlocks.length === 1 ? '' : 's'} for ${leads.filter((l) => !leadFails.includes(l.name)).map((l) => l.name).join(', ')}`)
  }

  // The label goes first, in the roomiest clear stretch (ahead of the spar if it fits as well
  // there), and the lightening holes keep clear of it
  const name = rib.name ?? ''
  const edge = 0.0015
  let best = null
  for (const [from, to, pref] of [
    [uA + edge, Math.min(uB, uSpar0) - edge, 1.1],
    [Math.max(uA, uSpar1) + edge, uB - edge, 1],
  ]) {
    for (let u0 = from; u0 < to; u0 += 0.001) {
      // The tallest label (up to 5 mm) whose box fits clear from here
      let h = 0.005
      for (let it = 0; it < 4 && h >= 0.0015; it++) {
        const u1 = u0 + textWidth(name, h)
        if (u1 > to) {
          h *= (to - u0) / (u1 - u0)
          continue
        }
        const c = clearOver(u0, u1, edge)
        const fit = Math.min(h, (c.t - c.b) * 0.8)
        if (fit >= h - 1e-6) break
        h = fit
      }
      if (h < 0.0015) continue
      const u1 = u0 + textWidth(name, h)
      if (u1 > to) continue
      if (leadBlocks.some(([b0, b1]) => u0 < b1 + edge && u1 > b0 - edge)) continue
      const c = clearOver(u0, u1, edge)
      if (c.t - c.b < h) continue
      if (!best || h * pref > best.h * best.pref + 1e-9) best = { u0, u1, h, pref, z: (c.t + c.b) / 2 - h / 2 }
    }
  }
  const label = best
    ? { text: name, u: best.u0, z: best.z, h: best.h }
    : { text: name, u: uA + 0.004, z: (top(uA + 0.004) + bot(uA + 0.004)) / 2 - 0.00075, h: 0.0015 }
  const labelBox = best ? [best.u0, best.u1] : null

  // Lightening holes, in the open stretches either side of the spar (not on the root,
  // break or tip ribs, which take the joining loads), clear of the label
  if (r.lightening && isPlainRib(rib.kind)) {
    const m = r.lighteningMargin || 0.004
    const stretches = []
    for (const [from, to] of [
      [uA + m, Math.min(uB, uSpar0) - m],
      [Math.max(uA, uSpar1) + m, uB - m],
    ]) {
      let open = [[from, to]]
      for (const [b0, b1] of [labelBox, ...leadBlocks].filter(Boolean)) {
        open = open.flatMap(([f, t2]) => (b1 + m > f && b0 - m < t2 ? [[f, b0 - m], [b1 + m, t2]] : [[f, t2]]))
      }
      stretches.push(...open.filter(([f, t2]) => t2 > f))
    }
    for (const [from, to] of stretches) {
      let u = from
      while (u < to) {
        // Largest circle starting here whose band fits all across it
        let D = 0
        for (let it = 0; it < 6; it++) {
          const span = Math.max(D, 0.004)
          let h = Infinity
          for (let k = 0; k <= 6; k++) {
            const x = u + (span * k) / 6
            if (x > to) {
              h = 0
              break
            }
            const bd = band(x, m)
            h = Math.min(h, bd.t - bd.b)
          }
          const next = Math.min(h, to - u)
          if (Math.abs(next - D) < 1e-5) break
          D = next
        }
        if (D >= 0.006) {
          const cu = u + D / 2
          const bd = band(cu, m)
          holes.push(circle(cu, (bd.t + bd.b) / 2, D / 2))
          u += D + m
        } else u += 0.002
      }
    }
  }

  // Height between the cap notch floors: what a shear web here has to fill
  const capGap =
    !movingSide && (sp.type === 'caps' || sp.type === 'box')
      ? Math.min(top(uSpar0), top(uSpar1)) - sp.capThickness - (Math.max(bot(uSpar0), bot(uSpar1)) + sp.capThickness)
      : null

  return {
    ok: true,
    s: rib.s,
    kind: rib.kind,
    side: split?.side ?? null,
    perpendicular,
    angle: prof.angle,
    panel: prof.panel,
    length: L,
    sparU: uSpar,
    sparNotch: [uSpar0, uSpar1],
    capGap,
    // The rib's outer and inset surfaces, for drawing cap strips on it
    surfaces: { us, up: prof.up, lo: prof.lo, upIn, loIn },
    // Where each surface's cap strips start from the LE side: a D-box side with sheeting
    // runs its strips from the end of that side's sheet, the rest from the LE stock
    capStripFrom: { top: capFrom('top'), bottom: capFrom('bottom') },
    uA,
    uB,
    outline,
    holes,
    etch,
    label,
    notes,
    leadFails,
    minLower: Math.min(...loIn.filter((_, i) => us[i] >= uA && us[i] <= uB)),
  }
}

// Cut a half-ellipse (centre uc on the rib's front face, half-axes ru along the rib and rz
// up it) out of the front of a rib outline: drop the points inside it and walk round its
// rear half instead, where it's inside the rib. Null if the notch would take the whole front.
// Insert the points where each outline segment crosses the notch ellipse, so a notch that
// falls between two sparse nose vertices still shows up as a run of points inside it.
function withEllipseCrossings(outline, uc, zc, ru, rz) {
  const out = []
  const n = outline.length
  for (let i = 0; i < n; i++) {
    const A = outline[i]
    const B = outline[(i + 1) % n]
    out.push(A)
    const pa = [(A[0] - uc) / ru, (A[1] - zc) / rz]
    const d = [(B[0] - A[0]) / ru, (B[1] - A[1]) / rz]
    // Ellipse in normalised coords: |pa + t d|^2 = 1, a t^2 + b t + c = 0
    const a = d[0] * d[0] + d[1] * d[1]
    if (a < 1e-18) continue
    const b = 2 * (pa[0] * d[0] + pa[1] * d[1])
    const c = pa[0] * pa[0] + pa[1] * pa[1] - 1
    const disc = b * b - 4 * a * c
    if (disc <= 0) continue
    const sq = Math.sqrt(disc)
    const ts = [(-b - sq) / (2 * a), (-b + sq) / (2 * a)].filter((t) => t > 0 && t < 1)
    for (const t of ts) out.push([A[0] + t * (B[0] - A[0]), A[1] + t * (B[1] - A[1])])
  }
  return out
}

export function notchFront(outline0, uc, zc, ru, rz) {
  // Points on the ellipse count as inside, so the inserted crossings join the run
  const inEllipse = ([u, z]) => ((u - uc) / ru) ** 2 + ((z - zc) / rz) ** 2 < 1 + 1e-9
  const outline = withEllipseCrossings(outline0, uc, zc, ru, rz)
  const n = outline.length
  // Start the walk at a point outside the notch, so the points inside are one run
  const start = outline.findIndex((p) => !inEllipse(p) && p[0] > uc + ru)
  if (start < 0) return null
  const ring = [...outline.slice(start), ...outline.slice(0, start)]
  const first = ring.findIndex(inEllipse)
  if (first < 0) return outline
  let last = first
  while (last + 1 < n && inEllipse(ring[last + 1])) last++
  const before = ring[first - 1]
  const after = ring[(last + 1) % n]
  // The outline runs anticlockwise (top forward, bottom back), so the notch is walked from
  // the bottom up: the angle from below the centre, round its rear, to above it
  const ang = ([u, z]) => Math.atan2((z - zc) / rz, (u - uc) / ru)
  const a0 = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, ang(before)))
  const a1 = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, ang(after)))
  if (!(a1 > a0)) return null
  const arc = []
  for (let i = 0; i <= 24; i++) {
    const t = a0 + ((a1 - a0) * i) / 24
    arc.push([uc + ru * Math.cos(t), zc + rz * Math.sin(t)])
  }
  return clean([...ring.slice(last + 1), ...ring.slice(0, first), ...arc])
}

// --- All parts -------------------------------------------------------------------------------

const PLY = [0.0004, 0.0006, 0.0008, 0.001, 0.0015, 0.002, 0.0025, 0.003, 0.004, 0.005, 0.006]
// A brace shallower than this (m) cannot be made from ply, so it is reported rather than sized
const MIN_BRACE_DEPTH = 0.01

// Dihedral angle (degrees) of the wing either side of each rib on a break, keyed by s.
function dihedralAt(a) {
  const out = []
  const ends = a.sampler.ends
  const half = a.sampler.half
  const ang = (i) => (i < 0 ? 0 : ends[i].rad / RAD)
  if (half > 0) out.push({ s: half, inner: 0, outer: ang(0) })
  else out.push({ s: 0, inner: -ang(0), outer: ang(0) }) // left and right panels meet
  for (let i = 0; i < ends.length - 1; i++) out.push({ s: ends[i].outer.s, inner: ang(i), outer: ang(i + 1) })
  return out
}

// Dihedral braces: one per dihedral break (sized here, drawn by buildParts). Two plates, one each
// side of the spar, share the bending moment at the break: t = 6 M SF / (2 σ h²), h being the depth
// between the spar caps (or skins) there. Each entry gives the break, the moment, the brace height,
// the thickness needed, the thickness chosen (entered, else the next standard ply) and the margin
// (chosen / needed - 1). A brace that can't be made (no depth at the break) has ok false and a reason.
// The centreline break has one plate each side; a polyhedral break has two. Pure: no Vue imports.
export function braceSizing(a, structure, { both = true } = {}) {
  const br = structure.braces
  if (!br?.enabled || structure.spar.type === 'tube' || structure.spar.type === 'none') return []
  const r = structure.ribs
  const m = material(br.material)
  const sigma = Math.min(m.compression, m.tension)
  const skin = skinAtSpar(structure)
  const out = []
  let k = 1
  for (const brk of dihedralAt(a)) {
    const delta = brk.outer - brk.inner
    if (Math.abs(delta) < 0.05) continue
    // A two-piece wing's root is a joiner, not a brace
    if (r.rootJoint === 'two-piece' && brk.s <= a.rootS + 1e-6) continue
    const at = (s) => {
      const sec = a.section(Math.min(a.tipS, Math.max(a.rootS, s)))
      if (!sec) return 0
      const q = Math.min(0.95, Math.max(0.02, (a.sparX(s) - sec.xl) / sec.c))
      return Math.max(0, sec.depth(q) - 2 * skin)
    }
    const Lb = br.length || 0.08
    const centre = brk.s < 1e-6 && r.rootJoint !== 'two-piece'
    // Each arm stops where the wing does: inboard at the centreline (or a two-piece root),
    // outboard at the tip rib. A centre brace's inboard arm is the other half's outboard one.
    const Lout = Math.max(0, Math.min(Lb, a.tipS - brk.s))
    const Lin = centre ? Lout : Math.max(0, Math.min(Lb, brk.s - a.rootS))
    const h0 = at(brk.s)
    const hi = at(centre ? brk.s + Lin : brk.s - Lin)
    const ho = at(brk.s + Lout)
    const d = delta * RAD
    const rot = ([x, y]) => [x * Math.cos(d) - y * Math.sin(d), x * Math.sin(d) + y * Math.cos(d)]
    const kTop = (h0 / 2) / Math.cos(d / 2)
    const raw = [
      [-Lin, -hi / 2],
      [-Lin, hi / 2],
      [-kTop * Math.sin(d / 2), kTop * Math.cos(d / 2)],
      rot([Lout, ho / 2]),
      rot([Lout, -ho / 2]),
      [kTop * Math.sin(d / 2), -kTop * Math.cos(d / 2)],
    ]
    // The engraved line marks the break, where it meets the break rib
    const fold = [raw[5], raw[2]]
    const M = interpRows(a.pos.rows, brk.s)
    const ok = h0 >= MIN_BRACE_DEPTH
    const entered = Number.isFinite(br.thickness) && br.thickness > 0 ? br.thickness : null
    const needT = ok ? (6 * M * a.safetyFactor) / (2 * sigma * h0 * h0) : null
    const chosenT = entered ?? (ok ? PLY.find((x) => x >= needT) ?? PLY.at(-1) : null)
    const margin = ok && chosenT ? chosenT / needT - 1 : null
    out.push({
      name: `B${k}`,
      s: brk.s,
      dihedralDeg: delta / 1,
      moment: M,
      height: h0,
      needT,
      chosenT,
      entered: entered !== null,
      material: br.material,
      margin,
      qty: 2 * (centre || !both ? 1 : 2),
      ok,
      reason: ok ? null : `the spar has only ${Math.round(h0 * 1000)} mm of depth at the break`,
      geom: { raw, fold, Lin, Lout, centre, hi, ho, h0 },
    })
    k++
  }
  return out
}

// Everything to cut for the wing, plus a cut list for strip stock and an estimate of the
// structure's weight. handedness: 'right' | 'left' | 'pair'. A foam wing (foam.js) has no ribs;
// its hot-wire templates, skins and pockets come from foamParts.js, wireKerf and leadIn
// setting its templates.
export function buildParts(a, structure, { handedness = 'pair', wireKerf = WIRE_KERF, leadIn = LEAD_IN } = {}) {
  const foam = isFoam(structure)
  const r = structure.ribs
  const both = handedness === 'pair'
  const qtyOf = (s) => (both ? (s < 1e-6 && r.rootJoint !== 'two-piece' ? 1 : 2) : 1)
  const ribs = a.ribs.map((rb, i) => ({ ...rb, name: `R${i + 1}` }))

  // Board datum per panel for jig tabs: below the lowest point of every rib in the panel
  const boards = new Map()
  if (r.jigTabs) {
    const firstPass = ribs.map((rb) => buildRib(a, structure, rb))
    firstPass.forEach((b, i) => {
      if (!b.ok) return
      const key = panelKey(a, ribs[i].s)
      boards.set(key, Math.min(boards.get(key) ?? Infinity, b.minLower))
    })
    for (const [k, v] of boards) boards.set(k, v - (r.tabClearance || 0.003))
  }

  const parts = []
  const skipped = []
  const ribMat = material(r.material)
  const breaks = dihedralAt(a)
  const surfaces = (a.surfaces ?? []).filter((x) => x.ok)
  const bays = (a.bays ?? []).filter((x) => x.ok)
  const brakes = (a.brakes ?? []).filter((x) => x.ok)
  // The servo leads through a rib: every bay outboard of it (or at its inner rib), and the ribs
  // that couldn't take a hole for each
  const leadsAt = (s) => bays.filter((x) => s <= x.sA + 1e-6).map((x) => ({ name: x.name, diameter: x.lead.diameter, offset: x.lead.offset }))
  const leadFailed = new Map()
  for (const rb of ribs) {
    const board = r.jigTabs ? boards.get(panelKey(a, rb.s)) : null
    // A rib across a control surface stops at its hinge spar; the moving part comes below
    const across = surfaceAt(surfaces, rb.s)
    const b = buildRib(a, structure, rb, { board, split: across ? { surface: across, side: 'fixed' } : null, leads: leadsAt(rb.s) })
    if (!b.ok) {
      skipped.push({ name: rb.name, s: rb.s, reason: b.reason })
      continue
    }
    for (const n of b.leadFails ?? []) leadFailed.set(n, [...(leadFailed.get(n) ?? []), rb.name])
    const brk = breaks.find((x) => Math.abs(x.s - rb.s) < 1e-4)
    const notes = [...b.notes]
    let cant = 0
    if (brk && Math.abs(brk.outer - brk.inner) > 0.05) {
      cant = (brk.outer - brk.inner) / 2
      notes.push(`Cant ${Math.abs(cant).toFixed(1)}° from square to the board (half the ${Math.abs(brk.outer - brk.inner).toFixed(1)}° dihedral change)`)
    }
    if (b.perpendicular && Math.abs(b.angle) > 0.5) notes.push(`Square to the spar, ${Math.abs(b.angle).toFixed(1)}° off streamwise`)
    if (across) notes.push(`Stops at the hinge spar of ${across.label}; its part behind the hinge is cut separately`)
    else if (rb.kind === 'hard' && surfaces.some((x) => Math.abs(x.s0 - rb.s) < 1e-6 || Math.abs(x.s1 - rb.s) < 1e-6)) notes.push('Full rib at the end of a control surface')
    else if (rb.kind === 'hard' && brakes.some((x) => Math.abs(x.sA - rb.s) < 1e-6 || Math.abs(x.sB - rb.s) < 1e-6)) notes.push('Full rib at the end of an air brake box')
    parts.push({
      id: rb.name,
      name: rb.name,
      group: 'ribs',
      material: r.material,
      thickness: r.thickness,
      qty: qtyOf(rb.s),
      s: rb.s,
      kind: rb.kind,
      sourceId: rb.id ?? null, // the manual rib or hard point it comes from, if any
      split: !!across, // ends at a control surface's hinge spar
      outline: b.outline,
      holes: b.holes,
      etch: b.etch,
      label: { ...b.label, text: rb.name },
      notes,
      cant,
      rib: b,
    })
  }

  // Each control surface's own ribs: one at each end (a gap clear of the wing's end ribs) and
  // the part behind the hinge of every wing rib between
  const h = structure.hinges
  // (none for a surface that is the trailing edge stock itself)
  for (const sf of foam ? [] : surfaces.filter((x) => !x.stock)) {
    const t = r.thickness || 0
    const inner = ribs.filter((rb) => rb.s > sf.endRibs[0] + t + 1e-6 && rb.s < sf.endRibs[1] - t - 1e-6)
    const list = [{ s: sf.endRibs[0], kind: 'surface' }, ...inner, { s: sf.endRibs[1], kind: 'surface' }]
    list.forEach((rb, k) => {
      const name = `${sf.name}-${k + 1}`
      const board = r.jigTabs ? boards.get(panelKey(a, rb.s)) : null
      const b = buildRib(a, structure, { ...rb, name }, { board, split: { surface: sf, side: 'moving' } })
      if (!b.ok) {
        skipped.push({ name, s: rb.s, reason: b.reason })
        return
      }
      const end = rb.kind === 'surface'
      parts.push({
        id: name,
        name,
        group: 'surfaces',
        material: r.material,
        thickness: r.thickness,
        qty: both ? 2 : 1,
        s: rb.s,
        kind: end ? 'surface' : rb.kind,
        surface: sf.id,
        sourceId: null,
        outline: b.outline,
        holes: b.holes,
        etch: b.etch,
        label: { ...b.label, text: name },
        notes: [`${sf.label}: ${end ? `end rib, ${k ? 'outer' : 'inner'}` : `behind the hinge, in line with ${rb.name}`}, from its hinge spar to the trailing edge`, ...b.notes],
        cant: 0,
        rib: b,
      })
    })
  }
  // The Mylar tabs, one size for every hinge
  const tabCount = surfaces.reduce((n, sf) => n + sf.tabs.length, 0)
  if (tabCount && h.tabWidth > 0 && h.tabLength > 0) {
    parts.push({
      id: 'H1',
      name: 'H1',
      group: 'hinges',
      material: 'mylar',
      thickness: h.tabThickness || 0.0002,
      qty: tabCount * (both ? 2 : 1),
      outline: rect(0, 0, h.tabLength, h.tabWidth),
      holes: [],
      etch: [],
      label: null,
      notes: [
        `Mylar hinge tab: ${surfaces.map((sf) => `${sf.tabs.length} on ${sf.name}`).join(', ')}${both ? ', each side' : ''}. Slot ${Math.round(Math.max(...surfaces.map((sf) => sf.slot)) * 2000) / 2} mm deep into each hinge spar at its centre line`,
      ],
    })
  }

  // Servo bays: a ply mount plate between the bay's ribs with a cut-out for the case and pilot
  // holes for the lug screws (part SB1 …), and on a sheeted wing the hatch cut from the lower
  // sheeting (SB1-H) with its two rails in the cut list
  const warnings = []
  const sheeted = structure.covering.type === 'sheeted' && structure.covering.sheetThickness > 0
  const ribNamed = (s) => ribs.find((rb) => Math.abs(rb.s - s) < 1e-3)?.name ?? '?'
  // Where a bay's or a brake's parts are glued: between its ribs, or in a foam wing's pocket
  const betweenRibs = (sA, sB) => (foam ? 'into its pocket in the core' : `between ${ribNamed(sA)} and ${ribNamed(sB)}`)
  for (const bay of bays) {
    const sv = bay.servo
    const len = bay.plate.s1 - bay.plate.s0
    const wid = bay.plate.x1 - bay.plate.x0
    const caseV = bay.case.x0 - bay.plate.x0
    const lugLen = (sv.lugSpan - sv.length) / 2
    const cut = 0.0005
    const screws = []
    for (const v of [bay.lugs.x0 - bay.plate.x0 + lugLen / 2, bay.lugs.x1 - bay.plate.x0 - lugLen / 2]) {
      for (const k of [-1, 1]) screws.push(circle(len / 2 + (k * sv.width) / 4, v, 0.0006, 12))
    }
    parts.push({
      id: bay.name,
      name: bay.name,
      group: 'servos',
      material: 'ply-birch',
      thickness: sv.plate,
      qty: both ? 2 : 1,
      outline: rect(0, 0, len, wid),
      holes: [rect(len / 2 - sv.width / 2 - cut, caseV - cut, len / 2 + sv.width / 2 + cut, caseV + sv.length + cut), ...screws],
      etch: [],
      label: null,
      bay,
      notes: [
        `${bay.label} (${bay.hostLabel || 'control surface'}): mount plate for a ${sv.label.toLowerCase()} servo (${Math.round(sv.mass * 1000)} g), glued ${betweenRibs(bay.sA, bay.sB)}, long side along the chord. The servo goes in from below, its lugs screwed up into the plate`,
        `Plate fits the gap between the ${foam ? "pocket's ends" : 'rib faces'} (${(len * 1000).toFixed(1)} mm); the cut-out leaves about ${(((len - sv.width) / 2 - cut) * 1000).toFixed(1)} mm of ply down each side`,
      ],
    })
    if (sheeted) {
      const th = structure.covering.sheetThickness
      parts.push({
        id: `${bay.name}-H`,
        name: `${bay.name}-H`,
        group: 'servos',
        material: structure.covering.sheetMaterial,
        thickness: th,
        qty: both ? 2 : 1,
        outline: rect(0, 0, bay.hatch.s1 - bay.hatch.s0, bay.hatch.x1 - bay.hatch.x0),
        holes: [],
        etch: [],
        label: null,
        notes: [`${bay.label} hatch: cut from the lower sheeting over the bay, screwed to the two hatch rails (see the cut list)`],
      })
    }
  }
  // Air brakes: a blade brake's two box walls (ply, between the ribs' faces and skin to skin) and
  // its blades with their lattice slots; a spoiler's plate and the ply frame it sits in, with
  // the opening for the plate. Parts AB1-F (front wall) and AB1-R (rear wall), AB1-B (blade),
  // AB1-P (plate) and AB1-F (frame, a spoiler's).
  const halves = both ? 2 : 1
  for (const br of brakes) {
    const len = br.inner[1] - br.inner[0]
    const between = betweenRibs(br.sA, br.sB)
    if (br.type === 'blade') {
      br.walls.forEach((w, k) => {
        const id = `${br.name}-${k ? 'R' : 'F'}`
        parts.push({
          id,
          name: id,
          group: 'brakes',
          material: 'ply-birch',
          thickness: BRAKE.wall,
          qty: halves,
          outline: rect(0, 0, len, Math.max(0.001, w.height)),
          holes: [],
          etch: [],
          label: null,
          brake: br,
          notes: [`${br.label}: ${k ? 'rear' : 'front'} wall of the box, glued ${between} from skin to skin; trim to the section if it stands proud`],
        })
      })
      const both2 = br.surface === 'both'
      const slots = bladeSlots(br.length, br.height)
      parts.push({
        id: `${br.name}-B`,
        name: `${br.name}-B`,
        group: 'brakes',
        material: 'ply-birch',
        thickness: BRAKE.bladeThickness,
        qty: br.blades * (both2 ? 2 : 1) * halves,
        outline: rect(0, 0, br.length, br.height),
        holes: slots.map(([u0, z0, u1, z1]) => rect(u0, z0, u1, z1)),
        etch: [],
        label: null,
        brake: br,
        notes: [
          `${br.label}: blade, ${br.blades === 1 ? 'a single blade' : `${br.blades} blades side by side (a lattice)`}${both2 ? ' each through the top and the bottom' : ''}, rising ${(br.height * 1000).toFixed(1)} mm through slots in the covering. The slots lighten it${slots.length ? ` (${slots.length})` : ''}; the solid foot and top bar guide it`,
        ],
      })
    } else {
      // The frame: the width of the gap between the ribs, with the opening a millimetre clear of
      // the plate all round and 5 mm of ply fore and aft of it
      const um = (br.gap - br.length - 2 * BRAKE.slot) / 2
      const vm = 0.005
      const opening = rect(um, vm, um + br.length + 2 * BRAKE.slot, vm + br.chord + 2 * BRAKE.slot)
      parts.push({
        id: `${br.name}-P`,
        name: `${br.name}-P`,
        group: 'brakes',
        material: 'ply-birch',
        thickness: BRAKE.plate,
        qty: halves,
        outline: rect(0, 0, br.length, br.chord),
        holes: [],
        etch: [[[0, 0.002], [br.length, 0.002]]],
        label: null,
        brake: br,
        notes: [`${br.label}: spoiler plate, hinged along its front edge (hinge tape goes along the engraved line, 2 mm in) and opening ${Math.round(br.angle)}° at the back`],
      })
      parts.push({
        id: `${br.name}-F`,
        name: `${br.name}-F`,
        group: 'brakes',
        material: 'ply-birch',
        thickness: BRAKE.frame,
        qty: halves,
        outline: rect(0, 0, br.gap, br.chord + 2 * BRAKE.slot + 2 * vm),
        holes: [opening],
        etch: [],
        label: null,
        brake: br,
        notes: [`${br.label}: frame under the top surface, glued ${between}, the opening a millimetre clear of the plate all round`],
      })
    }
  }
  for (const [name, list] of leadFailed) warnings.push(`${name}: no room for its lead hole in ${list.join(', ')}. The ribs are too thin behind the spar: use a smaller servo or thinner skins.`)

  // Corner gussets where ribs meet the LE and TE stock
  const g = structure.gussets
  const gussetGroups = new Map()
  if (gussetEdges(structure).length && g.size > 0) {
    for (const p of parts.filter((q) => q.group === 'ribs')) {
      if (g.where === 'ends' && isPlainRib(p.kind)) continue
      for (const edge of gussetEdges(structure)) {
        // A rib cut at a hinge doesn't reach the trailing edge
        if (edge === 'te' && p.split) continue
        const angle = gussetAngle(a, p.s, edge, p.rib)
        const sides = gussetSides(p, g, r.rootJoint).map((k) => (k > 0 ? angle : 180 - angle))
        for (const ang of sides) {
          const key = `${edge}:${Math.round(ang * 2) / 2}`
          const cur = gussetGroups.get(key) ?? { edge, angle: Math.round(ang * 2) / 2, count: 0 }
          cur.count += p.qty * (gussetLayer(g, edge) === 'both' ? 2 : 1)
          gussetGroups.set(key, cur)
        }
      }
    }
    let k = 1
    for (const grp of [...gussetGroups.values()].sort((p, q) => p.edge.localeCompare(q.edge) || p.angle - q.angle)) {
      const th = grp.angle * RAD
      const outline = [
        [0, 0],
        [g.size, 0],
        [g.size * Math.cos(th), g.size * Math.sin(th)],
      ]
      parts.push({
        id: `G${k}`,
        name: `G${k}`,
        group: 'gussets',
        material: g.material,
        thickness: g.thickness,
        qty: grp.count,
        // Grain runs along the hypotenuse (the edge opposite the rib-edge corner)
        grainAngle: Math.atan2(g.size * Math.sin(th), g.size * (Math.cos(th) - 1)),
        outline: normalise(outline),
        holes: [],
        etch: [],
        label: null,
        notes: [
          `${grp.edge === 'le' ? 'Leading' : 'Trailing'}-edge corner, ${grp.angle}° between rib and edge, flush with the ${
            { both: 'top and bottom', bottom: 'bottom', top: 'top' }[gussetLayer(g, grp.edge)]
          } of the rib`,
        ],
      })
      k++
    }
  }

  // Dihedral braces at breaks, on the spar's front and back faces (sized in braceSizing)
  for (const b of braceSizing(a, structure, { both })) {
    if (!b.ok) continue
    const { raw, fold, Lin, Lout, centre, hi, ho, h0 } = b.geom
    const bb = bounds(raw)
    const shift = ([x, y]) => [x - bb.x0, y - bb.y0]
    const mm = (v) => `${(v * 1000).toFixed(1)} mm`
    parts.push({
      id: b.name,
      name: b.name,
      group: 'braces',
      material: b.material,
      thickness: b.chosenT,
      qty: b.qty,
      outline: raw.map(shift),
      holes: [],
      etch: [fold.map(shift)],
      label: null,
      notes: [
        `${b.name}, one each side of the spar, ${Math.round((b.s - a.rootS) * 1000)} mm from the root rib`,
        `Dihedral angle at the break: ${Math.abs(b.dihedralDeg).toFixed(1)}°`,
        `Bending moment at the break: ${b.moment.toFixed(1)} N·m`,
        `Brace height between the spar caps: ${mm(h0)}`,
        `Thickness needed in ${material(b.material).label.toLowerCase()} at safety factor ${a.safetyFactor}: ${mm(b.needT)}`,
        `Thickness chosen: ${mm(b.chosenT)}${b.entered ? ' (entered)' : ' (next standard ply)'}`,
      ],
      need: b.needT,
      // Where it goes, for the 3D view: the break, its reach each side, and the plate's depth
      // at its inner end, the break and its outer end
      at: { s: b.s, inner: Lin, outer: Lout, depths: [hi, h0, ho], centre },
    })
  }

  // Shear webs, one piece per bay (two for a box spar), vertical grain (part y is the height)
  const sp = structure.spar
  if (sp.type === 'caps' || sp.type === 'box') {
    const ribList = parts.filter((p) => p.group === 'ribs')
    for (let i = 1; i < ribList.length; i++) {
      const pa = ribList[i - 1]
      const pb = ribList[i]
      // Exactly the gap between the caps where they pass through each rib
      const hOf = (p) => Math.max(0, p.rib.capGap ?? 0)
      const len = Math.max(0, pb.s - pa.s - r.thickness)
      if (len < 0.003) continue
      const ha = hOf(pa)
      const hb = hOf(pb)
      parts.push({
        id: `W${i}`,
        name: `W${i}`,
        group: 'webs',
        material: sp.webMaterial,
        thickness: sp.webThickness,
        qty: (sp.type === 'box' ? 2 : 1) * (both ? 2 : 1),
        grainAngle: Math.PI / 2,
        outline: [
          [0, 0],
          [len, 0],
          [len, hb],
          [0, ha],
        ],
        holes: [],
        etch: [],
        label: null,
        notes: [`Between ${pa.name} and ${pb.name}, grain vertical`],
      })
    }
  }

  // Sheeting templates (developed, approximate) per panel and surface
  const cov = structure.covering
  if (cov.type !== 'open' && cov.sheetThickness > 0) {
    const ribList = parts.filter((p) => p.group === 'ribs')
    const panels = new Map()
    for (const p of ribList) {
      for (const key of panelKeysOf(a, p.s)) {
        if (!panels.has(key)) panels.set(key, [])
        panels.get(key).push(p)
      }
    }
    let k = 1
    for (const [key, list] of panels) {
      if (list.length < 2) continue
      for (const surface of ['upper', 'lower']) {
        const widths = list.map((p) => ({ s: p.s, w: sheetWidth(a, structure, p.s, surface) }))
        const s0 = widths[0].s
        const outline = [...widths.map((w) => [w.s - s0, 0]).reverse(), ...widths.map((w) => [w.s - s0, w.w])]
        parts.push({
          id: `S${k}`,
          name: `S${k}`,
          group: 'sheeting',
          material: cov.sheetMaterial,
          thickness: cov.sheetThickness,
          qty: both ? 2 : 1,
          outline: clean(outline),
          holes: [],
          etch: [],
          label: null,
          notes: [`${surface === 'upper' ? 'Top' : 'Bottom'} sheeting, ${key}, developed from the ribs; approximate, cut oversize and trim`],
        })
        k++
      }
    }
  }

  // Sheeted hard points: one template per surface, developed approximately as its plan shape
  for (const h of hardPatches(structure, a.rootS)) {
    const ps = patchSheet(structure)
    const widthAt = (s) => {
      const span = patchSpan(a, structure, s)
      return span ? span[1] - span[0] : 0
    }
    const L = h.s1 - h.s0
    for (const side of h.sides) {
      const name = `HP${h.id}${side === 'top' ? 'T' : 'B'}`
      parts.push({
        id: name,
        name,
        group: 'sheeting',
        material: ps.material,
        thickness: ps.thickness,
        qty: both ? 2 : 1,
        outline: [
          [0, 0],
          [L, 0],
          [L, widthAt(h.s1)],
          [0, widthAt(h.s0)],
        ],
        holes: [],
        etch: [],
        label: null,
        notes: [`${side === 'top' ? 'Top' : 'Bottom'} sheeting over ${h.label}, across the whole chord between the edge stock (to the hinge spar beside a control surface); approximate, cut oversize and trim`],
      })
    }
  }

  // Tip block, as a plan template
  const flat = flatPanels(a.wing)
  if (flat.tip) {
    const base = flat.tip.base
    const outline = flat.tip.polygon.map(([s, x]) => [s - base.s, x])
    const tipRib = parts.find((p) => p.group === 'ribs' && p.kind === 'tip')
    // A foam wing has no tip rib: the deepest the section gets at the tip
    const tipSec = a.section(a.tipS)
    const tipDepth = tipSec ? Math.max(...Array.from({ length: 41 }, (_, i) => tipSec.depth(i / 40))) : 0
    const depth = tipRib ? bounds(tipRib.rib.outline).h + 2 * (cov.type === 'open' ? 0 : cov.sheetThickness || 0) : foam ? tipDepth : 0
    parts.push({
      id: 'T1',
      name: 'T1',
      group: 'tip',
      material: 'balsa-light',
      thickness: Math.ceil(depth * 1000) / 1000,
      qty: both ? 2 : 1,
      outline: clean(outline),
      holes: [],
      etch: [],
      label: null,
      notes: ['Tip block plan template: cut from block at least this thick, glue to the tip rib, carve to section'],
    })
  }

  const cutList = stripCutList(a, structure, parts, both)
  // A foam wing's templates, skins, web and pockets, its blocks and skin sheets, and the core's
  // and skin glue's weight
  const extra = foam ? foamParts(a, structure, { both, kerf: wireKerf, leadIn }) : null
  if (extra) {
    parts.push(...extra.parts)
    cutList.push(...extra.cutList)
  }
  const covered = coveredArea(a, structure)
  const servoMass = bays.reduce((m, x) => m + x.mass, 0)
  const weight = estimateWeight(parts, cutList, covered, structure, both ? 2 : 1, servoMass, extra)
  return { parts, skipped, cutList, weight, covered, boards, warnings }
}

// The sides of a rib that get corner gussets: +1 outboard, -1 inboard. Never outboard of the
// tip rib or inboard of a two-piece wing's root rib, where they'd hang outside the wing; with
// 'one' side, outboard unless that's the tip.
export function gussetSides(part, gussets, rootJoint) {
  const tip = part.kind === 'tip'
  const plugRoot = part.kind === 'root' && rootJoint === 'two-piece'
  if (gussets.sides === 'one') return [tip ? -1 : 1]
  return [1, -1].filter((k) => !(tip && k === 1) && !(plugRoot && k === -1))
}

// Which panel a rib belongs to for its board: the inner panel at a break.
function panelKey(a, s) {
  const ends = a.sampler.ends
  if (a.sampler.half > 0 && s <= a.sampler.half + 1e-6) return 'centre'
  const i = ends.findIndex((e) => s <= e.outer.s + 1e-6)
  return `panel ${i + 1}`
}

// Panels a rib bounds (both, at a break).
function panelKeysOf(a, s) {
  const keys = new Set()
  const ends = a.sampler.ends
  const half = a.sampler.half
  if (s <= half + 1e-6 && half > 0) keys.add('centre section')
  if (s >= half - 1e-6) {
    ends.forEach((e, i) => {
      if (s >= e.inner.s - 1e-6 && s <= e.outer.s + 1e-6) keys.add(`panel ${i + 1}`)
    })
  }
  return [...keys]
}

// Developed width of the sheeting at a rib: surface arc length from the LE stock to the spar
// (D-box) or the TE stock (fully sheeted).
function sheetWidth(a, structure, s, surface) {
  const sec = a.section(s)
  if (!sec) return 0
  const q0 = (structure.le.width || 0) / sec.c
  const sparXi = (a.sparX(s) - sec.xl) / sec.c
  const sp = structure.spar
  const half = (sp.type === 'caps' || sp.type === 'box' ? sp.capWidth : sp.type === 'solid' ? sp.solidWidth : sp.tubeDiameter) / 2
  const q1 = structure.covering.type === 'sheeted' ? 1 - (structure.te.width || 0) / sec.c : sparXi + half / sec.c
  let len = 0
  let prev = null
  for (let i = 0; i <= 60; i++) {
    const q = q0 + ((q1 - q0) * i) / 60
    const f = sec.surf(q)
    const p = [q * sec.c, surface === 'upper' ? f.upper : f.lower]
    if (prev) len += Math.hypot(p[0] - prev[0], p[1] - prev[1])
    prev = p
  }
  return len
}

// Angle (degrees) between a rib and the LE or TE stock in plan, on the rib's outboard side.
function gussetAngle(a, s, edge, rib) {
  const h = 1e-3
  const x = (t) => {
    const sec = a.section(Math.min(a.tipS, Math.max(a.rootS, t)))
    return edge === 'le' ? sec.xl : sec.xl + sec.c
  }
  const slope = (x(s + h) - x(s - h)) / (2 * h) // dx/ds of the edge
  const edgeDir = [1, slope]
  const ribDir = [Math.sin(rib.angle * RAD), Math.cos(rib.angle * RAD)] // (ds, dx), aft
  const dot = edgeDir[0] * ribDir[0] + edgeDir[1] * ribDir[1]
  const ang = Math.acos(Math.max(-1, Math.min(1, dot / (Math.hypot(...edgeDir) * Math.hypot(...ribDir))))) / RAD
  // On the LE the rib runs aft from the edge, on the TE forward into it
  return edge === 'le' ? ang : 180 - ang
}

function interpRows(rows, s) {
  if (s <= rows[0].s) return rows[0].M
  for (let k = 1; k < rows.length; k++) if (s <= rows[k].s) return rows[k - 1].M + ((rows[k].M - rows[k - 1].M) * (s - rows[k - 1].s)) / (rows[k].s - rows[k - 1].s)
  return 0
}

// Shift a polygon so its bounding box starts at the origin.
function normalise(pts) {
  const b = bounds(pts)
  return pts.map(([x, y]) => [x - b.x0, y - b.y0])
}

// Strip and stick stock that isn't cut from sheet: spar caps, LE and TE stock, stringers,
// cap strips, the tube. Lengths per wing side unless the line says otherwise.
function stripCutList(a, structure, parts, both) {
  const out = []
  const sides = both ? 2 : 1
  // Every rib that gets cap strips: the wing's, and the control surfaces' own
  const ribs = parts.filter((p) => p.group === 'ribs' || p.group === 'surfaces')
  const span = a.tipS - a.rootS
  const panelSpans = []
  const half = a.sampler.half
  if (a.rootS < half) panelSpans.push({ name: 'centre section', from: a.rootS, to: half })
  a.sampler.ends.forEach((e, i) => panelSpans.push({ name: `panel ${i + 1}`, from: Math.max(a.rootS, e.inner.s), to: e.outer.s }))
  const lenAlong = (from, to, fn) => {
    let L = 0
    const n = 40
    for (let i = 1; i <= n; i++) {
      const s0 = from + ((to - from) * (i - 1)) / n
      const s1 = from + ((to - from) * i) / n
      L += Math.hypot(s1 - s0, fn(s1) - fn(s0))
    }
    return L
  }
  const edgeX = (which) => (s) => {
    const sec = a.section(s)
    return which === 'le' ? sec.xl : sec.xl + sec.c
  }
  const faceHeight = (s, q) => {
    const sec = a.section(s)
    return sec ? sec.depth(Math.min(1, Math.max(0, q / sec.c))) : 0
  }
  const sp = structure.spar
  const edges = a.edges
  for (const p of panelSpans) {
    if (p.to - p.from < 1e-4) continue
    const sparLen = lenAlong(p.from, p.to, a.sparX)
    if (sp.type === 'caps' || sp.type === 'box') {
      out.push({ item: `Spar caps, ${p.name}`, material: sp.capMaterial, size: [sp.capWidth, sp.capThickness], length: sparLen, qty: 2 * sides })
    } else if (sp.type === 'solid') {
      out.push({ item: `Spar, ${p.name}`, material: sp.solidMaterial, size: [sp.solidWidth, sp.solidDepth], length: sparLen, qty: sides })
    }
    // Edge stock: a catalogue part at its own size, custom at the depth the section needs, or
    // a rod or dowel at its diameter; nothing for a sheeted nose
    const leH = Math.max(faceHeight(p.from, structure.le.width), faceHeight(p.to, structure.le.width))
    const leItem = edges?.le.item
    if (isRound(structure.le)) {
      const D = structure.le.diameter
      const t = LE_TYPES[structure.le.type]
      out.push({
        item: `Leading edge (${t.short}, ${Math.round(D * 10000) / 10} mm), ${p.name}`,
        edge: 'le',
        material: t.material,
        size: [D, D],
        length: lenAlong(p.from, p.to, edgeX('le')),
        qty: sides,
        round: true,
        stockLength: t.length,
      })
    } else if (structure.le.type !== 'none') {
      out.push({
        item: `Leading edge${leItem ? ` (${leItem.code} ${KIND_LABELS[leItem.kind]})` : ''}, ${p.name}`,
        edge: 'le',
        material: structure.le.material,
        size: [edges?.le.item ? edges.le.item.width : structure.le.width, edges?.le.item ? edges.le.item.height : Math.ceil(leH * 1000) / 1000],
        length: lenAlong(p.from, p.to, edgeX('le')),
        qty: sides,
      })
    }
    const teQ = (s) => a.section(s).c - structure.te.width
    const teH = Math.max(faceHeight(p.from, teQ(p.from)), faceHeight(p.to, teQ(p.to)))
    out.push({
      item: `Trailing edge (${edges?.te.item ? `${edges.te.item.code} ${KIND_LABELS[edges.te.item.kind]}` : structure.te.type}), ${p.name}`,
      edge: 'te',
      material: structure.te.material,
      size: [structure.te.width, edges?.te.item ? edges.te.item.height : Math.ceil(teH * 1000) / 1000],
      length: lenAlong(p.from, p.to, edgeX('te')),
      qty: sides,
      triangular: structure.te.type === 'triangular',
    })
    for (const st of structure.stringers ?? []) {
      if (!(st.width > 0)) continue
      const n = st.surface === 'both' ? 2 : 1
      out.push({ item: `Stringer at ${Math.round(st.position * 100)}% chord, ${p.name}`, material: st.material, size: [st.width, st.height], length: p.to - p.from, qty: n * sides })
    }
  }
  // Each control surface's two hinge spars: the fixed side's square, the moving side's
  // bevelled to a point at the centre line (top face for the down throw, bottom for up),
  // both slotted for the tabs. Depth: the deepest the section gets along them, to sand down.
  const h = structure.hinges
  const deg = (v) => `${Math.ceil(v - 1e-6)}°`
  for (const sf of (a.surfaces ?? []).filter((x) => x.ok)) {
    const k = Math.sqrt(1 + sf.slope * sf.slope)
    const up = (v) => Math.ceil(v * 2000 - 1e-6) / 2000
    const slots = `${sf.tabs.length} tab slot${sf.tabs.length === 1 ? '' : 's'}, ${Math.round(sf.slot * 2000) / 2} mm deep at the centre line`
    out.push({
      item: `Hinge spar, fixed side, ${sf.label}`,
      material: h.material,
      size: [h.fixedWidth, up(sf.depth.fixed)],
      length: (sf.fixed[1] - sf.fixed[0]) * k,
      qty: sides,
      note: `Between the end ribs, ribs butting its front face; ${slots}`,
    })
    if (sf.stock) {
      out.push({
        item: `Trailing edge stock as ${sf.label}`,
        material: structure.te.material,
        size: [structure.te.width, up(sf.depth.moving)],
        length: (sf.moving[1] - sf.moving[0]) * k,
        qty: sides,
        note: `Cut from the trailing edge stock; bevel its front face to a point at the centre line, ${deg(sf.bevel.top)} top and ${deg(sf.bevel.bottom)} bottom from square (${Math.round(sf.down)}° down, ${Math.round(sf.up)}° up, ${Math.round(sf.gap * 10000) / 10} mm gap); ${slots}`,
      })
      continue
    }
    out.push({
      item: `Hinge spar, moving side, ${sf.label}`,
      material: h.material,
      size: [h.movingWidth, up(sf.depth.moving)],
      length: (sf.moving[1] - sf.moving[0]) * k,
      qty: sides,
      note: `Bevel the front to a point at the centre line, ${deg(sf.bevel.top)} top and ${deg(sf.bevel.bottom)} bottom from square (${Math.round(sf.down)}° down, ${Math.round(sf.up)}° up, ${Math.round(sf.gap * 10000) / 10} mm gap); ${slots}`,
    })
  }
  // A spoiler's hinge: a strip of hinge tape along its front edge
  for (const br of (a.brakes ?? []).filter((x) => x.ok && x.type === 'spoiler')) {
    out.push({
      item: `Hinge tape, ${br.label}`,
      material: 'mylar',
      size: [0.012, 0.0002],
      length: br.length,
      qty: sides,
      note: 'Along the front edge of the plate, half on the plate and half on the frame',
    })
  }
  // A sheeted wing's servo hatch screws to a rail along each of the opening's chordwise edges
  if (structure.covering.type === 'sheeted' && structure.covering.sheetThickness > 0) {
    for (const bay of (a.bays ?? []).filter((x) => x.ok)) {
      out.push({
        item: `Hatch rail, ${bay.label}`,
        material: 'spruce',
        size: [0.005, 0.005],
        length: bay.hatch.s1 - bay.hatch.s0,
        qty: 2 * sides,
        note: 'Between the ribs either side at the front and back edges of the hatch opening, flush with the inside of the lower sheeting; the hatch screws to them',
      })
    }
  }
  if (sp.type === 'tube') {
    const L = Number.isFinite(sp.tubeLength) ? Math.min(sp.tubeLength, span) : span
    out.push({ item: 'Spar tube', material: sp.tubeMaterial, size: [sp.tubeDiameter, sp.tubeWall], length: L * (both && structure.ribs.rootJoint !== 'two-piece' ? 2 : 1), qty: both && structure.ribs.rootJoint !== 'two-piece' ? 1 : sides, tube: true })
  }
  const cov = structure.covering
  if (cov.capStrips && cov.type !== 'sheeted') {
    // Cap strips over each rib where it isn't sheeted, top and bottom
    let total = 0
    for (const p of ribs) {
      const b = p.rib
      total += (Math.max(0, b.uB - b.capStripFrom.top) + Math.max(0, b.uB - b.capStripFrom.bottom)) * p.qty
    }
    out.push({ item: 'Cap strips (total, both surfaces)', material: cov.capStripMaterial, size: [cov.capStripWidth, cov.capStripThickness], length: total, qty: 1 })
  }
  // Catalogue edge stock, rods and dowels: how many lengths to buy, noted on each edge's
  // first line
  for (const k of ['le', 'te']) {
    const lines = out.filter((c) => c.edge === k)
    if (!lines.length || !(edges?.[k].item || lines[0].round)) continue
    const L = lines[0].stockLength ?? STOCK_LENGTH
    const n = lengthsToBuy(lines.flatMap((c) => Array(c.qty).fill(c.length)), L)
    lines[0].note = `Buy ${n} × ${Math.round(L * 1000)} mm length${n === 1 ? '' : 's'}`
  }
  return out
}

// The area the covering goes over on one half wing, both surfaces, m²: { sheeted, open },
// sheeted being over sheeting (a D-box's nose back to the spar's rear face, or all of a
// fully sheeted wing), open the rest. The surface is measured along the section from root
// rib to tip rib, plus both faces of a rounded tip's block (as its plan area, a little
// under).
export function coveredArea(a, structure, n = 40) {
  const cov = structure.covering
  const [, sparRear] = lineFaces(a.sparX, sparWidth(structure.spar))
  // Length of one surface between chord fractions q0 and q1
  const arc = (sec, q0, q1, which) => {
    let L = 0
    let prev = null
    for (let i = 0; i <= 40; i++) {
      const q = q0 + ((q1 - q0) * i) / 40
      const f = sec.surf(q)
      const p = [q * sec.c, which === 'upper' ? f.upper : f.lower]
      if (prev) L += Math.hypot(p[0] - prev[0], p[1] - prev[1])
      prev = p
    }
    return L
  }
  // Each surface has its own sheeted run: a D-box side runs back to the spar's rear face, or
  // to its own setting, or not at all when that side is off
  const row = (s) => {
    const sec = a.section(s)
    if (!sec || !(sec.c > 1e-4)) return { sheeted: 0, open: 0 }
    const sparXi = cov.type === 'dbox' ? Math.min(1, Math.max(0, (sparRear(s) - sec.xl) / sec.c)) : 0
    let sheeted = 0
    let open = 0
    for (const w of ['upper', 'lower']) {
      const ext = sheetExtent(structure, w === 'upper' ? 'top' : 'bottom', sparXi)
      const back = ext ? ext.to : 0
      sheeted += back > 0 ? arc(sec, 0, back, w) : 0
      open += back < 1 ? arc(sec, back, 1, w) : 0
    }
    return { sheeted, open }
  }
  let sheeted = 0
  let open = 0
  let prev = null
  for (let i = 0; i <= n; i++) {
    const s = a.rootS + ((a.tipS - a.rootS) * i) / n
    const r = row(s)
    if (prev) {
      const ds = (a.tipS - a.rootS) / n
      sheeted += ((r.sheeted + prev.sheeted) / 2) * ds
      open += ((r.open + prev.open) / 2) * ds
    }
    prev = r
  }
  const tip = flatPanels(a.wing).tip
  if (tip) {
    const area = 2 * Math.abs(polygonArea(tip.polygon))
    if (cov.type === 'sheeted') sheeted += area
    else open += area
  }
  return { sheeted, open }
}

// Rough weight of the structure, kg, by group: every part and strip from its size and
// density, plus 10% for glue, and the covering over both surfaces (covered from
// coveredArea, for one half wing; halves: how many are being made), plus the servos
// (servoMass: those on one half wing). foam: a foam wing's core and skin glue, kg on one half
// wing (foamParts.js); its skins are weighed as parts but get no 10% (their glue is the
// stated allowance), and the templates and foam blocks aren't part of the wing.
function estimateWeight(parts, cutList, covered, structure, halves, servoMass = 0, foam = null) {
  const by = {}
  const add = (k, v) => (by[k] = (by[k] ?? 0) + v)
  for (const p of parts) {
    const area = Math.abs(polygonArea(p.outline)) - p.holes.reduce((s, h) => s + Math.abs(polygonArea(h)), 0)
    const rho = (MATERIALS[p.material] ?? MATERIALS['balsa-medium']).density
    // The tip block is carved down to a section: about half its block volume remains
    const fill = p.group === 'tip' ? 0.5 : 1
    add(p.group, area * p.thickness * rho * p.qty * fill)
  }
  for (const c of cutList) {
    if (c.buy || c.block) continue
    const rho = (MATERIALS[c.material] ?? MATERIALS['balsa-medium']).density
    let section = c.size[0] * c.size[1]
    if (c.triangular) section /= 2
    if (c.round) section *= Math.PI / 4
    if (c.tube) section = (Math.PI / 4) * (c.size[0] ** 2 - (c.size[0] - 2 * c.size[1]) ** 2)
    add('strip', section * c.length * c.qty * rho)
  }
  const skins = by.skins ?? 0
  let bare = (Object.values(by).reduce((s, v) => s + v, 0) - skins) * 1.1 + skins
  if (foam) {
    by.core = foam.core * halves
    by.glue = foam.glue * halves
    bare += by.core + by.glue
  }
  const f = finishes(structure.covering)
  by.covering = covered ? (covered.sheeted * f.sheeted.mass + covered.open * f.open.mass) * halves : 0
  // The servos themselves, one per bay on each half
  const servos = servoMass * halves
  return { total: bare + by.covering + servos, bare, covering: by.covering, servos, by }
}
