// 3D geometry of the built-up half wing, for the 3D view. Pure data (positions, indices and
// placement matrices), no rendering library, so it can be tested; the view turns it into
// meshes.
//
// World axes, metres: X spanwise outward (projected, so dihedral shows), Y up, Z chordwise
// aft from the root leading edge. A point on the wing is given by its flat spanwise distance
// s, chordwise x and height h above its panel's chord plane; dihedral tilts that plane.
// Washout rotates each section about the spar line (TE up), as in ribs.js, so the skin and
// the ribs agree.

const RAD = Math.PI / 180

// Panel dihedral at s; on a panel break, the mean of the two (where the break rib sits).
function angleAt(a, s) {
  const e = 1e-5
  const lo = a.sampler.at(Math.max(0, s - e))
  const hi = a.sampler.at(Math.min(a.sampler.reach, s + e))
  return ((lo?.rad ?? 0) + (hi?.rad ?? lo?.rad ?? 0)) / 2
}

// World position of (s, x, h).
export function worldPoint(a, s, x, h) {
  const w = a.sampler.at(Math.min(a.sampler.reach, Math.max(0, s)))
  const g = w.rad
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
// closed joins each ring's last point to its first; caps close the two end rings with fans.
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
  if (caps && n > 1) {
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
function sweep(a, s0, s1, section, n = 40) {
  const rings = []
  for (const s of stations(a, s0, s1, n)) {
    const pts = section(s)
    if (pts) rings.push(pts.map(([x, h]) => worldPoint(a, s, x, h)))
  }
  return rings.length > 1 ? loft(rings, { closed: true, caps: true }) : null
}

function sparWidth(sp) {
  return sp.type === 'caps' || sp.type === 'box' ? sp.capWidth : sp.type === 'solid' ? sp.solidWidth : sp.tubeDiameter
}

// The built-up half wing: skin, spar, webs, edge stock and stringers as meshes, and every rib
// as its outline (with holes) plus a column-major 4×4 matrix placing its plane, rib (u, z)
// in local X, Y and its thickness along local Z.
export function wing3d(a, structure, parts) {
  const st = structure
  const sp = st.spar
  const cov = st.covering
  const skinT = cov.type === 'open' ? 0 : cov.sheetThickness || 0
  const s0 = a.rootS
  const s1 = a.tipS
  const solids = []
  const add = (kind, mesh) => mesh && solids.push({ kind, ...mesh })

  // Spar
  const half = sparWidth(sp) / 2
  const sparEnd = sp.type === 'tube' && Number.isFinite(sp.tubeLength) ? Math.min(s1, s0 + sp.tubeLength) : s1
  const at = (s) => {
    const x = a.sparX(s)
    return { x, top: surfaceHeight(a, s, x, 'upper') - skinT, bot: surfaceHeight(a, s, x, 'lower') + skinT }
  }
  const box = (x0, x1, h0, h1) => [
    [x0, h0],
    [x1, h0],
    [x1, h1],
    [x0, h1],
  ]
  if (sp.type === 'caps' || sp.type === 'box') {
    const tc = sp.capThickness
    add('spar', sweep(a, s0, sparEnd, (s) => {
      const p = at(s)
      return box(p.x - half, p.x + half, p.top - tc, p.top)
    }))
    add('spar', sweep(a, s0, sparEnd, (s) => {
      const p = at(s)
      return box(p.x - half, p.x + half, p.bot, p.bot + tc)
    }))
    const tw = sp.webThickness
    const faces = sp.type === 'box' ? [-1, 1] : [-1]
    for (const side of faces) {
      add('web', sweep(a, s0, sparEnd, (s) => {
        const p = at(s)
        const x0 = side < 0 ? p.x - half - tw : p.x + half
        return box(x0, x0 + tw, p.bot + tc, p.top - tc)
      }))
    }
  } else if (sp.type === 'tube') {
    const r = sp.tubeDiameter / 2
    add('spar', sweep(a, s0, sparEnd, (s) => {
      const p = at(s)
      const mid = (p.top + p.bot) / 2
      return Array.from({ length: 16 }, (_, k) => [p.x + r * Math.cos((2 * Math.PI * k) / 16), mid + r * Math.sin((2 * Math.PI * k) / 16)])
    }))
  } else {
    const d = sp.solidDepth
    add('spar', sweep(a, s0, sparEnd, (s) => {
      const p = at(s)
      const mid = sp.solidMount === 'top' ? p.top - d / 2 : sp.solidMount === 'bottom' ? p.bot + d / 2 : (p.top + p.bot) / 2
      return box(p.x - half, p.x + half, mid - d / 2, mid + d / 2)
    }))
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
  }))
  add('te', sweep(a, s0, s1, (s) => edgeShape(s, (sec) => sec.xl + sec.c - Math.min(st.te.width, sec.c / 2), (sec) => sec.xl + sec.c)))

  // Stringers, under any skin
  for (const str of st.stringers ?? []) {
    if (!Number.isFinite(str.position) || !(str.width > 0) || !(str.height > 0)) continue
    for (const which of ['upper', 'lower']) {
      if (str.surface !== 'both' && str.surface !== which) continue
      add('stringer', sweep(a, s0, s1, (s) => {
        const sec = a.section(s)
        const x = sec.xl + str.position * sec.c
        const sheeted = cov.type === 'sheeted' || (cov.type === 'dbox' && x <= a.sparX(s))
        const under = sheeted ? skinT : 0
        const h = surfaceHeight(a, s, x, which)
        return which === 'upper'
          ? box(x - str.width / 2, x + str.width / 2, h - under - str.height, h - under)
          : box(x - str.width / 2, x + str.width / 2, h + under, h + under + str.height)
      }))
    }
  }

  // Ribs: placed by their plane's basis at the spar point
  const ribs = []
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
    const O = [0, 1, 2].map((k) => P[k] - eu[k] * r.sparU - (ew[k] * t) / 2)
    const matrix = [...eu, 0, ...ez, 0, ...ew, 0, ...O, 1]
    ribs.push({ id: p.id, name: p.name, kind: p.kind, outline: p.outline, holes: p.holes, thickness: t, matrix })
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
  return { skin: sk, solids, ribs, bounds: { min: lo, max: hi } }
}

// For tests: apply a column-major 4×4 matrix to a point.
export function applyMatrix(m, [x, y, z]) {
  return [m[0] * x + m[4] * y + m[8] * z + m[12], m[1] * x + m[5] * y + m[9] * z + m[13], m[2] * x + m[6] * y + m[10] * z + m[14]]
}
