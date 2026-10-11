// Multi-panel wing geometry: an optional fuselage centre section, then panels outward,
// each with its own length, outer chord, sweep, dihedral and straight or curved edges.
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

const SAMPLES = 32 // per panel, for integration and drawing

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

// Bézier control point of an edge, in panel-local (f, x) terms, for drawing handles.
export function controlPoint(x0, x1, curve) {
  return { f: curve.u, x: x0 + (x1 - x0) * curve.u + curve.d }
}

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

export function panelWingGeometry({ fuselageWidth = 0, rootChord, panels }) {
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
  }
  const half = Math.max(0, fuselageWidth || 0) / 2
  if (!(rootChord > 0) || !panels?.length) return g
  if (!panels.every((p) => p.length > 0 && p.tipChord >= 0 && panelAngle(p) !== null)) return g
  if (!panels.every((p) => validCurve(p.le) && validCurve(p.te) && Number.isFinite(p.sweep ?? 0))) return g

  // Sample the half wing: fuselage section (constant root chord), then each panel.
  // Each sample: projected y, LE x, chord c, and dy (projected width it represents).
  const samples = []
  if (half > 0) {
    samples.push({ y: 0, xl: 0, c: rootChord }, { y: half, xl: 0, c: rootChord, seg: 'fuselage' })
  } else {
    samples.push({ y: 0, xl: 0, c: rootChord })
  }
  const ends = panelEnds({ fuselageWidth, rootChord, panels })
  for (const { inner, outer, rad, panel } of ends) {
    if (rad !== 0) g.hasDihedral = true
    for (let i = 1; i <= SAMPLES; i++) {
      const f = i / SAMPLES
      const xl = edgeX(inner.x, outer.x, panel.le, f)
      const xt = edgeX(inner.x + inner.c, outer.x + outer.c, panel.te, f)
      samples.push({ y: inner.y + (outer.y - inner.y) * f, xl, c: xt - xl, cos: Math.cos(rad) })
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

  const last = ends.at(-1).outer
  g.span = 2 * last.y
  g.flatSpan = 2 * last.s
  g.rootChord = rootChord
  g.tipChord = last.c
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
  ]
  g.breaks = ends.slice(0, -1).map(({ outer }) => ({ y: outer.y, xl: outer.x, xt: outer.x + outer.c }))
  // Outline seen from above, as [y, x] points: LE root -> tip, then TE tip -> root.
  g.outline = [...samples.map((s) => [s.y, s.xl]), ...[...samples].reverse().map((s) => [s.y, s.xl + s.c])]
  return g
}

// The half wing in flat (as-built) coordinates, for the plan editor: each panel's leading
// and trailing edges as [s, x] polylines, plus its outline polygon.
export function flatPanels({ fuselageWidth = 0, rootChord, panels }, samples = 24) {
  if (!(rootChord > 0)) return []
  return panelEnds({ fuselageWidth, rootChord, panels }).map(({ inner, outer, panel }, i) => {
    const le = []
    const te = []
    const ok = panel.length > 0 && panel.tipChord >= 0 && validCurve(panel.le) && validCurve(panel.te)
    if (ok) {
      for (let k = 0; k <= samples; k++) {
        const f = k / samples
        const s = inner.s + (outer.s - inner.s) * f
        le.push([s, edgeX(inner.x, outer.x, panel.le, f)])
        te.push([s, edgeX(inner.x + inner.c, outer.x + outer.c, panel.te, f)])
      }
    }
    return { index: i, inner, outer, panel, le, te, polygon: [...le, ...[...te].reverse()] }
  })
}

const nextId = (panels) => panels.reduce((m, p) => Math.max(m, p.id ?? 0), 0) + 1

// Append a new outboard panel. It continues the previous panel's leading-edge line and
// dihedral, at about 40% of its length and tapering to 75% of its tip chord, ready to edit.
export function appendPanel(panels, rootChord) {
  const prev = panels.at(-1)
  if (!prev) return [{ id: 1, length: 0.3, tipChord: (rootChord || 0.2) * 0.75, sweep: 0, dihedral: 0, le: null, te: null }]
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
    },
  ]
}

// Remove panel i; panels outboard of it move inward to close the gap.
export function removePanel(panels, i) {
  if (panels.length < 2) return panels
  return panels.filter((_, j) => j !== i)
}

// Give every panel a stable id (used as a list key) and fill defaults for older shapes.
export function normalisePanels(panels) {
  let id = nextId(panels) - 1
  return panels.map((p) => ({ sweep: 0, le: null, te: null, ...p, id: p.id ?? ++id }))
}
