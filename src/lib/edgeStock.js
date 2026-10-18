// Leading and trailing edge stock: standard balsa sections as sold (SLEC's range, all in
// 915 mm lengths), whether each can be carved to the wing's section, and the choice of one
// to suit.
//
// Stock comes part-shaped and is carved to the aerofoil once glued on. Carving only removes
// wood, so the stock's profile has to contain the section over its whole depth: a stock
// "fits" if, placed at its best height, it's at least as big as the section everywhere from
// the rib face to the edge. A flat-bottomed profile is placed by its flat face; a symmetrical
// one can sit wherever suits.
//
// A stock's width is its depth along the chord (how far the ribs are cut back); its height
// is how tall it stands at the rib face. Sizes are SLEC's own metric figures, in metres.
// The pre-shaped profiles' curves are modelled as ellipse quadrants: close to the real
// thing, which is near enough for a check on wood that gets carved anyway.

export const STOCK_LENGTH = 0.915

const mm = (v) => v / 1000

// kind: 'symmetrical' (flat back, rounded front), 'strip' (plain strip, glued on edge),
// 'triangular' (flat bottom, full thickness at the rib face, tapering to an edge), 'block' (a
// custom leading edge: a plain rectangle, carved to the section).
// Each LE_SIZES row is [depth, inch, flat code, symmetrical code]: the flat profile is retired,
// and its codes map to the symmetrical one of the same size (see migrateLeStockId).
const LE_SIZES = [
  [6.5, '1/4"', 'L320', 'L325'],
  [9.5, '3/8"', 'L330', 'L335'],
  [12.5, '1/2"', 'L340', 'L345'],
  [19, '3/4"', 'L350', 'L355'],
  [25, '1"', 'L360', 'L365'],
]
// Strip, depth × height as glued on edge (SLEC: thickness × width); the sizes big enough to
// make a leading edge
const STRIPS = [
  ['L242', 3.2, 6.5, '1/8"', '1/4"'],
  ['L243', 3.2, 9.5, '1/8"', '3/8"'],
  ['L244', 3.2, 12.5, '1/8"', '1/2"'],
  ['L251', 4.5, 6.5, '3/16"', '1/4"'],
  ['L252', 4.5, 9.5, '3/16"', '3/8"'],
  ['L253', 4.5, 12.5, '3/16"', '1/2"'],
  ['L260', 6.5, 6.5, '1/4"', '1/4"'],
  ['L261', 6.5, 9.5, '1/4"', '3/8"'],
  ['L262', 6.5, 12.5, '1/4"', '1/2"'],
  ['L263', 6.5, 25, '1/4"', '1"'],
  ['L265', 8, 8, '5/16"', '5/16"'],
  ['L270', 9.5, 9.5, '3/8"', '3/8"'],
  ['L271', 9.5, 12.5, '3/8"', '1/2"'],
  ['L280', 12.5, 12.5, '1/2"', '1/2"'],
  ['L281', 12.5, 25, '1/2"', '1"'],
  ['L290', 19, 19, '3/4"', '3/4"'],
]
export const LE_STOCK = [
  ...LE_SIZES.map(([s, inch, , code]) => ({ id: code, code, kind: 'symmetrical', width: mm(s), height: mm(s), inch: `${inch} × ${inch}` })),
  ...STRIPS.map(([code, d, h, di, hi]) => ({ id: code, code, kind: 'strip', width: mm(d), height: mm(h), inch: `${di} × ${hi}` })),
]

// Retired flat leading-edge codes (saved projects may still name them) and their symmetrical
// stock of the same size
const FLAT_TO_SYMMETRICAL = Object.fromEntries(LE_SIZES.map(([, , flat, sym]) => [flat, sym]))
export function migrateLeStockId(id) {
  return FLAT_TO_SYMMETRICAL[id] ?? id
}

// Triangular, thickness × width
export const TE_STOCK = [
  ['L420', 3.2, 9.5, '1/8" × 3/8"'],
  ['L421', 3.2, 12.5, '1/8" × 1/2"'],
  ['L429', 3.2, 16, '1/8" × 5/8"'],
  ['L430', 5, 12.5, '3/16" × 1/2"'],
  ['L431', 5, 19, '3/16" × 3/4"'],
  ['L440', 6.5, 19, '1/4" × 3/4"'],
  ['L441', 6.5, 25, '1/4" × 1"'],
  ['L450', 8, 32, '5/16" × 1 1/4"'],
  ['L452', 9.5, 32, '3/8" × 1 1/4"'],
  ['L451', 12.5, 32, '1/2" × 1 1/4"'],
  ['L460', 9.5, 38, '3/8" × 1 1/2"'],
  ['L470', 12.5, 38, '1/2" × 1 1/2"'],
  ['L471', 9.5, 50, '3/8" × 2"'],
  ['L472', 12.5, 50, '1/2" × 2"'],
].map(([code, t, w, inch]) => ({ id: code, code, kind: 'triangular', width: mm(w), height: mm(t), inch }))
  // Square strip (the square sizes of the strip range above): a bolster with wood right through,
  // for hinge slots and strength, carved to the section like the rest. Offered by hand, never
  // picked by Auto.
  .concat(STRIPS.filter(([, d, h]) => d === h).map(([code, d, , di]) => ({ id: `${code}-te`, code, kind: 'square', width: mm(d), height: mm(d), inch: `${di} × ${di}` })))

export const KIND_LABELS = { symmetrical: 'symmetrical', strip: 'strip on edge', triangular: 'triangular', square: 'square', block: 'block' }

// What the leading edge is made of: balsa stock (the catalogue above, or a custom size),
// round stock (carbon rod or hardwood dowel, by diameter) or nothing, the sheeting itself
// forming the nose.
export const LE_TYPES = {
  balsa: { label: 'Balsa stock' },
  rod: { label: 'Carbon rod', short: 'carbon rod', material: 'carbon-rod', length: 1, sizes: [1.5, 2, 3, 4, 5, 6, 8].map(mm), default: mm(3) },
  dowel: { label: 'Hardwood dowel', short: 'hardwood dowel', material: 'hardwood', length: STOCK_LENGTH, sizes: [3, 4, 5, 6, 8, 10].map(mm), default: mm(5) },
  none: { label: 'None, sheeted nose' },
}
export const isRound = (le) => le?.type === 'rod' || le?.type === 'dowel'
// The diameter in use: as set, or the type's default size
export function roundDiameter(le) {
  if (Number.isFinite(le.diameter) && le.diameter > 0) return le.diameter
  return LE_TYPES[le.type]?.default ?? 0.003
}

// Carving takes up a little; stock this much short of the section still counts as fitting
const TOLERANCE = 0.0002
// Auto never picks stock shallower along the chord than this (flimsier won't take knocks or
// the covering's pull): the larger of a fixed depth and a fraction of the root chord
const LE_MIN = { depth: 0.006, chord: 0.025 }
const TE_MIN = { depth: 0, chord: 0.05 }
const SAMPLES = 24
const TE_EDGE = 0.0005

// The stock's profile as bottom and top heights above its reference line, at u from its
// edge (the nose or the trailing edge, u = 0) back to the rib face (u = width).
function profile(item, u) {
  const { width: W, height: H } = item
  const e = Math.sqrt(Math.max(0, 1 - ((W - u) / W) ** 2))
  switch (item.kind) {
    case 'symmetrical':
      return [(H / 2) * (1 - e), (H / 2) * (1 + e)]
    case 'triangular':
      // Not a knife edge as sold: about half a millimetre at the thin end, tapering straight to
      // its full thickness at the back
      return [0, TE_EDGE + ((H - TE_EDGE) * u) / W]
    default:
      return [0, H]
  }
}

// The closed cross-section as [[u, z], ...] in metres: the top from the edge (u = 0) back to the
// rib face (u = width), then the bottom back again. Closer together towards the edge, where a
// rounded profile curves fastest. The thumbnails and the fit drawing both draw this.
export function profileOutline(item, n = 24) {
  const top = []
  const bottom = []
  for (let i = 0; i <= n; i++) {
    const u = item.width * (1 - Math.cos((Math.PI * i) / n / 2))
    const [b, t] = profile(item, u)
    top.push([u, t])
    bottom.push([u, b])
  }
  return [...top, ...bottom.reverse()]
}

function stockArea(item) {
  const { width: W, height: H } = item
  if (item.kind === 'symmetrical') return (Math.PI / 4) * W * H
  if (item.kind === 'triangular') return (W * (H + TE_EDGE)) / 2
  return W * H
}

// --- Carved stock: where it goes and how well it fits ------------------------------------------
//
// At one station, in the plane of the section: v runs from the edge into the wing (aft from the
// nose, forward from the trailing edge) and y is height. The stock as sold is placed by three
// numbers: d, how far its front (its own edge) sits ahead of the wing's edge (the part ahead of
// the edge is carved away); theta, the angle it's turned through (0 for stock square to the rib
// face, its back face flat against the square-cut rib; otherwise turned to follow the camber,
// the rib face cut to match); and n, how far it slides along its own normal to its best height.
// Its axis is e = (cos theta, sin theta), its normal m = (-sin theta, cos theta), and a point
// (u, z) of its profile sits at A + u e + (z + n) m, A = (-d, the edge's own height).
// It fits when every point of the section ahead of its back face (u <= its width) is inside it:
// shortfall is how much taller (along its normal) it would need to be; 0 or less fits.
// +-15 degrees in half degrees, the smallest first: a turn has to earn its place
const ROTATIONS = Array.from({ length: 61 }, (_, i) => (((i - 30) / 2) * Math.PI) / 180).sort((p, q) => Math.abs(p) - Math.abs(q) || p - q)
// Turning stock is worth it only if it saves at least this share of the stock as sold
const TURN_GAIN = 0.01
const SECTION_SAMPLES = 40

// The section's surfaces at v from the edge. At the trailing edge the stock's own edge becomes
// the wing's, so the section's trailing-edge thickness doesn't count: it's closed, blended out
// over the stock's depth W.
function edgeSurfaces(sec, edge, W) {
  const end = sec.surf(edge === 'le' ? 0 : 1)
  const gap = edge === 'te' ? Math.max(0, end.upper - end.lower) : 0
  return (v) => {
    const xi = edge === 'le' ? v / sec.c : 1 - v / sec.c
    const f = sec.surf(Math.min(1, Math.max(0, xi)))
    const close = (gap / 2) * Math.max(0, 1 - v / W)
    return { upper: f.upper - close, lower: f.lower + close }
  }
}

// What the fit needs at one station for one item: the section's surface points near the edge
// (closer together at the edge, where it curves fastest), its height at the edge and the
// section's area from the edge back to any depth (the wood that ends up as wing)
function stationShape(item, sec, edge) {
  const W = Math.min(item.width, sec.c)
  const surf = edgeSurfaces(sec, edge, W)
  const reach = Math.min(sec.c, 1.4 * (W + item.height))
  const pts = []
  const cols = []
  for (let i = 0; i <= SECTION_SAMPLES; i++) {
    const v = reach * (1 - Math.cos((Math.PI * i) / SECTION_SAMPLES / 2))
    const f = surf(v)
    pts.push({ v, y: f.upper }, { v, y: f.lower })
    cols.push({ v, upper: f.upper, lower: f.lower })
  }
  const e0 = surf(0)
  return { W, H: item.height, pts, cols, y0: (e0.upper + e0.lower) / 2, surf }
}

// The stock at offset d and angle theta: its shortfall, its best normal offset n, how deep its
// back face reaches into the wing at mid-height (the ribs are cut back to there) and the wood
// that stays as wing (the section's area ahead of the face)
function placeAt(item, shape, d, theta) {
  const { W, H, pts, y0 } = shape
  const cs = Math.cos(theta)
  const sn = Math.sin(theta)
  let hi = -Infinity
  let lo = Infinity
  let behind = 0
  for (const p of pts) {
    const dx = p.v + d
    const dy = p.y - y0
    const u = dx * cs + dy * sn
    if (u > W) continue
    // Ahead of the stock's own front: it can't reach there at all
    if (u < 0) {
      behind = Math.max(behind, -u)
      continue
    }
    const w = -dx * sn + dy * cs
    const [b, t] = profile(item, u)
    hi = Math.max(hi, w - t)
    lo = Math.min(lo, w - b)
  }
  if (!Number.isFinite(hi)) hi = lo = 0
  const n = (hi + lo) / 2
  const depth = -d + W * cs - (n + H / 2) * sn
  // The face: v = vP - (y - yP) tan(theta). Each column of the section, lower to upper, is cut
  // where it crosses it; what's ahead of the face is wood that stays as wing.
  const vP = -d + W * cs - n * sn
  const yP = y0 + W * sn + n * cs
  const tn = sn / cs
  const ahead = (c) => {
    if (Math.abs(tn) < 1e-12) return c.v <= vP ? c.upper - c.lower : 0
    // v <= vP - (y - yP) tn  <=>  y <= yP + (vP - v) / tn  (tn > 0), or >= (tn < 0)
    const yc = yP + (vP - c.v) / tn
    return tn > 0 ? Math.max(0, Math.min(c.upper, yc) - c.lower) : Math.max(0, c.upper - Math.max(c.lower, yc))
  }
  let used = 0
  const { cols } = shape
  for (let i = 1; i < cols.length; i++) used += ((ahead(cols[i]) + ahead(cols[i - 1])) / 2) * (cols[i].v - cols[i - 1].v)
  return { shortfall: hi - lo + behind, n, d, theta, depth, used }
}

// Stock let into the ribs (mode 'inset', the leading edge only): a strip at the nose in a notch in the rib's lower
// corner, the rib over it and behind it. It's turned so its bottom face runs along the lower
// surface behind the edge's own curve (a straight line fitted to it from half the strip's depth
// to twice it: the profile's base, not the nose's curve), set just low enough to be at
// or below the lower surface everywhere along it (carved to it), and its front comes right to
// the edge: nothing of the section under its top is left ahead of it. It fits if the rib over
// its back corner keeps at least INSET_RIB of material; ahead of that the rib runs out and the
// strip forms the edge itself. shortfall is how much more depth that needs (0 or less fits).
const INSET_RIB = 0.0015

// Area of a polygon
const polyArea = (pts) => Math.abs(pts.reduce((t, [x1, y1], i) => {
  const [x2, y2] = pts[(i + 1) % pts.length]
  return t + x1 * y2 - x2 * y1
}, 0)) / 2

function placeInset(item, shape) {
  const { W, H, cols, y0 } = shape
  let near = cols.filter((c) => c.v >= W / 2 && c.v <= 2 * W)
  if (near.length < 3) near = cols.filter((c) => c.v <= 2 * W)
  let sv = 0, sy = 0, svv = 0, svy = 0
  for (const c of near) {
    sv += c.v
    sy += c.lower
    svv += c.v * c.v
    svy += c.v * c.lower
  }
  const N = near.length
  const theta = Math.atan((N * svy - sv * sy) / (N * svv - sv * sv || 1))
  const cs = Math.cos(theta)
  const sn = Math.sin(theta)
  const frame = (v, y, d) => {
    const dx = v + d
    const dy = y - y0
    return [dx * cs + dy * sn, -dx * sn + dy * cs]
  }
  let d = 0
  let n = 0
  for (let it = 0; it < 4; it++) {
    let nb = Infinity
    for (const c of cols) {
      const [u, w] = frame(c.v, c.lower, d)
      if (u >= 0 && u <= W) nb = Math.min(nb, w)
    }
    n = Number.isFinite(nb) ? nb : 0
    let umin = 0
    for (const c of cols) {
      for (const y of [c.upper, c.lower]) {
        const [u, w] = frame(c.v, y, d)
        if (u <= W && w - n <= H && w - n >= -1e-9) umin = Math.min(umin, u)
      }
    }
    if (umin > -1e-9) break
    d -= umin
  }
  // The upper surface over the strip's back corner (u = W), and the rib left over it
  const up = cols.map((c) => frame(c.v, c.upper, d)).sort((p, q) => p[0] - q[0])
  let wUp = up.at(-1)[1]
  for (let i = 1; i < up.length; i++) {
    if (up[i][0] >= W) {
      const [u0, w0] = up[i - 1]
      const [u1, w1] = up[i]
      wUp = w0 + ((w1 - w0) * (W - u0)) / (u1 - u0 || 1)
      break
    }
  }
  const over = wUp - n - H
  // The section inside the strip: what's left of it once carved
  const toV = (u, z) => [-d + u * cs - (z + n) * sn, y0 + u * sn + (z + n) * cs]
  const toU = ([v, y]) => {
    const [u, w] = frame(v, y, d)
    return [u, w - n]
  }
  const section = [...cols.map((c) => [c.v, c.upper]).reverse(), ...cols.map((c) => [c.v, c.lower])]
  let carved = section
  // Its top: flat, or a triangular strip's slope down to its thin edge
  const topAt = (u) => profile(item, Math.min(W, Math.max(0, u)))[1]
  for (const keep of [(q) => toU(q)[0], (q) => W - toU(q)[0], (q) => toU(q)[1], (q) => topAt(toU(q)[0]) - toU(q)[1]]) carved = clipPolygon(carved, keep)
  const used = carved.length > 2 ? polyArea(carved) : 0
  const depth = -d + W * cs - (n + H / 2) * sn
  // The rib's minimum is strict: no carving allowance (shortfall is offset so that fitting,
  // shortfall <= TOLERANCE, means at least INSET_RIB of rib)
  return { shortfall: INSET_RIB - over + TOLERANCE, n, d, theta, depth, used, over, carved, toV, toU, fits: over >= INSET_RIB - 1e-9, inset: true }
}

// Where sheeting starts over an inset leading-edge strip, back from the nose (m): on top, where
// the rib (under a sheet of thickness t) runs out over the strip, ahead of which the strip is
// the surface; underneath, at the strip's back, since its bottom is the lower surface ahead of
// that. feather: the thinnest the rib runs out to.
export function insetSheetStarts(item, sec, t, feather = 0.0005) {
  const P = insetPlacement(item, sec)
  const [vF, yF] = P.toV(0, P.H)
  const [vB, yB] = P.toV(P.W, P.H)
  const stripTop = (v) => yF + ((yB - yF) * (v - vF)) / (vB - vF || 1e-9)
  let top = vB
  for (let v = 0; v < vB; v += 0.0001) {
    if (sec.surf(Math.min(1, v / sec.c)).upper - t - stripTop(v) >= feather) {
      top = v
      break
    }
  }
  return { top, bottom: P.toV(P.W, 0)[0] }
}

// An inset leading edge's strip at one section, for the ribs and the 3D view: toV maps a point
// (u, z) of the strip (u back from its front, z up from its bottom) to the section's (v, y), v
// back from the nose; also its width W and height H, the carved strip (the section inside it,
// in (v, y)) and its angle
export function insetPlacement(item, sec) {
  const shape = stationShape(item, sec, 'le')
  const f = placeInset(item, shape)
  return { ...f, W: shape.W, H: item.height }
}

// The best placement at one station for offset d: square stock at its best height; stock turned
// to the camber at the angle that fits with the most of it used (or, if none fits, that falls
// least short), or at the angle given (theta)
function stationFit(item, shape, d, mode, theta = null) {
  if (mode === 'inset') {
    const f = placeInset(item, shape)
    return { ...f, waste: Math.max(0, stockArea(item) - f.used) }
  }
  let best = null
  for (const t of theta != null ? [theta] : mode === 'rotated' ? ROTATIONS : [0]) {
    const f = placeAt(item, shape, d, t)
    const fits = f.shortfall <= TOLERANCE
    const gain = TURN_GAIN * stockArea(item)
    if (!best || (fits && (!best.fits || f.used > best.used + gain)) || (!fits && !best.fits && f.shortfall < best.shortfall)) best = { ...f, fits }
  }
  return { ...best, waste: Math.max(0, stockArea(item) - best.used) }
}

// How well a rod or dowel of diameter D fits the nose of the section at s. It sits with its
// front at the nose and forms the nose itself; the ribs are notched for it back to its
// centre line, where the sheeting or covering meets it. It can't be carved, so it fits if
// its rear half (from that centre line back) is inside the section, at its best height:
// shortfall is how far it stands proud of the surface there (0 or less fits). Its front
// half is the new nose, a little blunter or sharper than the section's own. Returns the
// centre height too.
// The coordinate points are too sparse at the nose to follow its curve (straight between
// them, the nose comes out as a wedge, which no circle fits), so ahead of 2% of the chord
// the section is taken as rounded: its height off the nose point grows with the square
// root of the distance back, scaled from 2%. That's slightly inside a NACA nose.
const NOSE_REF = 0.02
export function noseSurf(sec, xi) {
  const f = sec.surf(xi)
  if (!(xi < NOSE_REF) || xi <= 0) return f
  const n = sec.surf(0)
  const ref = sec.surf(NOSE_REF)
  const k = Math.sqrt(xi / NOSE_REF)
  return { upper: Math.max(f.upper, n.upper + (ref.upper - n.upper) * k), lower: Math.min(f.lower, n.lower + (ref.lower - n.lower) * k) }
}

export function roundFitAt(D, sec) {
  const r = D / 2
  let hiNeed = -Infinity
  let loMax = Infinity
  for (let i = 0; i <= SAMPLES; i++) {
    // Closer together at the centre line, where the rod is tallest
    const u = r + r * (1 - Math.cos((Math.PI * i) / SAMPLES / 2))
    const h = Math.sqrt(Math.max(0, r * r - (u - r) ** 2))
    const f = noseSurf(sec, Math.min(1, u / sec.c))
    hiNeed = Math.max(hiNeed, f.lower + h)
    loMax = Math.min(loMax, f.upper - h)
  }
  return { shortfall: hiNeed - loMax, centre: (hiNeed + loMax) / 2, waste: 0 }
}

// Worst fit over the stations, and the total waste (a stand-in for volume carved away), where
// it's worst (worstS), the placement at each station (at) and the angle (theta). Carved stock
// sits at offset d, square or turned to the camber (mode 'square' or 'rotated'); turned, it's
// one straight strip, so it takes the one angle that suits every station best: the one that
// fits everywhere with the least waste, or failing that falls least short where it's worst. A
// rod or dowel is checked as itself.
// shapes caches each station's section samples for the item across calls (the angle search
// asks for the same stations many times).
export function fitOver(item, section, stations, edge, { d = 0, mode = 'square', theta = null } = {}, shapes = new Map()) {
  if (item.kind !== 'round' && mode === 'rotated' && theta == null) {
    let best = null
    for (const t of ROTATIONS) {
      const f = fitOver(item, section, stations, edge, { d, mode, theta: t }, shapes)
      // Turned only where it saves a worthwhile share of the stock at every station together
      const gain = TURN_GAIN * stockArea(item) * Math.max(1, f.at.length)
      if (!best || (f.fits && (!best.fits || f.waste < best.waste - gain)) || (!f.fits && !best.fits && f.shortfall < best.shortfall)) best = f
    }
    return best
  }
  let shortfall = -Infinity
  let waste = 0
  let worstS = stations[0] ?? 0
  const at = []
  for (const s of stations) {
    const sec = section(s)
    if (!sec || !(sec.c > 1e-4)) continue
    if (item.kind !== 'round' && !shapes.has(s)) shapes.set(s, stationShape(item, sec, edge))
    const f = item.kind === 'round' ? roundFitAt(item.width, sec) : stationFit(item, shapes.get(s), Math.min(d, item.width * 0.9), mode, mode === 'inset' ? null : theta ?? 0)
    at.push({ s, ...f })
    if (f.shortfall > shortfall) {
      shortfall = f.shortfall
      worstS = s
    }
    waste += f.waste
  }
  return { shortfall, waste, worstS, fits: shortfall <= TOLERANCE, at, theta: theta ?? 0 }
}

// The rib face behind (or, at the trailing edge, ahead of) placed carved stock at one station:
// how far it is from the wing's edge along the chord at any height y of the section (at), and
// at the stock's mid-height (depth). Square stock's face is the same distance at every height.
export function edgeFace(item, sec, edge, { d = 0, theta = 0 } = {}) {
  const shape = stationShape(item, sec, edge)
  const f = placeAt(item, shape, Math.min(d, item.width * 0.9), theta)
  const cs = Math.cos(theta)
  const sn = Math.sin(theta)
  const vP = -f.d + shape.W * cs - f.n * sn
  const yP = shape.y0 + shape.W * sn + f.n * cs
  return { at: (y) => vP - ((y - yP) * sn) / cs, depth: f.depth, theta }
}

// Where carved stock goes (square, or turned to the camber): at the edge if it fits there;
// otherwise as little ahead of the edge as makes it fit, keeping at least floor of it in the
// wing (the part ahead is carved away, and it reaches less far in, where the section is
// thinner). Stock that fits nowhere stays at the edge and is warned about there. Round stock is
// always at the nose. Returns fitOver's result with the offset d.
const OFFSET_STEPS = 16
export function bestPlacement(item, section, stations, edge, { mode = 'square', floor = 0 } = {}) {
  const shapes = new Map()
  const at0 = fitOver(item, section, stations, edge, { mode }, shapes)
  // Let into the ribs, the strip always comes right to the edge
  if (item.kind === 'round' || at0.fits || mode === 'inset') return { d: 0, ...at0 }
  const most = Math.max(0, Math.min(item.width * 0.6, item.width - floor))
  for (let i = 1; i <= OFFSET_STEPS; i++) {
    const d = (most * i) / OFFSET_STEPS
    const f = fitOver(item, section, stations, edge, { d, mode }, shapes)
    if (f.fits) return { d, ...f }
  }
  return { d: 0, ...at0 }
}

// Of the items deep enough along the chord, those that fit with the least waste (at the edge if
// any do, else set ahead of it); if none fits, the one that falls least short
// Let into the ribs, a strip can stand on edge (its longer side up) or lie flat (its longer side
// along the chord), whichever way the catalogue lists it. Each way keeps the size it's sold at
// (sold: [depth, height] as listed) for the cut list.
const canLie = (x) => (x.kind === 'strip' || x.kind === 'block') && Math.abs(x.width - x.height) > 1e-6
const turnedTo = (x, laid) => {
  const long = Math.max(x.width, x.height)
  const short = Math.min(x.width, x.height)
  const [width, height] = laid === 'flat' ? [long, short] : [short, long]
  return { ...x, width, height, laid, sold: x.sold ?? [x.width, x.height] }
}
// The ways a strip may go in: lay 'edge', 'flat', or 'best' (either)
const lays = (x, lay) => (!canLie(x) ? [x] : lay === 'best' ? [turnedTo(x, 'edge'), turnedTo(x, 'flat')] : [turnedTo(x, lay)])

// Let into the ribs, only flat-sided stock will do (strips, square and triangular)
const INSET_KINDS = new Set(['strip', 'square', 'triangular', 'block'])
function pick(list, section, stations, edge, min, mode) {
  const rootC = section(stations[0])?.c ?? 0
  const floor = Math.max(min.depth, min.chord * rootC) - 1e-9
  if (mode === 'inset' && list.some((x) => INSET_KINDS.has(x.kind))) list = list.filter((x) => INSET_KINDS.has(x.kind))
  const pool = list.filter((x) => x.width >= floor)
  const scored = (pool.length ? pool : list).map((item) => ({ item, ...bestPlacement(item, section, stations, edge, { mode, floor }) }))
  const atEdge = scored.filter((x) => x.fits && !(x.d > 0))
  const ahead = scored.filter((x) => x.fits && x.d > 0)
  for (const set of [atEdge, ahead]) if (set.length) return set.reduce((a, b) => (b.waste < a.waste ? b : a)).item
  return scored.reduce((a, b) => (b.shortfall < a.shortfall ? b : a)).item
}

// The part of a polygon where keep(p) >= 0 (clipped against one line)
export function clipPolygon(poly, keep) {
  const out = []
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i]
    const b = poly[(i + 1) % poly.length]
    const fa = keep(a)
    const fb = keep(b)
    if (fa >= 0) out.push(a)
    if (fa >= 0 !== fb >= 0) {
      const t = fa / (fa - fb)
      out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t])
    }
  }
  return out
}

// The fit at one station, for drawing. x runs aft from the nose for the leading edge, forward
// from the trailing edge as negative values, so the drawing reads like the wing; z is height,
// both in metres. Every drawing has the section's upper and lower surfaces (as lines) and stock
// (the stock as sold, placed; a rod or dowel as its circle). Carved stock also has carved (what
// is left of it once carved to the section), rib (the rib, from its face back), face (the rib
// face, where the stock's flat back is glued: square to the chord, or at the stock's angle),
// offset (how far the stock sits ahead of the edge), angle (radians) and depth (how far it
// reaches into the wing). short holds the disagreements: for carved stock, the section outside
// the stock (wood it would need and hasn't got); for round stock, the rod outside the section
// (where it stands proud); worst is the worst point of them.
export function fitDrawing(item, sec, edge, { d = 0, mode = 'square', theta = null } = {}) {
  const sign = edge === 'le' ? 1 : -1
  const W = Math.min(item.width, sec.c)
  const short = []
  let worst = null
  let most = 0
  // Runs where one shape (a) is past another (b): slivers between them
  const runs = (rows, map) => {
    let cur = []
    const flush = () => {
      if (cur.length > 1) short.push([...cur.map((r) => map(r.x, r.a)), ...[...cur].reverse().map((r) => map(r.x, r.b))])
      cur = []
    }
    for (const r of rows) {
      // Within the carving allowance it fits, so it isn't shown
      if (r && r.over > TOLERANCE) {
        cur.push(r)
        if (r.over > most) {
          most = r.over
          worst = map(r.x, (r.a + r.b) / 2)
        }
      } else flush()
    }
    flush()
  }
  if (item.kind === 'round') {
    const reach = Math.min(sec.c, W * 1.6)
    const surf = (u) => noseSurf(sec, Math.min(1, Math.max(0, u / sec.c)))
    const us = Array.from({ length: 49 }, (_, i) => reach * (1 - Math.cos((Math.PI * i) / 48 / 2)))
    const r = W / 2
    const { centre } = roundFitAt(W, sec)
    const stock = Array.from({ length: 48 }, (_, i) => [r + r * Math.cos((2 * Math.PI * i) / 48), centre + r * Math.sin((2 * Math.PI * i) / 48)])
    const rear = us.filter((u) => u >= r && u <= W)
    const h = (u) => Math.sqrt(Math.max(0, r * r - (u - r) ** 2))
    const id = (x, z) => [x, z]
    runs(rear.map((u) => ({ x: u, a: centre + h(u), b: surf(u).upper, over: centre + h(u) - surf(u).upper })), id)
    runs(rear.map((u) => ({ x: u, a: surf(u).lower, b: centre - h(u), over: surf(u).lower - (centre - h(u)) })), id)
    return { edge, x0: 0, x1: reach, upper: us.map((u) => [u, surf(u).upper]), lower: us.map((u) => [u, surf(u).lower]), stock, short, worst, offset: 0 }
  }
  const shape = stationShape(item, sec, edge)
  const flipX = (pts) => pts.map(([v, y]) => [sign * v, y])
  if (mode === 'inset') {
    // Let into the rib: the rib is the whole section, the strip in its notch drawn over it; the
    // faces it's glued on are its top and back
    const f = placeInset(item, shape)
    const vs = Array.from({ length: 49 }, (_, i) => Math.min(sec.c, Math.max(f.depth, W) * 1.8) * (1 - Math.cos((Math.PI * i) / 48 / 2)))
    const upperV = vs.map((v) => [v, shape.surf(v).upper])
    const lowerV = vs.map((v) => [v, shape.surf(v).lower])
    const section = [...[...upperV].reverse(), ...lowerV]
    const stock = profileOutline({ ...item, width: W }, 24).map(([u, z]) => f.toV(u, z))
    const H = item.height
    const face = [f.toV(0, H), f.toV(W, H), f.toV(W, 0)]
    // Red: the strip's back corner where it's through the upper surface or the rib over it is
    // too thin to keep
    const short = []
    let worst = null
    if (!f.fits) {
      const corner = f.toV(W, H)
      worst = corner
      short.push([f.toV(W - Math.min(W, 0.002), H - 0.0005), f.toV(W, H - 0.0005), f.toV(W, H + INSET_RIB), f.toV(W - Math.min(W, 0.002), H + INSET_RIB)])
    }
    const xs = [...stock, ...section].map(([v]) => sign * v)
    return {
      edge, x0: Math.min(...xs), x1: Math.max(...xs),
      upper: flipX(upperV), lower: flipX(lowerV), stock: flipX(stock), carved: flipX(f.carved), rib: flipX(section), face: flipX(face),
      short: short.map(flipX), worst: worst && flipX([worst])[0], offset: f.d, angle: f.theta, depth: f.depth, inset: true, over: f.over, laid: item.laid ?? null,
    }
  }
  const f = stationFit(item, shape, Math.min(d, W * 0.9), mode, theta)
  const cs = Math.cos(f.theta)
  const sn = Math.sin(f.theta)
  const { y0 } = shape
  // The stock's (u, z) to the section's (v, y), and back
  const toV = (u, z) => [-f.d + u * cs - (z + f.n) * sn, y0 + u * sn + (z + f.n) * cs]
  const toU = ([v, y]) => {
    const dx = v + f.d
    const dy = y - y0
    return [dx * cs + dy * sn, -dx * sn + dy * cs - f.n]
  }
  const reach = Math.min(sec.c, Math.max(f.depth, 0.4 * W) * 1.8 + item.height * Math.abs(sn))
  const vs = Array.from({ length: 49 }, (_, i) => reach * (1 - Math.cos((Math.PI * i) / 48 / 2)))
  const upperV = vs.map((v) => [v, shape.surf(v).upper])
  const lowerV = vs.map((v) => [v, shape.surf(v).lower])
  const section = [...[...upperV].reverse(), ...lowerV]
  const stock = profileOutline({ ...item, width: W }, 24).map(([u, z]) => toV(u, z))
  const ahead = (p) => W - toU(p)[0]
  const carved = clipPolygon(section, ahead)
  const rib = clipPolygon(section, (p) => -ahead(p))
  const face = [toV(W, -0.1 * item.height), toV(W, 1.1 * item.height)]
  // Where the section runs outside the stock: above its top, or below its bottom
  const outside = (line, top) =>
    line.map((p) => {
      const [u, w] = toU(p)
      if (u < 0 || u > W) return null
      const [b, t] = profile(item, u)
      return top ? { x: u, a: w, b: t, over: w - t } : { x: u, a: b, b: w, over: b - w }
    })
  runs(outside(upperV, true), toV)
  runs(outside(lowerV, false), toV)
  const flip = (pts) => pts.map(([v, y]) => [sign * v, y])
  const xs = [...stock, ...section].map(([v]) => sign * v)
  return {
    edge,
    x0: Math.min(...xs),
    x1: Math.max(...xs),
    upper: flip(upperV),
    lower: flip(lowerV),
    stock: flip(stock),
    carved: flip(carved),
    rib: flip(rib),
    face: flip(face),
    short: short.map(flip),
    worst: worst && flip([worst])[0],
    offset: f.d,
    angle: f.theta,
    depth: f.depth,
  }
}

// The stock to use for each edge, and how well it fits. structure.le.stock and
// structure.te.stock are 'auto' (picked to suit), 'custom' (as entered: a custom leading edge is
// a block le.width deep by le.height tall, checked like catalogue stock; a
// custom trailing edge is width only, unchecked) or a catalogue id (a retired flat leading-edge
// code reads as the symmetrical stock of the same size). stations: the span positions to check (root, panel ends, tip).
// A round leading edge (structure.le.type 'rod' or 'dowel') is checked at its diameter, and
// one of type 'none' has no stock at all.
// Returns { le, te }: each { width, height (null for custom), item (or null), auto,
// autoFits, shortfall, worstS (where the fit is worst), fits }; a round leading edge has
// round: { type, diameter, material } and the largest size that fits (roundFits, or null).
export function resolveEdges(structure, section, stations) {
  const out = {}
  for (const [k, list, min] of [
    ['le', LE_STOCK, LE_MIN],
    ['te', TE_STOCK, TE_MIN],
  ]) {
    const e = structure[k]
    if (k === 'le' && e.type === 'none') {
      out.le = { width: 0, height: null, item: null, auto: null, autoFits: true, shortfall: 0, worstS: stations[0], fits: true, none: true }
      continue
    }
    if (k === 'le' && isRound(e)) {
      const t = LE_TYPES[e.type]
      const D = roundDiameter(e)
      const f = fitOver(roundItem(D), section, stations, k)
      const roundFits = [...t.sizes].reverse().find((d) => fitOver(roundItem(d), section, stations, k).fits) ?? null
      // The ribs stop at the rod's centre line, where the sheeting or covering meets it
      out.le = { width: D / 2, height: D, item: null, auto: null, autoFits: false, shortfall: f.shortfall, worstS: f.worstS, fits: f.fits, round: { type: e.type, diameter: D, material: t.material }, roundFits }
      continue
    }
    // Square to the rib face, turned to follow the camber, or (the leading edge only) let into
    // the ribs (e.fit)
    const mode = e.fit === 'rotated' || (e.fit === 'inset' && k === 'le') ? e.fit : 'square'
    // Let into the ribs, a strip stands on edge, lies flat, or whichever suits (e.lay)
    const lay = mode === 'inset' ? (e.lay === 'edge' || e.lay === 'flat' ? e.lay : 'best') : 'edge'
    const ways = (x) => (mode === 'inset' ? lays(x, lay) : [x])
    // Auto picks from the shaped stock; square trailing-edge strip is a deliberate choice
    const auto = pick(list.filter((x) => x.kind !== 'square').flatMap(ways), section, stations, k, min, mode)
    const id = k === 'le' ? migrateLeStockId(e.stock) : e.stock
    const custom = id === 'custom' && k === 'le' ? customLe(e) : null
    const floor = Math.max(min.depth, min.chord * (section(stations[0])?.c ?? 0))
    const chosen = id === 'custom' ? custom : list.find((x) => x.id === id)
    // A chosen strip let into the ribs goes in whichever of its ways fits with the least waste
    let item = id === 'auto' || !chosen ? (id === 'custom' ? custom : auto) : chosen
    if (chosen && mode === 'inset' && ways(chosen).length > 1) {
      const scored = ways(chosen).map((x) => ({ x, f: bestPlacement(x, section, stations, k, { mode, floor }) }))
      const fit = scored.filter((t) => t.f.fits)
      item = (fit.length ? fit.reduce((p, q) => (q.f.waste < p.f.waste ? q : p)) : scored.reduce((p, q) => (q.f.shortfall < p.f.shortfall ? q : p))).x
    } else if (chosen && mode === 'inset') item = ways(chosen)[0]
    const f = item ? bestPlacement(item, section, stations, k, { mode, floor }) : { d: 0, shortfall: 0, worstS: stations[0], fits: true, at: [] }
    const autoFits = item === auto ? f.fits : bestPlacement(auto, section, stations, k, { mode, floor }).fits
    // width is how far the stock reaches into the wing at the root, at mid-height (the ribs are
    // cut back by it): less than its own depth (stockWidth) when it's set ahead of the edge
    // (offset) or turned (angle, at the root)
    const root = f.at?.[0]
    const offset = f.d || 0
    const width = item ? Math.max(0.001, root?.depth ?? item.width - offset) : e.width || 0
    // Let into the ribs: where the strip's bottom stops being the lower surface (its bottom back
    // corner) at the root, as a chord fraction, for the cap strips underneath
    const rootSec = section(stations[0])
    const insetBottomXi = mode === 'inset' && item && rootSec ? insetSheetStarts(item, rootSec, 0).bottom / rootSec.c : null
    // Turned: where its face meets the upper and the lower surface at the root, as chord
    // fractions, for the capping and sheeting either side to meet it
    let faceXi = null
    if (mode === 'rotated' && item && rootSec && Math.abs(f.theta ?? 0) > 1e-6) {
      const F = edgeFace(item, rootSec, k, { d: offset, theta: f.theta })
      const xiOf = (v) => Math.min(1, Math.max(0, k === 'le' ? v / rootSec.c : 1 - v / rootSec.c))
      // Where the face meets the surface and the rib's surface under any cap strips, the more
      // forward of the two: from there the rib is under a strip, its end cut along the face
      const tCap = structure.covering?.capStrips ? structure.covering.capStripThickness || 0 : 0
      const meetAt = (which, off) => {
        let v = F.depth
        for (let i = 0; i < 8; i++) v = F.at(rootSec.surf(xiOf(v))[which] + off)
        return v
      }
      const meet = (which) => xiOf(Math.min(meetAt(which, 0), meetAt(which, which === 'upper' ? -tCap : tCap)))
      faceXi = { top: meet('upper'), bottom: meet('lower') }
    }
    out[k] = { width, height: item?.height ?? null, item, auto, autoFits, shortfall: f.shortfall, worstS: f.worstS, fits: f.fits, offset, angle: f.theta ?? 0, mode, stockWidth: item ? item.width : e.width || 0, insetBottomXi, faceXi }
  }
  return out
}

// A custom leading edge: a plain block at the entered depth and height, carved to the section
// (height defaults to the depth, as for the square catalogue sizes)
export const customLe = (e) => {
  const W = e.width || LE_MIN.depth
  const H = e.height || W
  const r = (v) => Math.round(v * 10000) / 10
  return { id: 'custom', code: `${r(W)} × ${r(H)} mm custom`, kind: 'block', custom: true, width: W, height: H }
}

// A rod or dowel as a fit-check item
export const roundItem = (D) => ({ kind: 'round', width: D, height: D })

// The structure with each edge's width (and type, for a catalogue trailing edge) set from
// the resolved stock, so everything downstream reads le.width / te.width as before. A round
// leading edge's width is its radius (the ribs stop at its centre line), with its diameter.
// Turned stock also carries face: what the ribs need to cut their face to its angle at any
// station (edgeFace's inputs: the item, its offset d and angle theta).
export function applyEdges(structure, edges) {
  const face = (e) => ({
    face: e.item && e.mode === 'rotated' && Math.abs(e.angle ?? 0) > 1e-6 ? { item: e.item, d: e.offset || 0, theta: e.angle, topXi: e.faceXi?.top, bottomXi: e.faceXi?.bottom } : null,
    inset: e.item && e.mode === 'inset' ? { item: e.item, bottomXi: e.insetBottomXi } : null,
  })
  return {
    ...structure,
    le: { ...structure.le, width: edges.le.width, height: edges.le.height, ...(edges.le.round ? { diameter: edges.le.round.diameter } : {}), ...face(edges.le) },
    te: { ...structure.te, width: edges.te.width, height: edges.te.height, type: edges.te.item ? edges.te.item.kind : structure.te.type, ...face(edges.te) },
  }
}

// How many stock lengths a set of pieces needs (first fit, longest first; a piece longer
// than a stock length is made from several joined).
export function lengthsToBuy(pieces, L = STOCK_LENGTH) {
  const bins = []
  const parts = []
  for (const p of pieces) {
    let left = p
    while (left > L + 1e-9) {
      parts.push(L)
      left -= L
    }
    if (left > 1e-6) parts.push(left)
  }
  parts.sort((a, b) => b - a)
  for (const p of parts) {
    const i = bins.findIndex((room) => room >= p - 1e-9)
    if (i >= 0) bins[i] -= p
    else bins.push(L - p)
  }
  return bins.length
}
