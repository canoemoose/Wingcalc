// Air brakes: Schempp-Hirth style blade brakes (one or more blades that rise vertically out
// of a box in the wing, on the top surface or on both) and pop-up spoilers (a hinged plate on
// the top surface). Where each goes along the span and chord, and its servo bay.
//
// Nothing here knows which wing it's on: placement takes a wing sampler, so a tailplane or a
// fin could use it too. How a placed brake is built into the structure (box, ribs, cut-outs,
// clashes with the spar and the control surfaces) is in structure.js brakeLayouts and ribs.js.
//
// A brake, as saved with the wing in controls.brakes:
//   id        stable id
//   type      'blade' | 'spoiler'
//   panel     the id of the panel it's on
//   at        where its centre is, m from the panel's inner end (flat, along the panel)
//   length    along the span: a blade's length, or the spoiler plate's, m
//   x         where it sits across the chord, as a fraction of the chord at its centre (the
//             middle of the box, or of the plate)
//   chord     along the chord: the box's inside width for blades, the plate's chord for a
//             spoiler, m
//   height    blades: how far each rises above the skin, m (the room it needs inside when
//             retracted)
//   blades    blades: how many, spaced evenly across the box's width (1 is a single blade,
//             more make a lattice)
//   surface   blades: 'top', or 'both' for a blade through the top and one through the bottom
//   angle     spoiler: how far the plate opens, degrees
// Both sets of fields are always saved, so changing the type loses nothing.
//
// A brake sits between two ribs (hard points), a little further apart than its length. Its
// servo bay (servos.js, keyed by brakeKey) is the one beside it, sharing the box's inner rib.

export const BRAKE_TYPES = {
  blade: { label: 'Lattice blades', short: 'Blade brake', code: 'AB' },
  spoiler: { label: 'Pop-up spoiler', short: 'Spoiler', code: 'AB' },
}

// Part sizes, m: blade and box wall ply, spoiler plate and frame ply, the frame's width
export const BRAKE = {
  bladeThickness: 0.001,
  wall: 0.001,
  plate: 0.0015,
  frame: 0.0015,
  // Room left each side of the blades between the ribs (the box walls are the ribs' faces
  // at the ends); the spoiler's frame takes more, so it has ply to carry its opening
  clearBlade: 0.0015,
  clearSpoiler: 0.006,
  // Clearance round a blade's slot or the spoiler plate's opening in the covering, each side
  slot: 0.0005,
}

export const MIN_BRAKE = 0.02
export const MAX_BLADES = 6

export function newBrake(type, panel, at, id = 1) {
  const t = BRAKE_TYPES[type] ? type : 'blade'
  return { id, type: t, panel, at, length: t === 'blade' ? 0.08 : 0.1, x: 0.55, chord: t === 'blade' ? 0.03 : 0.04, height: 0.012, blades: 1, surface: 'top', angle: 60 }
}

// The key a brake's servo bay is saved under in controls.bays (its id is a number, like a
// control surface's, so the keys are kept apart).
export const brakeKey = (id) => `b${id}`

const nextId = (list) => list.reduce((m, x) => Math.max(m, x.id ?? 0), 0) + 1

// The panel a brake is on, by id: { index, inner, outer, panel } from the sampler, or null.
function panelOf(sampler, id) {
  const i = sampler.ends.findIndex((e) => (e.panel.id ?? null) === id)
  return i < 0 ? null : { index: i, ...sampler.ends[i] }
}

// The room each side of the blades or plate between the ribs
export const clearOf = (type) => (type === 'spoiler' ? BRAKE.clearSpoiler : BRAKE.clearBlade)

// A brake placed on the wing: its centre s, the ribs either side (sA, sB: their centres, a rib
// thickness t out from its length plus the clearance), the gap between the ribs' faces (gap),
// and its chord range in plan (x0, x1, a rectangle: a wing's sides run straight along the span
// whatever the taper). ok is false, with a problem, if it can't be placed: 'panel' (no such
// panel), 'size' (a size or position that makes no sense) or 'span' (its ribs would be off the
// panel, or too near its ends, which have ribs of their own).
export function resolveBrake(sampler, brake, ribThickness = 0.002) {
  const p = panelOf(sampler, brake.panel)
  if (!p) return { ...brake, ok: false, problem: 'panel' }
  const blade = brake.type === 'blade'
  const good = (v, lo, hi) => Number.isFinite(v) && v >= lo && v <= hi
  const sized =
    BRAKE_TYPES[brake.type] &&
    Number.isFinite(brake.at) &&
    good(brake.length, MIN_BRAKE, 2) &&
    good(brake.chord, 0.01, 1) &&
    good(brake.x, 0.05, 0.95) &&
    (!blade || (good(brake.height, 0.003, 0.2) && Number.isInteger(brake.blades) && brake.blades >= 1 && brake.blades <= MAX_BLADES)) &&
    (blade || good(brake.angle, 10, 90))
  if (!sized) return { ...brake, ok: false, problem: 'size', panelIndex: p.index }
  const t = Math.max(0, ribThickness)
  const clear = clearOf(brake.type)
  const gap = brake.length + 2 * clear
  const half = gap / 2 + t / 2
  const s = p.inner.s + brake.at
  const sA = s - half
  const sB = s + half
  if (sA < p.inner.s + 0.005 || sB > p.outer.s - 0.005) return { ...brake, ok: false, problem: 'span', panelIndex: p.index }
  const w = sampler.at(s)
  const xc = w.xl + brake.x * w.c
  return { ...brake, ok: true, problem: null, panelIndex: p.index, s, sA, sB, gap, clear, xc, x0: xc - brake.chord / 2, x1: xc + brake.chord / 2, rib: t }
}

// Every brake placed, in order along the span, with names (AB1, AB2 … root outward) and
// problems: those that can't be placed, and any whose ribs would be on top of an earlier
// one's ('overlap'). Only ok ones go on to be built.
export function resolveBrakes(sampler, brakes = [], { ribThickness = 0.002 } = {}) {
  const list = (brakes ?? []).map((b) => resolveBrake(sampler, b, ribThickness))
  const order = [...list].sort((a, b) => (a.s ?? Infinity) - (b.s ?? Infinity) || (a.id ?? 0) - (b.id ?? 0))
  const placed = []
  order.forEach((r, i) => {
    const info = BRAKE_TYPES[r.type] ?? BRAKE_TYPES.blade
    r.name = `${info.code}${i + 1}`
    r.label = `${info.short} ${r.name}`
    r.key = brakeKey(r.id)
    if (!r.ok) return
    if (placed.some((q) => r.sA < q.sB + 0.005 && r.sB > q.sA - 0.005)) {
      r.ok = false
      r.problem = 'overlap'
      return
    }
    placed.push(r)
  })
  return order
}

// Each built brake as the host a servo bay is placed for (servos.js placeBays takes surfaces;
// anything with an id, panelIndex, s0 and s1 will do). The bay goes beside the box, its outer
// rib the box's inner one, or failing that outboard of it. bay ids are the brake's key.
export function brakeHosts(brakes, teFront) {
  return (brakes ?? [])
    .filter((r) => r.ok)
    .map((r) => ({
      id: r.key,
      brake: r.id,
      ok: true,
      name: r.name,
      label: r.label,
      panelIndex: r.panelIndex,
      s0: r.sA,
      s1: r.sB,
      beside: [r.sA, r.sB],
      faces: { fixedFront: teFront },
    }))
}

const snap5 = (v) => Math.round(v / 0.005) * 0.005

// Add a brake to panel i, of the given type (a blade brake by default), as near the middle of
// the panel as there's room for it. Returns { brakes, id } (the new brake's id), or null if
// there's no room.
export function addBrake(sampler, brakes, i, type = 'blade', { ribThickness = 0.002 } = {}) {
  const end = sampler?.ends[i]
  if (!end) return null
  const L = end.outer.s - end.inner.s
  const id = end.panel.id
  const base = newBrake(type, id, 0, nextId(brakes ?? []))
  for (const f of [0.5, 0.35, 0.65, 0.2, 0.8]) {
    const cand = { ...base, at: snap5(L * f) }
    const list = [...(brakes ?? []), cand]
    const res = resolveBrakes(sampler, list, { ribThickness }).find((r) => r.id === cand.id)
    if (res.ok) return { brakes: list, id: cand.id }
  }
  return null
}

// The outline of a brake in plan, flat, as [s, x] points (the box's outside, with its walls,
// or the spoiler's plate); for drawing. Null if it can't be placed.
export function brakeOutline(r) {
  if (!r?.ok) return null
  const w = r.type === 'blade' ? BRAKE.wall : 0
  return [
    [r.sA + r.rib / 2, r.x0 - w],
    [r.sB - r.rib / 2, r.x0 - w],
    [r.sB - r.rib / 2, r.x1 + w],
    [r.sA + r.rib / 2, r.x1 + w],
  ]
}

// The blades' chord positions (their centres, m in plan): spaced evenly across the box
export function bladeXs(r) {
  return Array.from({ length: r.blades ?? 1 }, (_, k) => r.x0 + ((r.x1 - r.x0) * (k + 0.5)) / (r.blades ?? 1))
}

// The openings in the covering a brake needs, as { x0, x1, s0, s1 } rectangles in plan: a slot
// for each blade, or the spoiler plate's opening. Both surfaces for a blade through each skin.
export function brakeOpenings(r) {
  if (!r?.ok) return []
  if (r.type === 'spoiler') {
    return [{ x0: r.x0 - BRAKE.slot, x1: r.x1 + BRAKE.slot, s0: r.s - r.length / 2 - BRAKE.slot, s1: r.s + r.length / 2 + BRAKE.slot }]
  }
  const hw = BRAKE.bladeThickness / 2 + BRAKE.slot
  return bladeXs(r).map((x) => ({ x0: x - hw, x1: x + hw, s0: r.s - r.length / 2 - BRAKE.slot, s1: r.s + r.length / 2 + BRAKE.slot }))
}

// The lattice cut-outs in a blade, as rectangles [u0, z0, u1, z1] in the blade's own plane (u
// along its length, z up its height): slots 10 mm long on a 16 mm pitch, centred, from 30% to
// 80% of its height, leaving a solid bar along the foot (the guide) and the top edge. None for
// a blade too short or too low to take one.
export function bladeSlots(length, height) {
  const slotW = 0.01
  const pitch = 0.016
  const n = Math.floor((length - 0.008 - slotW) / pitch) + 1
  if (n < 1 || height < 0.012) return []
  const run = (n - 1) * pitch + slotW
  const u0 = (length - run) / 2
  return Array.from({ length: n }, (_, k) => [u0 + k * pitch, 0.3 * height, u0 + k * pitch + slotW, 0.8 * height])
}
