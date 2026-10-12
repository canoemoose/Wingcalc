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

// kind: 'flat' (the symmetrical profile's top half over a filled lower half: flat back and
// bottom, a short flat front, so it sits square on the bench),
// 'symmetrical' (flat back, rounded front), 'strip' (plain strip, glued on edge),
// 'triangular' (flat bottom, full thickness at the rib face, tapering to an edge)
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
  ...LE_SIZES.map(([s, inch, code]) => ({ id: code, code, kind: 'flat', width: mm(s), height: mm(s), inch: `${inch} × ${inch}` })),
  ...LE_SIZES.map(([s, inch, , code]) => ({ id: code, code, kind: 'symmetrical', width: mm(s), height: mm(s), inch: `${inch} × ${inch}` })),
  ...STRIPS.map(([code, d, h, di, hi]) => ({ id: code, code, kind: 'strip', width: mm(d), height: mm(h), inch: `${di} × ${hi}` })),
]

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

export const KIND_LABELS = { flat: 'flat', symmetrical: 'symmetrical', strip: 'strip on edge', triangular: 'triangular' }

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
    case 'flat':
      // The symmetrical profile's top half over a filled, flat-bottomed lower half
      return [0, (H / 2) * (1 + e)]
    case 'symmetrical':
      return [(H / 2) * (1 - e), (H / 2) * (1 + e)]
    case 'triangular':
      // Not a knife edge as sold: about half a millimetre at the thin end
      return [0, Math.max(TE_EDGE, (H * u) / W)]
    default:
      return [0, H]
  }
}

function stockArea(item) {
  const { width: W, height: H } = item
  if (item.kind === 'symmetrical') return (Math.PI / 4) * W * H
  if (item.kind === 'flat') return (W * H) / 2 + (Math.PI / 8) * W * H
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
  for (const k of TILTS) {
    let hiNeed = -Infinity
    let loMax = Infinity
    for (const p of pts) {
      hiNeed = Math.max(hiNeed, p.upper - k * p.u - p.t)
      loMax = Math.min(loMax, p.lower - k * p.u - p.b)
    }
    shortfall = Math.min(shortfall, hiNeed - loMax)
  }
  return { shortfall, waste: Math.max(0, stockArea(item) - area) }
}

// Worst fit over the stations, and the total waste (a stand-in for volume carved away)
function fitOver(item, section, stations, edge) {
  let shortfall = -Infinity
  let waste = 0
  for (const s of stations) {
    const sec = section(s)
    if (!sec || !(sec.c > 1e-4)) continue
    const f = fitAt(item, sec, edge)
    shortfall = Math.max(shortfall, f.shortfall)
    waste += f.waste
  }
  return { shortfall, waste, fits: shortfall <= TOLERANCE }
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

// The stock to use for each edge, and how well it fits. structure.le.stock and
// structure.te.stock are 'auto' (picked to suit), 'custom' (width as entered, no catalogue
// part) or a catalogue id. stations: the span positions to check (root, panel ends, tip).
// Returns { le, te }: each { width, height (null for custom), item (or null), auto,
// autoFits, shortfall, fits }.
export function resolveEdges(structure, section, stations) {
  const out = {}
  for (const [k, list, min] of [
    ['le', LE_STOCK, LE_MIN],
    ['te', TE_STOCK, TE_MIN],
  ]) {
    const e = structure[k]
    const auto = pick(list, section, stations, k, min)
    const item = e.stock === 'auto' ? auto : e.stock === 'custom' ? null : (list.find((x) => x.id === e.stock) ?? auto)
    const f = item ? fitOver(item, section, stations, k) : { shortfall: 0, fits: true }
    const autoFits = item === auto ? f.fits : fitOver(auto, section, stations, k).fits
    out[k] = { width: item ? item.width : e.width || 0, height: item?.height ?? null, item, auto, autoFits, shortfall: f.shortfall, fits: f.fits }
  }
  return out
}

// The structure with each edge's width (and type, for a catalogue trailing edge) set from
// the resolved stock, so everything downstream reads le.width / te.width as before.
export function applyEdges(structure, edges) {
  return {
    ...structure,
    le: { ...structure.le, width: edges.le.width, height: edges.le.height },
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
