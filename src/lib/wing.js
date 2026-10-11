// Multi-panel wing geometry: an optional fuselage centre section, then panels outward,
// each with its own length, outer chord, sweep, dihedral and edge shape, and an optional
// curved tip beyond the last panel.
//
// Coordinates for a half wing, in metres:
//   s – spanwise distance from the centreline measured flat along the panels
//   x – chordwise, from the root leading edge, positive aft
//   y – spanwise distance seen from above (projected); differs from s where there's dihedral
//   z – height above the root
//
// A panel:
//   length    flat spanwise length
//   tipChord  chord at the outer end
//   sweep     chordwise offset of the outer leading edge from the inner one (+ aft), default 0
//   dihedral  angle to the horizontal in degrees, or `rise` (m) of the outer end; see panelAngle
//   le, te    null for a straight edge, or { u, d } for a quadratic Bézier curve whose control
//             point sits at fraction u of the panel's length, offset d (m, + aft) from the
//             straight edge there. Stored relative so the curve survives resizing.
//   stations  null, or a list of { id, d, chord, le, straightIn }: chords dimensioned at
//             distance d from the panel's inner end, with their leading edge set back `le`
//             from the panel's inner leading edge. When present, both edges run smoothly
//             through the stations (monotone cubic interpolation) and `le`/`te` are ignored.
//             straightIn makes the segment from the previous station (or the panel's inner
//             end) to this one straight, for a faceted outline; straightToTip on the panel
//             does the same for the last segment.
//   straightLine  with stations: null, or the chord fraction (0 = leading edge, 1 = trailing
//             edge, 0.25 = quarter-chord) of a line kept straight from end to end. Stations
//             then set only their chord; `le` is ignored and the edges lie either side of the
//             straight line in proportion.
//
// The tip (wing-level, optional): { extension, peak } adds a rounded cap beyond the last
// panel, reaching `extension` further out at fraction `peak` of the tip chord. It is made of
// two quarter-ellipses, so it meets both edges tangentially; its area is (π/4)·extension·chord.

const SAMPLES = 32 // per panel, for integration and drawing
const TIP_SAMPLES = 24

// A panel's dihedral in radians, or null if it can't be resolved (e.g. rise > length).
export function panelAngle(p) {
  if ('rise' in p && p.rise !== undefined) {
    if (!Number.isFinite(p.rise) || !(p.length > 0) || Math.abs(p.rise) > p.length) return null
    return Math.asin(p.rise / p.length)
  }
  return Number.isFinite(p.dihedral) ? (p.dihedral * Math.PI) / 180 : null
}

function validCurve(c) {
  return c === null || c === undefined || (c.u > 0 && c.u < 1 && Number.isFinite(c.d))
}

// Chordwise position on an edge at flat spanwise fraction f (0..1) of a panel, for an edge
// running from x0 to x1, straight or curved.
export function edgeX(x0, x1, curve, f) {
  if (!curve) return x0 + (x1 - x0) * f
  // Quadratic Bézier in (f, x) with control (u, x0 + (x1 - x0) u + d). Solve f(t) = f for t.
  const { u, d } = curve
  const cx = x0 + (x1 - x0) * u + d
  const a = 1 - 2 * u
  let t
  if (Math.abs(a) < 1e-9) t = f / (2 * u)
  else t = (-2 * u + Math.sqrt(4 * u * u + 4 * a * f)) / (2 * a)
  const mt = 1 - t
  return mt * mt * x0 + 2 * mt * t * cx + t * t * x1
}

// Monotone piecewise cubic (Fritsch–Carlson PCHIP) through points xs (increasing), ys.
// Smooth, and never overshoots between points, so a wing edge can't bulge past a station.
// straight[i] makes segment i (xs[i] to xs[i+1]) a straight line instead; a curved segment
// next to a straight one leaves along the straight one's direction, so the join has no kink.
export function pchip(xs, ys, straight = []) {
  const n = xs.length
  if (n === 1) return () => ys[0]
  const h = []
  const del = []
  for (let i = 0; i < n - 1; i++) {
    h.push(xs[i + 1] - xs[i])
    del.push((ys[i + 1] - ys[i]) / h[i])
  }
  const m = new Array(n)
  if (n === 2) {
    m[0] = m[1] = del[0]
  } else {
    const end = (h0, h1, d0, d1) => {
      let v = ((2 * h0 + h1) * d0 - h0 * d1) / (h0 + h1)
      if (Math.sign(v) !== Math.sign(d0)) v = 0
      else if (Math.sign(d0) !== Math.sign(d1) && Math.abs(v) > Math.abs(3 * d0)) v = 3 * d0
      return v
    }
    m[0] = end(h[0], h[1], del[0], del[1])
    m[n - 1] = end(h[n - 2], h[n - 3], del[n - 2], del[n - 3])
    for (let i = 1; i < n - 1; i++) {
      if (del[i - 1] * del[i] <= 0) m[i] = 0
      else {
        const w1 = 2 * h[i] + h[i - 1]
        const w2 = h[i] + 2 * h[i - 1]
        m[i] = (w1 + w2) / (w1 / del[i - 1] + w2 / del[i])
      }
    }
  }
  // Tangent continuity into and out of straight segments.
  for (let i = 0; i < n; i++) {
    const before = i > 0 && straight[i - 1]
    const after = i < n - 1 && straight[i]
    if (before && !after) m[i] = del[i - 1]
    else if (after && !before) m[i] = del[i]
  }
  return (x) => {
    let i = 0
    while (i < n - 2 && x > xs[i + 1]) i++
    const t = (x - xs[i]) / h[i]
    if (straight[i]) return ys[i] + t * (ys[i + 1] - ys[i])
    const t2 = t * t
    const t3 = t2 * t
    return (
      (2 * t3 - 3 * t2 + 1) * ys[i] +
      (t3 - 2 * t2 + t) * h[i] * m[i] +
      (-2 * t3 + 3 * t2) * ys[i + 1] +
      (t3 - t2) * h[i] * m[i + 1]
    )
  }
}

// Stations in table order: by distance, with blank (not yet filled in) ones at the end.
export function stationOrder(stations) {
  const key = (st) => (Number.isFinite(st.d) ? st.d : Infinity)
  return [...(stations ?? [])].sort((a, b) => key(a) - key(b) || (a.id ?? 0) - (b.id ?? 0))
}

// Sort a panel's stations by distance and set aside any that can't be used, with the
// reason, so the rest of the panel still draws: not filled in yet, before the inner end,
// on or beyond the tip, or at the same place as another station. A blank leading-edge
// set-back is fine: the station takes its leading edge from the line through its neighbours.
const STATION_EPS = 1e-6
export function checkStations(panel) {
  const L = panel.length
  const valid = []
  const ignored = []
  for (const st of stationOrder(panel.stations)) {
    let reason = null
    if (!Number.isFinite(st.d) || !Number.isFinite(st.chord)) reason = 'incomplete'
    else if (st.d <= STATION_EPS) reason = 'inner'
    else if (Math.abs(st.d - L) <= STATION_EPS) reason = 'on-tip'
    else if (st.d > L) reason = 'beyond'
    else if (st.chord < 0) reason = 'chord'
    else if (valid.length && st.d - valid.at(-1).d <= STATION_EPS) reason = 'duplicate'
    if (reason) ignored.push({ id: st.id, d: st.d, reason })
    else valid.push(st)
  }
  return { valid, ignored }
}

function sortedStations(panel) {
  return checkStations(panel).valid
}

// Edge functions of a panel: le(f) and te(f) give the chordwise positions of the leading and
// trailing edges at flat spanwise fraction f (0..1). null if the panel's shape is invalid.
export function panelEdges(inner, outer, panel) {
  if (!(panel.length > 0) || !(panel.tipChord >= 0)) return null
  if (Array.isArray(panel.stations)) {
    const list = sortedStations(panel)
    const fs = [0, ...list.map((st) => st.d / panel.length), 1]
    const straight = [...list.map((st) => !!st.straightIn), !!panel.straightToTip]
    if (Number.isFinite(panel.straightLine)) {
      // A chord line kept straight: interpolate the chord, and hang the edges either side of
      // the line in proportion.
      const at = Math.min(1, Math.max(0, panel.straightLine))
      const chord = pchip(fs, [inner.c, ...list.map((st) => st.chord), outer.c], straight)
      const r0 = inner.x + at * inner.c
      const r1 = outer.x + at * outer.c
      const le = (f) => r0 + (r1 - r0) * f - at * chord(f)
      return { le, te: (f) => le(f) + chord(f) }
    }
    // Stations with a blank set-back take their leading edge from the line through the
    // stations that have one (and the panel ends).
    const withLe = list.filter((st) => Number.isFinite(st.le))
    const autoLe = pchip(
      [0, ...withLe.map((st) => st.d / panel.length), 1],
      [inner.x, ...withLe.map((st) => inner.x + st.le), outer.x],
    )
    const leOf = (st) => (Number.isFinite(st.le) ? inner.x + st.le : autoLe(st.d / panel.length))
    const les = [inner.x, ...list.map(leOf), outer.x]
    const tes = [inner.x + inner.c, ...list.map((st) => leOf(st) + st.chord), outer.x + outer.c]
    return { le: pchip(fs, les, straight), te: pchip(fs, tes, straight) }
  }
  if (!validCurve(panel.le) || !validCurve(panel.te)) return null
  return {
    le: (f) => edgeX(inner.x, outer.x, panel.le, f),
    te: (f) => edgeX(inner.x + inner.c, outer.x + outer.c, panel.te, f),
  }
}

// Spanwise fractions at which to sample a panel: evenly spaced, plus every station, so
// corners between straight segments are hit exactly. Excludes 0.
export function sampleFractions(panel, n = SAMPLES) {
  const fs = []
  for (let i = 1; i <= n; i++) fs.push(i / n)
  if (Array.isArray(panel.stations) && panel.length > 0) {
    for (const st of checkStations(panel).valid) fs.push(st.d / panel.length)
  }
  return [...new Set(fs)].sort((a, b) => a - b)
}

export function panelMode(panel) {
  if (Array.isArray(panel.stations)) return 'stations'
  return panel.le || panel.te ? 'curves' : 'straight'
}

// Rounded tip cap beyond a panel end. Returns its shape at fraction u (0..1) of the
// extension: spanwise offset, LE x and chord. Cosine spacing in u keeps the rounded end smooth.
export function tipShape(end, tip) {
  const e = tip.extension
  const p = Math.min(1, Math.max(0, tip.peak ?? 0.4))
  const c = end.c
  const xPeak = end.x + p * c
  return (u) => {
    const r = Math.sqrt(Math.max(0, 1 - u * u))
    return { ds: e * u, xl: xPeak - p * c * r, c: c * r }
  }
}

const hasTip = (tip) => tip && tip.extension > 0

// Resolve each panel's inner and outer ends: flat s, projected y, height z, LE x and chord.
export function panelEnds({ fuselageWidth = 0, rootChord, panels }) {
  const half = Math.max(0, fuselageWidth || 0) / 2
  let s = half
  let y = half
  let z = 0
  let x = 0
  let c = rootChord
  return panels.map((p) => {
    const rad = panelAngle(p) ?? 0
    const inner = { s, y, z, x, c }
    s += p.length
    y += p.length * Math.cos(rad)
    z += p.length * Math.sin(rad)
    x += p.sweep || 0
    c = p.tipChord
    return { inner, outer: { s, y, z, x, c }, rad, panel: p }
  })
}

export function panelWingGeometry({ fuselageWidth = 0, rootChord, panels, tip = null }) {
  const g = {
    span: null,
    flatSpan: null,
    rootChord: null,
    tipChord: null,
    area: null,
    projectedArea: null,
    exposedArea: null,
    meanChord: null,
    mac: null,
    macY: null,
    macX: null,
    sweepQuarter: null,
    aspectRatio: null,
    stations: null,
    outline: null,
    breaks: null,
    fuselageHalf: 0,
    hasDihedral: false,
    invalid: null,
    ignoredStations: [], // { panel, id, d, reason }
  }
  const half = Math.max(0, fuselageWidth || 0) / 2
  if (!(rootChord > 0) || !panels?.length) return g
  if (!panels.every((p) => p.length > 0 && p.tipChord >= 0 && panelAngle(p) !== null)) return g
  if (!panels.every((p) => Number.isFinite(p.sweep ?? 0))) return g

  // Sample the half wing: fuselage section (constant root chord), then each panel, then the
  // tip cap. Each sample: projected y, LE x, chord c and the cosine of its panel's dihedral.
  const samples = [{ y: 0, xl: 0, c: rootChord }]
  if (half > 0) samples.push({ y: half, xl: 0, c: rootChord })
  const ends = panelEnds({ fuselageWidth, rootChord, panels })
  for (const end of ends) {
    const { inner, outer, rad, panel } = end
    if (rad !== 0) g.hasDihedral = true
    const edges = panelEdges(inner, outer, panel)
    if (!edges) return g
    if (Array.isArray(panel.stations)) {
      for (const ig of checkStations(panel).ignored) g.ignoredStations.push({ panel: ends.indexOf(end), ...ig })
    }
    for (const f of sampleFractions(panel)) {
      const xl = edges.le(f)
      samples.push({ y: inner.y + (outer.y - inner.y) * f, xl, c: edges.te(f) - xl, cos: Math.cos(rad) })
    }
  }
  const last = ends.at(-1)
  let tipReach = { s: last.outer.s, y: last.outer.y, z: last.outer.z }
  if (hasTip(tip)) {
    const shape = tipShape(last.outer, tip)
    const cos = Math.cos(last.rad)
    for (let i = 1; i <= TIP_SAMPLES; i++) {
      const u = Math.sin((Math.PI / 2) * (i / TIP_SAMPLES))
      const t = shape(u)
      samples.push({ y: last.outer.y + t.ds * cos, xl: t.xl, c: t.c, cos })
    }
    tipReach = {
      s: last.outer.s + tip.extension,
      y: last.outer.y + tip.extension * cos,
      z: last.outer.z + tip.extension * Math.sin(last.rad),
    }
  }
  if (samples.some((s) => s.c < -1e-9)) {
    g.invalid = 'edges-cross'
    return g
  }

  // Integrate over projected y, interval by interval.
  let projHalf = 0
  let flatHalf = 0
  let c2 = 0
  let cy = 0
  let cx = 0
  let sw = 0
  let swy = 0
  let swx = 0
  let swyy = 0
  let swyx = 0
  for (let i = 1; i < samples.length; i++) {
    const a = samples[i - 1]
    const b = samples[i]
    const dy = b.y - a.y
    if (dy <= 0) continue
    const cos = b.cos ?? 1
    const area = (dy * (a.c + b.c)) / 2
    projHalf += area
    flatHalf += area / cos
    // Exact for quantities varying linearly across the interval
    c2 += (dy * (a.c * a.c + a.c * b.c + b.c * b.c)) / 3
    cy += (dy * (2 * a.c * a.y + a.c * b.y + b.c * a.y + 2 * b.c * b.y)) / 6
    cx += (dy * (2 * a.c * a.xl + a.c * b.xl + b.c * a.xl + 2 * b.c * b.xl)) / 6
    // Chord-weighted least-squares fit of the quarter-chord line x = k y + m, for sweep.
    for (const s of [a, b]) {
      const w = (s.c * dy) / 2
      const q = s.xl + s.c / 4
      sw += w
      swy += w * s.y
      swx += w * q
      swyy += w * s.y * s.y
      swyx += w * s.y * q
    }
  }
  if (!(projHalf > 0)) return g
  const slope = (sw * swyx - swy * swx) / (sw * swyy - swy * swy)

  g.span = 2 * tipReach.y
  g.flatSpan = 2 * tipReach.s
  g.rootChord = rootChord
  g.tipChord = last.outer.c
  g.area = 2 * flatHalf
  g.projectedArea = 2 * projHalf
  g.exposedArea = g.area - 2 * half * rootChord
  g.meanChord = g.area / g.flatSpan
  g.mac = c2 / projHalf
  g.macY = cy / projHalf
  g.macX = cx / projHalf
  g.sweepQuarter = Number.isFinite(slope) ? Math.atan(slope) : 0
  g.aspectRatio = (g.span * g.span) / g.projectedArea
  g.fuselageHalf = half
  g.stations = [
    { y: 0, z: 0, c: rootChord },
    ...(half > 0 ? [{ y: half, z: 0, c: rootChord }] : []),
    ...ends.map(({ outer }) => ({ y: outer.y, z: outer.z, c: outer.c })),
    ...(hasTip(tip) ? [{ y: tipReach.y, z: tipReach.z, c: 0 }] : []),
  ]
  const breakEnds = hasTip(tip) ? ends : ends.slice(0, -1)
  g.breaks = breakEnds.map(({ outer }) => ({ y: outer.y, xl: outer.x, xt: outer.x + outer.c }))
  // Outline seen from above, as [y, x] points: LE root -> tip, then TE tip -> root.
  g.outline = [...samples.map((s) => [s.y, s.xl]), ...[...samples].reverse().map((s) => [s.y, s.xl + s.c])]
  return g
}

// The half wing in flat (as-built) coordinates, for the plan editor: each panel's leading
// and trailing edges as [s, x] polylines and its outline polygon, plus the tip cap.
export function flatPanels({ fuselageWidth = 0, rootChord, panels, tip = null }, samples = 32) {
  if (!(rootChord > 0)) return { panels: [], tip: null }
  const ends = panelEnds({ fuselageWidth, rootChord, panels })
  const list = ends.map(({ inner, outer, panel }, i) => {
    const le = []
    const te = []
    const edges = panelEdges(inner, outer, panel)
    if (edges) {
      for (const f of [0, ...sampleFractions(panel, samples)]) {
        const s = inner.s + (outer.s - inner.s) * f
        le.push([s, edges.le(f)])
        te.push([s, edges.te(f)])
      }
    }
    return { index: i, inner, outer, panel, edges, le, te, polygon: [...le, ...[...te].reverse()] }
  })
  let tipOut = null
  const last = ends.at(-1)
  if (last && hasTip(tip) && last.outer.c >= 0) {
    const shape = tipShape(last.outer, tip)
    const le = []
    const te = []
    for (let i = 0; i <= TIP_SAMPLES; i++) {
      const t = shape(Math.sin((Math.PI / 2) * (i / TIP_SAMPLES)))
      le.push([last.outer.s + t.ds, t.xl])
      te.push([last.outer.s + t.ds, t.xl + t.c])
    }
    tipOut = {
      polygon: [...le, ...[...te].reverse()],
      peak: { s: last.outer.s + tip.extension, x: last.outer.x + (tip.peak ?? 0.4) * last.outer.c },
      base: last.outer,
    }
  }
  return { panels: list, tip: tipOut }
}

// Points on the plan a dimension can snap to, each with a stable id so a dimension attached
// to it follows the wing as it changes.
export function keyPoints(wing) {
  const { rootChord, fuselageWidth = 0 } = wing
  const half = Math.max(0, fuselageWidth || 0) / 2
  if (!(rootChord > 0)) return []
  const pts = [
    { id: 'c.le', s: 0, x: 0 },
    { id: 'c.te', s: 0, x: rootChord },
  ]
  if (half > 0) pts.push({ id: 'f.le', s: half, x: 0 }, { id: 'f.te', s: half, x: rootChord })
  const flat = flatPanels(wing)
  for (const p of flat.panels) {
    const id = p.panel.id ?? p.index
    pts.push({ id: `p${id}.le`, s: p.outer.s, x: p.outer.x }, { id: `p${id}.te`, s: p.outer.s, x: p.outer.x + p.outer.c })
    if (p.edges && Array.isArray(p.panel.stations)) {
      for (const st of checkStations(p.panel).valid) {
        const s = p.inner.s + st.d
        const f = st.d / p.panel.length
        pts.push({ id: `p${id}.s${st.id}.le`, s, x: p.edges.le(f) }, { id: `p${id}.s${st.id}.te`, s, x: p.edges.te(f) })
      }
    }
  }
  if (flat.tip) pts.push({ id: 'tip', s: flat.tip.peak.s, x: flat.tip.peak.x })
  return pts
}

const nextId = (items) => items.reduce((m, p) => Math.max(m, p.id ?? 0), 0) + 1

// Append a new outboard panel. It continues the previous panel's leading-edge line and
// dihedral, at about 40% of its length and tapering to 75% of its tip chord, ready to edit.
export function appendPanel(panels, rootChord) {
  const prev = panels.at(-1)
  if (!prev)
    return [{ id: 1, length: 0.3, tipChord: (rootChord || 0.2) * 0.75, sweep: 0, dihedral: 0, le: null, te: null, stations: null }]
  const len = Math.max(0.05, Math.round(((prev.length || 0.25) * 0.4) / 0.005) * 0.005)
  const scale = prev.length > 0 ? len / prev.length : 0
  const tilt = 'rise' in prev ? { rise: Number.isFinite(prev.rise) ? prev.rise * scale : 0 } : { dihedral: prev.dihedral ?? 0 }
  return [
    ...panels,
    {
      id: nextId(panels),
      length: len,
      tipChord: Math.max(0, (prev.tipChord || 0) * 0.75),
      sweep: (prev.sweep || 0) * scale,
      ...tilt,
      le: null,
      te: null,
      stations: null,
    },
  ]
}

// Remove panel i; panels outboard of it move inward to close the gap.
export function removePanel(panels, i) {
  if (panels.length < 2) return panels
  return panels.filter((_, j) => j !== i)
}

// Give every panel (and station) a stable id and fill defaults for older shapes.
export function normalisePanels(panels) {
  let id = nextId(panels) - 1
  return panels.map((p) => {
    const out = { sweep: 0, le: null, te: null, stations: null, ...p, id: p.id ?? ++id }
    if (Array.isArray(out.stations)) {
      let sid = nextId(out.stations) - 1
      out.stations = out.stations.map((st) => ({ ...st, id: st.id ?? ++sid }))
    }
    return out
  })
}

// Station values that sit exactly on the panel's current shape at distance d.
function stationOn(inner, outer, panel, d) {
  const edges = panelEdges(inner, outer, panel) ?? panelEdges(inner, outer, { ...panel, stations: null, le: null, te: null })
  const f = d / panel.length
  const le = edges.le(f)
  return { d, chord: edges.te(f) - le, le: le - inner.x }
}

// Switch a panel between edge modes, keeping its shape as far as possible. Converting to
// stations samples the current edges (three stations for a curved panel, one for straight).
export function setPanelMode(wing, i, mode) {
  const ends = panelEnds(wing)
  const { inner, outer, panel } = ends[i]
  let next
  if (mode === 'stations') {
    const fs = panel.le || panel.te ? [0.25, 0.5, 0.75] : [0.5]
    const stations = fs.map((f, k) => ({ id: k + 1, ...stationOn(inner, outer, { ...panel, stations: null }, f * panel.length) }))
    // A panel with only one curved edge keeps the other one straight.
    const straightLine = panel.le && !panel.te ? 1 : panel.te && !panel.le ? 0 : null
    next = { ...panel, stations, straightLine, straightToTip: false }
  } else if (mode === 'curves') {
    next = { ...panel, stations: null, le: panel.le ?? { u: 0.5, d: -0.15 * Math.max(panel.tipChord || 0, 0.05) }, te: panel.te ?? null }
  } else {
    next = { ...panel, stations: null, le: null, te: null }
  }
  if (mode !== 'stations') {
    delete next.straightLine
    delete next.straightToTip
  }
  return wing.panels.map((p, j) => (j === i ? next : p))
}

// Add a blank station at the end of the list (just before the tip), ready to fill in.
export function addBlankStation(panels, i) {
  return panels.map((p, j) =>
    j === i ? { ...p, stations: [...(p.stations ?? []), { id: nextId(p.stations ?? []), d: null, chord: null, le: null }] } : p,
  )
}

// Add a station in the middle of the largest gap, placed on the current shape.
export function addStation(wing, i) {
  const ends = panelEnds(wing)
  const { inner, outer, panel } = ends[i]
  const sorted = checkStations(panel).valid
  const ds = [0, ...sorted.map((st) => st.d), panel.length]
  let at = panel.length / 2
  let gap = 0
  let seg = 0
  for (let k = 1; k < ds.length; k++) {
    if (ds[k] - ds[k - 1] > gap) {
      gap = ds[k] - ds[k - 1]
      at = (ds[k] + ds[k - 1]) / 2
      seg = k - 1
    }
  }
  // Splitting a straight segment leaves both halves straight, so the outline doesn't change.
  const segStraight = seg < sorted.length ? !!sorted[seg].straightIn : !!panel.straightToTip
  const station = { id: nextId(panel.stations ?? []), ...stationOn(inner, outer, panel, at), straightIn: segStraight }
  return wing.panels.map((p, j) => (j === i ? { ...p, stations: [...(p.stations ?? []), station] } : p))
}

// Insert a new panel after panel i (i = -1 inserts at the root). It has a constant chord
// equal to the chord where it goes in, continues the leading-edge line and dihedral of the
// panel before it, and the panels outboard keep their own shape; the wing gets longer.
export function insertPanel(panels, i, rootChord) {
  const before = i >= 0 ? panels[i] : null
  const chord = before ? before.tipChord : rootChord
  const ref = before ?? panels[0]
  const len = Math.max(0.05, Math.round(((ref?.length || 0.25) * 0.3) / 0.005) * 0.005)
  const slope = ref?.length > 0 ? (ref.sweep || 0) / ref.length : 0
  const scale = ref?.length > 0 ? len / ref.length : 0
  const tilt = ref && 'rise' in ref ? { rise: Number.isFinite(ref.rise) ? ref.rise * scale : 0 } : { dihedral: ref?.dihedral ?? 0 }
  const panel = {
    id: nextId(panels),
    length: len,
    tipChord: Math.max(0, chord || 0),
    sweep: before ? slope * len : 0,
    ...tilt,
    le: null,
    te: null,
    stations: null,
  }
  return [...panels.slice(0, i + 1), panel, ...panels.slice(i + 1)]
}

// Move panel i one place inward (dir = -1) or outward (+1). Each panel keeps its own length,
// chord, sweep, dihedral and shape; only the order changes.
export function movePanel(panels, i, dir) {
  const j = i + dir
  if (j < 0 || j >= panels.length) return panels
  const out = [...panels]
  ;[out[i], out[j]] = [out[j], out[i]]
  return out
}
