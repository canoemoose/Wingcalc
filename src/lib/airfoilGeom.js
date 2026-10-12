// Aerofoil section geometry: generating a section from parameters (custom path)
// and measuring the parameters of a section from its coordinates (library path).
//
// All lengths are fractions of chord (0..1) unless the name says "pct".

// Leading-edge radius of a standard NACA four-digit thickness form: r = 1.1019 t².
export function nacaLeRadius(thickness) {
  return 1.1019 * thickness * thickness
}

// Trailing-edge slope parameter d1 of the NACA modified four-digit thickness form,
// tabulated against the position of maximum thickness (Abbott & von Doenhoff, 1959).
const D1_TABLE = [
  [0.2, 0.2],
  [0.3, 0.234],
  [0.4, 0.315],
  [0.5, 0.465],
  [0.6, 0.7],
]

function lerpTable(table, x) {
  if (x <= table[0][0]) return table[0][1]
  for (let i = 1; i < table.length; i++) {
    if (x <= table[i][0]) {
      const [x0, y0] = table[i - 1]
      const [x1, y1] = table[i]
      return y0 + ((y1 - y0) * (x - x0)) / (x1 - x0)
    }
  }
  return table[table.length - 1][1]
}

function solve3(m, v) {
  // Cramer's rule for a 3x3 system m·x = v
  const det = (a) =>
    a[0][0] * (a[1][1] * a[2][2] - a[1][2] * a[2][1]) -
    a[0][1] * (a[1][0] * a[2][2] - a[1][2] * a[2][0]) +
    a[0][2] * (a[1][0] * a[2][1] - a[1][1] * a[2][0])
  const d = det(m)
  return [0, 1, 2].map((col) => {
    const mc = m.map((row, r) => row.map((val, c) => (c === col ? v[r] : val)))
    return det(mc) / d
  })
}

// Thickness distribution after the NACA modified four-digit series, but with the
// leading-edge radius set directly rather than via the integer LE index.
// Returns a function x -> half-thickness (fraction of chord).
export function thicknessForm({ thickness, thicknessPos, leRadius }) {
  const t = thickness
  const p = thicknessPos
  const U = 1 - p
  // Aft section: y = d0 + d1 u + d2 u² + d3 u³ with u = 1 - x, scaled so y(p) = 0.1
  const d0 = 0.002
  const d1 = lerpTable(D1_TABLE, p)
  // y(U) = 0.1 and y'(U) = 0
  // d2 U² + d3 U³ = 0.1 - d0 - d1 U ; 2 d2 U + 3 d3 U² = -d1
  const A = 0.1 - d0 - d1 * U
  const d3 = (-d1 * U - 2 * A) / (U * U * U)
  const d2 = (A - d3 * U * U * U) / (U * U)
  // Forward section: y = a0 √x + a1 x + a2 x² + a3 x³
  // r = (t/0.2)² a0² / 2  =>  a0 = 0.2 √(2r) / t
  const a0 = (0.2 * Math.sqrt(2 * leRadius)) / t
  const curvAft = 2 * d2 + 6 * d3 * U // d²y/du² = d²y/dx²
  const sp = Math.sqrt(p)
  const [a1, a2, a3] = solve3(
    [
      [p, p * p, p * p * p],
      [1, 2 * p, 3 * p * p],
      [0, 2, 6 * p],
    ],
    [0.1 - a0 * sp, -a0 / (2 * sp), curvAft + a0 / (4 * p * sp)],
  )
  const scale = t / 0.2
  return (x) => {
    if (x <= 0) return 0
    if (x <= p) return scale * (a0 * Math.sqrt(x) + a1 * x + a2 * x * x + a3 * x * x * x)
    const u = 1 - x
    return scale * (d0 + d1 * u + d2 * u * u + d3 * u * u * u)
  }
}

// NACA four-digit mean line. Returns { yc, slope } at x.
export function camberLine({ camber, camberPos }) {
  const m = camber
  const p = camberPos
  return (x) => {
    if (m === 0 || p <= 0 || p >= 1) return { yc: 0, slope: 0 }
    if (x < p) {
      return {
        yc: (m / (p * p)) * (2 * p * x - x * x),
        slope: ((2 * m) / (p * p)) * (p - x),
      }
    }
    const q = (1 - p) * (1 - p)
    return {
      yc: (m / q) * (1 - 2 * p + 2 * p * x - x * x),
      slope: ((2 * m) / q) * (p - x),
    }
  }
}

// Cosine-spaced x stations, clustered at both edges.
function cosineStations(n) {
  const xs = []
  for (let i = 0; i <= n; i++) xs.push(0.5 * (1 - Math.cos((Math.PI * i) / n)))
  return xs
}

// Generate a section in Selig order (TE -> upper -> LE -> lower -> TE).
// Parameters are fractions of chord: thickness, thicknessPos, camber, camberPos, leRadius.
export function generateSection(params, n = 60) {
  const yt = thicknessForm(params)
  const mean = camberLine(params)
  const upper = []
  const lower = []
  let valid = true
  for (const x of cosineStations(n)) {
    const t = yt(x)
    if (t < -1e-6) valid = false
    const { yc, slope } = mean(x)
    const th = Math.atan(slope)
    upper.push([x - t * Math.sin(th), yc + t * Math.cos(th)])
    lower.push([x + t * Math.sin(th), yc - t * Math.cos(th)])
  }
  const coords = [...upper.reverse(), ...lower.slice(1)]
  return { coords, valid }
}

// Split Selig-ordered coordinates into upper and lower surfaces, each running LE -> TE,
// with x shifted so the leading edge (min x) is at 0. y is left relative to the chord line.
export function splitSurfaces(coords) {
  let iLe = 0
  for (let i = 1; i < coords.length; i++) if (coords[i][0] < coords[iLe][0]) iLe = i
  const xLe = coords[iLe][0]
  const shift = ([x, y]) => [x - xLe, y]
  const upper = coords.slice(0, iLe + 1).reverse().map(shift)
  const lower = coords.slice(iLe).map(shift)
  // Selig order should put the upper surface first; swap if the file is the other way round.
  const mid = (s) => interp(s, 0.3)
  if (mid(upper) < mid(lower)) return { upper: lower, lower: upper }
  return { upper, lower }
}

// Linear interpolation of y at x on a surface sorted (roughly) by x.
export function interp(surface, x) {
  for (let i = 1; i < surface.length; i++) {
    const [x0, y0] = surface[i - 1]
    const [x1, y1] = surface[i]
    if ((x >= x0 && x <= x1) || (x <= x0 && x >= x1)) {
      if (x1 === x0) return y0
      return y0 + ((y1 - y0) * (x - x0)) / (x1 - x0)
    }
  }
  return surface[surface.length - 1][1]
}

// Fast evaluators for a section's surfaces: upper(x) and lower(x) for x in 0..1 (clamped),
// by binary search on each surface sorted by x. For code that samples a section many times
// (ribs, lifting line), where interp's linear scan would be slow.
export function surfaceFns(coords) {
  const { upper, lower } = splitSurfaces(coords)
  const make = (surface) => {
    const pts = [...surface].sort((a, b) => a[0] - b[0])
    const xs = pts.map((p) => p[0])
    const ys = pts.map((p) => p[1])
    const n = xs.length
    return (x) => {
      if (x <= xs[0]) return ys[0]
      if (x >= xs[n - 1]) return ys[n - 1]
      let lo = 0
      let hi = n - 1
      while (hi - lo > 1) {
        const mid = (lo + hi) >> 1
        if (xs[mid] <= x) lo = mid
        else hi = mid
      }
      const dx = xs[hi] - xs[lo]
      return dx > 0 ? ys[lo] + ((ys[hi] - ys[lo]) * (x - xs[lo])) / dx : ys[lo]
    }
  }
  return { upper: make(upper), lower: make(lower) }
}

// The same section with its thickness scaled by k and its camber line unchanged, so a
// thinner tip section keeps the root's camber. Returned in Selig order at n + 1 cosine-spaced
// stations. Thickness is added vertically to the camber line, which for ordinary sections
// differs from the textbook normal-to-camber construction by a negligible amount.
export function scaleThickness(coords, k, n = 80) {
  const { upper, lower } = surfaceFns(coords)
  const up = []
  const lo = []
  for (let i = 0; i <= n; i++) {
    const x = 0.5 * (1 - Math.cos((Math.PI * i) / n))
    const yu = upper(x)
    const yl = lower(x)
    const c = (yu + yl) / 2
    const t = (yu - yl) / 2
    up.push([x, c + k * t])
    lo.push([x, c - k * t])
  }
  return [...up.reverse(), ...lo.slice(1)]
}

// Least-squares fit y = a √x + b x + c x² + d x³ to points near the LE; returns a.
// For a round leading edge, y ≈ √(2 r x) as x -> 0, so r = a² / 2.
function fitLeCoefficient(surface, xMax = 0.15) {
  const pts = surface.filter(([x]) => x > 0 && x <= xMax)
  if (pts.length < 4) return null
  const basis = (x) => [Math.sqrt(x), x, x * x, x * x * x]
  const n = 4
  const ata = Array.from({ length: n }, () => new Array(n).fill(0))
  const aty = new Array(n).fill(0)
  for (const [x, y] of pts) {
    const b = basis(x)
    for (let i = 0; i < n; i++) {
      aty[i] += b[i] * y
      for (let j = 0; j < n; j++) ata[i][j] += b[i] * b[j]
    }
  }
  // Gaussian elimination with partial pivoting
  for (let col = 0; col < n; col++) {
    let piv = col
    for (let r = col + 1; r < n; r++) if (Math.abs(ata[r][col]) > Math.abs(ata[piv][col])) piv = r
    ;[ata[col], ata[piv]] = [ata[piv], ata[col]]
    ;[aty[col], aty[piv]] = [aty[piv], aty[col]]
    if (Math.abs(ata[col][col]) < 1e-14) return null
    for (let r = col + 1; r < n; r++) {
      const f = ata[r][col] / ata[col][col]
      for (let c = col; c < n; c++) ata[r][c] -= f * ata[col][c]
      aty[r] -= f * aty[col]
    }
  }
  const sol = new Array(n).fill(0)
  for (let r = n - 1; r >= 0; r--) {
    let s = aty[r]
    for (let c = r + 1; c < n; c++) s -= ata[r][c] * sol[c]
    sol[r] = s / ata[r][r]
  }
  return sol[0]
}

// Measure a section from its coordinates. Results are fractions of chord.
export function sectionStats(coords) {
  const { upper, lower } = splitSurfaces(coords)
  let thickness = 0
  let thicknessPos = 0
  let camber = 0
  let camberPos = 0
  for (let i = 1; i < 200; i++) {
    const x = i / 200
    const yu = interp(upper, x)
    const yl = interp(lower, x)
    const t = yu - yl
    const c = (yu + yl) / 2
    if (t > thickness) {
      thickness = t
      thicknessPos = x
    }
    if (Math.abs(c) > Math.abs(camber)) {
      camber = c
      camberPos = x
    }
  }
  // Fit the half-thickness rather than each surface, so camber near the nose
  // doesn't inflate the result. Stations come from both surfaces.
  const halfThickness = [...upper, ...lower]
    .map(([x]) => x)
    .filter((x) => x > 0 && x <= 0.15)
    .sort((a, b) => a - b)
    .map((x) => [x, (interp(upper, x) - interp(lower, x)) / 2])
  const a = fitLeCoefficient(halfThickness)
  const leRadius = a === null ? null : (a * a) / 2
  return {
    thickness,
    thicknessPos,
    camber,
    camberPos,
    leRadius,
    upper125: upperOrdinate(coords, 0.0125),
  }
}

// Upper-surface ordinate above the chord line at a given x (used by the stall heuristic).
export function upperOrdinate(coords, x) {
  const { upper } = splitSurfaces(coords)
  return interp(upper, x)
}

// Reduce a coordinate list to roughly n points for drawing, always keeping the
// leading edge and both trailing-edge points.
export function decimate(coords, n = 90) {
  if (coords.length <= n) return coords
  const step = (coords.length - 1) / (n - 1)
  let iLe = 0
  for (let i = 1; i < coords.length; i++) if (coords[i][0] < coords[iLe][0]) iLe = i
  const keep = new Set([0, coords.length - 1, iLe])
  for (let i = 0; i < n; i++) keep.add(Math.round(i * step))
  return [...keep].sort((a, b) => a - b).map((i) => coords[i])
}

// Zero-lift angle of attack (degrees) from thin-aerofoil theory, using the mean line
// measured from the coordinates:  αL0 = -(1/π) ∫₀^π (dyc/dx)(cos θ - 1) dθ,  x = (1 - cos θ)/2.
// Accurate to a fraction of a degree for ordinary sections (NACA 2412 gives about -2.1°).
export function zeroLiftAngle(coords, n = 200) {
  const { upper, lower } = splitSurfaces(coords)
  const yc = (x) => (interp(upper, x) + interp(lower, x)) / 2
  const h = 1e-3
  let sum = 0
  for (let i = 0; i < n; i++) {
    const th = (Math.PI * (i + 0.5)) / n
    const x = (1 - Math.cos(th)) / 2
    const x0 = Math.max(0, x - h)
    const x1 = Math.min(1, x + h)
    const slope = (yc(x1) - yc(x0)) / (x1 - x0)
    sum += slope * (Math.cos(th) - 1)
  }
  const rad = -(sum * (Math.PI / n)) / Math.PI
  return (rad * 180) / Math.PI
}

// How many separate elements a coordinate set describes. A single section has one leading
// edge: in Selig order x falls from the trailing edge to the nose and rises back again (in
// Lednicer order it rises, jumps back to the nose and rises again, which also has one). A
// multi-element set, such as a slat, main element and flap, is one such loop per element in
// a row, so x turns from falling to rising once per element. Turns smaller than `tolerance`
// of the x extent are ignored, so ragged points at a nose or trailing edge don't count.
// A big gap between neighbouring points is not a test on its own: sparse files join long
// straight stretches with a single step.
export function elementCount(coords, tolerance = 0.02) {
  if (coords.length < 3) return coords.length ? 1 : 0
  let xMin = Infinity
  let xMax = -Infinity
  for (const [x] of coords) {
    if (x < xMin) xMin = x
    if (x > xMax) xMax = x
  }
  const h = tolerance * (xMax - xMin)
  let dir = 0 // -1 falling, +1 rising, 0 not yet known
  let turn = coords[0][0] // furthest x reached in the current direction (the start, until known)
  let leadingEdges = 0
  for (const [x] of coords) {
    if (dir > 0) {
      if (x > turn) turn = x
      else if (x < turn - h) [dir, turn] = [-1, x]
    } else if (dir < 0) {
      if (x < turn) turn = x
      else if (x > turn + h) {
        leadingEdges++
        ;[dir, turn] = [1, x]
      }
    } else if (Math.abs(x - turn) > h) [dir, turn] = [Math.sign(x - turn), x]
  }
  return Math.max(1, leadingEdges)
}

export function isMultiElement(coords) {
  return elementCount(coords) > 1
}

// The chord of a section given in Selig order: the trailing edge is the midpoint of the first
// and last points, the leading edge the point furthest from it. angle is the chord's slope
// in radians.
export function chordLine(coords) {
  const [xa, ya] = coords[0]
  const [xb, yb] = coords[coords.length - 1]
  const te = [(xa + xb) / 2, (ya + yb) / 2]
  let le = coords[0]
  let length = 0
  for (const p of coords) {
    const d = Math.hypot(p[0] - te[0], p[1] - te[1])
    if (d > length) {
      length = d
      le = p
    }
  }
  return { le, te, length, angle: Math.atan2(te[1] - le[1], te[0] - le[0]) }
}

// A section whose chord isn't 1, moved, turned and scaled so it runs from (0, 0) to (1, 0).
// The database has some elements of multi-element sets as files of their own, still placed
// where they sit in the set (a flap 0.3 long, nose at x = 0.87, drooped 30°), and a few
// sections with an extension past x = 1. A section within `tolerance` of unit chord is left
// as it is, so flat-bottomed sections drawn with the nose above the chord line keep it there.
export function normaliseChord(coords, tolerance = 0.02) {
  const { le, length, angle } = chordLine(coords)
  if (!(length > 0) || Math.abs(length - 1) <= tolerance) return coords
  const c = Math.cos(angle)
  const s = Math.sin(angle)
  return coords.map(([x, y]) => {
    const dx = x - le[0]
    const dy = y - le[1]
    return [(dx * c + dy * s) / length, (dy * c - dx * s) / length]
  })
}

// Unpack integer-packed coordinates (see scripts/fetch-airfoils.mjs).
export function unpack(pts, scale = 10000) {
  const out = []
  for (let i = 0; i + 1 < pts.length; i += 2) out.push([pts[i] / scale, pts[i + 1] / scale])
  return out
}
