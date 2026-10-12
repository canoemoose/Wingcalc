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

import { material, MATERIALS, sparSection, MIN_MATERIAL, skinAt, skinAtSpar, lineFaces, sparWidth } from './structure.js'
import { flatPanels } from './wing.js'
import { textWidth } from './strokeFont.js'
import { KIND_LABELS, lengthsToBuy, STOCK_LENGTH } from './edgeStock.js'

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

// Build one rib: outline with notches and tabs, holes, etch lines and label.
// rib: { s, kind, label } from the analysis; board: panel datum height (for jig tabs) or null.
export function buildRib(a, structure, rib, { board = null } = {}) {
  const r = structure.ribs
  const perpendicular = r.orientation === 'perpendicular' && rib.kind === 'normal'
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

  // Inset surfaces: offset by the skin, measured square to the surface
  const n = us.length
  const upIn = new Array(n)
  const loIn = new Array(n)
  for (let i = 0; i < n; i++) {
    const i0 = Math.max(0, i - 1)
    const i1 = Math.min(n - 1, i + 1)
    const du = us[i1] - us[i0] || 1e-9
    const su = (prof.up[i1] - prof.up[i0]) / du
    const sl = (prof.lo[i1] - prof.lo[i0]) / du
    const t = skinAt(structure, prof.xi[i], sparXiRear)
    upIn[i] = prof.up[i] - t * Math.sqrt(1 + su * su)
    loIn[i] = prof.lo[i] + t * Math.sqrt(1 + sl * sl)
  }
  const top = (u) => interp(us, upIn, u)
  const bot = (u) => interp(us, loIn, u)

  // Cut back for the LE and TE stock (their depth is along the streamwise chord)
  const uA = crossing((s) => a.section(s).xl + (structure.le.width || 0), (structure.le.width || 0) * scale)
  const uB = crossing((s) => a.section(s).xl + a.section(s).c - (structure.te.width || 0), L - (structure.te.width || 0) * scale)
  if (!(uB > uA + 0.01)) return { ok: false, reason: 'short', s: rib.s }
  if (top(uB) - bot(uB) < MIN_MATERIAL) notes.push('Very thin at the trailing-edge cut')

  // Notches from the top (upper) and bottom (lower): { u0, u1, depth }
  const upper = []
  const lower = []
  const holes = []
  const sparHere = sparSection(structure, interp(us, prof.up, uSpar) - interp(us, prof.lo, uSpar), rib.s - a.rootS)
  if (sp.type === 'caps' || sp.type === 'box') {
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
  if (sparHere.type !== 'none' && sparHere.fits === false) notes.push("The spar doesn't fit at this rib")
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
  const outline = clean([...topChain, ...botChain])

  // Etch: where to cut each tab off, along the rib's lower edge
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

  // The label goes first, in the roomiest clear stretch (ahead of the spar if it fits as well
  // there), and the lightening holes keep clear of it
  const name = rib.name ?? ''
  const edge = 0.0015
  let best = null
  for (const [from, to, pref] of [
    [uA + edge, uSpar0 - edge, 1.1],
    [uSpar1 + edge, uB - edge, 1],
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
  if (r.lightening && rib.kind === 'normal') {
    const m = r.lighteningMargin || 0.004
    const stretches = []
    for (const [from, to] of [
      [uA + m, uSpar0 - m],
      [uSpar1 + m, uB - m],
    ]) {
      if (labelBox && labelBox[1] + m > from && labelBox[0] - m < to) {
        stretches.push([from, labelBox[0] - m], [labelBox[1] + m, to])
      } else stretches.push([from, to])
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
    sp.type === 'caps' || sp.type === 'box'
      ? Math.min(top(uSpar0), top(uSpar1)) - sp.capThickness - (Math.max(bot(uSpar0), bot(uSpar1)) + sp.capThickness)
      : null

  return {
    ok: true,
    s: rib.s,
    kind: rib.kind,
    perpendicular,
    angle: prof.angle,
    panel: prof.panel,
    length: L,
    sparU: uSpar,
    sparNotch: [uSpar0, uSpar1],
    capGap,
    // The rib's outer and inset surfaces, for drawing cap strips on it
    surfaces: { us, up: prof.up, lo: prof.lo, upIn, loIn },
    capStripFrom: structure.covering.type === 'dbox' ? uSpar1 : uA,
    uA,
    uB,
    outline,
    holes,
    etch,
    label,
    notes,
    minLower: Math.min(...loIn.filter((_, i) => us[i] >= uA && us[i] <= uB)),
  }
}

// --- All parts -------------------------------------------------------------------------------

const PLY = [0.0004, 0.0006, 0.0008, 0.001, 0.0015, 0.002, 0.0025, 0.003, 0.004, 0.005, 0.006]

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

// Everything to cut for the wing, plus a cut list for strip stock and an estimate of the
// structure's weight. handedness: 'right' | 'left' | 'pair'.
export function buildParts(a, structure, { handedness = 'pair' } = {}) {
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
  for (const rb of ribs) {
    const board = r.jigTabs ? boards.get(panelKey(a, rb.s)) : null
    const b = buildRib(a, structure, rb, { board })
    if (!b.ok) {
      skipped.push({ name: rb.name, s: rb.s, reason: b.reason })
      continue
    }
    const brk = breaks.find((x) => Math.abs(x.s - rb.s) < 1e-4)
    const notes = [...b.notes]
    let cant = 0
    if (brk && Math.abs(brk.outer - brk.inner) > 0.05) {
      cant = (brk.outer - brk.inner) / 2
      notes.push(`Cant ${Math.abs(cant).toFixed(1)}° from square to the board (half the ${Math.abs(brk.outer - brk.inner).toFixed(1)}° dihedral change)`)
    }
    if (b.perpendicular && Math.abs(b.angle) > 0.5) notes.push(`Square to the spar, ${Math.abs(b.angle).toFixed(1)}° off streamwise`)
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
      outline: b.outline,
      holes: b.holes,
      etch: b.etch,
      label: { ...b.label, text: rb.name },
      notes,
      cant,
      rib: b,
    })
  }

  // Corner gussets where ribs meet the LE and TE stock
  const g = structure.gussets
  const gussetGroups = new Map()
  if ((g.le || g.te) && g.size > 0) {
    for (const p of parts.filter((q) => q.group === 'ribs')) {
      if (g.where === 'ends' && p.kind === 'normal') continue
      for (const edge of ['le', 'te'].filter((e) => g[e])) {
        const angle = gussetAngle(a, p.s, edge, p.rib)
        const sides = gussetSides(p, g, r.rootJoint).map((k) => (k > 0 ? angle : 180 - angle))
        for (const ang of sides) {
          const key = `${edge}:${Math.round(ang * 2) / 2}`
          const cur = gussetGroups.get(key) ?? { edge, angle: Math.round(ang * 2) / 2, count: 0 }
          cur.count += p.qty * (g.layer === 'both' ? 2 : 1)
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
        outline: normalise(outline),
        holes: [],
        etch: [],
        label: null,
        notes: [
          `${grp.edge === 'le' ? 'Leading' : 'Trailing'}-edge corner, ${grp.angle}° between rib and edge, flush with the ${
            g.layer === 'both' ? 'top and bottom' : g.layer === 'bottom' ? 'bottom' : 'top'
          } of the rib`,
        ],
      })
      k++
    }
  }

  // Dihedral braces at breaks, on the spar's front and back faces
  const br = structure.braces
  if (br.enabled && structure.spar.type !== 'tube') {
    let k = 1
    for (const brk of breaks) {
      const delta = brk.outer - brk.inner
      if (Math.abs(delta) < 0.05) continue
      // A two-piece wing's root is a joiner, not a brace
      if (r.rootJoint === 'two-piece' && brk.s <= a.rootS + 1e-6) continue
      const at = (s) => {
        const sec = a.section(Math.min(a.tipS, Math.max(a.rootS, s)))
        if (!sec) return 0
        const q = Math.min(0.95, Math.max(0.02, (a.sparX(s) - sec.xl) / sec.c))
        const skin = skinAtSpar(structure)
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
      // A flat plate (the spar's face is one plane across the break), shaped to the dihedral;
      // the etched line marks the break, where it meets the break rib
      const fold = [raw[5], raw[2]]
      const bb = bounds(raw)
      const shift = ([x, y]) => [x - bb.x0, y - bb.y0]
      // Two plates carry the moment at the break: t = 6 M SF / (2 σ h²)
      const M = interpRows(a.pos.rows, brk.s)
      const m = material(br.material)
      const need = (6 * M * a.safetyFactor) / (2 * Math.min(m.compression, m.tension) * Math.max(1e-4, h0) ** 2)
      const t = Number.isFinite(br.thickness) && br.thickness > 0 ? br.thickness : (PLY.find((x) => x >= need) ?? PLY.at(-1))
      parts.push({
        id: `B${k}`,
        name: `B${k}`,
        group: 'braces',
        material: br.material,
        thickness: t,
        qty: 2 * (centre || !both ? 1 : 2),
        outline: raw.map(shift),
        holes: [],
        etch: [fold.map(shift)],
        label: null,
        notes: [
          `Dihedral brace, ${Math.abs(delta).toFixed(1)}° at ${Math.round((brk.s - a.rootS) * 1000)} mm from the root rib; one each side of the spar`,
          `Needs at least ${(need * 1000).toFixed(1)} mm ${m.label.toLowerCase()} for the bending there`,
        ],
        need,
        // Where it goes, for the 3D view: the break, its reach each side, and the plate's depth
        // at its inner end, the break and its outer end
        at: { s: brk.s, inner: Lin, outer: Lout, depths: [hi, h0, ho], centre }
      })
      k++
    }
  }

  // Shear webs, one piece per bay (two for a box spar), vertical grain
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

  // Tip block, as a plan template
  const flat = flatPanels(a.wing)
  if (flat.tip) {
    const base = flat.tip.base
    const outline = flat.tip.polygon.map(([s, x]) => [s - base.s, x])
    const tipRib = parts.find((p) => p.group === 'ribs' && p.kind === 'tip')
    const depth = tipRib ? bounds(tipRib.rib.outline).h + 2 * (cov.type === 'open' ? 0 : cov.sheetThickness || 0) : 0
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
  const weight = estimateWeight(parts, cutList)
  return { parts, skipped, cutList, weight, boards }
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
  const ribs = parts.filter((p) => p.group === 'ribs')
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
    // Edge stock: a catalogue part at its own size, or custom at the depth the section needs
    const leH = Math.max(faceHeight(p.from, structure.le.width), faceHeight(p.to, structure.le.width))
    const leItem = edges?.le.item
    out.push({
      item: `Leading edge${leItem ? ` (${leItem.code} ${KIND_LABELS[leItem.kind]})` : ''}, ${p.name}`,
      edge: 'le',
      material: structure.le.material,
      size: [structure.le.width, edges?.le.item ? edges.le.item.height : Math.ceil(leH * 1000) / 1000],
      length: lenAlong(p.from, p.to, edgeX('le')),
      qty: sides,
    })
    const teQ = (s) => a.section(s).c - structure.te.width
    const teH = Math.max(faceHeight(p.from, teQ(p.from)), faceHeight(p.to, teQ(p.to)))
    out.push({
      item: `Trailing edge (${edges?.te.item ? `${edges.te.item.code} triangular` : structure.te.type}), ${p.name}`,
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
      const from = cov.type === 'dbox' ? b.sparU : b.uA
      total += Math.max(0, b.uB - from) * 2 * p.qty
    }
    out.push({ item: 'Cap strips (total, both surfaces)', material: cov.capStripMaterial, size: [cov.capStripWidth, cov.capStripThickness], length: total, qty: 1 })
  }
  // Catalogue edge stock: how many lengths to buy, noted on each edge's first line
  for (const k of ['le', 'te']) {
    if (!edges?.[k].item) continue
    const lines = out.filter((c) => c.edge === k)
    const n = lengthsToBuy(lines.flatMap((c) => Array(c.qty).fill(c.length)))
    if (lines.length) lines[0].note = `Buy ${n} × ${Math.round(STOCK_LENGTH * 1000)} mm length${n === 1 ? '' : 's'}`
  }
  return out
}

// Rough weight of the structure (no covering, glue allowance 10%), kg, by group.
function estimateWeight(parts, cutList) {
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
    const rho = (MATERIALS[c.material] ?? MATERIALS['balsa-medium']).density
    let section = c.size[0] * c.size[1]
    if (c.triangular) section /= 2
    if (c.tube) section = (Math.PI / 4) * (c.size[0] ** 2 - (c.size[0] - 2 * c.size[1]) ** 2)
    add('strip', section * c.length * c.qty * rho)
  }
  const total = Object.values(by).reduce((s, v) => s + v, 0) * 1.1
  return { total, by }
}
