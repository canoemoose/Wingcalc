// 3D geometry of the built-up half wing, for the 3D view. Pure data (positions, indices and
// placement matrices), no rendering library, so it can be tested; the view turns it into
// meshes.
//
// World axes, metres: X spanwise outward (projected, so dihedral shows), Y up, Z chordwise
// aft from the root leading edge. A point on the wing is given by its flat spanwise distance
// s, chordwise x and height h above its panel's chord plane; dihedral tilts that plane.
// Washout rotates each section about the spar line (TE up), as in ribs.js, so the skin and
// the ribs agree.

import { skinAt, sparWidth, lineFaces } from './structure.js'

const RAD = Math.PI / 180

// Panel dihedral at s; on a panel break, the mean of the two (where the break rib sits).
function angleAt(a, s) {
  const e = 1e-5
  const lo = a.sampler.at(Math.max(0, s - e))
  const hi = a.sampler.at(Math.min(a.sampler.reach, s + e))
  return ((lo?.rad ?? 0) + (hi?.rad ?? lo?.rad ?? 0)) / 2
}

// World position of (s, x, h). At a dihedral break the section lies on the bisector of the
// two panels, where the break rib is, so both panels meet it cleanly.
export function worldPoint(a, s, x, h) {
  const w = a.sampler.at(Math.min(a.sampler.reach, Math.max(0, s)))
  const g = angleAt(a, s)
  return [w.y - h * Math.sin(g), w.z + h * Math.cos(g), x]
}

// Height of the upper or lower surface at (s, x), with washout.
function surfaceHeight(a, s, x, which) {
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

// The outer skin, root to the tip of a rounded tip, as one closed loft.
function skin(a, n = 60, chordPts = 36) {
  const xs = cosine(chordPts)
  const rings = []
  for (const s of stations(a, a.rootS, a.sampler.reach, n)) {
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
  return loft(rings, { closed: true, caps })
}

// Height of the inset surface at (s, x): the outer surface less the skin over the ribs there,
// measured square to the surface, exactly as the ribs are inset (ribs.js).
export function insetHeight(a, structure, s, x, which) {
  const sec = a.section(s)
  const rear = (a.sparX(s) + sparWidth(structure.spar) / 2 - sec.xl) / sec.c
  const d = 1e-4
  const slope = (surfaceHeight(a, s, x + d, which) - surfaceHeight(a, s, x - d, which)) / (2 * d)
  const t = skinAt(structure, (x - sec.xl) / sec.c, rear) * Math.sqrt(1 + slope * slope)
  return surfaceHeight(a, s, x, which) + (which === 'upper' ? -t : t)
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

// The shear web(s) at s: on the caps' front face (and rear, for a box), between the caps.
export function webBoxes(a, structure, s) {
  const sp = structure.spar
  if (sp.type !== 'caps' && sp.type !== 'box') return []
  const [up, lo] = sparBoxes(a, structure, s)
  const [front, rear] = lineFaces(a.sparX, sparWidth(sp))
  const [outFront, outRear] = lineFaces(a.sparX, sparWidth(sp) + 2 * sp.webThickness)
  const h0 = lo[2][1] // top of the lower cap
  const h1 = up[0][1] // bottom of the upper cap
  const box = (xa, xb) => [
    [xa, h0],
    [xb, h0],
    [xb, h1],
    [xa, h1],
  ]
  const out = [box(outFront(s), front(s))]
  if (sp.type === 'box') out.push(box(rear(s), outRear(s)))
  return out
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
  const add = (kind, mesh) => mesh && solids.push({ kind, ...mesh })

  // Spar, then the shear webs: separate pieces between the ribs, as they're fitted
  const sparEnd = sp.type === 'tube' && Number.isFinite(sp.tubeLength) ? Math.min(s1, s0 + sp.tubeLength) : s1
  const nSpar = sparBoxes(a, st, s0).length
  const sparEnds = [ends[0], sparEnd < s1 - 1e-9 ? 0 : ends[1]]
  for (let k = 0; k < nSpar; k++) add('spar', sweep(a, s0, sparEnd, (s) => sparBoxes(a, st, s)[k], 40, { extend: sparEnds }))
  const ribList = parts.filter((p) => p.group === 'ribs').sort((p, q) => p.s - q.s)
  for (let i = 1; i < ribList.length; i++) {
    const from = ribList[i - 1].s + ribList[i - 1].thickness / 2
    const to = ribList[i].s - ribList[i].thickness / 2
    if (to - from < 0.001) continue
    const n = webBoxes(a, st, from).length
    for (let k = 0; k < n; k++) add('web', sweep(a, from, to, (s) => webBoxes(a, st, s)[k], 4))
  }

  // Sheeting: top and bottom, from the LE stock back to the spar's rear face (D-box) or the TE
  // stock (fully sheeted), between the outer surface and the ribs' inset surface
  const cov = st.covering
  if (cov.type !== 'open' && cov.sheetThickness > 0) {
    const [, sparRear] = lineFaces(a.sparX, sparWidth(sp))
    for (const which of ['upper', 'lower']) {
      add('sheet', sweep(a, s0, s1, (s) => {
        const sec = a.section(s)
        if (!sec || !(sec.c > 1e-4)) return null
        const x0 = sec.xl + st.le.width
        const x1 = cov.type === 'sheeted' ? sec.xl + sec.c - st.te.width : sparRear(s)
        const xs = Array.from({ length: 17 }, (_, i) => x0 + ((x1 - x0) * (1 - Math.cos((Math.PI * i) / 16))) / 2)
        return [...xs.map((x) => [x, surfaceHeight(a, s, x, which)]), ...[...xs].reverse().map((x) => [x, insetHeight(a, st, s, x, which)])]
      }, 40, { extend: ends, caps: 'strip' }))
    }
  }

  // Leading and trailing edge stock: the section's own shape over their depth
  const edgeShape = (s, from, to, k = 8) => {
    const sec = a.section(s)
    if (!sec || !(sec.c > 1e-4)) return null
    const xs = Array.from({ length: k + 1 }, (_, i) => from(sec) + ((to(sec) - from(sec)) * i) / k)
    return [...xs.map((x) => [x, surfaceHeight(a, s, x, 'upper')]), ...[...xs].reverse().map((x) => [x, surfaceHeight(a, s, x, 'lower')])]
  }
  // Leading edge: cosine spacing so the nose stays round
  add('le', sweep(a, s0, s1, (s) => {
    const sec = a.section(s)
    if (!sec || !(sec.c > 1e-4)) return null
    const w = Math.min(st.le.width, sec.c / 2)
    const xs = cosine(10).map((f) => sec.xl + f * w)
    return [...[...xs].reverse().map((x) => [x, surfaceHeight(a, s, x, 'upper')]), ...xs.slice(1).map((x) => [x, surfaceHeight(a, s, x, 'lower')])]
  }, 40, { extend: ends }))
  add('te', sweep(a, s0, s1, (s) => edgeShape(s, (sec) => sec.xl + sec.c - Math.min(st.te.width, sec.c / 2), (sec) => sec.xl + sec.c), 40, { extend: ends }))

  // Stringers, seated in their rib notches
  for (const str of st.stringers ?? []) {
    if (!Number.isFinite(str.position) || !(str.width > 0) || !(str.height > 0)) continue
    for (const which of ['upper', 'lower']) {
      if (str.surface !== 'both' && str.surface !== which) continue
      add('stringer', sweep(a, s0, s1, (s) => stringerBox(a, st, str, s, which), 40, { extend: ends }))
    }
  }

  // Ribs: placed by their plane's basis at the spar point. Cap strips sit on them, centred,
  // from the LE stock (or the D-box) to the TE stock, between the outer and inset surfaces.
  const ribs = []
  const capStrips = []
  const strips = cov.capStrips && cov.type !== 'sheeted' && cov.capStripThickness > 0 && cov.capStripWidth > 0
  for (const p of parts.filter((q) => q.group === 'ribs')) {
    const r = p.rib
    const g = angleAt(a, p.s)
    const ang = r.angle * RAD
    const ds = Math.sin(ang)
    const dx = Math.cos(ang)
    const eu = [ds * Math.cos(g), ds * Math.sin(g), dx]
    const ez = [-Math.sin(g), Math.cos(g), 0]
    const ew = [-dx * Math.cos(g), -dx * Math.sin(g), ds]
    const w = a.sampler.at(p.s)
    const P = [w.y, w.z, a.sparX(p.s)] // the spar point, h = 0
    const t = p.thickness
    // Placement for something of a given width across the rib, reaching `outer` outboard of
    // the rib's centre plane (ew points inboard, so the extrusion starts at -outer)
    const place = (width, outer = width / 2) => {
      const O = [0, 1, 2].map((k) => P[k] - eu[k] * r.sparU - ew[k] * outer)
      return [...eu, 0, ...ez, 0, ...ew, 0, ...O, 1]
    }
    const centre = p.s < 1e-9 && st.ribs.rootJoint !== 'two-piece' // shared by both halves
    ribs.push({ id: p.id, name: p.name, kind: p.kind, outline: p.outline, holes: p.holes, thickness: t, matrix: place(t), centre })
    if (strips && r.surfaces) {
      const { us, up, lo, upIn, loIn } = r.surfaces
      const at = (arr, u) => {
        let i = 1
        while (i < us.length - 1 && us[i] < u) i++
        const f = (u - us[i - 1]) / (us[i] - us[i - 1] || 1)
        return arr[i - 1] + (arr[i] - arr[i - 1]) * f
      }
      const from = r.capStripFrom
      const to = r.uB
      const n = 40
      const uu = Array.from({ length: n + 1 }, (_, i) => from + ((to - from) * i) / n)
      for (const [outer, inner] of [
        [up, upIn],
        [lo, loIn],
      ]) {
        const outline = [...uu.map((u) => [u, at(outer, u)]), ...[...uu].reverse().map((u) => [u, at(inner, u)])]
        // Centred on the rib, except on end ribs, where it's flush with the outer face; the
        // centre rib's is split between the halves (the other half comes with the mirror)
        const cw = cov.capStripWidth
        const tip = p.kind === 'tip'
        const root = p.kind === 'root' && st.ribs.rootJoint === 'two-piece'
        const width = centre ? cw / 2 : cw
        const reach = tip ? t / 2 : root ? -t / 2 + cw : cw / 2
        capStrips.push({ id: `${p.id}-cs`, outline, holes: [], thickness: width, matrix: place(width, reach) })
      }
    }
  }

  // Bounds, for framing the camera
  const lo = [Infinity, Infinity, Infinity]
  const hi = [-Infinity, -Infinity, -Infinity]
  const sk = skin(a)
  for (let i = 0; i < sk.positions.length; i += 3) {
    for (let k = 0; k < 3; k++) {
      lo[k] = Math.min(lo[k], sk.positions[i + k])
      hi[k] = Math.max(hi[k], sk.positions[i + k])
    }
  }
  return { skin: sk, solids, ribs, capStrips, bounds: { min: lo, max: hi } }
}

// For tests: apply a column-major 4×4 matrix to a point.
export function applyMatrix(m, [x, y, z]) {
  return [m[0] * x + m[4] * y + m[8] * z + m[12], m[1] * x + m[5] * y + m[9] * z + m[13], m[2] * x + m[6] * y + m[10] * z + m[14]]
}
