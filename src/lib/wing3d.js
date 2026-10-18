// 3D geometry of the built-up half wing, for the 3D view. Pure data (positions, indices and
// placement matrices), no rendering library, so it can be tested; the view turns it into
// meshes.
//
// World axes, metres: X spanwise outward (projected, so dihedral shows), Y up, Z chordwise
// aft from the root leading edge. A point on the wing is given by its flat spanwise distance
// s, chordwise x and height h above its panel's chord plane; dihedral tilts that plane.
// Washout rotates each section about the spar line (TE up), as in ribs.js, so the skin and
// the ribs agree.
//
// A foam wing (foam.js) comes as its equivalent fully sheeted structure with no ribs: the skins
// are its sheeting, and its core is a solid between them (coreSection).

import { MIN_CORE, isFoam } from './foam.js'
import { skinAt, sheetExtent, sparWidth, lineFaces, gussetLayer, gussetEdges, hardPatches, patchSheet, patchSpan } from './structure.js'
import { gussetsAt } from './ribs.js'
import { isRound, roundFitAt, edgeFace, insetPlacement, insetSheetStarts } from './edgeStock.js'
import { BRAKE, bladeXs } from './airBrakes.js'
import { placeServo } from './servos.js'

const RAD = Math.PI / 180

// Panel dihedral at s; on a panel break, the mean of the two (where the break rib sits).
function angleAt(a, s) {
  const e = 1e-5
  // On the centreline the two halves meet symmetrically, so the section there stands upright
  if (s < e) return 0
  const lo = a.sampler.at(Math.max(0, s - e))
  const hi = a.sampler.at(Math.min(a.sampler.reach, s + e))
  return ((lo?.rad ?? 0) + (hi?.rad ?? lo?.rad ?? 0)) / 2
}

// The direction the 3D view and the card's wireframe look from (target to camera; X out along
// the span, Y up, Z aft): behind, above and inboard, so they read like the plan, root left,
// tip right, leading edge at the top
export const HOME_VIEW = [-0.55, 0.6, 0.75]

// The view direction (target to camera) for a face of the view cube, given where the camera
// is now. Straight down or up is a degenerate view for an orbit camera, so the top and bottom
// lean a hair fore or aft, towards whichever the camera is on, and square up to it: from behind,
// the span runs across with the root on the left (from above, the leading edge at the top, as
// the plan); from ahead, the same turned half round.
export function faceView(normal, current = [0, 0, 1]) {
  if (Math.abs(normal[1]) <= 0.99) return normal
  const v = [0, Math.sign(normal[1]), current[2] < 0 ? -1e-3 : 1e-3]
  const l = Math.hypot(...v)
  return v.map((c) => c / l)
}

// A view direction part way (e, 0 to 1) round from one to another, moving in heading and
// elevation like the orbit camera (heading round the shorter way). Unlike a straight arc
// between the two, this never carries the camera over the top or bottom, where its picture
// would flip, and it turns the camera's heading as it climbs, so a top or bottom view arrives
// squared up.
export function orbitLerp(from, to, e) {
  const unit = (v) => v.map((c) => c / Math.hypot(...v))
  // Arrived, or nowhere to come from (a camera sitting on its target)
  if (e >= 1 || Math.hypot(...from) < 1e-12) return unit(to)
  const sph = (v) => {
    const r = Math.hypot(...v)
    return { phi: Math.acos(Math.max(-1, Math.min(1, v[1] / r))), theta: Math.atan2(v[0], v[2]) }
  }
  const a = sph(from)
  const b = sph(to)
  let dTheta = b.theta - a.theta
  if (dTheta > Math.PI) dTheta -= 2 * Math.PI
  if (dTheta < -Math.PI) dTheta += 2 * Math.PI
  const phi = a.phi + (b.phi - a.phi) * e
  const theta = a.theta + dTheta * e
  return [Math.sin(phi) * Math.sin(theta), Math.cos(phi), Math.sin(phi) * Math.cos(theta)]
}

// World position of (s, x, h). At a dihedral break the section lies on the bisector of the
// two panels, where the break rib is, so both panels meet it cleanly.
export function worldPoint(a, s, x, h) {
  const w = a.sampler.at(Math.min(a.sampler.reach, Math.max(0, s)))
  const g = angleAt(a, s)
  return [w.y - h * Math.sin(g), w.z + h * Math.cos(g), x]
}

// Height of the upper or lower surface at (s, x), with washout.
export function surfaceHeight(a, s, x, which) {
  const sec = a.section(s)
  // A rounded tip comes to a point: no chord there, so no thickness either
  const q = sec.c > 1e-9 ? Math.min(1, Math.max(0, (x - sec.xl) / sec.c)) : 0
  const f = sec.surf(q)
  const lift = (x - a.sparX(Math.min(a.tipS, s))) * Math.sin(sec.twist * RAD)
  return (which === 'upper' ? f.upper : f.lower) + lift
}

// A mesh from rings of points: every ring the same length, consecutive rings joined.
// closed joins each ring's last point to its first. caps closes the two end rings: 'fan'
// from the ring's centre, for convex sections (boxes, the nose of the leading edge), or
// 'strip' for a thin shell given as one surface out and the other back (sheeting), joining
// each point to its partner across the thickness. A fan on a shell would span its hollow.
export function loft(rings, { closed = true, caps = false } = {}) {
  const n = rings.length
  const m = rings[0]?.length ?? 0
  const positions = []
  for (const r of rings) for (const p of r) positions.push(p[0], p[1], p[2])
  const idx = []
  const span = closed ? m : m - 1
  for (let i = 0; i < n - 1; i++) {
    for (let j = 0; j < span; j++) {
      const a = i * m + j
      const b = i * m + ((j + 1) % m)
      const c = (i + 1) * m + ((j + 1) % m)
      const d = (i + 1) * m + j
      idx.push(a, b, c, a, c, d)
    }
  }
  if (caps === 'strip' && n > 1) {
    for (const [ring, flip] of [
      [0, true],
      [n - 1, false],
    ]) {
      const base = ring * m
      for (let j = 0; j < m / 2 - 1; j++) {
        const a = base + j
        const b = base + j + 1
        const c = base + m - 2 - j
        const d = base + m - 1 - j
        if (flip) idx.push(a, c, b, a, d, c)
        else idx.push(a, b, c, a, c, d)
      }
    }
  } else if (caps && n > 1) {
    for (const [ring, flip] of [
      [0, true],
      [n - 1, false],
    ]) {
      const base = ring * m
      const centre = [0, 0, 0]
      for (const p of rings[ring]) for (let k = 0; k < 3; k++) centre[k] += p[k] / m
      const ci = positions.length / 3
      positions.push(...centre)
      for (let j = 0; j < m; j++) {
        const a = base + j
        const b = base + ((j + 1) % m)
        if (flip) idx.push(ci, b, a)
        else idx.push(ci, a, b)
      }
    }
  }
  return { positions: new Float32Array(positions), indices: new Uint32Array(idx) }
}

// Spanwise stations from s0 to s1: evenly spaced plus every panel end, so kinks are exact.
function stations(a, s0, s1, n) {
  const set = new Set()
  for (let i = 0; i <= n; i++) set.add(s0 + ((s1 - s0) * i) / n)
  for (const e of a.sampler.ends) if (e.outer.s > s0 && e.outer.s < s1) set.add(e.outer.s)
  if (a.sampler.half > s0 && a.sampler.half < s1) set.add(a.sampler.half)
  return [...set].sort((p, q) => p - q)
}

const cosine = (n) => Array.from({ length: n + 1 }, (_, i) => 0.5 * (1 - Math.cos((Math.PI * i) / n)))

// Stations over a rounded tip, from the tip rib's outer face to the end: close together
// towards the end, where the outline curves round fastest. The covering and the tip block
// both use them, so the two surfaces are built from the same points.
function tipStations(a, structure, n = 24) {
  const s0 = a.tipS + (structure.ribs.thickness || 0) / 2
  const s1 = a.sampler.reach
  if (!(s1 > s0 + 1e-6)) return []
  return Array.from({ length: n + 1 }, (_, i) => s0 + (s1 - s0) * Math.sin((Math.PI / 2) * (i / n)))
}

// The outer skin, root to the tip of a rounded tip, as one closed loft.
function skin(a, structure, n = 60, chordPts = 36) {
  const xs = cosine(chordPts)
  const rings = []
  const tip = tipStations(a, structure)
  const along = tip.length ? [...stations(a, a.rootS, tip[0], n), ...tip.slice(1)] : stations(a, a.rootS, a.sampler.reach, n)
  for (const s of along) {
    const sec = a.section(s)
    if (!sec) continue
    const ring = []
    // Upper surface TE to LE, then lower LE to TE (skipping the shared LE point)
    for (let i = xs.length - 1; i >= 0; i--) {
      const x = sec.xl + xs[i] * sec.c
      ring.push(worldPoint(a, s, x, surfaceHeight(a, s, x, 'upper')))
    }
    for (let i = 1; i < xs.length - 1; i++) {
      const x = sec.xl + xs[i] * sec.c
      ring.push(worldPoint(a, s, x, surfaceHeight(a, s, x, 'lower')))
    }
    rings.push(ring)
  }
  return loft(rings, { closed: true })
}

// A solid running along the span: section(s) returns its cross-section as [x, h] points
// (the same number at every station), or null where it stops.
// extend: [inboard, outboard] distances to carry the end sections on, square to them, so a
// part runs to the outer face of the rib it ends at rather than that rib's centre plane.
function sweep(a, s0, s1, section, n = 40, { extend = [0, 0], caps = 'fan' } = {}) {
  const rings = sweepRings(a, s0, s1, section, n, extend)
  return rings ? loft(rings, { closed: true, caps }) : null
}

// The rings a sweep lofts through, in world coordinates, or null.
function sweepRings(a, s0, s1, section, n, extend) {
  const rings = []
  for (const s of stations(a, s0, s1, n)) {
    const pts = section(s)
    if (pts) rings.push(pts.map(([x, h]) => worldPoint(a, s, x, h)))
  }
  if (rings.length < 2) return null
  const along = (s) => {
    const g = angleAt(a, s)
    return [Math.cos(g), Math.sin(g), 0]
  }
  const shift = (ring, d, by) => ring.map((p) => [p[0] + d[0] * by, p[1] + d[1] * by, p[2] + d[2] * by])
  if (extend[0] > 0) rings.unshift(shift(rings[0], along(s0), -extend[0]))
  if (extend[1] > 0) rings.push(shift(rings.at(-1), along(s1), extend[1]))
  return rings
}

// A hollow tube from matching outer and inner rings: both walls, and annular ends.
export function tubeLoft(outer, inner) {
  const n = outer.length
  const m = outer[0].length
  const positions = []
  for (const r of [...outer, ...inner]) for (const p of r) positions.push(p[0], p[1], p[2])
  const O = (i, j) => i * m + (j % m)
  const I = (i, j) => (n + i) * m + (j % m)
  const idx = []
  for (let i = 0; i < n - 1; i++) {
    for (let j = 0; j < m; j++) {
      idx.push(O(i, j), O(i, j + 1), O(i + 1, j + 1), O(i, j), O(i + 1, j + 1), O(i + 1, j))
      idx.push(I(i, j), I(i + 1, j + 1), I(i, j + 1), I(i, j), I(i + 1, j), I(i + 1, j + 1))
    }
  }
  for (const [i, flip] of [
    [0, true],
    [n - 1, false],
  ]) {
    for (let j = 0; j < m; j++) {
      const q = [O(i, j), O(i, j + 1), I(i, j + 1), I(i, j)]
      if (flip) idx.push(q[0], q[2], q[1], q[0], q[3], q[2])
      else idx.push(q[0], q[1], q[2], q[0], q[2], q[3])
    }
  }
  return { positions: new Float32Array(positions), indices: new Uint32Array(idx) }
}

// Height of the inset surface at (s, x): the outer surface less the skin over the ribs there,
// measured square to the surface, exactly as the ribs are inset (ribs.js). caps false leaves
// the cap strips out (the hinge spars' height: see skinAt).
export function insetHeight(a, structure, s, x, which, caps = true) {
  const sec = a.section(s)
  const rear = (a.sparX(s) + sparWidth(structure.spar) / 2 - sec.xl) / sec.c
  const d = 1e-4
  const slope = (surfaceHeight(a, s, x + d, which) - surfaceHeight(a, s, x - d, which)) / (2 * d)
  const up = surfaceHeight(a, s, x, 'upper')
  const lo = surfaceHeight(a, s, x, 'lower')
  // Never past the middle: right at the nose (a sheeted nose) the skin is the whole depth
  const t = Math.min((up - lo) / 2, skinAt(structure, (x - sec.xl) / sec.c, rear, which === 'upper' ? 'top' : 'bottom', sec.c, caps) * Math.sqrt(1 + slope * slope))
  return which === 'upper' ? up - t : lo + t
}

// Something seated in a rib notch from x0 to x1, depth deep, as the notch is cut: its floor
// is flat, set by the lower of the inset surface at the two walls. Returns [x, h] corners.
function seated(a, structure, s, x0, x1, depth, which) {
  const corners = (h0, h1) => [
    [x0, h0],
    [x1, h0],
    [x1, h1],
    [x0, h1],
  ]
  if (which === 'upper') {
    const floor = Math.min(insetHeight(a, structure, s, x0, which), insetHeight(a, structure, s, x1, which)) - depth
    return corners(floor, floor + depth)
  }
  const floor = Math.max(insetHeight(a, structure, s, x0, which), insetHeight(a, structure, s, x1, which)) + depth
  return corners(floor - depth, floor)
}

// A stringer's cross-section at s, as [x, h] corners, seated in its rib notches.
export function stringerBox(a, structure, str, s, which) {
  const sec = a.section(s)
  if (!sec || !(sec.c > 1e-4)) return null
  const line = (t) => {
    const q = a.section(Math.min(a.tipS, Math.max(a.rootS, t)))
    return q.xl + str.position * q.c
  }
  const [front, rear] = lineFaces(line, str.width)
  return seated(a, structure, s, front(s), rear(s), str.height, which)
}

// The spar's cross-section(s) at s, as [x, h] corners, seated as the ribs are cut: caps in
// their notches top and bottom, a tube or slotted spar centred between the inset surfaces.
export function sparBoxes(a, structure, s) {
  const sp = structure.spar
  if (sp.type === 'none') return []
  const x = a.sparX(s)
  // Faces of the stock at its own width, square to the spar, as the rib notches are cut
  const [front, rear] = lineFaces(a.sparX, sparWidth(sp))
  const x0 = front(s)
  const x1 = rear(s)
  if (sp.type === 'caps' || sp.type === 'box') {
    return [seated(a, structure, s, x0, x1, sp.capThickness, 'upper'), seated(a, structure, s, x0, x1, sp.capThickness, 'lower')]
  }
  if (sp.type === 'solid' && sp.solidMount !== 'through') return [seated(a, structure, s, x0, x1, sp.solidDepth, sp.solidMount === 'top' ? 'upper' : 'lower')]
  const mid = (insetHeight(a, structure, s, x, 'upper') + insetHeight(a, structure, s, x, 'lower')) / 2
  if (sp.type === 'solid') {
    const d = sp.solidDepth / 2
    return [
      [
        [x0, mid - d],
        [x1, mid - d],
        [x1, mid + d],
        [x0, mid + d],
      ],
    ]
  }
  const r = sp.tubeDiameter / 2
  return [Array.from({ length: 16 }, (_, k) => [x + ((x1 - x0) / 2) * Math.cos((2 * Math.PI * k) / 16), mid + r * Math.sin((2 * Math.PI * k) / 16)])]
}

// The shear web(s) at s: between the caps (from the top of the lower cap to the bottom of the
// upper), flush with the caps' front face, and with the rear face too for a box spar, so a
// box closes. Fitted between the ribs, as the W parts are cut.
export function webBoxes(a, structure, s) {
  const sp = structure.spar
  // No web at all (a foam wing without one): nothing, not a sliver of no thickness
  if ((sp.type !== 'caps' && sp.type !== 'box') || !(sp.webThickness > 0)) return []
  const [up, lo] = sparBoxes(a, structure, s)
  const [front, rear] = lineFaces(a.sparX, sparWidth(sp))
  const [innerFront, innerRear] = lineFaces(a.sparX, Math.max(0, sparWidth(sp) - 2 * sp.webThickness))
  const h0 = lo[2][1] // top of the lower cap
  const h1 = up[0][1] // bottom of the upper cap
  const box = (xa, xb) => [
    [xa, h0],
    [xb, h0],
    [xb, h1],
    [xa, h1],
  ]
  const out = [box(front(s), innerFront(s))]
  if (sp.type === 'box') out.push(box(innerRear(s), rear(s)))
  return out
}

// The bore of a tube spar at s: the inside of the wall, matching sparBoxes' outer ring point
// for point, or null for any other spar.
export function tubeBore(a, structure, s) {
  const sp = structure.spar
  if (sp.type !== 'tube') return null
  const outer = sparBoxes(a, structure, s)[0]
  const r = sp.tubeDiameter / 2
  const ri = Math.max(0, r - sp.tubeWall)
  if (!(ri > 0)) return null
  const cx = outer.reduce((m, p) => m + p[0], 0) / outer.length
  const ch = outer.reduce((m, p) => m + p[1], 0) / outer.length
  return outer.map(([x, h]) => [cx + ((x - cx) * ri) / r, ch + ((h - ch) * ri) / r])
}

// Sheeting at s on one surface: from the LE stock back to the spar's rear face (D-box) or
// the TE stock (fully sheeted), between the outer surface and the ribs' inset surface. As a
// shell: the outer surface out, the inset surface back.
export function sheetSection(a, structure, s, which) {
  const sec = a.section(s)
  if (!sec || !(sec.c > 1e-4)) return null
  const [, sparRear] = lineFaces(a.sparX, sparWidth(structure.spar))
  // From the leading edge stock, or over an inset strip where it meets it
  const inset = structure.le.inset ? insetSheetStarts(structure.le.inset.item, sec, structure.covering.sheetThickness || 0) : null
  const turned = structure.le.face?.[which === 'upper' ? 'topXi' : 'bottomXi']
  const x0 = sec.xl + (inset ? inset[which === 'upper' ? 'top' : 'bottom'] : Number.isFinite(turned) ? turned * sec.c : structure.le.width)
  // Each surface's sheet runs to its own end (a D-box side may stop short of the spar, or be off)
  const side = which === 'upper' ? 'top' : 'bottom'
  const rearXi = (sparRear(s) - sec.xl) / sec.c
  const ext = sheetExtent(structure, side, rearXi)
  if (!ext) return null
  const x1 = structure.covering.type === 'sheeted' ? sec.xl + sec.c - structure.te.width : sec.xl + ext.to * sec.c
  const xs = Array.from({ length: 17 }, (_, i) => x0 + ((x1 - x0) * (1 - Math.cos((Math.PI * i) / 16))) / 2)
  return [...xs.map((x) => [x, surfaceHeight(a, s, x, which)]), ...[...xs].reverse().map((x) => [x, insetHeight(a, structure, s, x, which)])]
}

// A sheeted hard point's sheet at s on one surface: over the whole chord it covers (patchSpan),
// its thickness in from the outer surface, measured square to it.
export function patchSection(a, structure, s, which) {
  const span = patchSpan(a, structure, s)
  if (!span) return null
  const [x0, x1] = span
  const t = patchSheet(structure).thickness
  const d = 1e-4
  const xs = Array.from({ length: 17 }, (_, i) => x0 + ((x1 - x0) * (1 - Math.cos((Math.PI * i) / 16))) / 2)
  const inner = (x) => {
    const slope = (surfaceHeight(a, s, x + d, which) - surfaceHeight(a, s, x - d, which)) / (2 * d)
    const k = t * Math.sqrt(1 + slope * slope)
    return which === 'upper' ? surfaceHeight(a, s, x, which) - k : surfaceHeight(a, s, x, which) + k
  }
  return [...xs.map((x) => [x, surfaceHeight(a, s, x, which)]), ...[...xs].reverse().map((x) => [x, inner(x)])]
}

// A closed outline as n points evenly round it, from its foremost point, anticlockwise (x aft,
// h up): so outlines whose own point counts differ from station to station loft together
function evenRing(pts, n = 36) {
  const area = pts.reduce((t, [x1, y1], i) => {
    const [x2, y2] = pts[(i + 1) % pts.length]
    return t + x1 * y2 - x2 * y1
  }, 0)
  let ring = area < 0 ? [...pts].reverse() : [...pts]
  const k = ring.reduce((b, p, i) => (p[0] < ring[b][0] ? i : b), 0)
  ring = [...ring.slice(k), ...ring.slice(0, k)]
  const seg = ring.map((p, i) => Math.hypot(ring[(i + 1) % ring.length][0] - p[0], ring[(i + 1) % ring.length][1] - p[1]))
  const total = seg.reduce((t, l) => t + l, 0)
  const out = []
  let i = 0
  let run = 0
  for (let j = 0; j < n; j++) {
    const at = (total * j) / n
    while (i < ring.length - 1 && run + seg[i] < at) run += seg[i++]
    const t = seg[i] > 0 ? (at - run) / seg[i] : 0
    const [x0, y0] = ring[i]
    const [x1, y1] = ring[(i + 1) % ring.length]
    out.push([x0 + (x1 - x0) * t, y0 + (y1 - y0) * t])
  }
  return out
}

// Where turned edge stock's face (the rib face behind it) meets one surface at s, in plan: the
// face's distance from the edge at that height (edgeStock.js edgeFace, in the section's own
// heights, which the 3D surface differs from by the twist). Null for square stock.
function faceX(a, structure, s, edge, which) {
  const e = structure[edge]
  const sec = a.section(s)
  if (!e?.face || !sec) return null
  const F = edgeFace(e.face.item, sec, edge, e.face)
  const xAt = (v) => (edge === 'le' ? sec.xl + v : sec.xl + sec.c - v)
  let x = xAt(F.depth)
  for (let i = 0; i < 6; i++) {
    const xi = Math.min(1, Math.max(0, (x - sec.xl) / sec.c))
    const lift = surfaceHeight(a, s, x, which) - sec.surf(xi)[which]
    x = xAt(Math.min(sec.c / 2, Math.max(0, F.at(surfaceHeight(a, s, x, which) - lift))))
  }
  return x
}

// Leading edge stock at s: the section's own nose over its depth, cosine-spaced so it stays
// round, back to the rib face (square, or at a turned stock's angle); a rod or dowel as its
// circle, placed as the fit check places it (edgeStock.js); nothing for a sheeted nose.
export function leSection(a, structure, s) {
  const sec = a.section(s)
  if (!sec || !(sec.c > 1e-4) || structure.le.type === 'none') return null
  if (isRound(structure.le)) {
    const D = structure.le.diameter
    if (!(D > 0)) return null
    const r = D / 2
    const x = sec.xl + r
    const zc = roundFitAt(D, sec).centre + surfaceHeight(a, s, x, 'upper') - sec.surf(Math.min(1, r / sec.c)).upper
    return Array.from({ length: 24 }, (_, i) => [x + r * Math.cos((2 * Math.PI * i) / 24), zc + r * Math.sin((2 * Math.PI * i) / 24)])
  }
  // Let into the ribs: the strip as carved to the section, in its notch (edgeStock.js)
  if (structure.le.inset) {
    const P = insetPlacement(structure.le.inset.item, sec)
    if (P.carved.length > 2) {
      return evenRing(P.carved).map(([v, y]) => {
        const x = sec.xl + v
        const f = sec.surf(Math.min(1, Math.max(0, v / sec.c)))
        const lift = (surfaceHeight(a, s, x, 'upper') - f.upper + surfaceHeight(a, s, x, 'lower') - f.lower) / 2
        return [x, y + lift]
      })
    }
  }
  const w = Math.min(structure.le.width, sec.c / 2)
  const xUp = faceX(a, structure, s, 'le', 'upper') ?? sec.xl + w
  const xLo = faceX(a, structure, s, 'le', 'lower') ?? sec.xl + w
  const ups = cosine(10).map((f) => sec.xl + f * (xUp - sec.xl))
  const los = cosine(10).map((f) => sec.xl + f * (xLo - sec.xl))
  return [...[...ups].reverse().map((x) => [x, surfaceHeight(a, s, x, 'upper')]), ...los.slice(1).map((x) => [x, surfaceHeight(a, s, x, 'lower')])]
}

// A control surface's fixed hinge spar at s: from its front face to its rear face (a box that
// follows the section), the full height of the ribs and their cap strips, which stop at it:
// only sheeting covers it. sf from structure.js surfaceLayouts.
export function hingeSparSection(a, structure, sf, s) {
  const x0 = sf.faces.fixedFront(s)
  const x1 = sf.faces.fixedRear(s)
  const up = (x) => insetHeight(a, structure, s, x, 'upper', false)
  const lo = (x) => insetHeight(a, structure, s, x, 'lower', false)
  return [
    [x0, lo(x0)],
    [x1, lo(x1)],
    [x1, up(x1)],
    [x0, up(x0)],
  ]
}

// The moving surface's hinge spar at s: its front bevelled to a point at the centre line (the
// top face at sf.bevel.top from square, the bottom at sf.bevel.bottom), its rear face square,
// as tall as the fixed one (ribs and cap strips).
export function movingSparSection(a, structure, sf, s) {
  const xa = sf.faces.apex(s)
  const xr = sf.faces.movingRear(s)
  const up = (x) => insetHeight(a, structure, s, x, 'upper', false)
  const lo = (x) => insetHeight(a, structure, s, x, 'lower', false)
  const mid = (up(xa) + lo(xa)) / 2
  // Where each bevel meets its surface, no further back than the rear face
  const meet = (deg, which) => {
    const k = Math.tan(deg * RAD)
    const h = which === 'upper' ? up : lo
    let x = xa
    for (let i = 0; i < 4; i++) x = Math.min(xr - 1e-5, xa + k * Math.abs(h(x) - mid))
    return [x, h(x)]
  }
  return [[xa, mid], meet(sf.bevel.bottom, 'lower'), [xr, lo(xr)], [xr, up(xr)], meet(sf.bevel.top, 'upper')]
}

// Where a servo stands in its bay: the base height (its lowest point), the highest the lower
// skin's inside (or a lower stringer's top) gets under its run and along the bay, so it never
// pokes through either, and the ceiling, the lowest the upper skin's inside (or an upper
// stringer's underside) gets.
export function servoBox(a, structure, b) {
  let base = -Infinity
  let ceil = Infinity
  for (const s of [b.sA, (b.sA + b.sB) / 2, b.sB]) {
    for (let k = 0; k <= 6; k++) {
      const x = b.lugs.x0 + ((b.lugs.x1 - b.lugs.x0) * k) / 6
      base = Math.max(base, insetHeight(a, structure, s, x, 'lower'))
      ceil = Math.min(ceil, insetHeight(a, structure, s, x, 'upper'))
    }
    for (const str of structure.stringers ?? []) {
      if (!Number.isFinite(str.position) || !(str.width > 0) || !(str.height > 0)) continue
      for (const w of ['upper', 'lower']) {
        if (str.surface !== 'both' && str.surface !== w) continue
        const box = stringerBox(a, structure, str, s, w)
        if (!box) continue
        const xs = box.map((p) => p[0])
        if (Math.max(...xs) <= b.lugs.x0 || Math.min(...xs) >= b.lugs.x1) continue
        const hs = box.map((p) => p[1])
        if (w === 'lower') base = Math.max(base, Math.max(...hs))
        else ceil = Math.min(ceil, Math.min(...hs))
      }
    }
  }
  return { base, ceil, top: base + b.servo.height }
}

// A built bay's servo and mount plate: the servo's solids placed (servos.js placeServo), standing
// on servoBox's base with its case centred on the bay's, and the plate as the strips of ply
// round its cut-out ([x0, x1, s0, s1]), from z to z + thickness.
export function servoBayParts(a, structure, b) {
  const box = servoBox(a, structure, b)
  const parts = placeServo(b.servo, { x: (b.case.x0 + b.case.x1) / 2, s: b.s, base: box.base })
  const z = box.base + b.servo.lugHeight + b.servo.lugThickness
  const p = b.plate
  const c = b.cut
  const strips = c
    ? [
        [p.x0, c.x0, p.s0, p.s1],
        [c.x1, p.x1, p.s0, p.s1],
        [c.x0, c.x1, p.s0, c.s0],
        [c.x0, c.x1, c.s1, p.s1],
      ]
    : [[p.x0, p.x1, p.s0, p.s1]]
  return { parts, plate: { z, thickness: p.thickness, strips: strips.filter(([x0, x1, s0, s1]) => x1 - x0 > 1e-4 && s1 - s0 > 1e-4) } }
}

// One of a servo's solids cut square to the span at s, as [x, h] corners, or null where the
// cut misses it
function servoSlice({ box, cylinder: c }, s) {
  const rect = (x0, x1, z0, z1) => [[x0, z0], [x1, z0], [x1, z1], [x0, z1]]
  if (box) return s >= box.s[0] && s <= box.s[1] ? rect(box.x[0], box.x[1], box.z[0], box.z[1]) : null
  if (c.axis === 's') {
    if (s < c.from || s > c.to) return null
    return Array.from({ length: 16 }, (_, i) => [c.x + c.r * Math.cos((2 * Math.PI * i) / 16), c.z + c.r * Math.sin((2 * Math.PI * i) / 16)])
  }
  const d = s - c.s
  if (Math.abs(d) >= c.r) return null
  const half = Math.sqrt(c.r * c.r - d * d)
  return c.axis === 'x' ? rect(c.from, c.to, c.z - half, c.z + half) : rect(c.x - half, c.x + half, c.from, c.to)
}

// One of a servo's solids (servos.js placeServo) as a mesh: a box swept across the span, or a
// cylinder: round in section along the span, or swept across it as the chord (or height) the
// circle has at each station when it stands on the chord or the height.
function servoSolid(a, { box, cylinder: c }) {
  const rect = (x0, x1, z0, z1) => [[x0, z0], [x1, z0], [x1, z1], [x0, z1]]
  if (box) return sweep(a, box.s[0], box.s[1], () => rect(box.x[0], box.x[1], box.z[0], box.z[1]), 1)
  if (!(c.r > 0) || !(c.to > c.from)) return null
  if (c.axis === 's') {
    const ring = Array.from({ length: 16 }, (_, i) => [c.x + c.r * Math.cos((2 * Math.PI * i) / 16), c.z + c.r * Math.sin((2 * Math.PI * i) / 16)])
    return sweep(a, c.from, c.to, () => ring, 1)
  }
  const half = (s) => Math.max(1e-5, Math.sqrt(Math.max(0, c.r * c.r - (s - c.s) ** 2)))
  if (c.axis === 'x') return sweep(a, c.s - c.r, c.s + c.r, (s) => rect(c.from, c.to, c.z - half(s), c.z + half(s)), 12)
  return sweep(a, c.s - c.r, c.s + c.r, (s) => rect(c.x - half(s), c.x + half(s), c.from, c.to), 12)
}

// A foam wing's core at s, from x0 to x1 (plan x): between the skins' inner faces, top surface
// front to back then the bottom back to front, n + 1 points each; where the skins meet the two
// surfaces close up rather than cross.
export function coreSection(a, structure, s, x0, x1, n = 24) {
  const sec = a.section(s)
  if (!sec || !(sec.c > 1e-4) || !(x1 > x0)) return null
  const xs = cosine(n).map((f) => x0 + (x1 - x0) * f)
  const pairs = xs.map((x) => {
    const up = insetHeight(a, structure, s, x, 'upper')
    const lo = insetHeight(a, structure, s, x, 'lower')
    const mid = (up + lo) / 2
    return up - lo < MIN_CORE ? [mid, mid] : [up, lo]
  })
  return [...xs.map((x, i) => [x, pairs[i][0]]), ...[...xs].reverse().map((x, i) => [x, pairs[n - i][1]])]
}

// Trailing edge stock at s: the section's own tail over its depth.
export function teSection(a, structure, s, k = 8) {
  const sec = a.section(s)
  if (!sec || !(sec.c > 1e-4)) return null
  const from = sec.xl + sec.c - Math.min(structure.te.width, sec.c / 2)
  const to = sec.xl + sec.c
  // From the rib face (square, or at a turned stock's angle) to the trailing edge
  const run = (x0) => Array.from({ length: k + 1 }, (_, i) => x0 + ((to - x0) * i) / k)
  const ups = run(faceX(a, structure, s, 'te', 'upper') ?? from)
  const los = run(faceX(a, structure, s, 'te', 'lower') ?? from)
  return [...ups.map((x) => [x, surfaceHeight(a, s, x, 'upper')]), ...[...los].reverse().map((x) => [x, surfaceHeight(a, s, x, 'lower')])]
}

// A control surface that is the trailing edge stock itself, at s: the stock from the hinge back,
// its front bevelled to a point at the centre line as a moving hinge spar's is (top face at
// sf.bevel.top from square, bottom at sf.bevel.bottom), so it clears the fixed side over its
// throws.
export function stockSurfaceSection(a, structure, sf, s, k = 8) {
  const sec = a.section(s)
  if (!sec || !(sec.c > 1e-4)) return null
  const xa = sf.faces.apex(s)
  const te = sec.xl + sec.c
  const up = (x) => surfaceHeight(a, s, x, 'upper')
  const lo = (x) => surfaceHeight(a, s, x, 'lower')
  const mid = (up(xa) + lo(xa)) / 2
  const meet = (deg, h) => {
    const t = Math.tan(deg * RAD)
    let x = xa
    for (let i = 0; i < 4; i++) x = Math.min(te - 1e-5, xa + t * Math.abs(h(x) - mid))
    return x
  }
  const run = (x0) => Array.from({ length: k + 1 }, (_, i) => x0 + ((te - x0) * i) / k)
  const bottom = run(meet(sf.bevel.bottom, lo)).map((x) => [x, lo(x)])
  const top = run(meet(sf.bevel.top, up)).map((x) => [x, up(x)])
  return [[xa, mid], ...bottom, ...top.reverse().slice(1)]
}

// The plane square to the span at s (where a cut is made): a point on it and its outward
// normal, in world coordinates.
export function spanPlane(a, s) {
  const g = angleAt(a, s)
  return { point: worldPoint(a, s, a.sparX(s), 0), normal: [Math.cos(g), Math.sin(g), 0] }
}

// Everything a cut square to the span at s passes through, as [x, h] outlines in the cut's
// plane (map them with worldPoint): sheeting, spar and webs (between ribs), edge stock and
// stringers, plus the outer surface of the wing. For the 3D view's section.
export function sectionAt(a, structure, parts, s) {
  const st = structure
  const sp = st.spar
  const pieces = []
  const add = (kind, pts, holes = []) => pts && pts.length > 2 && pieces.push({ kind, pts, holes })
  if (st.covering.type !== 'open' && st.covering.sheetThickness > 0) for (const w of ['upper', 'lower']) add('sheet', sheetSection(a, st, s, w))
  // Sheeted hard points the cut passes through
  for (const h of hardPatches(st, a.rootS)) {
    if (s < h.s0 - 1e-9 || s > h.s1 + 1e-9) continue
    for (const side of h.sides) add('sheet', patchSection(a, st, s, side === 'top' ? 'upper' : 'lower'))
  }
  if (isFoam(st)) {
    const sec = a.section(s)
    // Stopping at a control surface's fixed hinge spar, as the 3D core does
    const sf = (a.surfaces ?? []).find((x) => x.ok && s > x.s0 && s < x.s1)
    if (sec && sec.c > 1e-4) add('core', coreSection(a, st, s, sec.xl + Math.min(st.le.width || 0, sec.c / 2), sf ? sf.faces.fixedFront(s) : sec.xl + sec.c - Math.min(st.te.width || 0, sec.c / 2)))
  }
  add('le', leSection(a, st, s))
  // Behind a surface that is the stock itself, the stock is that surface, bevelled at the hinge
  const stockSf = (a.surfaces ?? []).find((x) => x.ok && x.stock && s >= x.moving[0] && s <= x.moving[1])
  if (stockSf) add('teMoving', stockSurfaceSection(a, st, stockSf, s))
  else add('te', teSection(a, st, s))
  const sparEnd = sp.type === 'tube' && Number.isFinite(sp.tubeLength) ? Math.min(a.tipS, a.rootS + sp.tubeLength) : a.tipS
  if (s <= sparEnd + 1e-9) {
    const bore = tubeBore(a, st, s)
    for (const box of sparBoxes(a, st, s)) add('spar', box, bore ? [bore] : [])
  }
  // Webs only between ribs, as they're fitted
  const t = (st.ribs.thickness || 0) / 2
  const inRib = parts.some((p) => p.group === 'ribs' && Math.abs(p.s - s) < t)
  if (!inRib) for (const box of webBoxes(a, st, s)) add('web', box)
  for (const str of st.stringers ?? []) {
    if (!Number.isFinite(str.position) || !(str.width > 0) || !(str.height > 0)) continue
    for (const w of ['upper', 'lower']) if (str.surface === 'both' || str.surface === w) add('stringer', stringerBox(a, st, str, s, w))
  }
  // Servos and their mount plates, where the cut crosses them
  for (const b of (a.bays ?? []).filter((x) => x.ok)) {
    if (s < b.sA || s > b.sB) continue
    const { parts: sp, plate } = servoBayParts(a, st, b)
    for (const p of sp) add(p.kind, servoSlice(p, s))
    for (const [x0, x1, s0, s1] of plate.strips) {
      if (s >= s0 && s <= s1) add('plate', [[x0, plate.z], [x1, plate.z], [x1, plate.z + plate.thickness], [x0, plate.z + plate.thickness]])
    }
  }
  // Control surfaces' hinge spars, where the cut crosses them
  for (const sf of (a.surfaces ?? []).filter((x) => x.ok)) {
    if (s >= sf.fixed[0] && s <= sf.fixed[1]) add('hinge', hingeSparSection(a, st, sf, s))
    if (!sf.stock && s >= sf.moving[0] && s <= sf.moving[1]) add('hingeMoving', movingSparSection(a, st, sf, s))
  }
  const sec = a.section(s)
  const xs = cosine(40)
  const outline = sec
    ? [...xs.map((f) => sec.xl + f * sec.c).map((x) => [x, surfaceHeight(a, s, x, 'upper')]), ...[...xs].reverse().slice(1, -1).map((f) => sec.xl + f * sec.c).map((x) => [x, surfaceHeight(a, s, x, 'lower')])]
    : []
  return { pieces, outline, inRib }
}

// A rounded tip's block, as carved: the wing's own surface from the tip rib's outer face out
// to the end of the tip, closing to a point. Null without a rounded tip.
export function tipBlock(a, structure) {
  const along = tipStations(a, structure)
  if (!along.length) return null
  const xs = cosine(36) // the same chordwise points as the covering
  const rings = []
  for (const s of along) {
    const sec = a.section(Math.min(a.sampler.reach, s))
    const ring = []
    for (let k = xs.length - 1; k >= 0; k--) {
      const x = sec.xl + xs[k] * sec.c
      ring.push(worldPoint(a, s, x, surfaceHeight(a, s, x, 'upper')))
    }
    for (let k = 1; k < xs.length - 1; k++) {
      const x = sec.xl + xs[k] * sec.c
      ring.push(worldPoint(a, s, x, surfaceHeight(a, s, x, 'lower')))
    }
    rings.push(ring)
  }
  return loft(rings, { closed: true, caps: 'fan' })
}

// Each corner gusset's triangle in plan: laid flat in the corner between a rib's face and the
// LE or TE stock, legs along each. In this half only: the centre rib's inboard ones come with
// the mirrored half. Returns [{ rib, name, edge, side, tri: [[s, x] × 3] }].
function gussetTriangles(a, structure, parts) {
  const st = structure
  const g = st.gussets
  if (!gussetEdges(st).length || !(g.size > 0)) return []
  const out = []
  const clampS = (s) => Math.min(a.tipS, Math.max(a.rootS, s))
  // Where there's room for one (ribs.js gussetsAt), the centre rib's inboard ones left to the
  // mirrored half
  for (const { part: p, edge, side } of gussetsAt(a, st, parts)) {
    const r = p.rib
    const ang = (r.angle * Math.PI) / 180
    const d = [Math.sin(ang), Math.cos(ang)] // along the rib, aft, in plan (s, x)
    const nrm = [Math.cos(ang), -Math.sin(ang)] // across the rib, outboard
    const P = [p.s, a.sparX(p.s)]
    const centre = p.s < 1e-9 && st.ribs.rootJoint !== 'two-piece'
    if (centre && side < 0) continue
    const stockX = (s) => {
      const sec = a.section(clampS(s))
      return edge === 'le' ? sec.xl + st.le.width : sec.xl + sec.c - st.te.width
    }
    const at = (u) => [P[0] + d[0] * (u - r.sparU) + (nrm[0] * side * p.thickness) / 2, P[1] + d[1] * (u - r.sparU) + (nrm[1] * side * p.thickness) / 2]
    // The corner: where this face of the rib meets the stock
    const guess = edge === 'le' ? r.uA : r.uB
    let lo = guess - 0.02
    let hi = guess + 0.02
    const f = (u) => at(u)[1] - stockX(at(u)[0])
    if (Math.sign(f(lo)) !== Math.sign(f(hi))) {
      for (let i = 0; i < 50; i++) {
        const m = (lo + hi) / 2
        if (Math.sign(f(m)) === Math.sign(f(lo))) lo = m
        else hi = m
      }
    }
    const C = at((lo + hi) / 2)
    const A = [C[0] + d[0] * (edge === 'le' ? g.size : -g.size), C[1] + d[1] * (edge === 'le' ? g.size : -g.size)]
    const h = 1e-4
    const slope = (stockX(C[0] + h) - stockX(C[0] - h)) / (2 * h)
    const e = [1 / Math.hypot(1, slope), slope / Math.hypot(1, slope)]
    const B = [C[0] + e[0] * side * g.size, C[1] + e[1] * side * g.size]
    out.push({ rib: p.id, name: p.name, edge, side, tri: [C, A, B] })
  }
  return out
}

// The faces a gusset is flush with: the lowest point of the inset upper surface over its
// triangle, and the highest of the lower one. The room between is what it has to sit in.
function gussetFaces(a, structure, tri) {
  const at = (s, x, which) => insetHeight(a, structure, Math.min(a.tipS, Math.max(a.rootS, s)), x, which)
  const up = Math.min(...tri.map(([s, x]) => at(s, x, 'upper')))
  const lo = Math.max(...tri.map(([s, x]) => at(s, x, 'lower')))
  return { up, lo }
}

// Room for the corner gussets at each edge: the least depth between the inset surfaces over
// any gusset there, and which placements fit ('top' and 'bottom' need one thickness, 'both'
// two). { le: { room, fits: { top, bottom, both }, short: [rib names] } | null, te: ... }
export function gussetFit(a, structure, parts) {
  const g = structure.gussets
  const out = { le: null, te: null }
  for (const t of gussetTriangles(a, structure, parts)) {
    const { up, lo } = gussetFaces(a, structure, t.tri)
    const room = up - lo
    const cur = (out[t.edge] ??= { room: Infinity, rooms: new Map() })
    cur.room = Math.min(cur.room, room)
    cur.rooms.set(t.name, Math.min(cur.rooms.get(t.name) ?? Infinity, room))
  }
  for (const edge of ['le', 'te']) {
    const cur = out[edge]
    if (!cur) continue
    const need = (layer) => (layer === 'both' ? 2 : 1) * g.thickness
    const layer = gussetLayer(g, edge)
    out[edge] = {
      room: cur.room,
      fits: { top: cur.room >= need('top') - 1e-9, bottom: cur.room >= need('bottom') - 1e-9, both: cur.room >= need('both') - 1e-9 },
      short: [...cur.rooms].filter(([, r]) => r < need(layer) - 1e-9).map(([n]) => n),
    }
  }
  return out
}

// Corner gussets as small prisms, flush with the rib's top edge, bottom edge or both (kept
// under the inset surface, so clear of sheeting, cap strips and covering).
export function gussetPrisms(a, structure, parts) {
  const g = structure.gussets
  if (!(g.thickness > 0)) return []
  const out = []
  for (const t of gussetTriangles(a, structure, parts)) {
    const layer = gussetLayer(g, t.edge)
    const { up, lo } = gussetFaces(a, structure, t.tri)
    for (const which of layer === 'both' ? ['upper', 'lower'] : [layer === 'bottom' ? 'lower' : 'upper']) {
      const [h0, h1] = which === 'upper' ? [up - g.thickness, up] : [lo, lo + g.thickness]
      const ring = (hh) => t.tri.map(([s, x]) => worldPoint(a, s, x, hh))
      out.push({ kind: 'gusset', rib: t.rib, edge: t.edge, side: t.side, layer: which, ...loft([ring(h0), ring(h1)], { closed: true, caps: 'fan' }) })
    }
  }
  return out
}

// The Mylar hinge tabs as thin flat plates, each tabWidth along the hinge by tabLength across
// it, centred on the hinge line at its centre line (midway between the skins), half into each
// hinge spar.
export function hingeTabPlates(a, structure) {
  const h = structure.hinges
  const t = h?.tabThickness || 0.0002
  if (!(h?.tabWidth > 0) || !(h?.tabLength > 0)) return []
  const out = []
  for (const sf of (a.surfaces ?? []).filter((x) => x.ok)) {
    for (const s of sf.tabs ?? []) {
      const x = sf.hingeX(s)
      const mid = (insetHeight(a, structure, s, x, 'upper', false) + insetHeight(a, structure, s, x, 'lower', false)) / 2
      const hw = h.tabWidth / 2
      const hl = h.tabLength / 2
      const corners = [
        [s - hw, x - hl],
        [s + hw, x - hl],
        [s + hw, x + hl],
        [s - hw, x + hl],
      ]
      const ring = (hh) => corners.map(([cs, cx]) => worldPoint(a, Math.min(a.tipS, Math.max(a.rootS, cs)), cx, hh))
      out.push({ kind: 'tab', surface: sf.id, ...loft([ring(mid - t / 2), ring(mid + t / 2)], { closed: true, caps: 'fan' }) })
    }
  }
  return out
}

// Dihedral braces as flat plates on the spar's front and rear faces, shaped to the break as
// exported. In this half only: a centre brace's other arm comes with the mirrored half.
export function bracePlates(a, structure, parts) {
  const sp = structure.spar
  const out = []
  for (const p of parts.filter((q) => q.group === 'braces' && q.at)) {
    const { s: sb, inner, outer, depths, centre } = p.at
    const t = p.thickness
    const [front, rear] = lineFaces(a.sparX, sparWidth(sp))
    const [outFront, outRear] = lineFaces(a.sparX, sparWidth(sp) + 2 * t)
    const mid = (s) => {
      const x = a.sparX(s)
      return (insetHeight(a, structure, s, x, 'upper') + insetHeight(a, structure, s, x, 'lower')) / 2
    }
    // Plate outline in (s, h): inner arm (not for a centre brace), the break, the outer arm
    const stations = [...(centre || !(inner > 0) ? [] : [[sb - inner, depths[0]]]), [sb, depths[1]], [sb + outer, depths[2]]]
    const shape = [...stations.map(([s, dd]) => [s, mid(s) - dd / 2]), ...[...stations].reverse().map(([s, dd]) => [s, mid(s) + dd / 2])]
    for (const [x0, x1] of [
      [outFront, front],
      [rear, outRear],
    ]) {
      const ring = (xf) => shape.map(([s, hh]) => worldPoint(a, s, xf(s), hh))
      out.push({ kind: 'brace', part: p.id, ...loft([ring(x0), ring(x1)], { closed: true, caps: 'fan' }) })
    }
  }
  return out
}

// Where a rib part sits: a function giving the column-major 4×4 matrix that places something
// of a given width across the rib, reaching `outer` outboard of the rib's centre plane, with
// the rib's (u, z) in local X, Y and the width along local Z.
export function ribPlacement(a, p) {
  const r = p.rib
  const g = angleAt(a, p.s)
  const ang = r.angle * RAD
  const ds = Math.sin(ang)
  const dx = Math.cos(ang)
  const eu = [ds * Math.cos(g), ds * Math.sin(g), dx]
  const ez = [-Math.sin(g), Math.cos(g), 0]
  const ew = [-dx * Math.cos(g), -dx * Math.sin(g), ds] // points inboard, so the width starts at -outer
  const w = a.sampler.at(p.s)
  const P = [w.y, w.z, a.sparX(p.s)] // the spar point, h = 0
  return (width, outer = width / 2) => {
    const O = [0, 1, 2].map((k) => P[k] - eu[k] * r.sparU - ew[k] * outer)
    return [...eu, 0, ...ez, 0, ...ew, 0, ...O, 1]
  }
}

// The built-up half wing: skin, spar, webs, edge stock and stringers as meshes, and every rib
// as its outline (with holes) plus a column-major 4×4 matrix placing its plane, rib (u, z)
// in local X, Y and its thickness along local Z.
export function wing3d(a, structure, parts) {
  const st = structure
  const sp = st.spar
  // Spanwise parts run to the outer faces of the end ribs: the tip rib, and the root rib of
  // a two-piece wing (a one-piece wing's centre rib is shared, so parts stop at its middle)
  const halfRib = (st.ribs.thickness || 0) / 2
  const ends = [st.ribs.rootJoint === 'two-piece' ? halfRib : 0, halfRib]
  const s0 = a.rootS
  const s1 = a.tipS
  const solids = []
  // pick: which part a solid stands for (see partFor); piece: which piece of the wing it is,
  // { id, name, material }, for selecting and inspecting it on its own (see wingPieces). A
  // piece may be several solids (a servo's case, lugs, boss and lead).
  const add = (kind, mesh, pick = null, piece = null) => mesh && solids.push({ kind, ...mesh, ...(pick ? { pick } : {}), ...(piece ? { piece } : {}) })
  const ribName = (id) => parts.find((p) => p.id === id)?.name ?? id

  // Spar, then the shear webs: separate pieces between the ribs, as they're fitted
  const sparEnd = sp.type === 'tube' && Number.isFinite(sp.tubeLength) ? Math.min(s1, s0 + sp.tubeLength) : s1
  const nSpar = sparBoxes(a, st, s0).length
  const sparEnds = [ends[0], sparEnd < s1 - 1e-9 ? 0 : ends[1]]
  if (sp.type === 'tube' && tubeBore(a, st, s0)) {
    const outer = sweepRings(a, s0, sparEnd, (s) => sparBoxes(a, st, s)[0], 40, sparEnds)
    const inner = sweepRings(a, s0, sparEnd, (s) => tubeBore(a, st, s), 40, sparEnds)
    if (outer && inner && outer.length === inner.length) add('spar', tubeLoft(outer, inner), null, { id: 'spar', name: 'Spar tube', material: sp.tubeMaterial, section: { outline: sparBoxes(a, st, (s0 + sparEnd) / 2)[0], holes: [tubeBore(a, st, (s0 + sparEnd) / 2)].filter(Boolean) } })
  } else {
    const caps = sp.type === 'caps' || sp.type === 'box'
    for (let k = 0; k < nSpar; k++) {
      const piece = caps ? { id: `spar-${k ? 'bottom' : 'top'}`, name: `Spar cap, ${k ? 'bottom' : 'top'}`, material: sp.capMaterial, section: { outline: sparBoxes(a, st, (s0 + sparEnd) / 2)[k] } } : { id: 'spar', name: 'Spar', material: sp.solidMaterial, section: { outline: sparBoxes(a, st, (s0 + sparEnd) / 2)[k] } }
      add('spar', sweep(a, s0, sparEnd, (s) => sparBoxes(a, st, s)[k], 40, { extend: sparEnds }), null, piece)
    }
  }
  const ribList = parts.filter((p) => p.group === 'ribs').sort((p, q) => p.s - q.s)
  for (let i = 1; i < ribList.length; i++) {
    const from = ribList[i - 1].s + ribList[i - 1].thickness / 2
    const to = ribList[i].s - ribList[i].thickness / 2
    if (to - from < 0.001) continue
    const n = webBoxes(a, st, from).length
    for (let k = 0; k < n; k++) {
      const piece = { id: `web-${i}-${k}`, name: `Shear web, ${ribList[i - 1].name} to ${ribList[i].name}${n > 1 ? (k ? ', rear' : ', front') : ''}`, material: sp.webMaterial }
      add('web', sweep(a, from, to, (s) => webBoxes(a, st, s)[k], 4), { ids: [`W${i}`] }, piece)
    }
  }

  // Sheeting, then the leading and trailing edge stock
  const cov = st.covering
  if (cov.type !== 'open' && cov.sheetThickness > 0) {
    // A sheet per panel, as each is cut
    const runs = panelRuns(a)
    for (const which of ['upper', 'lower']) {
      runs.forEach((r, k) => {
        const ext = [k === 0 ? ends[0] : 0, k === runs.length - 1 ? ends[1] : 0]
        const piece = { id: `sheet-${which}-${k}`, name: `${which === 'upper' ? 'Top' : 'Bottom'} ${isFoam(st) ? 'skin' : 'sheeting'}, ${r.name}`, material: isFoam(st) ? st.foam?.skin?.material : cov.sheetMaterial, at: (r.from + r.to) / 2 }
        add('sheet', sweep(a, r.from, r.to, (s) => sheetSection(a, st, s, which), 20, { extend: ext, caps: 'strip' }), { groups: ['sheeting', 'skins'], surface: which }, piece)
      })
    }
  }
  // Sheeted hard points, over the ribs at their ends and the bays between
  for (const h of hardPatches(st, a.rootS)) {
    for (const side of h.sides) {
      const which = side === 'top' ? 'upper' : 'lower'
      add('sheet', sweep(a, h.s0, h.s1, (s) => patchSection(a, st, s, which), 12, { caps: 'strip' }), { ids: [`HP${h.id}${side === 'top' ? 'T' : 'B'}`] }, { id: `patch-${h.id}-${side}`, name: `${side === 'top' ? 'Top' : 'Bottom'} sheeting over ${h.label}`, material: patchSheet(st).material })
    }
  }
  add('le', sweep(a, s0, s1, (s) => leSection(a, st, s), 40, { extend: ends }), null, { id: 'le', name: 'Leading edge', material: st.le.material, section: { outline: leSection(a, st, (s0 + s1) / 2) } })
  // The trailing edge: the wing's, broken where each control surface's own runs, between the
  // surface's end ribs' outer faces
  const surfaces = (a.surfaces ?? []).filter((x) => x.ok).sort((p, q) => p.s0 - q.s0)
  let from = s0
  let fromExt = ends[0]
  let fromName = 'the root'
  const teMat = st.te.material
  for (const sf of surfaces) {
    add('te', sweep(a, from, sf.s0, (s) => teSection(a, st, s), 20, { extend: [fromExt, halfRib] }), null, { id: `te-${sf.id}`, name: `Trailing edge, ${fromName} to ${sf.label}`, material: teMat, section: { outline: teSection(a, st, (from + sf.s0) / 2) } })
    fromName = sf.label
    from = sf.s1
    fromExt = halfRib
    add('teMoving', sweep(a, sf.moving[0], sf.moving[1], (s) => (sf.stock ? stockSurfaceSection(a, st, sf, s) : teSection(a, st, s)), 20), null, { id: `teMoving-${sf.id}`, name: sf.stock ? `${sf.label}, cut from the trailing edge stock` : `Trailing edge, ${sf.label}`, material: teMat, section: { outline: sf.stock ? stockSurfaceSection(a, st, sf, (sf.moving[0] + sf.moving[1]) / 2) : teSection(a, st, (sf.moving[0] + sf.moving[1]) / 2) } })
    // The hinge spars: the fixed side's between the end ribs' faces, the moving side's across
    // the moving surface
    add('hinge', sweep(a, sf.fixed[0], sf.fixed[1], (s) => hingeSparSection(a, st, sf, s), 12), null, { id: `hinge-${sf.id}`, name: `Hinge spar, fixed side, ${sf.label}`, material: st.hinges.material, section: { outline: hingeSparSection(a, st, sf, (sf.fixed[0] + sf.fixed[1]) / 2) } })
    if (!sf.stock) add('hingeMoving', sweep(a, sf.moving[0], sf.moving[1], (s) => movingSparSection(a, st, sf, s), 12), null, { id: `hingeMoving-${sf.id}`, name: `Hinge spar, moving side, ${sf.label}`, material: st.hinges.material, section: { outline: movingSparSection(a, st, sf, (sf.moving[0] + sf.moving[1]) / 2) } })
  }
  add('te', sweep(a, from, s1, (s) => teSection(a, st, s), 40, { extend: [fromExt, ends[1]] }), null, { id: 'te', name: surfaces.length ? `Trailing edge, ${fromName} to the tip` : 'Trailing edge', material: teMat, section: { outline: teSection(a, st, (from + s1) / 2) } })

  // A foam wing's core: from the leading edge stock to the trailing edge stock, stopping at the
  // fixed hinge spar along each control surface, whose own core runs from its hinge spar back;
  // and its shear web, the whole span
  if (isFoam(st)) {
    const sec = (s) => a.section(s)
    const front = (s) => sec(s).xl + Math.min(st.le.width || 0, sec(s).c / 2)
    const teFront = (s) => sec(s).xl + sec(s).c - Math.min(st.te.width || 0, sec(s).c / 2)
    // A core is picked as its nearer hot-wire template
    const templates = { groups: ['templates'] }
    let at = s0
    let k = 0
    const core = (id, name, coreAt) => ({ id: `core-${id}`, name, material: st.foam?.core, coreAt })
    for (const sf of surfaces) {
      add('core', sweep(a, at, sf.s0, (s) => coreSection(a, st, s, front(s), teFront(s)), 40), templates, core(k++, 'Foam core, inboard of ' + sf.label, (at + sf.s0) / 2))
      add('core', sweep(a, sf.s0, sf.s1, (s) => coreSection(a, st, s, front(s), sf.faces.fixedFront(s)), 12), templates, core(k++, `Foam core, ahead of ${sf.label}`, (sf.s0 + sf.s1) / 2))
      if (!sf.stock) add('coreMoving', sweep(a, sf.moving[0], sf.moving[1], (s) => coreSection(a, st, s, sf.faces.movingRear(s), teFront(s), 8), 12), templates, core(`${sf.id}-moving`, `Foam core, ${sf.label}`, (sf.moving[0] + sf.moving[1]) / 2))
      at = sf.s1
    }
    add('core', sweep(a, at, s1, (s) => coreSection(a, st, s, front(s), teFront(s)), 40), templates, core(k++, surfaces.length ? 'Foam core, outboard' : 'Foam core', (at + s1) / 2))
    if (sp.webThickness > 0) add('web', sweep(a, s0, s1, (s) => webBoxes(a, st, s)[0], 40), null, { id: 'web', name: 'Shear web', material: sp.webMaterial, section: { outline: webBoxes(a, st, (s0 + s1) / 2)[0] } })
  }

  // Servo bays: each servo, standing on the lower skin's inside, drawn from its maker's drawing
  // (servos.js placeServo: case, lugs, output boss, lead), and the mount plate across the bay on
  // its lugs, round its cut-out
  for (const b of (a.bays ?? []).filter((x) => x.ok)) {
    const rect = (x0, x1, z0, z1) => [[x0, z0], [x1, z0], [x1, z1], [x0, z1]]
    const { parts: sp, plate } = servoBayParts(a, st, b)
    // The plate is cut as the bay's plate part (a foam wing's: the pocket's template); the servo is bought
    const pick = { ids: [b.name, `${b.name}-T`] }
    const servo = { id: `servo-${b.name}`, name: `${b.servo.label} servo, ${b.name}`, servo: b.servo }
    const platePiece = { id: `plate-${b.name}`, name: `Servo plate, ${b.name}`, material: 'ply-birch' }
    for (const p of sp) add(p.kind, servoSolid(a, p), null, servo)
    for (const [x0, x1, s0, s1] of plate.strips) add('plate', sweep(a, s0, s1, () => rect(x0, x1, plate.z, plate.z + plate.thickness), 1), pick, platePiece)
  }

  // Air brakes: a blade brake's box walls, with its blades drawn raised through the covering;
  // a spoiler's plate drawn open on its front-edge hinge
  for (const r of (a.brakes ?? []).filter((x) => x.ok)) {
    const rect = (x0, x1, z0, z1) => [[x0, z0], [x1, z0], [x1, z1], [x0, z1]]
    if (r.type === 'blade') {
      r.walls.forEach((w, k) => {
        const xm = (w.x0 + w.x1) / 2
        add('brakeBox', sweep(a, r.inner[0], r.inner[1], (s) => rect(w.x0, w.x1, insetHeight(a, st, s, xm, 'lower'), insetHeight(a, st, s, xm, 'upper')), 1), { ids: [`${r.name}-${k ? 'R' : 'F'}`, `${r.name}-T`] }, { id: `${r.name}-wall-${k}`, name: `${r.label}, ${k ? 'rear' : 'front'} wall`, material: 'ply-birch' })
      })
      bladeXs(r).forEach((x, bi) => {
        const hw = BRAKE.bladeThickness / 2
        for (const which of r.surfaces) {
          const sec = (s) => {
            const z = surfaceHeight(a, s, x, which)
            return which === 'upper' ? rect(x - hw, x + hw, z - 0.3 * r.height, z + r.height) : rect(x - hw, x + hw, z - r.height, z + 0.3 * r.height)
          }
          add('blade', sweep(a, r.s - r.length / 2, r.s + r.length / 2, sec, 1), { ids: [`${r.name}-B`, `${r.name}-T`] }, { id: `${r.name}-blade-${bi}-${which}`, name: `${r.label}, blade ${bi + 1}${r.surfaces.length > 1 ? (which === 'upper' ? ', top' : ', bottom') : ''}`, material: 'ply-birch' })
        }
      })
    } else {
      const th = Math.max(BRAKE.plate, 0.0015)
      const ca = Math.cos(r.angle * RAD)
      const sa = Math.sin(r.angle * RAD)
      const plate = (s) => {
        const z = surfaceHeight(a, s, r.x0, 'upper')
        const p0 = [r.x0, z]
        const p1 = [r.x0 + r.chord * ca, z + r.chord * sa]
        return [p0, p1, [p1[0] - th * sa, p1[1] + th * ca], [p0[0] - th * sa, p0[1] + th * ca]]
      }
      add('blade', sweep(a, r.s - r.length / 2, r.s + r.length / 2, plate, 1), { ids: [`${r.name}-P`, `${r.name}-T`] }, { id: `${r.name}-plate`, name: `${r.label}, plate`, material: 'ply-birch' })
    }
  }

  // Stringers, seated in their rib notches
  for (const str of st.stringers ?? []) {
    if (!Number.isFinite(str.position) || !(str.width > 0) || !(str.height > 0)) continue
    for (const which of ['upper', 'lower']) {
      if (str.surface !== 'both' && str.surface !== which) continue
      add('stringer', sweep(a, s0, s1, (s) => stringerBox(a, st, str, s, which), 40, { extend: ends }), null, { id: `stringer-${str.id}-${which}`, name: `Stringer at ${Math.round(str.position * 100)}% chord, ${which === 'upper' ? 'top' : 'bottom'}`, material: str.material, section: { outline: stringerBox(a, st, str, (s0 + s1) / 2, which) } })
    }
  }

  // Ribs: placed by their plane's basis at the spar point. Cap strips sit on them, centred,
  // from the LE stock (or the D-box) to the TE stock, between the outer and inset surfaces.
  const ribs = []
  const capStrips = []
  const strips = cov.capStrips && cov.type !== 'sheeted' && cov.capStripThickness > 0 && cov.capStripWidth > 0
  for (const p of parts.filter((q) => q.group === 'ribs' || q.group === 'surfaces')) {
    const r = p.rib
    const t = p.thickness
    const place = ribPlacement(a, p)
    const centre = p.s < 1e-9 && st.ribs.rootJoint !== 'two-piece' // shared by both halves
    // surface: one of a control surface's own ribs, drawn with it
    ribs.push({ id: p.id, name: p.name, kind: p.kind, outline: p.outline, holes: p.holes, thickness: t, matrix: place(t), centre, surface: p.group === 'surfaces' })
    if (strips && r.surfaces) {
      const { us, up, lo, upIn, loIn } = r.surfaces
      const at = (arr, u) => {
        let i = 1
        while (i < us.length - 1 && us[i] < u) i++
        const f = (u - us[i - 1]) / (us[i] - us[i - 1] || 1)
        return arr[i - 1] + (arr[i] - arr[i - 1]) * f
      }
      const to0 = r.uB
      const n = 40
      for (const [outer, inner, side] of [
        [up, upIn, 'top'],
        [lo, loIn, 'bottom'],
      ]) {
        // Each surface's strips start behind its own sheeting (from the LE where that side is open)
        const from = r.capStripFrom[side]
        // ... and end at the rib's end, or where a turned trailing-edge face meets this side
        const to = r.capStripTo?.[side] ?? to0
        if (!(to > from)) continue
        // Its ends: square, or cut along a turned edge's face (outer and inner ends apart)
        const ends = r.capStripEnds?.[side] ?? { from: [from, from], to: [to, to] }
        const run = (a0, a1) => Array.from({ length: n + 1 }, (_, i) => a0 + ((a1 - a0) * i) / n)
        const outline = [...run(ends.from[0], ends.to[0]).map((u) => [u, at(outer, u)]), ...run(ends.from[1], ends.to[1]).reverse().map((u) => [u, at(inner, u)])]
        // Centred on the rib, except on end ribs, where it's flush with the outer face; the
        // centre rib's is split between the halves (the other half comes with the mirror)
        const cw = cov.capStripWidth
        const tip = p.kind === 'tip'
        const root = p.kind === 'root' && st.ribs.rootJoint === 'two-piece'
        const width = centre ? cw / 2 : cw
        const reach = tip ? t / 2 : root ? -t / 2 + cw : cw / 2
        capStrips.push({ id: `${p.id}-cs-${side}`, name: `Cap strip, ${p.name}, ${side}`, material: cov.capStripMaterial, outline, holes: [], thickness: width, matrix: place(width, reach), surface: p.group === 'surfaces' })
      }
    }
  }

  // Bounds, for framing the camera
  const lo = [Infinity, Infinity, Infinity]
  const hi = [-Infinity, -Infinity, -Infinity]
  const sk = skin(a, st)
  for (let i = 0; i < sk.positions.length; i += 3) {
    for (let k = 0; k < 3; k++) {
      lo[k] = Math.min(lo[k], sk.positions[i + k])
      hi[k] = Math.max(hi[k], sk.positions[i + k])
    }
  }
  // A centre rib's gusset seen in the other half is the one on its other face
  const centreRib = (id) => parts.some((p) => p.id === id && p.s < 1e-9 && st.ribs.rootJoint !== 'two-piece')
  for (const g of gussetPrisms(a, st, parts)) {
    const pick = { member: `${g.rib}:${g.edge}:${g.side}` }
    if (centreRib(g.rib)) pick.mirrorMember = `${g.rib}:${g.edge}:${-g.side}`
    const both = gussetLayer(st.gussets, g.edge) === 'both'
    const name = `Gusset at ${ribName(g.rib)}, ${g.edge === 'le' ? 'leading' : 'trailing'} edge, ${g.side > 0 ? 'outboard' : 'inboard'}${both ? (g.layer === 'upper' ? ', top' : ', bottom') : ''}`
    solids.push({ ...g, pick, piece: { id: `gusset-${g.rib}-${g.edge}-${g.side}-${g.layer}`, name, material: st.gussets.material } })
  }
  const braceFaces = {}
  for (const b of bracePlates(a, st, parts)) {
    const k = (braceFaces[b.part] = (braceFaces[b.part] ?? 0) + 1)
    solids.push({ ...b, pick: { ids: [b.part] }, piece: { id: `brace-${b.part}-${k}`, name: `Dihedral brace ${b.part}, ${k === 1 ? 'front' : 'rear'}`, material: parts.find((p) => p.id === b.part)?.material } })
  }
  const tabsOn = {}
  for (const t of hingeTabPlates(a, st)) {
    const k = (tabsOn[t.surface] = (tabsOn[t.surface] ?? 0) + 1)
    const sf = surfaces.find((x) => x.id === t.surface)
    solids.push({ ...t, pick: { ids: ['H1'] }, piece: { id: `tab-${t.surface}-${k}`, name: `Mylar hinge tab ${k}, ${sf?.label ?? 'control surface'}`, material: 'mylar' } })
  }
  const tip = tipBlock(a, st)
  if (tip) solids.push({ kind: 'tip', ...tip, pick: { ids: ['T1'] }, piece: { id: 'tip', name: 'Tip block', material: 'balsa-light' } })
  return { skin: sk, solids, ribs, capStrips, bounds: { min: lo, max: hi } }
}

// The part a solid of the 3D view stands for (its pick, from wing3d), where it's picked at span
// s, as the part's id, or null: one of a list of ids (the first that's a part), the part a gusset
// is one of (its members; mirrored, in the other half, its mirrorMember if it has one), or of
// the parts in some groups (on the same surface, if they say), the one whose span is nearest s,
// and of those the one whose station s is nearest (a core's two hot-wire templates).
export function partFor(parts, pick, s, { mirrored = false } = {}) {
  if (!pick) return null
  if (pick.ids) return pick.ids.find((id) => parts.some((p) => p.id === id)) ?? null
  if (pick.member) {
    const m = mirrored && pick.mirrorMember ? pick.mirrorMember : pick.member
    return parts.find((p) => p.members?.includes(m))?.id ?? null
  }
  let best = null
  let bestD = [Infinity, Infinity]
  for (const p of parts) {
    if (!pick.groups?.includes(p.group)) continue
    if (pick.surface && p.surface && p.surface !== pick.surface) continue
    const [lo, hi] = p.span ?? (Number.isFinite(p.s) ? [p.s, p.s] : [-Infinity, Infinity])
    const d = [s < lo ? lo - s : s > hi ? s - hi : 0, Number.isFinite(p.s) ? Math.abs(s - p.s) : 0]
    if (d[0] < bestD[0] - 1e-12 || (Math.abs(d[0] - bestD[0]) <= 1e-12 && d[1] < bestD[1])) {
      best = p.id
      bestD = d
    }
  }
  return best
}

// The wing's panels along the flat span, root outward, as the cut list names them: the centre
// section (when there is one) and each panel, { name, from, to }.
export function panelRuns(a) {
  const out = []
  const half = a.sampler.half
  if (a.rootS < half - 1e-6) out.push({ name: 'centre section', from: a.rootS, to: half })
  a.sampler.ends.forEach((e, i) => {
    const from = Math.max(a.rootS, e.inner.s)
    if (e.outer.s - from > 1e-4) out.push({ name: `panel ${i + 1}`, from, to: e.outer.s })
  })
  return out
}

// Every piece of the wing the 3D view draws, for selecting and inspecting it on its own: { id,
// name, kind, material, part (the part it's cut as, when it is one: a rib, gusset, web, plate,
// a panel's sheet and so on; null for strip stock, a servo, a core), solids (indices into
// model.solids), rib (a model.ribs entry) or capStrip (a model.capStrips entry) }. A rib's
// piece is the rib part itself, so ids shared with the plan select the same thing.
export function wingPieces(model, parts) {
  const out = []
  const byId = new Map()
  model.solids.forEach((s, i) => {
    if (!s.piece) return
    let p = byId.get(s.piece.id)
    if (!p) {
      const part = s.pick ? partFor(parts, s.pick, s.piece.at ?? 0) : null
      p = { id: s.piece.id, name: s.piece.name, kind: s.kind, material: s.piece.material ?? null, part, solids: [], section: s.piece.section ?? null, coreAt: s.piece.coreAt ?? null, servo: s.piece.servo ?? null }
      byId.set(p.id, p)
      out.push(p)
    }
    p.solids.push(i)
  })
  for (const r of model.ribs) out.push({ id: r.id, name: r.name, kind: 'rib', material: parts.find((p) => p.id === r.id)?.material ?? null, part: r.id, solids: [], rib: r })
  for (const c of model.capStrips) out.push({ id: c.id, name: c.name, kind: 'capStrip', material: c.material, part: null, solids: [], capStrip: c })
  return out
}

// A piece's silhouette for a thumbnail, as [u, v] points: a rib's or cap strip's own outline,
// or the convex hull of its solids' points seen square to their two longest dimensions.
export function pieceOutline(model, piece) {
  if (piece.rib) return piece.rib.outline
  if (piece.capStrip) return piece.capStrip.outline
  const pts = []
  for (const i of piece.solids) {
    const pos = model.solids[i].positions
    const n = pos.length / 3
    const step = Math.max(1, Math.floor(n / 1500))
    for (let k = 0; k < n; k += step) pts.push([pos[3 * k], pos[3 * k + 1], pos[3 * k + 2]])
  }
  if (pts.length < 3) return []
  const ext = [0, 1, 2].map((k) => Math.max(...pts.map((p) => p[k])) - Math.min(...pts.map((p) => p[k])))
  const [a1, a2] = [0, 1, 2].sort((p, q) => ext[q] - ext[p])
  // World y is up: keep it the second axis when it's one of the two, so the picture stands up
  const [u, v] = a1 === 1 ? [a2, a1] : [a1, a2]
  const flat = pts.map((p) => [p[u], p[v]]).sort((p, q) => p[0] - q[0] || p[1] - q[1])
  const cross = (o, p, q) => (p[0] - o[0]) * (q[1] - o[1]) - (p[1] - o[1]) * (q[0] - o[0])
  const half = (list) => {
    const h = []
    for (const p of list) {
      while (h.length >= 2 && cross(h.at(-2), h.at(-1), p) <= 0) h.pop()
      h.push(p)
    }
    return h
  }
  const lower = half(flat)
  const upper = half([...flat].reverse())
  return [...lower.slice(0, -1), ...upper.slice(0, -1)]
}

// The flat span station s of a point in the half wing's world coordinates: where the span
// plane through it is (bisection on spanPlane between the root and the wing's reach).
export function spanOf(a, point) {
  const side = (s) => {
    const { point: q, normal: n } = spanPlane(a, s)
    return (point[0] - q[0]) * n[0] + (point[1] - q[1]) * n[1] + (point[2] - q[2]) * n[2]
  }
  let lo = a.rootS
  let hi = Math.max(a.tipS, a.sampler.reach ?? a.tipS)
  const f0 = side(lo)
  if (Math.sign(side(hi)) === Math.sign(f0)) return Math.abs(f0) < Math.abs(side(hi)) ? lo : hi
  for (let i = 0; i < 50; i++) {
    const m = (lo + hi) / 2
    if (Math.sign(side(m)) === Math.sign(f0)) lo = m
    else hi = m
  }
  return (lo + hi) / 2
}

// Apply a column-major 4×4 matrix to a point (the tests, and the wireframe thumbnail).
export function applyMatrix(m, [x, y, z]) {
  return [m[0] * x + m[4] * y + m[8] * z + m[12], m[1] * x + m[5] * y + m[9] * z + m[13], m[2] * x + m[6] * y + m[10] * z + m[14]]
}
