// Small static drawings of the structure for the page's Structure and ribs card: the plan as
// built, and a wireframe of the half wing (ribs, edges and spar) in parallel projection from
// ahead, above and inboard, so the ribs show their profiles. Plain SVG path data, so the page
// needs no three.js.
import { planEntities } from './dxf.js'
import { worldPoint, ribPlacement, applyMatrix } from './wing3d.js'
import { bounds } from './ribs.js'

const PAD = 0.04 // of the drawing's larger side, around it
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
const PLAN_LAYERS = { OUTLINE: 'outline', STOCK: 'stock', SPAR: 'spar', RIBS: 'rib' }
export function planThumb(a, structure, parts) {
  const ents = planEntities(a, structure, parts, { handedness: 'right' })
  const lines = ents
    .filter((e) => e.type === 'poly' && PLAN_LAYERS[e.layer])
    .map((e) => ({ kind: PLAN_LAYERS[e.layer], pts: e.pts.map(([x, y]) => [x, -y]), closed: e.closed }))
  return framed(lines)
}

// The view direction (target to camera) and its screen axes: X out along the span, Y up, Z
// aft in the world. Further round than the 3D view's start, which looks at the ribs edge on.
const VIEW_DIR = [-0.55, 0.6, -0.75]
function camera(dir = VIEW_DIR) {
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
  return (p) => [dot(p, x), -dot(p, y)]
}

// The half wing as a wireframe: each rib's outline (and lightening holes) at its mid-plane,
// and lines along the span for the leading and trailing edges and the spar's top and bottom. Returns { box, lines: [{ kind, d }] } or null.
export function isoThumb(a, structure, parts, { steps = 24 } = {}) {
  const view = camera()
  const lines = []
  for (const p of parts.filter((q) => q.group === 'ribs')) {
    const m = ribPlacement(a, p)(p.thickness)
    const at = ([u, z]) => view(applyMatrix(m, [u, z, p.thickness / 2]))
    lines.push({ kind: 'rib', pts: p.outline.map(at), closed: true })
    for (const h of p.holes) lines.push({ kind: 'hole', pts: h.map(at), closed: true })
  }
  // Along the span, from the root rib to the tip rib
  const span = (fn) => {
    const pts = []
    for (let i = 0; i <= steps; i++) {
      const s = a.rootS + ((a.tipS - a.rootS) * i) / steps
      const sec = a.section(s)
      if (sec) pts.push(view(fn(s, sec)))
    }
    return pts
  }
  const surf = (sec, q, which) => sec.surf(Math.min(1, Math.max(0, q)))[which]
  lines.push({ kind: 'edge', pts: span((s, sec) => worldPoint(a, s, sec.xl, surf(sec, 0, 'upper'))) })
  lines.push({ kind: 'edge', pts: span((s, sec) => worldPoint(a, s, sec.xl + sec.c, surf(sec, 1, 'upper'))) })
  for (const which of ['upper', 'lower']) {
    lines.push({
      kind: 'spar',
      pts: span((s, sec) => {
        const x = a.sparX(s)
        return worldPoint(a, s, x, surf(sec, (x - sec.xl) / sec.c, which))
      }),
    })
  }
  return framed(lines)
}
