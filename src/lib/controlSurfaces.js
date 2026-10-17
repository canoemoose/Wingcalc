// Control surfaces: ailerons, flaps and flaperons, each hinged along a straight line across
// part of one panel, and crow braking when the wing has separate ailerons and flaps.
//
// Nothing here knows which wing it's on: every function takes a wing sampler (wing.js
// wingSampler), so a tailplane's elevators or a fin's rudder use the same code.
//
// A surface, as saved with the wing:
//   id        stable id
//   role      'aileron' | 'flap' | 'flaperon'
//   panel     the id of the panel it's on
//   from, to  where it starts and ends, m from the panel's inner end (flat, along the panel)
//   hingeIn, hingeOut  the hinge line as a chord fraction (0 the leading edge, 1 the trailing
//             edge) at the surface's inner and outer ends; the line is straight between them
//   up, down  the most it deflects each way, degrees (trailing edge up, trailing edge down)
//   gap       between the fixed part and the moving surface at the hinge, m
//
// One panel only, because a hinge has to be straight: across a dihedral break or a kink in
// the edges it couldn't be. A surface wanted across a break is two surfaces, one each side.

const RAD = Math.PI / 180
// The shortest surface worth having, m
export const MIN_SURFACE = 0.02

export const ROLES = {
  aileron: { label: 'Aileron', code: 'A', up: 20, down: 15 },
  flap: { label: 'Flap', code: 'F', up: 5, down: 45 },
  flaperon: { label: 'Flaperon', code: 'FA', up: 20, down: 30 },
}

// Saved with the wing: the surfaces, crow (both surfaces' deflections when it's on), the
// servo bays' settings (servos.js: each surface has a bay unless removed here) and the air
// brakes (airBrakes.js), which sit with the surfaces as the wing's other moving parts.
// Crow's settings are kept even while the wing can't use it, so they come back. `landing` is
// how far the flaps go down for the stall speed with flaps (flaps.js): null for each flap's
// own most down.
export function defaultControls() {
  return { surfaces: [], crow: { enabled: false, aileronUp: 25, flapDown: 45 }, landing: { flapDown: null }, bays: [], brakes: [] }
}

const nextId = (list) => list.reduce((m, x) => Math.max(m, x.id ?? 0), 0) + 1

// A new surface's numbers: 25% of the chord, the role's usual throws, a 1 mm gap.
export function newSurface(role, panel, from, to, id = 1) {
  const r = ROLES[role] ?? ROLES.aileron
  return { id, role: ROLES[role] ? role : 'aileron', panel, from, to, hingeIn: 0.75, hingeOut: 0.75, up: r.up, down: r.down, gap: 0.001 }
}

// The panel a surface is on, by id: { index, inner, outer, panel } from the sampler, or null.
function panelOf(sampler, id) {
  const i = sampler.ends.findIndex((e) => (e.panel.id ?? null) === id)
  return i < 0 ? null : { index: i, ...sampler.ends[i] }
}

// A surface placed on the wing: its ends in flat s, and the hinge line in plan as x(s),
// straight between the hinge points at its two ends. ok is false (with a problem) if it
// can't be placed: 'panel' (no such panel), 'span' (its ends are back to front, too close
// or off the panel), 'hinge' (a hinge fraction outside the chord).
export function resolveSurface(sampler, surf) {
  const p = panelOf(sampler, surf.panel)
  if (!p) return { ...surf, ok: false, problem: 'panel' }
  const L = p.outer.s - p.inner.s
  const { from, to, hingeIn, hingeOut } = surf
  if (!Number.isFinite(from) || !Number.isFinite(to) || from < -1e-6 || to > L + 1e-6 || to - from < MIN_SURFACE - 1e-9) {
    return { ...surf, ok: false, problem: 'span', panelIndex: p.index }
  }
  const okHinge = (f) => Number.isFinite(f) && f > 0.02 && f < 0.99
  if (!okHinge(hingeIn) || !okHinge(hingeOut)) return { ...surf, ok: false, problem: 'hinge', panelIndex: p.index }
  const s0 = p.inner.s + Math.max(0, from)
  const s1 = p.inner.s + Math.min(L, to)
  const w0 = sampler.at(s0)
  const w1 = sampler.at(s1)
  const x0 = w0.xl + hingeIn * w0.c
  const x1 = w1.xl + hingeOut * w1.c
  const slope = (x1 - x0) / (s1 - s0)
  const hingeX = (s) => x0 + slope * (s - s0)
  return {
    ...surf,
    ok: true,
    panelIndex: p.index,
    s0,
    s1,
    x0,
    x1,
    slope,
    hingeX,
    // The hinge's chord fraction anywhere along it (it varies on a curved or tapered panel)
    hingeFraction: (s) => {
      const w = sampler.at(s)
      return w && w.c > 0 ? (hingeX(s) - w.xl) / w.c : null
    },
    length: Math.hypot(s1 - s0, x1 - x0),
  }
}

// Every surface placed, in order along the span, with names (A1, A2, F1 … by role, root
// outward) and problems: those that can't be placed, and any that overlaps one before it
// on the same panel ('overlap'). Only ok ones go on to be built.
export function resolveSurfaces(sampler, surfaces = []) {
  const list = (surfaces ?? []).map((s) => resolveSurface(sampler, s))
  const order = [...list].sort((a, b) => (a.s0 ?? Infinity) - (b.s0 ?? Infinity) || (a.id ?? 0) - (b.id ?? 0))
  const count = {}
  const placed = []
  for (const r of order) {
    const role = ROLES[r.role] ?? ROLES.aileron
    count[r.role] = (count[r.role] ?? 0) + 1
    r.name = `${role.code}${count[r.role]}`
    r.label = `${role.label} ${r.name}`
    if (!r.ok) continue
    if (placed.some((q) => q.panelIndex === r.panelIndex && r.s0 < q.s1 - 1e-6 && r.s1 > q.s0 + 1e-6)) {
      r.ok = false
      r.problem = 'overlap'
      continue
    }
    placed.push(r)
  }
  return order
}

// --- The hinge ---------------------------------------------------------------------------------

// The bevel (degrees from square) the moving surface's leading edge needs on one face to swing
// through deflection `deg` about a hinge at its centre line: the face's top (or bottom) edge,
// half the depth `half` away from the centre line, mustn't swing forward of the fixed part's
// rear face. The hinge flexes in the middle of the gap, so the gap gives a little in hand:
// with half-gap a, the face at angle β swings to a·cos δ + half·(tan β·cos δ − sin δ) from the
// hinge, which must be no further forward than −a. Square (0) when the gap alone clears it.
export function bevelAngle(deg, gap, half) {
  if (!(deg > 0) || !(half > 0)) return 0
  const d = Math.min(89, deg) * RAD
  const a = Math.max(0, gap || 0) / 2
  const t = (half * Math.sin(d) - a * (1 + Math.cos(d))) / (half * Math.cos(d))
  return Math.atan(Math.max(0, t)) / RAD
}

// Where the hinge tabs go along a hinge `length` long: their centres, as distances from its
// inner end, evenly spaced no further than `spacing` apart, the end ones `inset` in from each
// end. Two at least; one in the middle of a hinge too short for two; none if even one won't fit.
export function hingeTabs(length, { spacing, inset, width = 0 }) {
  if (!(length > 0) || !(length >= width)) return []
  const run = length - 2 * Math.max(0, inset || 0)
  if (!(run > width)) return [length / 2]
  const n = Math.max(2, Math.ceil(run / Math.max(1e-3, spacing) - 1e-9) + 1)
  return Array.from({ length: n }, (_, k) => inset + (run * k) / (n - 1))
}

// --- Crow ------------------------------------------------------------------------------------

// Crow: ailerons up and flaps down together, for steep, slow landings. Only with separate
// ailerons and flaps: a flaperon is the aileron and the flap at once, so it can't do both.
// Returns { available, reason, enabled, deflections: [{ id, role, deflection }] } with each
// deflection in degrees, + trailing edge down, never past the surface's own limit.
export function crowState(controls) {
  const list = controls?.surfaces ?? []
  const crow = { ...defaultControls().crow, ...(controls?.crow ?? {}) }
  const has = (r) => list.some((s) => s.role === r)
  let reason = null
  if (has('flaperon')) reason = 'flaperon'
  else if (!has('aileron') || !has('flap')) reason = 'missing'
  if (reason) return { available: false, reason, enabled: false, deflections: [] }
  const deflections = list
    .filter((s) => s.role === 'aileron' || s.role === 'flap')
    .map((s) => ({
      id: s.id,
      role: s.role,
      deflection: s.role === 'aileron' ? -Math.min(Math.max(0, crow.aileronUp), Math.max(0, s.up)) : Math.min(Math.max(0, crow.flapDown), Math.max(0, s.down)),
    }))
  return { available: true, reason: null, enabled: !!crow.enabled, deflections }
}

// --- Editing ---------------------------------------------------------------------------------

const snap5 = (v) => Math.round(v / 0.005) * 0.005

// Add a surface to panel i, in the longest stretch of it no surface uses yet. The wing's first
// is an aileron in the outer part of that stretch; later ones are flaps along most of it.
// Returns { surfaces, id } (the new surface's id), or null if there's no room.
// depth (m, optional): the new surface's depth from the hinge to the trailing edge, the same at
// both ends (the trailing edge stock's width, so the stock is the surface); otherwise 25% of the
// chord.
export function addSurface(sampler, surfaces, i, { depth = null } = {}) {
  const end = sampler?.ends[i]
  if (!end) return null
  const L = end.outer.s - end.inner.s
  const id = end.panel.id
  const taken = (surfaces ?? []).filter((s) => s.panel === id && Number.isFinite(s.from) && Number.isFinite(s.to)).sort((a, b) => a.from - b.from)
  let gap = null
  let at = 0
  for (const s of [...taken, { from: L, to: L }]) {
    if (!gap || s.from - at > gap[1] - gap[0]) gap = [at, s.from]
    at = Math.max(at, s.to)
  }
  const len = gap[1] - gap[0]
  if (len < MIN_SURFACE + 0.01) return null
  const role = (surfaces ?? []).some((s) => s.role === 'aileron' || s.role === 'flaperon') ? 'flap' : 'aileron'
  const margin = Math.min(0.01, len * 0.05)
  let from = role === 'aileron' ? gap[0] + len * 0.4 : gap[0] + margin
  let to = gap[1] - margin
  from = Math.max(gap[0], snap5(from))
  to = Math.min(gap[1], snap5(to))
  if (to - from < MIN_SURFACE) {
    from = gap[0]
    to = gap[1]
  }
  const surface = newSurface(role, id, from, to, nextId(surfaces ?? []))
  if (depth > 0) {
    // The hinge where the surface is `depth` deep at each end (the gap is half each side of it)
    const at = (d) => {
      const w = sampler.at(end.inner.s + d)
      return w && w.c > 0 ? Math.min(0.95, Math.max(0.5, 1 - (depth + surface.gap / 2) / w.c)) : 0.75
    }
    surface.hingeIn = at(from)
    surface.hingeOut = at(to)
  }
  return { surfaces: [...(surfaces ?? []), surface], id: surface.id }
}

// The outline of a surface in plan, flat, as [s, x] points: along the hinge line, out to the
// trailing edge and back along it. For drawing; null if it can't be placed.
export function surfaceOutline(sampler, r, n = 16) {
  if (!r?.ok) return null
  const ss = Array.from({ length: n + 1 }, (_, k) => r.s0 + ((r.s1 - r.s0) * k) / n)
  const te = ss.map((s) => {
    const w = sampler.at(s)
    return [s, w.xl + w.c]
  })
  return [...ss.map((s) => [s, r.hingeX(s)]), ...te.reverse()]
}
