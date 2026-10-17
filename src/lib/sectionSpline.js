// Section outline geometry for the advanced section editor: NACA seeds, a smooth outline drawn through the
// user's points, nose radius, fairing and curvature checks. Pure functions only (no Vue, no DOM, no state).
// Every function takes the point list (and any options) and returns new data; inputs are never mutated.
//
// Point format: an array ordered TE upper -> LE -> TE lower, each {x, y} in chord fractions. The LE point is
// flagged {le: true, r} with r the nose radius as a chord fraction. A point flagged {straight: true} starts a
// straight segment that runs to the next point.

import { generateSection, splitSurfaces, interp } from './airfoilGeom.js'

// Spline samples per user segment
const PER = 24
// Stations for the NACA seeds, from the trailing edge to the leading edge (chord fractions)
const STATIONS = [1, 0.8, 0.6, 0.45, 0.3, 0.18, 0.09, 0.035, 0.012]

export const NOSE_MIN = 0.002
export const NOSE_MAX = 0.06

export const SEEDS = [
  { code: '2412', name: 'NACA 2412' },
  { code: '0012', name: 'NACA 0012' },
  { code: '4415', name: 'NACA 4415' },
]

/* ------------------------------ seeds ------------------------------ */

// A NACA 4-digit section as a point list. The nose radius is the standard 1.1019 t^2 for that thickness.
export function naca4Points(code) {
  const m = +code[0] / 100, p = +code[1] / 10, t = +code.slice(2) / 100
  const yt = (x) => 5 * t * (0.2969 * Math.sqrt(x) - 0.126 * x - 0.3516 * x * x + 0.2843 * x ** 3 - 0.1015 * x ** 4)
  const yc = (x) => (p === 0 ? 0 : x < p ? (m / (p * p)) * (2 * p * x - x * x) : (m / ((1 - p) ** 2)) * ((1 - 2 * p) + 2 * p * x - x * x))
  const dyc = (x) => (p === 0 ? 0 : x < p ? (2 * m / (p * p)) * (p - x) : (2 * m / ((1 - p) ** 2)) * (p - x))
  const up = [], lo = []
  for (const x of STATIONS) {
    const th = Math.atan(dyc(x)), y = yt(x), c = yc(x)
    up.push({ x: x - y * Math.sin(th), y: c + y * Math.cos(th) })
    lo.push({ x: x + y * Math.sin(th), y: c - y * Math.cos(th) })
  }
  return [...up, { x: 0, y: 0, le: true, r: 1.1019 * t * t }, ...lo.reverse()]
}

/* ------------------------------ geometry ------------------------------ */

export function leIndex(pts) {
  return pts.findIndex((p) => p.le)
}

// Outline construction. Each surface is y as a smooth spline in t = sqrt(x), measured in the chord frame (LE at
// the origin, x along the chord, both in chord lengths). In sqrt(x) space a round nose is simply a finite slope:
// with x = t^2 and y = a t + ..., the radius of curvature at the LE is a^2 / 2, so the end condition
// dy/dt = +-sqrt(2 r) at t = 0 makes the nose radius exact (camber does not change it). There is no circle and no
// join: the nose is the first segment like any other. Each run of curved segments is a C2 cubic in t (so the
// curvature is continuous), clamped at the LE and at any straight segment, and natural at the trailing edge. A
// straight segment is a true line in x, y; at its ends the neighbouring curve is given the line's slope
// (dy/dt = 2 t dy/dx), so the join is tangent.
const noseSlope = (le) => Math.sqrt(2 * Math.max(1e-6, le.r || 0.01))

// Chord frame: LE, unit vector to the TE midpoint, its length
function chordFrame(pts) {
  const le = pts[leIndex(pts)], a = pts[0], b = pts[pts.length - 1]
  const mx = (a.x + b.x) / 2 - le.x, my = (a.y + b.y) / 2 - le.y, L = Math.hypot(mx, my) || 1
  return { le, ux: mx / L, uy: my / L, L }
}

function frameOf(pts) {
  const cf = chordFrame(pts)
  return { ...cf, vx: -cf.uy, vy: cf.ux }
}

// Outline point -> chord frame, and back
const toC = (F, p) => {
  const ex = p.x - F.le.x, ey = p.y - F.le.y
  return { x: (ex * F.ux + ey * F.uy) / F.L, y: (-ex * F.uy + ey * F.ux) / F.L }
}
const fromC = (F, x, y) => ({
  x: F.le.x + F.L * (x * F.ux + y * F.vx),
  y: F.le.y + F.L * (x * F.uy + y * F.vy),
})

// Slopes dy/dt at the knots of one run of curved segments (n + 1 knots). Clamped on the left, clamped on the right
// when mR is given, otherwise natural (zero second derivative) at the trailing edge.
function solveRun(t, y, mL, mR) {
  const n = t.length - 1, h = [], d = []
  for (let j = 0; j < n; j++) { h.push(t[j + 1] - t[j]); d.push((y[j + 1] - y[j]) / h[j]) }
  const A = new Array(n + 1).fill(0), B = A.slice(), C = A.slice(), R = A.slice()
  B[0] = 1; R[0] = mL
  for (let i = 1; i < n; i++) {
    A[i] = h[i]; B[i] = 2 * (h[i - 1] + h[i]); C[i] = h[i - 1]
    R[i] = 3 * (h[i] * d[i - 1] + h[i - 1] * d[i])
  }
  if (mR != null) { B[n] = 1; R[n] = mR } else { A[n] = 1; B[n] = 2; R[n] = 3 * d[n - 1] }
  // Thomas algorithm
  for (let i = 1; i <= n; i++) { const w = A[i] / B[i - 1]; B[i] -= w * C[i - 1]; R[i] -= w * R[i - 1] }
  const m = new Array(n + 1)
  m[n] = R[n] / B[n]
  for (let i = n - 1; i >= 0; i--) m[i] = (R[i] - C[i] * m[i + 1]) / B[i]
  return m
}

// One surface, knots running outward from the LE (dir -1 = upper, points l, l-1 ... 0; +1 = lower, points l ... n-1)
function surfaceSpline(F, pts, l, dir, mLE) {
  const idx = []
  for (let i = l; i >= 0 && i < pts.length; i += dir) idx.push(i)
  const K = idx.map((i, k) => {
    if (k === 0) return { i, x: 0, y: 0, t: 0 }
    const c = toC(F, pts[i])
    return { i, x: Math.max(c.x, 0), y: c.y, t: 0 }
  })
  // Knot parameter t = sqrt(x), nudged so it always increases; x is then rebuilt from t so the two agree
  for (let k = 1; k < K.length; k++) {
    K[k].t = Math.max(Math.sqrt(K[k].x), K[k - 1].t + 1e-4)
    K[k].x = K[k].t * K[k].t
  }
  const ns = K.length - 1, straight = [], fixed = new Array(K.length).fill(null), m = new Array(K.length).fill(0)
  fixed[0] = mLE
  for (let j = 0; j < ns; j++) {
    const st = j > 0 && !!pts[Math.min(K[j].i, K[j + 1].i)].straight
    straight.push(st)
    if (st) {
      // Tangent to a straight segment: dy/dt = 2 t dy/dx at each of its ends
      const dxk = K[j + 1].x - K[j].x, k = Math.abs(dxk) < 1e-9 ? 1e3 : (K[j + 1].y - K[j].y) / dxk
      fixed[j] = 2 * K[j].t * k
      fixed[j + 1] = 2 * K[j + 1].t * k
    }
  }
  for (let j = 0; j < ns;) {
    if (straight[j]) { j++; continue }
    let e = j
    while (e < ns && !straight[e]) e++
    const ts = K.slice(j, e + 1).map((q) => q.t), ys = K.slice(j, e + 1).map((q) => q.y)
    const sol = solveRun(ts, ys, fixed[j], e < ns ? fixed[e] : null)
    sol.forEach((v, q) => { m[j + q] = v })
    j = e
  }
  return { K, m, straight }
}

// A point at fraction u along the segment from knot kA to knot kB (either order), in the chord frame
function splineAt(S, kA, kB, u) {
  const a = S.K[kA], b = S.K[kB]
  if (S.straight[Math.min(kA, kB)]) return { x: a.x + (b.x - a.x) * u, y: a.y + (b.y - a.y) * u }
  const h = b.t - a.t, u2 = u * u, u3 = u2 * u, t = a.t + h * u
  const y = (2 * u3 - 3 * u2 + 1) * a.y + h * (u3 - 2 * u2 + u) * S.m[kA] + (-2 * u3 + 3 * u2) * b.y + h * (u3 - u2) * S.m[kB]
  return { x: t * t, y }
}

// Samples the outline, upper TE -> LE -> lower TE: PER samples per user segment.
// The result is an array of {x, y} with extra fields: at[i] = index of user point i; segs = one entry per user
// segment; range[i] = [from, to] of user segment i.
export function sampleSection(pts) {
  const l = leIndex(pts), n = pts.length, F = frameOf(pts), a = noseSlope(pts[l])
  const U = surfaceSpline(F, pts, l, -1, a), Lo = surfaceSpline(F, pts, l, +1, -a)
  const D = []
  D.at = new Array(n).fill(0); D.segs = []; D.range = []
  for (let ui = 0; ui < n - 1; ui++) {
    const S = ui < l ? U : Lo
    const kA = ui < l ? l - ui : ui - l, kB = ui < l ? l - ui - 1 : ui - l + 1
    const from = D.length
    D.at[ui] = from
    for (let k = 0; k < PER; k++) {
      const q = splineAt(S, kA, kB, k / PER)
      D.push(fromC(F, q.x, q.y))
    }
    D.segs.push({
      ui,
      nose: !!(pts[ui].le || pts[ui + 1].le),
      from,
      to: from + PER,
      straight: S.straight[Math.min(kA, kB)],
    })
    D.range[ui] = [from, from + PER]
  }
  const lastK = Lo.K[Lo.K.length - 1]
  D.push(fromC(F, lastK.x, lastK.y))
  D.at[n - 1] = D.length - 1
  return D
}

// Nose radius measured on the outline: the circle through the LE and one point just behind it on each surface
// (in chord lengths). Measured, not read back from the stored r, so it shows what the spline really does.
export function noseRadiusOf(pts) {
  const l = leIndex(pts), F = frameOf(pts), a = noseSlope(pts[l])
  const U = surfaceSpline(F, pts, l, -1, a), Lo = surfaceSpline(F, pts, l, +1, -a)
  const at = (S) => splineAt(S, 1, 0, 1 - Math.min(2e-4, S.K[1].t / 2) / S.K[1].t)
  const p = at(U), q = at(Lo), cr = Math.abs(p.x * q.y - p.y * q.x)
  if (cr < 1e-20) return pts[l].r || 0.01
  return (Math.hypot(p.x, p.y) * Math.hypot(q.x, q.y) * Math.hypot(p.x - q.x, p.y - q.y)) / (2 * cr)
}

// Signed curvature through three points (zero where they are collinear or coincident)
export function curvature(a, b, c) {
  const ab = Math.hypot(b.x - a.x, b.y - a.y), bc = Math.hypot(c.x - b.x, c.y - b.y), ac = Math.hypot(c.x - a.x, c.y - a.y)
  if (ab * bc * ac < 1e-12) return 0
  return (2 * ((b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x))) / (ab * bc * ac)
}

// Rotate and scale so the LE is the origin and the TE midpoint is (1, 0). Returns the new points, the chord
// length and the angle the chord made in the original frame (degrees).
export function normalise(pts) {
  const le = pts[leIndex(pts)], a = pts[0], b = pts[pts.length - 1]
  const mx = (a.x + b.x) / 2 - le.x, my = (a.y + b.y) / 2 - le.y
  const L = Math.hypot(mx, my) || 1, c = mx / L, s = my / L
  const out = pts.map((p) => ({
    ...p,
    x: ((p.x - le.x) * c + (p.y - le.y) * s) / L,
    y: (-(p.x - le.x) * s + (p.y - le.y) * c) / L,
  }))
  return { pts: out, chord: L, angle: (Math.atan2(my, mx) * 180) / Math.PI }
}

// y on a polyline at a given x, or null if x is outside it
export function yAt(poly, x) {
  for (let i = 0; i < poly.length - 1; i++) {
    const a = poly[i], b = poly[i + 1]
    if ((a.x <= x && x <= b.x) || (b.x <= x && x <= a.x)) {
      return Math.abs(b.x - a.x) < 1e-12 ? a.y : a.y + ((b.y - a.y) * (x - a.x)) / (b.x - a.x)
    }
  }
  return null
}

// Measures a section: thickness, camber, nose radius, trailing-edge gap and angle, and curvature inflections.
// Works in the normalised frame, so the numbers are in chord fractions whatever the input's units.
export function analyseSection(pts) {
  const N = normalise(pts), D = sampleSection(N.pts), li = D.at[leIndex(N.pts)]
  const up = D.slice(0, li + 1).reverse(), lo = D.slice(li)
  let tmax = -1, xt = 0, cmax = 0, xc = 0, cross = false
  for (let x = 0.002; x <= 0.998; x += 0.002) {
    const yu = yAt(up, x), yl = yAt(lo, x)
    if (yu == null || yl == null) continue
    const t = yu - yl, c = (yu + yl) / 2
    if (t > tmax) { tmax = t; xt = x }
    if (Math.abs(c) > Math.abs(cmax)) { cmax = c; xc = x }
    if (t < -1e-4) cross = true
  }
  const leR = noseRadiusOf(pts)
  const teT = D[0].y - D[D.length - 1].y
  const v1 = { x: D[3].x - D[0].x, y: D[3].y - D[0].y }
  const v2 = { x: D[D.length - 4].x - D[D.length - 1].x, y: D[D.length - 4].y - D[D.length - 1].y }
  const teA = (Math.acos(Math.max(-1, Math.min(1, (v1.x * v2.x + v1.y * v2.y) / (Math.hypot(v1.x, v1.y) * Math.hypot(v2.x, v2.y))))) * 180) / Math.PI
  const ks = D.map((_, i) => (i === 0 || i === D.length - 1 ? 0 : curvature(D[i - 1], D[i], D[i + 1])))
  // Inflections: sign changes of the curvature (ignoring near-flat stretches and the last 3 % of chord), each with
  // its position as a fractional sample index, the user segment it falls in and the two points either side of it
  const inflections = (lo, hi, surf) => {
    const out = []
    let last = 0, lastI = 0
    for (let i = lo; i <= hi; i++) {
      if (D[i].x >= 0.97 || Math.abs(ks[i]) < 0.5) continue
      const s = Math.sign(ks[i])
      if (last && s !== last) {
        const idx = lastI + (ks[lastI] / (ks[lastI] - ks[i])) * (i - lastI)
        const g = D.segs.find((q) => idx >= q.from && idx < q.to) || D.segs[D.segs.length - 1]
        const i0 = Math.min(Math.floor(idx), D.length - 2), fr = idx - i0
        out.push({ surf, idx, ui: g.ui, pa: g.ui, pb: g.ui + 1, x: D[i0].x + (D[i0 + 1].x - D[i0].x) * fr })
      }
      last = s; lastI = i
    }
    return out
  }
  const iu = inflections(0, li - 1, 'Upper'), il = inflections(li + 1, D.length - 1, 'Lower')
  ;[iu, il].forEach((arr) => arr.forEach((e, k) => { e.k = k; e.of = arr.length; e.warn = arr.length >= 2 }))
  return { normalised: N, tmax, xt, cmax, xc, leR, teT, teA, cross, inflU: iu.length, inflL: il.length, infls: [...iu, ...il] }
}

/* ------------------------------ fairing ------------------------------ */

// Fairing works in the normalised chord frame (LE at the origin, TE midpoint at (1, 0)). Along the whole
// TE -> LE -> TE run the parameter is s = +sqrt(x) on the upper surface and -sqrt(x) on the lower, so the section
// is a smooth function y(s) straight through the nose. Each free point's target is the Lagrange cubic through its
// two neighbours on each side (fewer near the ends), evaluated at its own s.
function fairTarget(Q, i, l) {
  const sp = (j) => (j <= l ? 1 : -1) * Math.sqrt(Math.max(0, Q[j].x))
  const nb = [i - 2, i - 1, i + 1, i + 2].filter((j) => j >= 0 && j < Q.length)
  if (nb.length < 2) return null
  const s0 = sp(i), s = nb.map(sp)
  // Two neighbours almost on top of each other make the cubic wildly unstable: leave such a point alone
  for (let a = 0; a < nb.length; a++) {
    if (Math.abs(s[a] - s0) < 0.01) return null
    for (let b = a + 1; b < nb.length; b++) if (Math.abs(s[a] - s[b]) < 0.01) return null
  }
  let y = 0
  for (let a = 0; a < nb.length; a++) {
    let w = 1
    for (let b = 0; b < nb.length; b++) if (b !== a) w *= (s0 - s[b]) / (s[a] - s[b])
    y += w * Q[nb[a]].y
  }
  return y
}

const FAIR_ITERS = 4, FAIR_RELAX = 0.5, FAIR_STEP_MAX = 0.01

// Points that fairing will not move: the LE, the trailing-edge points, and both ends of a straight segment
export function isFairable(pts, i) {
  const l = leIndex(pts)
  return i !== l && i !== 0 && i !== pts.length - 1 && !pts[i].straight && !(pts[i - 1] && pts[i - 1].straight)
}

// Rescale distance from the camber line, for the listed points only (so a surface you did not smooth stays as it
// was), until the max thickness is back at `target`. One surface alone has to supply the whole change, so its
// factor doubles.
function restoreThickness(Q, target, only) {
  const l = leIndex(Q), both = [...only].some((i) => i < l) && [...only].some((i) => i > l)
  for (let it = 0; it < 12; it++) {
    let k = target / analyseSection(Q).tmax
    if (!isFinite(k) || Math.abs(k - 1) < 2e-5) break
    if (!both) k = 1 + (k - 1) * 2
    k = Math.max(0.8, Math.min(1.25, k))
    const D = sampleSection(Q), li = D.at[l], up = D.slice(0, li + 1).reverse(), lo = D.slice(li)
    Q = Q.map((p, i) => {
      if (!only.has(i)) return p
      const x = Math.min(Math.max(p.x, 0.0005), 0.9995), yu = yAt(up, x), yl = yAt(lo, x)
      if (yu == null || yl == null) return p
      const cam = (yu + yl) / 2
      return { ...p, y: cam + (p.y - cam) * k }
    })
  }
  return Q
}

// Map normalised-frame points back into the base's own frame; untouched points keep their identity
function fromFrame(Q, nm, base) {
  const ang = (nm.angle * Math.PI) / 180, c = Math.cos(ang), s = Math.sin(ang), L = nm.chord
  const le = base[leIndex(base)]
  return base.map((p, i) => (
    Q[i].y === nm.pts[i].y && Q[i].x === nm.pts[i].x
      ? p
      : { ...p, x: le.x + (Q[i].x * c - Q[i].y * s) * L, y: le.y + (Q[i].x * s + Q[i].y * c) * L }
  ))
}

// Smooths the points at indices idxs (those fairing may not move are skipped). Returns a new point list.
// keepThickness rescales the faired points afterwards so the max thickness stays what it was.
export function fairShape(pts, idxs, { keepThickness = true } = {}) {
  const l = leIndex(pts), nm = normalise(pts), tBefore = analyseSection(pts).tmax
  const todo = idxs.filter((i) => isFairable(pts, i))
  let Q = nm.pts.map((p) => ({ ...p }))
  for (let it = 0; it < FAIR_ITERS; it++) {
    const tg = todo.map((i) => fairTarget(Q, i, l))
    todo.forEach((i, k) => {
      if (tg[k] == null) return
      const d = Math.max(-FAIR_STEP_MAX, Math.min(FAIR_STEP_MAX, (tg[k] - Q[i].y) * FAIR_RELAX))
      Q[i] = { ...Q[i], y: Q[i].y + d }
    })
  }
  if (keepThickness && todo.length) Q = restoreThickness(Q, tBefore, new Set(todo))
  return fromFrame(Q, nm, pts)
}

/* ------------------------------ nose radius ------------------------------ */

// Thickness near the LE goes as sqrt(2 r x), so each point's distance from the camber line is scaled by
// sqrt(rNew / rOld) at the nose, fading smoothly to 1 at min(max-thickness position, 30 %). TE and aft points do
// not move. Always computed from `base` (the shape before the change), so applying a radius twice does not compound.
// rNew is clamped to NOSE_MIN..NOSE_MAX.
export function applyRadius(base, rNew) {
  rNew = Math.min(NOSE_MAX, Math.max(NOSE_MIN, rNew))
  const l = leIndex(base), rOld = base[l].r || 0.01, nm = normalise(base), Q = nm.pts
  const xf = Math.max(0.05, Math.min(analyseSection(base).xt, 0.3))
  const D = sampleSection(Q), li = D.at[l], up = D.slice(0, li + 1).reverse(), lo = D.slice(li)
  const g = Math.sqrt(rNew / rOld)
  const out = Q.map((p, i) => {
    if (i === l) return { ...p, r: rNew }
    const u = Math.min(1, p.x / xf)
    if (u >= 1) return p
    const w = 1 - u * u * (3 - 2 * u)
    const x = Math.min(Math.max(p.x, 0.0005), 0.9995), yu = yAt(up, x), yl = yAt(lo, x)
    if (yu == null || yl == null) return p
    const cam = (yu + yl) / 2
    return { ...p, y: cam + (p.y - cam) * (1 + (g - 1) * w) }
  })
  const res = fromFrame(out, nm, base)
  res[l] = { ...base[l], r: rNew }
  return res
}

/* ------------------------------ segment dragging ------------------------------ */

// Keeps each surface's points in order along the chord, outward from the LE, with a small gap. Only the points in
// idxs move, and only along the chord, processed from the nose outward so the surface stays a function of sqrt(x).
// Returns a new point list.
const ORDER_GAP = 0.0005
export function clampOrder(pts, idxs) {
  const out = pts.map((p) => ({ ...p }))
  const l = leIndex(out), n = out.length, F = frameOf(out)
  const cx = (i) => (i === l ? 0 : toC(F, out[i]).x)
  const todo = [...new Set(idxs)].filter((i) => i !== l && i >= 0 && i < n).sort((a, b) => Math.abs(a - l) - Math.abs(b - l))
  for (const i of todo) {
    const dir = i < l ? 1 : -1, inner = i + dir, outer = i - dir, x = cx(i)
    const lo = cx(inner) + ORDER_GAP
    let hi = outer >= 0 && outer < n ? cx(outer) - ORDER_GAP : Infinity
    if (hi < lo) hi = lo
    const nx = Math.min(hi, Math.max(lo, x))
    if (nx !== x) out[i] = { ...out[i], x: out[i].x + (nx - x) * F.L * F.ux, y: out[i].y + (nx - x) * F.L * F.uy }
  }
  return out
}

// A segment touching the nose: only its free end moves (the LE is locked), by the full drag vector
function moveFreeEnd(base, i, dxy) {
  const out = base.map((p) => ({ ...p }))
  const j = base[i].le ? i + 1 : i
  out[j] = { ...base[j], x: base[j].x + dxy.x, y: base[j].y + dxy.y }
  return clampOrder(out, [i, i + 1])
}

// Bends curved segment i (between points i and i+1) so the spot at fraction u along it (snapped to the nearest
// sample) moves by dxy. Both end points move with weights (1 - t, t) / ((1 - t)^2 + t^2), so a grab near one end moves
// that end most. The weights are refined twice, so the grabbed spot lands on its target to well under 1e-3 chord for
// a modest drag. A segment touching the nose moves only its free end. The LE never moves. Returns a new point list.
export function bendSegment(base, i, u, dxy) {
  const a0 = base[i], b0 = base[i + 1]
  if (a0.le || b0.le) return moveFreeEnd(base, i, dxy)
  const D0 = sampleSection(base), r = D0.range[i]
  const k = Math.min(PER, Math.max(0, Math.round(u * PER)))
  const t = k / PER, idx = r[0] + k
  const want = { x: D0[idx].x + dxy.x, y: D0[idx].y + dxy.y }
  const den = (1 - t) ** 2 + t ** 2, w0 = (1 - t) / den, w1 = t / den
  let tot = { x: dxy.x, y: dxy.y }
  let out = null
  for (let it = 0; it < 3; it++) {
    out = base.map((p) => ({ ...p }))
    out[i] = { ...a0, x: a0.x + w0 * tot.x, y: a0.y + w0 * tot.y }
    out[i + 1] = { ...b0, x: b0.x + w1 * tot.x, y: b0.y + w1 * tot.y }
    if (it === 2) break
    const cur = sampleSection(out)[idx]
    tot = { x: tot.x + want.x - cur.x, y: tot.y + want.y - cur.y }
  }
  return clampOrder(out, [i, i + 1])
}

// Translates straight segment i (both ends) by dxy. constrain: null for the whole move, 'along' keeps only the part
// along the line, 'across' only the part across it. Constraints apply to the line's own direction, not the screen,
// and are ignored for a segment touching the nose, which moves only its free end. Returns a new point list.
export function moveStraightSegment(base, i, dxy, constrain = null) {
  const a0 = base[i], b0 = base[i + 1]
  if (a0.le || b0.le) return moveFreeEnd(base, i, dxy)
  let v = { x: dxy.x, y: dxy.y }
  if (constrain) {
    const el = Math.hypot(b0.x - a0.x, b0.y - a0.y) || 1
    const e = { x: (b0.x - a0.x) / el, y: (b0.y - a0.y) / el }
    const dir = constrain === 'along' ? e : { x: -e.y, y: e.x }
    const s = v.x * dir.x + v.y * dir.y
    v = { x: dir.x * s, y: dir.y * s }
  }
  const out = base.map((p) => ({ ...p }))
  out[i] = { ...a0, x: a0.x + v.x, y: a0.y + v.y }
  out[i + 1] = { ...b0, x: b0.x + v.x, y: b0.y + v.y }
  return clampOrder(out, [i, i + 1])
}

/* ------------------------------ saved sections ------------------------------ */

// A drawn section as saved in a project: { pts, seed }. Usable when pts is an array of at least 5 finite points with
// exactly one LE point. seed is the name the drawing was started from (a string) or null.
export function isDrawnSection(d) {
  if (!d || typeof d !== 'object' || !Array.isArray(d.pts) || d.pts.length < 5) return false
  if (!d.pts.every((p) => p && Number.isFinite(p.x) && Number.isFinite(p.y))) return false
  return d.pts.filter((p) => p.le).length === 1
}

// Cosine-spaced x stations from the LE (0) to the TE (1), clustered at both edges, as generateSection uses
const cosineStations = (n) => Array.from({ length: n + 1 }, (_, i) => 0.5 * (1 - Math.cos((Math.PI * i) / n)))

// y of a polyline (sorted by x) at x, with x clamped to its ends (a drawn surface may stop a hair short of x = 1)
function ySurface(poly, x) {
  const lo = Math.min(poly[0].x, poly[poly.length - 1].x), hi = Math.max(poly[0].x, poly[poly.length - 1].x)
  return yAt(poly, Math.min(hi, Math.max(lo, x)))
}

// The outline in the format generateSection returns: Selig order, TE upper -> LE -> TE lower, LE at the origin and
// TE at x = 1 (chord fractions), 2n + 1 points for n stations per surface (121 at the default n = 60). Resampled
// from the spline outline, so the points are cosine-spaced in x. The two TE points stay where the drawn surfaces
// meet them, so an open trailing edge keeps its gap.
export function sectionCoords(pts, n = 60) {
  const N = normalise(pts).pts
  const D = sampleSection(N), li = D.at[leIndex(N)]
  const up = D.slice(0, li + 1).reverse(), lo = D.slice(li) // both LE -> TE
  const xs = cosineStations(n)
  const upper = xs.map((x) => [x, ySurface(up, x)])
  const lower = xs.map((x) => [x, ySurface(lo, x)])
  return [...upper.reverse(), ...lower.slice(1)].map(([x, y]) => [x, y])
}

// Editor points that approximate a parametric custom section ({ thicknessPct, thicknessPosPct, camberPct,
// camberPosPct, leRadiusPct }). The points sit on the same 9-station layout as the NACA seeds (naca4Points), read
// off the generated outline; the LE point takes the custom section's nose radius.
export function drawnFromParams(c) {
  const { coords } = generateSection({
    thickness: c.thicknessPct / 100,
    thicknessPos: c.thicknessPosPct / 100,
    camber: c.camberPct / 100,
    camberPos: c.camberPosPct / 100,
    leRadius: c.leRadiusPct / 100,
  })
  const { upper, lower } = splitSurfaces(coords) // both LE -> TE
  const r = c.leRadiusPct / 100
  // The spline passes through the station points, so the heights at the stations are the unknowns. Start from the
  // target at each station, then least-squares fit all 18 heights so the outline between stations matches too
  // (a flat camber peak is otherwise pulled off its position by the sparse stations).
  const layout = (p) => {
    const up = STATIONS.map((x, j) => ({ x, y: p[j] })) // TE -> LE
    const lo = STATIONS.map((x, j) => ({ x, y: p[9 + j] })).reverse() // LE -> TE
    return [...up, { x: 0, y: 0, le: true, r }, ...lo]
  }
  const residual = (p) => {
    const N = normalise(layout(p)).pts, D = sampleSection(N), li = D.at[leIndex(N)]
    const up = D.slice(0, li + 1).reverse(), lo = D.slice(li)
    const out = []
    for (const x of FIT_XS) {
      out.push(ySurface(up, x) - interp(upper, x))
      out.push(ySurface(lo, x) - interp(lower, x))
    }
    return out
  }
  let p = [...STATIONS.map((x) => interp(upper, x)), ...STATIONS.map((x) => interp(lower, x))]
  for (let it = 0; it < FIT_ITERS; it++) {
    const r0 = residual(p)
    const cols = p.map((_, j) => {
      const q = p.slice()
      q[j] += FIT_STEP
      return residual(q).map((v, k) => (v - r0[k]) / FIT_STEP)
    })
    // Normal equations (JtJ + lambda I) dp = -Jt r
    const A = cols.map((a) => cols.map((b) => a.reduce((s, _, k) => s + a[k] * b[k], 0)))
    const g = cols.map((a) => a.reduce((s, v, k) => s + v * r0[k], 0))
    for (let j = 0; j < A.length; j++) A[j][j] = A[j][j] * (1 + FIT_LAMBDA) + 1e-12
    const dp = solveLinear(A, g.map((v) => -v))
    p = p.map((v, j) => v + dp[j])
  }
  return layout(p)
}

// Sample x for the fit: cosine-spaced across the chord, excluding the very ends
const FIT_XS = cosineStations(40).slice(1, -1)
const FIT_ITERS = 6, FIT_STEP = 1e-5, FIT_LAMBDA = 1e-2

// Solves A x = b for a small dense system by Gaussian elimination with partial pivoting
function solveLinear(A, b) {
  const n = b.length, M = A.map((row, i) => [...row, b[i]])
  for (let c = 0; c < n; c++) {
    let piv = c
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[piv][c])) piv = r
    ;[M[c], M[piv]] = [M[piv], M[c]]
    for (let r = c + 1; r < n; r++) {
      const f = M[r][c] / M[c][c]
      for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k]
    }
  }
  const x = new Array(n).fill(0)
  for (let r = n - 1; r >= 0; r--) {
    let s = M[r][n]
    for (let k = r + 1; k < n; k++) s -= M[r][k] * x[k]
    x[r] = s / M[r][r]
  }
  return x
}

/* ------------------------------ editing ------------------------------ */

// Maps a normalised point list Q (the frame normalise(base) gives) back into the base's own frame. Every field of Q is
// kept, so flags and nose radii carry over.
export function denormalise(base, Q) {
  const N = normalise(base), ang = (N.angle * Math.PI) / 180, c = Math.cos(ang), s = Math.sin(ang), L = N.chord
  const le = base[leIndex(base)]
  return Q.map((p) => ({ ...p, x: le.x + (p.x * c - p.y * s) * L, y: le.y + (p.x * s + p.y * c) * L }))
}

// Moves point i to chord fractions (nx, ny) in the normalised frame, keeping each surface in order. The LE is locked.
// Returns a new point list.
export function setPointAt(P, i, nx, ny) {
  if (!P[i] || P[i].le) return P
  const Q = normalise(P).pts.map((p) => ({ ...p }))
  Q[i] = { ...Q[i], x: nx, y: ny }
  return clampOrder(denormalise(P, Q), [i])
}

// Makes segment i straight (on) or curved (off). A segment touching the nose keeps its shape, so it is returned as is.
export function setStraight(P, i, on) {
  if (i < 0 || i >= P.length - 1 || P[i].le || P[i + 1].le) return P
  return P.map((p, j) => {
    if (j !== i) return p
    const q = { ...p }
    if (on) q.straight = true
    else delete q.straight
    return q
  })
}

// Makes the surface on the other side of the chord a mirror image of the surface holding point fromIdx. The straight
// flags follow their segments, the nose radius is kept. Returns a new point list.
export function mirrorSurface(P, fromIdx) {
  const l = leIndex(P)
  if (!P[fromIdx] || fromIdx === l) return P
  const N = normalise(P).pts
  const up = N.slice(0, l), lo = N.slice(l + 1)
  // Reversing a surface turns it over; the straight flag of a segment belongs to its start point, so it moves to the
  // other end of the segment when the order is reversed
  const mir = (arr) => arr.slice().reverse().map((p, k) => {
    const q = { ...p, y: -p.y }
    const src = arr[arr.length - 2 - k]
    if (src && src.straight) q.straight = true
    else delete q.straight
    return q
  })
  const Q = fromIdx < l ? [...up, N[l], ...mir(up)] : [...mir(lo), N[l], ...lo]
  return denormalise(P, Q)
}
