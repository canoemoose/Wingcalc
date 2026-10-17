// Small static drawings of the structure for the page's Structure and ribs card: the plan as
// built, and a wireframe of the half wing (ribs, edges and spar) in parallel projection from
// behind, above and inboard, so it reads like the plan (root left, tip right, leading edge at
// the top) and the ribs show their profiles. Plain SVG path data, so the page needs no three.js.
import { planEntities } from './dxf.js'
import { worldPoint, ribPlacement, applyMatrix, HOME_VIEW, surfaceHeight, insetHeight, coreSection } from './wing3d.js'
import { bounds } from './ribs.js'

const PAD = 0.04 // of the drawing's larger side, around it
// Coordinates are written to 0.01, so drawings are in millimetres
const path = (pts, closed = false) => pts.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(2)} ${y.toFixed(2)}`).join('') + (closed ? 'Z' : '')

function framed(lines) {
  const all = lines.flatMap((l) => l.pts)
  if (!all.length) return null
  const b = bounds(all)
  const pad = Math.max(b.w, b.h) * PAD
  return {
    box: `${(b.x0 - pad).toFixed(2)} ${(b.y0 - pad).toFixed(2)} ${(b.w + 2 * pad).toFixed(2)} ${(b.h + 2 * pad).toFixed(2)}`,
    lines: lines.map((l) => ({ kind: l.kind, d: path(l.pts, l.closed) })),
  }
}

// The plan: outline, edge stock, spar and ribs, leading edge at the top. In millimetres, so
// stroke widths are best set non-scaling. Returns { box, lines: [{ kind, d }] } or null.
const PLAN_LAYERS = { OUTLINE: 'outline', STOCK: 'stock', SPAR: 'spar', RIBS: 'rib', HINGE: 'stock', BRAKE: 'stock' }
export function planThumb(a, structure, parts) {
  const ents = planEntities(a, structure, parts, { handedness: 'right' })
  const lines = ents
    .filter((e) => e.type === 'poly' && PLAN_LAYERS[e.layer])
    .map((e) => ({ kind: PLAN_LAYERS[e.layer], pts: e.pts.map(([x, y]) => [x, -y]), closed: e.closed }))
  return framed(lines)
}

// Screen axes looking along a view direction (target to camera), the 3D view's home by default
function camera(dir = HOME_VIEW) {
  const n = Math.hypot(...dir)
  const z = dir.map((v) => v / n)
  const cross = (p, q) => [p[1] * q[2] - p[2] * q[1], p[2] * q[0] - p[0] * q[2], p[0] * q[1] - p[1] * q[0]]
  const unit = (v) => {
    const l = Math.hypot(...v)
    return v.map((c) => c / l)
  }
  const x = unit(cross([0, 1, 0], z))
  const y = cross(z, x)
  const dot = (p, q) => p[0] * q[0] + p[1] * q[1] + p[2] * q[2]
  // World metres to millimetres on the screen
  return (p) => [dot(p, x) * 1000, -dot(p, y) * 1000]
}

// The half wing as a wireframe: each rib's outline (and lightening holes) at its mid-plane,
// and lines along the span for the leading and trailing edges (where the ribs end) and the
// spar's top and bottom. Every line follows the washout, as the ribs do. A foam wing has no
// ribs: its cores' end faces stand in for them. Returns { box, lines: [{ kind, d }] } or null.
export function isoThumb(a, structure, parts, { steps = 24 } = {}) {
  const view = camera()
  const lines = []
  // The wing's ribs and the control surfaces' own, which carry them on behind a hinge
  const ribs = parts.filter((q) => q.group === 'ribs' || q.group === 'surfaces')
  for (const p of ribs) {
    const m = ribPlacement(a, p)(p.thickness)
    const at = ([u, z]) => view(applyMatrix(m, [u, z, p.thickness / 2]))
    lines.push({ kind: 'rib', pts: p.outline.map(at), closed: true })
    for (const h of p.holes) lines.push({ kind: 'hole', pts: h.map(at), closed: true })
  }
  const coreEnds = [...new Set((a.cores ?? []).flatMap((c) => [c.from, c.to]))]
  for (const s of coreEnds) {
    const sec = a.section(s)
    if (!sec || !(sec.c > 1e-4)) continue
    const x0 = sec.xl + Math.min(structure.le?.width || 0, sec.c / 2)
    const x1 = sec.xl + sec.c - Math.min(structure.te?.width || 0, sec.c / 2)
    const pts = coreSection(a, structure, s, x0, x1)
    if (pts) lines.push({ kind: 'rib', pts: pts.map(([x, h]) => view(worldPoint(a, s, x, h))), closed: true })
  }
  // Along the span, from the root to the tip, through each rib's station so the lines meet
  // the ribs there rather than cutting the corner between samples
  const along = [...new Set([...Array.from({ length: steps + 1 }, (_, i) => a.rootS + ((a.tipS - a.rootS) * i) / steps), ...ribs.map((p) => p.s), ...coreEnds])]
    .filter((s) => s >= a.rootS - 1e-9 && s <= a.tipS + 1e-9)
    .sort((p, q) => p - q)
  const span = (kind, fn) => {
    const pts = []
    for (const s of along) {
      const sec = a.section(s)
      if (sec && sec.c > 1e-9) pts.push(view(worldPoint(a, s, ...fn(s, sec))))
    }
    lines.push({ kind, pts })
  }
  const outer = (x, which) => (s) => [x(s), surfaceHeight(a, s, x(s), which)]
  // The leading and trailing edges, drawn where the ribs end against the edge stock (the top
  // of its inner face), so every rib meets them; with no stock, the nose and the tail
  const le = structure.le?.width || 0
  const te = structure.te?.width || 0
  const edge = (x) => (s) => [x(s), insetHeight(a, structure, s, x(s), 'upper')]
  span('edge', edge((s) => a.section(s).xl + Math.min(le, a.section(s).c / 2)))
  span('edge', edge((s) => a.section(s).xl + a.section(s).c - Math.min(te, a.section(s).c / 2)))
  for (const which of ['upper', 'lower']) span('spar', outer((s) => a.sparX(s), which))
  return framed(lines)
}
