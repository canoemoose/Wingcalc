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
// 'triangular' (flat bottom, full thickness at the rib face, tapering to an edge).
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

export const KIND_LABELS = { symmetrical: 'symmetrical', strip: 'strip on edge', triangular: 'triangular' }

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
      // Not a knife edge as sold: about half a millimetre at the thin end
      return [0, Math.max(TE_EDGE, (H * u) / W)]
    default:
      return [0, H]
  }
}

// The closed cross-section as [[u, z], ...] in metres: the top from the edge (u = 0) back to the
// rib face (u = width), then the bottom back again. For drawing thumbnails.
export function profileOutline(item, n = 16) {
  const top = []
  const bottom = []
  for (let i = 0; i <= n; i++) {
    const u = (item.width * i) / n
    const [b, t] = profile(item, u)
    top.push([u, t])
    bottom.push([u, b])
  }
  return [...top, ...bottom.reverse()]
}

function stockArea(item) {
  const { width: W, height: H } = item
  if (item.kind === 'symmetrical') return (Math.PI / 4) * W * H
  if (item.kind === 'triangular') return (W * H) / 2
  return W * H
}

// How well an item fits the section at s: shortfall (how far it falls short of containing
// the section at its best height; 0 or less fits) and waste (stock area less the section's
// area over the stock's depth, i.e. what's carved away).
// The stock may be tilted (packed up at one end) to follow the section; a small tilt is a
// shear of the section, so the area carved away is the same at any tilt
const TILTS = Array.from({ length: 49 }, (_, i) => Math.tan((((i - 24) / 2) * Math.PI) / 180))

function fitAt(item, sec, edge) {
  const W = Math.min(item.width, sec.c)
  // The stock's own edge becomes the trailing edge, so the section's trailing edge
  // thickness doesn't count: close it, blended out over the stock's depth
  const end = sec.surf(edge === 'le' ? 0 : 1)
  const gap = edge === 'te' ? Math.max(0, end.upper - end.lower) : 0
  const pts = []
  let area = 0
  for (let i = 0; i <= SAMPLES; i++) {
    // Closer together towards the edge, where the section curves fastest
    const u = W * (1 - Math.cos((Math.PI * i) / SAMPLES / 2))
    const xi = edge === 'le' ? u / sec.c : 1 - u / sec.c
    const s = sec.surf(Math.min(1, Math.max(0, xi)))
    const close = (gap / 2) * (1 - u / W)
    const upper = s.upper - close
    const lower = s.lower + close
    const [b, t] = profile(item, u)
    const p = pts.at(-1)
    if (p) area += ((upper - lower + p.upper - p.lower) / 2) * (u - p.u)
    pts.push({ u, upper, lower, b, t })
  }
  // At each tilt, the reference line must be at least hiNeed and at most loMax
  let shortfall = Infinity
  let best = null
  for (const k of TILTS) {
    let hiNeed = -Infinity
    let loMax = Infinity
    for (const p of pts) {
      hiNeed = Math.max(hiNeed, p.upper - k * p.u - p.t)
      loMax = Math.min(loMax, p.lower - k * p.u - p.b)
    }
    if (hiNeed - loMax < shortfall) {
      shortfall = hiNeed - loMax
      best = { k, ref: (hiNeed + loMax) / 2 }
    }
  }
  return { shortfall, waste: Math.max(0, stockArea(item) - area), pts, best }
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

// Worst fit over the stations, and the total waste (a stand-in for volume carved away)
// (and where the fit is worst, worstS)
export function fitOver(item, section, stations, edge) {
  let shortfall = -Infinity
  let waste = 0
  let worstS = stations[0] ?? 0
  for (const s of stations) {
    const sec = section(s)
    if (!sec || !(sec.c > 1e-4)) continue
    const f = item.kind === 'round' ? roundFitAt(item.width, sec) : fitAt(item, sec, edge)
    if (f.shortfall > shortfall) {
      shortfall = f.shortfall
      worstS = s
    }
    waste += f.waste
  }
  return { shortfall, waste, worstS, fits: shortfall <= TOLERANCE }
}

// Of the items deep enough along the chord, those that fit with the least waste; if none
// fits, the one that falls least short
function pick(list, section, stations, edge, min) {
  const rootC = section(stations[0])?.c ?? 0
  const floor = Math.max(min.depth, min.chord * rootC) - 1e-9
  const pool = list.filter((x) => x.width >= floor)
  const scored = (pool.length ? pool : list).map((item) => ({ item, ...fitOver(item, section, stations, edge) }))
  const fitting = scored.filter((x) => x.fits)
  if (fitting.length) return fitting.reduce((a, b) => (b.waste < a.waste ? b : a)).item
  return scored.reduce((a, b) => (b.shortfall < a.shortfall ? b : a)).item
}

// The fit at one station, for drawing: the section over the stock's depth and a little
// more, the stock as sold at its best height and tilt (a rod or dowel as its circle), and
// where they disagree: for carved stock, the section outside the stock (wood it would need
// and hasn't got); for round stock, the rod outside the section (where it stands proud).
// x runs aft from the nose for the leading edge, forward from the trailing edge as
// negative values, so the drawing reads like the wing; z is height, both in metres.
// Returns { edge, x0, x1, upper, lower, stock, short: [polygon], worst: [x, z] }.
export function fitDrawing(item, sec, edge) {
  const sign = edge === 'le' ? 1 : -1
  const W = Math.min(item.width, sec.c)
  const reach = Math.min(sec.c, W * 1.6)
  const surf = (u) => (item.kind === 'round' ? noseSurf : (q, xi) => q.surf(xi))(sec, Math.min(1, Math.max(0, edge === 'le' ? u / sec.c : 1 - u / sec.c)))
  const N = 48
  const us = Array.from({ length: N + 1 }, (_, i) => reach * (1 - Math.cos((Math.PI * i) / N / 2)))
  const upper = us.map((u) => [sign * u, surf(u).upper])
  const lower = us.map((u) => [sign * u, surf(u).lower])
  const short = []
  let worst = null
  let most = 0
  // Runs where the outer shape (a) is above the inner one (b): polygons between them
  const runs = (rows) => {
    let cur = []
    const flush = () => {
      if (cur.length > 1) short.push([...cur.map((r) => [r.x, r.a]), ...[...cur].reverse().map((r) => [r.x, r.b])])
      cur = []
    }
    for (const r of rows) {
      if (r.a > r.b + 1e-6) {
        cur.push(r)
        if (r.a - r.b > most) {
          most = r.a - r.b
          worst = [r.x, (r.a + r.b) / 2]
        }
      } else flush()
    }
    flush()
  }
  let stock
  if (item.kind === 'round') {
    const r = W / 2
    const { centre } = roundFitAt(W, sec)
    stock = Array.from({ length: 48 }, (_, i) => [r + r * Math.cos((2 * Math.PI * i) / 48), centre + r * Math.sin((2 * Math.PI * i) / 48)])
    const rear = us.filter((u) => u >= r && u <= W)
    const h = (u) => Math.sqrt(Math.max(0, r * r - (u - r) ** 2))
    runs(rear.map((u) => ({ x: u, a: centre + h(u), b: surf(u).upper })))
    runs(rear.map((u) => ({ x: u, a: surf(u).lower, b: centre - h(u) })))
  } else {
    const f = fitAt(item, sec, edge)
    const { k, ref } = f.best
    const top = f.pts.map((p) => [sign * p.u, ref + k * p.u + p.t])
    const bot = f.pts.map((p) => [sign * p.u, ref + k * p.u + p.b])
    stock = [...top, ...[...bot].reverse()]
    runs(f.pts.map((p) => ({ x: sign * p.u, a: p.upper, b: ref + k * p.u + p.t })))
    runs(f.pts.map((p) => ({ x: sign * p.u, a: ref + k * p.u + p.b, b: p.lower })))
  }
  return { edge, x0: Math.min(0, sign * reach), x1: Math.max(0, sign * reach), upper, lower, stock, short, worst }
}

// The stock to use for each edge, and how well it fits. structure.le.stock and
// structure.te.stock are 'auto' (picked to suit), 'custom' (as entered: a custom leading edge is
// the symmetrical profile at le.width deep by le.height tall, checked like catalogue stock; a
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
    const auto = pick(list, section, stations, k, min)
    const id = k === 'le' ? migrateLeStockId(e.stock) : e.stock
    const custom = id === 'custom' && k === 'le' ? customLe(e) : null
    const item = id === 'auto' ? auto : id === 'custom' ? custom : (list.find((x) => x.id === id) ?? auto)
    const f = item ? fitOver(item, section, stations, k) : { shortfall: 0, worstS: stations[0], fits: true }
    const autoFits = item === auto ? f.fits : fitOver(auto, section, stations, k).fits
    out[k] = { width: item ? item.width : e.width || 0, height: item?.height ?? null, item, auto, autoFits, shortfall: f.shortfall, worstS: f.worstS, fits: f.fits }
  }
  return out
}

// A custom leading edge: the symmetrical profile at the entered depth and height (height
// defaults to the depth, as for the square catalogue sizes)
export const customLe = (e) => {
  const W = e.width || LE_MIN.depth
  const H = e.height || W
  const r = (v) => Math.round(v * 10000) / 10
  return { id: 'custom', code: `${r(W)} × ${r(H)} mm custom`, kind: 'symmetrical', custom: true, width: W, height: H }
}

// A rod or dowel as a fit-check item
export const roundItem = (D) => ({ kind: 'round', width: D, height: D })

// The structure with each edge's width (and type, for a catalogue trailing edge) set from
// the resolved stock, so everything downstream reads le.width / te.width as before. A round
// leading edge's width is its radius (the ribs stop at its centre line), with its diameter.
export function applyEdges(structure, edges) {
  return {
    ...structure,
    le: { ...structure.le, width: edges.le.width, height: edges.le.height, ...(edges.le.round ? { diameter: edges.le.round.diameter } : {}) },
    te: { ...structure.te, width: edges.te.width, height: edges.te.height, type: edges.te.item ? 'triangular' : structure.te.type },
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
