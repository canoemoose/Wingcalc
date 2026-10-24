// A servo bay's linkage: the settings saved with the bay, the frame a built bay gives the
// linkage geometry (linkage.js), and the choices the servo configurator offers.
//
// The link, saved in the bay as `link` (only what differs from DEFAULT_LINK):
//   arm       an arm's id (linkage.js ARMS or GENERIC_ARMS), or null for the first the servo
//             is offered
//   armRow    which row of holes on it (a set's arm, a double's side), by index
//   armHole   which hole along that row, by index, or null for the best pair
//   horn      a horn's id, or null for the one the servo's class takes
//   hornHole  by index, lowest first, or null for the best pair
//   hornFace  'top' or 'bottom' (default): the face of the surface the horn's on, which the arm
//             comes out through and the pushrod runs over, outside the wing
//   travel    the servo's travel each way, degrees: 45 (standard) or 60 (extended end points)
//   facing    1 or -1, which way the arm points, or null for the one towards the horn's face
//   linkage   'pushrod' (the only type so far)
//   hornAt    where the horn is along the hinge, m from the surface's inner end (flat, along the
//             span), or null for square to the hinge from the servo's output
//   hornAngle the horn turned in plan from square to the hinge, degrees

import { armsFor, armById, hornById, defaultHorn, hingeAt, hornHole, outputPivot, solveAssembly, linkage } from './linkage.js'
import { installedServo, servoById, bayOf, SERVO_HEADROOM } from './servos.js'
import { servoBox, surfaceHeight, insetHeight } from './wing3d.js'

export const DEFAULT_LINK = { arm: null, armRow: 0, armHole: null, horn: null, hornHole: null, hornFace: 'bottom', travel: 45, facing: null, linkage: 'pushrod', hornAt: null, hornAngle: 0 }
export const TRAVELS = [45, 60]

export const linkOf = (bay) => ({ ...DEFAULT_LINK, ...(bay?.link ?? {}) })

// The link as saved: only what differs from the defaults, or null if nothing does
export function savedLink(link) {
  const out = {}
  for (const [k, v] of Object.entries(link ?? {})) if (k in DEFAULT_LINK && v !== DEFAULT_LINK[k] && v !== undefined) out[k] = v
  return Object.keys(out).length ? out : null
}

// What a built bay gives the linkage: where its servo stands and how it's turned, the hinge at
// the horn's station (on the centre line, with the faces' offsets from it), the surface's depth
// there and its designed throws. a: analyseStructure's result; b: one of its bays (ok); link: its
// link (for where the horn is). null if the bay isn't built or its surface isn't.
//   s, square   the horn's station, flat s, and the one square to the hinge from the output
//   range       the stations the horn can take, [s0, s1]: on the surface, clear of its ends
//   bayS        the bay's own station
//   pose        how the servo's turned ({ rotate, flip, yaw }, servos.js installedServo)
//   box         where it stands (wing3d.js servoBox: base, floor, ceil), and insetMax, the most
//               it can be inset from the skin on its horn's face
//   chord       the section at the bay's station, { xl, c }, for where the servo is along it
//   hornDir     the horn's plane in plan, [x, s]: aft, square to the hinge turned by hornAngle
//   faceLine    each face's height along the horn's plane, { top, bottom }: [[u, z]], u aft of
//               the hinge, m; and meet, where each face of the moving surface starts behind its
//               bevel, { top, bottom } (u)
//   outline     the section at the horn's station for the side view, [x, z] in the flat frame:
//               fixed (from ahead of the servo to the fixed hinge spar's rear face, its front a
//               cut at `cut`) and moving (the surface, its front bevelled to the hinge)
export function bayFrame(a, b, link = DEFAULT_LINK) {
  if (!a || !b?.ok || !b.case) return null
  const surface = (a.surfaces ?? []).find((r) => r.id === b.surface && r.ok)
  if (!surface) return null
  const box = servoBox(a, a.structure, b)
  const at = { x: (b.case.x0 + b.case.x1) / 2, s: b.s, base: box.base }
  const range = [surface.s0 + HORN_END, surface.s1 - HORN_END]
  const clamp = (v) => Math.min(range[1], Math.max(range[0], v))
  // The foot of the square from the output to the hinge line in plan
  const [px, ps] = outputPivot(b.servo, at, 0).pivot
  const square = clamp(ps - (surface.slope * (surface.hingeX(ps) - px)) / (1 + surface.slope ** 2))
  const s = Number.isFinite(link.hornAt) ? clamp(surface.s0 + link.hornAt) : square
  const x = surface.hingeX(s)
  const upper = surfaceHeight(a, s, x, 'upper')
  const lower = surfaceHeight(a, s, x, 'lower')
  const z = (upper + lower) / 2
  const sec = a.section(s)
  const ang = ((link.hornAngle || 0) * Math.PI) / 180
  const n = Math.hypot(surface.slope, 1)
  // Square to the hinge in plan, aft, then turned
  const aft = [1 / n, -surface.slope / n]
  const hornDir = [aft[0] * Math.cos(ang) - aft[1] * Math.sin(ang), aft[0] * Math.sin(ang) + aft[1] * Math.cos(ang)]
  const faceLine = {}
  for (const [face, which] of [['top', 'upper'], ['bottom', 'lower']]) {
    faceLine[face] = Array.from({ length: 41 }, (_, i) => {
      const u = -0.01 + i * 0.0015
      return [u, surfaceHeight(a, s + hornDir[1] * u, x + hornDir[0] * u, which)]
    })
  }
  // Behind the bevel: the moving surface's front at its apex, each face cut back at its bevel
  const apex = surface.faces?.apex?.(s) ?? x
  const meet = {}
  for (const [face, which] of [['top', 'upper'], ['bottom', 'lower']]) {
    meet[face] = Math.max(0, (bevelMeet(a, surface, s, apex, z, which) - x) / Math.max(0.2, hornDir[0]))
  }
  // Each face's outer surface along the chord at the output's station, from ahead of the servo
  // to the hinge: what the arm's hole has to stay outside of
  const x0 = Math.min(b.lugs.x0, b.case.x0) - 0.03
  const x1 = surface.hingeX(ps) + 0.002
  const skinLine = {}
  for (const [face, which] of [['top', 'upper'], ['bottom', 'lower']]) {
    skinLine[face] = Array.from({ length: 41 }, (_, i) => {
      const xi = x0 + ((x1 - x0) * i) / 40
      return [xi, surfaceHeight(a, ps, xi, which)]
    })
  }
  const bayChord = a.section(b.s)
  const sv = b.servo
  const tall = Math.max(sv.height, sv.lugHeight + sv.lugThickness + (sv.plate ?? 0))
  return {
    surface,
    label: surface.label ?? '',
    s,
    square,
    range,
    bayS: b.s,
    hinge: hingeAt(surface, s, z),
    faces: { top: upper - z, bottom: z - lower },
    depth: sec.xl + sec.c - x,
    up: surface.up ?? 0,
    down: surface.down ?? 0,
    at,
    pose: { rotate: !!sv.rotate, flip: !!sv.flip, yaw: sv.yaw ?? 0 },
    box,
    insetMax: Math.max(0, box.ceil - box.floor - tall),
    chord: { xl: bayChord.xl, c: bayChord.c },
    room: b.room,
    hornDir,
    faceLine,
    meet,
    skinLine,
    outline: sectionOutline(a, surface, s, Math.min(b.lugs.x0, b.case.x0) - 0.012, z),
  }
}

// Where a face of the moving surface starts behind its bevel at s, x in the flat frame: the
// bevel runs from the apex on the centre line (z) at the surface's bevel angle for that face
function bevelMeet(a, surface, s, apex, z, which) {
  const k = Math.tan(((surface.bevel?.[which === 'upper' ? 'top' : 'bottom'] ?? 0) * Math.PI) / 180)
  const sec = a.section(s)
  const te = sec.xl + sec.c - 1e-5
  let x = apex
  for (let i = 0; i < 4; i++) x = Math.min(te, apex + k * Math.abs(surfaceHeight(a, s, x, which) - z))
  return x
}

// The section at s for the side view, [x, z] in the flat frame: the fixed part from x0 (a cut)
// to the fixed hinge spar's rear face, and the moving surface from its apex on the centre line
// (z), bevelled to each face, to the trailing edge
function sectionOutline(a, surface, s, x0, z) {
  const sec = a.section(s)
  const up = (x) => surfaceHeight(a, s, x, 'upper')
  const lo = (x) => surfaceHeight(a, s, x, 'lower')
  const rear = surface.faces?.fixedRear?.(s) ?? surface.hingeX(s)
  const apex = surface.faces?.apex?.(s) ?? surface.hingeX(s)
  const te = sec.xl + sec.c - 1e-5
  const run = (from, to, n = 24) => Array.from({ length: n + 1 }, (_, i) => from + ((to - from) * i) / n)
  const cut = Math.max(sec.xl, Math.min(x0, rear - 0.005))
  const fixed = [...run(cut, rear).map((x) => [x, up(x)]), ...run(cut, rear).reverse().map((x) => [x, lo(x)])]
  const mt = bevelMeet(a, surface, s, apex, z, 'upper')
  const mb = bevelMeet(a, surface, s, apex, z, 'lower')
  const moving = [[apex, z], ...run(mb, te).map((x) => [x, lo(x)]), ...run(mt, te).reverse().map((x) => [x, up(x)])]
  return { fixed, moving, cut }
}

// The horn's outline at surface neutral, [x, s, z] corners in its plane in the flat frame: its
// base on the moving surface's face from just behind the bevel, aft, following the face; its
// front rising to a column over the hinge line, where its holes are, HORN_EDGE of material either
// side of them up to its tip. A placeholder for a real horn's shape: only its height and holes
// are the maker's.
export function hornOutline(frame, horn, face) {
  const up = face === 'bottom' ? -1 : 1
  const line = frame.faceLine[face]
  const zAt = (u) => {
    const k = line.findIndex((p) => p[0] > u)
    const i = Math.max(0, Math.min(line.length - 2, (k < 0 ? line.length : k) - 1))
    const [u0, z0] = line[i]
    const [u1, z1] = line[i + 1]
    return z0 + ((z1 - z0) * (u - u0)) / (u1 - u0)
  }
  const H = frame.hinge.point
  const d = frame.hornDir
  const at = (u, z) => [H[0] + d[0] * u, H[1] + d[1] * u, z]
  const face0 = H[2] + up * frame.faces[face]
  const b0 = frame.meet[face] + 0.0005
  const len = Math.max(horn.height * PART_SIZES.horn.base, 0.006)
  const base = Array.from({ length: 5 }, (_, i) => b0 + (len * i) / 4).map((u) => at(u, zAt(u)))
  const tip = face0 + up * horn.height
  const low = face0 + up * Math.max(0, horn.holes[0] - HORN_EDGE)
  return [...base, at(HORN_EDGE, tip), at(-HORN_EDGE, tip), at(-HORN_EDGE, low)]
}
// The horn's material either side of its holes, m
export const HORN_EDGE = 0.0025
// The least a horn's centre keeps from its surface's ends, m
export const HORN_END = 0.008

// Whether a servo fits the bay where it is: the depth it needs (its own, or its plate's top,
// plus the headroom) against the depth the bay has. { ok, need, room }
export function servoFits(frame, servo) {
  const need = Math.max(servo.height, servo.lugHeight + servo.lugThickness + (servo.plate ?? 0)) + SERVO_HEADROOM
  return { ok: !(frame.room < need), need, room: frame.room }
}

// The arm, its row, the horn and the facing the link resolves to for a servo (the defaults
// filled in), with the arm's choices.
export function resolveLink(servo, link) {
  const arms = armsFor(servoById(servo.id) ?? servo)
  const arm = (link.arm && arms.find((x) => x.id === link.arm)) || arms[0] || armById('generic-micro')
  const armRow = Math.min(Math.max(0, link.armRow ?? 0), arm.holes.length - 1)
  const horn = (link.horn && hornById(link.horn)) || defaultHorn(servo)
  return { arms, arm, armRow, horn }
}

// The geometry for one arm hole and one horn hole (indices)
export function assemblyGeometry(frame, servo, { arm, armRow, horn }, armIndex, hornIndex, face) {
  const pivot = outputPivot(servo, frame.at, arm.seat)
  return {
    ...pivot,
    radius: arm.holes[armRow].radii[armIndex],
    hinge: frame.hinge,
    horn: hornHole(frame.hinge, { face, faceOffset: frame.faces[face], height: horn.holes[hornIndex] }),
  }
}

// The facing whose arm points towards the horn's face (up for a top horn), or 1 where neither
// does more than the other (a flat servo's arm swings across the span)
function autoFacing(frame, servo, parts, face) {
  const want = face === 'bottom' ? -1 : 1
  let best = 1
  let score = -Infinity
  for (const facing of [1, -1]) {
    const geom = assemblyGeometry(frame, servo, parts, parts.arm.holes[parts.armRow].radii.length - 1, parts.horn.holes.length - 1, face)
    const r = solveAssembly(geom, { up: frame.up, down: frame.down, travel: 60, facing })
    if (!r.ok) continue
    const lean = (r.points.arm[2] - geom.pivot[2]) * want
    if (lean > score + 1e-6) {
      score = lean
      best = facing
    }
  }
  return best
}

// Every arm hole against every horn hole on the chosen row and horn: the result of each, and the
// best (within the travel and outside the wing, using the most travel: the finest control).
// cells[i][j] for arm hole i, horn hole j, each solveAssembly's result with clear (how far the
// arm's hole stays outside the skin on the horn's face over the travel used, beyond the
// pushrod's end, m: negative where it goes in) and outside (clear isn't negative).
export function holeMatrix(frame, servo, parts, { travel, facing, face }) {
  const opts = { up: frame.up, down: frame.down, travel, facing, depth: frame.depth }
  const radii = parts.arm.holes[parts.armRow].radii
  let best = null
  const cells = radii.map((_, i) =>
    parts.horn.holes.map((__, j) => {
      const g = assemblyGeometry(frame, servo, parts, i, j, face)
      const r = solveAssembly(g, opts)
      if (!r.ok) return r
      r.clear = holeClearance(frame, g, r, face, Math.min(r.travelNeeded, travel), parts.arm.size)
      r.outside = r.clear >= 0
      if (r.fits && r.outside && (!best || r.travelNeeded > best.travelNeeded)) best = { armHole: i, hornHole: j, travelNeeded: r.travelNeeded }
      return r
    }),
  )
  return { cells, best }
}

// How far an arm's hole stays outside the skin on the horn's face over a travel each way (from
// the servo's midpoint), beyond the pushrod wire's radius and ROD_CLEAR, m (negative where it goes
// in), by the frame's skin line at the output's station
function holeClearance(frame, g, r, face, travel, size) {
  const L = linkage(g)
  const line = frame.skinLine[face]
  const up = face === 'bottom' ? -1 : 1
  const rod = PART_SIZES.rod[size] ?? PART_SIZES.rod.standard
  let clear = Infinity
  for (let k = 0; k <= 12; k++) {
    const p = L.arm(armAngle(r, -travel + (2 * travel * k) / 12))
    clear = Math.min(clear, up * (p[2] - lineAt(line, p[0])) - rod - ROD_CLEAR)
  }
  return clear
}
// A sampled line's height at x ([[x, z]], x rising), held level beyond its ends
function lineAt(line, x) {
  if (x <= line[0][0]) return line[0][1]
  if (x >= line.at(-1)[0]) return line.at(-1)[1]
  const k = line.findIndex((p) => p[0] > x)
  const [x0, z0] = line[k - 1]
  const [x1, z1] = line[k]
  return z0 + ((z1 - z0) * (x - x0)) / (x1 - x0)
}

// Everything the configurator shows for a bay with a servo and a link: the parts, the facing,
// the hole matrix, the holes used (the chosen ones, or the best pair, or failing that the pair
// nearest to fitting) and the solved assembly. servo: installed.
export function configureBay(frame, servo, link) {
  const parts = resolveLink(servo, link)
  const face = link.hornFace === 'bottom' ? 'bottom' : 'top'
  const travel = TRAVELS.includes(link.travel) ? link.travel : 45
  const facing = link.facing === 1 || link.facing === -1 ? link.facing : autoFacing(frame, servo, parts, face)
  const matrix = holeMatrix(frame, servo, parts, { travel, facing, face })
  const radii = parts.arm.holes[parts.armRow].radii
  const inRange = (v, n) => Number.isInteger(v) && v >= 0 && v < n
  let armHole = inRange(link.armHole, radii.length) ? link.armHole : null
  let hornHole = inRange(link.hornHole, parts.horn.holes.length) ? link.hornHole : null
  if (armHole == null || hornHole == null) {
    // The best pair, keeping whichever hole was chosen
    const pick = nearestFit(matrix.cells, armHole, hornHole)
    armHole = armHole ?? pick.armHole
    hornHole = hornHole ?? pick.hornHole
  }
  const result = matrix.cells[armHole][hornHole]
  return { ...parts, face, travel, facing, matrix, armHole, hornHole, result, rodAngle: rodAngle(frame, result, link.hornAngle) }
}

// The pushrod's angle in plan from the horn's plane (square to the hinge, turned by hornAngle
// degrees), at the servo's midpoint, degrees, or null if it's not solved
function rodAngle(frame, r, hornAngle = 0) {
  if (!r?.ok) return null
  const d = [r.points.horn[0] - r.points.arm[0], r.points.horn[1] - r.points.arm[1]]
  const h = frame.hinge.axis
  const t = ((hornAngle || 0) * Math.PI) / 180
  // Square to the hinge, aft, turned
  const sq = [h[1], -h[0]]
  const plane = [sq[0] * Math.cos(t) - sq[1] * Math.sin(t), sq[0] * Math.sin(t) + sq[1] * Math.cos(t)]
  const n = Math.hypot(...d) * Math.hypot(...plane)
  if (!(n > 0)) return null
  const c = Math.abs((d[0] * plane[0] + d[1] * plane[1]) / n)
  return (Math.acos(Math.min(1, c)) * 180) / Math.PI
}

// How far the pushrod may run off the horn's plane in plan before it's warned, degrees
export const ROD_OFF_SQUARE = 10

// Every built bay's linkage on a control surface: Map of surface id -> { bay, frame, c (as
// configureBay), warnings ([{ id, message }]) }. a: analyseStructure's result; controls: the
// wing's (for each bay's link).
export function bayLinkages(a, controls) {
  const out = new Map()
  for (const b of a?.bays ?? []) {
    if (b.brake) continue
    const link = linkOf(bayOf(controls, b.surface))
    const frame = bayFrame(a, b, link)
    if (!frame) continue
    const c = configureBay(frame, b.servo, link)
    const fit = linkageFit(a, b, frame, c)
    out.set(b.surface, { bay: b, frame, c, link, fit, solids: linkageSolids(frame, b.servo, c), warnings: [...linkWarnings(b, frame, c), ...fit.warnings] })
  }
  return out
}

function linkWarnings(b, frame, c) {
  const r = c.result
  const name = `${b.label} (${frame.label})`
  if (!r.ok) return [{ id: `linkage-reach-${b.surface}`, message: `${name}: its arm and horn holes can't give the designed throws without the arm passing dead centre. Choose other holes in Servo and linkage.` }]
  const out = []
  if (!r.fits) {
    out.push({
      id: `linkage-travel-${b.surface}`,
      message: `${name}: the designed throws need ±${r.travelNeeded.toFixed(0)}° of servo travel, more than its ±${c.travel}°, so it reaches only ${r.achieved.up.toFixed(0)}° up and ${r.achieved.down.toFixed(0)}° down. Use an arm hole further out or a horn hole lower down${c.travel === 45 ? ', or extended end points' : ''}.`,
    })
  }
  if (c.rodAngle != null && c.rodAngle > ROD_OFF_SQUARE) {
    out.push({
      id: `linkage-square-${b.surface}`,
      message: `${name}: the pushrod runs ${c.rodAngle.toFixed(0)}° off the horn's plane, which binds the clevis. Move the horn along the hinge, turn it to line up, or square the servo to the hinge.`,
    })
  }
  return out
}

// The pair that fits (within the travel, outside the wing) using the most travel, or, with none
// fitting, the one needing the least of those outside the wing, or of any, among those agreeing
// with a hole already chosen
function nearestFit(cells, armHole, hornHole) {
  let fit = null
  let near = null
  cells.forEach((row, i) =>
    row.forEach((r, j) => {
      if ((armHole != null && i !== armHole) || (hornHole != null && j !== hornHole) || !r.ok) return
      if (r.fits && r.outside && (!fit || r.travelNeeded > fit.t)) fit = { armHole: i, hornHole: j, t: r.travelNeeded }
      const rank = (r.outside ? 0 : 1000) + r.travelNeeded
      if (!near || rank < near.rank) near = { armHole: i, hornHole: j, rank }
    }),
  )
  return fit ?? near ?? { armHole: armHole ?? 0, hornHole: hornHole ?? 0 }
}

// The servos the picker lists, each with whether it fits the bay (and why not)
export function servoChoices(frame, options, mass) {
  return options.map((o) => {
    const v = installedServo(o.value, mass, frame.pose)
    const f = servoFits(frame, v)
    const mm = (x) => `${(x * 1000).toFixed(0)} mm`
    return { ...o, fits: f.ok, reason: f.ok ? '' : `Needs ${mm(f.need)} of depth, the bay has ${mm(Math.max(0, f.room))}` }
  })
}

// A short summary of a link: "HS-5125MG › Hitec 55706 (single), hole 2 › Du-Bro 848, hole 3"
export function linkSummary(servo, c) {
  const armName = c.arm.maker === 'Generic' ? c.arm.name : `${c.arm.maker} ${c.arm.part}`
  const row = c.arm.holes.length > 1 ? ` (${c.arm.holes[c.armRow].arm})` : ''
  return `${servo.label} › ${armName}${row}, hole ${c.armHole + 1} › ${c.horn.maker} ${c.horn.part}, hole ${c.hornHole + 1}`
}

// --- The parts in the wing ---------------------------------------------------------------------

// Sizes the arm, horn and pushrod are drawn and checked at, by the arm's or horn's size, m: the
// arm's width and thickness and how far its end runs past its outer hole; the horn plate's
// thickness, its base along its plane as a share of its height, and its tip; the pushrod wire's
// radius (1.2, 1.6 and 2 mm wire)
export const PART_SIZES = {
  arm: { micro: { width: 0.0045, thickness: 0.002, tip: 0.0025 }, standard: { width: 0.006, thickness: 0.0025, tip: 0.003 }, large: { width: 0.008, thickness: 0.003, tip: 0.004 } },
  horn: { micro: 0.0015, mini: 0.0015, standard: 0.002, large: 0.0025, base: 0.7, tip: 0.004 },
  rod: { micro: 0.0006, standard: 0.0008, large: 0.001 },
}

const v3 = {
  add: (p, q) => [p[0] + q[0], p[1] + q[1], p[2] + q[2]],
  sub: (p, q) => [p[0] - q[0], p[1] - q[1], p[2] - q[2]],
  mul: (p, k) => [p[0] * k, p[1] * k, p[2] * k],
  cross: (p, q) => [p[1] * q[2] - p[2] * q[1], p[2] * q[0] - p[0] * q[2], p[0] * q[1] - p[1] * q[0]],
  unit: (p) => {
    const n = Math.hypot(...p) || 1
    return [p[0] / n, p[1] / n, p[2] / n]
  },
}

// A box from p0 to p1 with its width along u and its thickness along v: two rectangular rings
const barRings = (p0, p1, u, v, w, t) =>
  [p0, p1].map((p) => [
    v3.add(p, v3.add(v3.mul(u, w / 2), v3.mul(v, t / 2))),
    v3.add(p, v3.add(v3.mul(u, -w / 2), v3.mul(v, t / 2))),
    v3.add(p, v3.add(v3.mul(u, -w / 2), v3.mul(v, -t / 2))),
    v3.add(p, v3.add(v3.mul(u, w / 2), v3.mul(v, -t / 2))),
  ])

// A round rod from p0 to p1, radius r: two 12-sided rings square to it
function rodRings(p0, p1, r) {
  const d = v3.unit(v3.sub(p1, p0))
  const u = v3.unit(v3.cross(d, Math.abs(d[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0]))
  const w = v3.cross(d, u)
  const ring = (p) => Array.from({ length: 12 }, (_, i) => v3.add(p, v3.add(v3.mul(u, r * Math.cos((2 * Math.PI * i) / 12)), v3.mul(w, r * Math.sin((2 * Math.PI * i) / 12)))))
  return [ring(p0), ring(p1)]
}

// The arm's angle (radians from its reference) with the servo at an angle from its midpoint
// (degrees, in its turning direction for trailing edge down)
const armAngle = (r, servoDeg) => ((r.midpoint + r.direction * servoDeg) * Math.PI) / 180

// The assembly at surface neutral as solids, each { kind, rings } with rings in the wing's flat
// frame ([x, s, z]), for wing3d to place: the arm ('servoArm'), the horn ('horn', its outline,
// hornOutline, as a plate) and the pushrod ('pushrod'). Empty where the linkage isn't solved.
export function linkageSolids(frame, servo, c) {
  const r = c.result
  if (!r?.ok) return []
  const g = assemblyGeometry(frame, servo, c, c.armHole, c.hornHole, c.face)
  const L = linkage(g)
  const t0 = armAngle(r, r.neutralArm)
  const d = L.armDir(t0)
  const A = PART_SIZES.arm[c.arm.size] ?? PART_SIZES.arm.standard
  const radii = c.arm.holes[c.armRow].radii
  const across = v3.cross(L.a, d)
  const hub = A.width / 2
  const arm = barRings(v3.add(g.pivot, v3.mul(d, -hub)), v3.add(g.pivot, v3.mul(d, radii.at(-1) + A.tip)), across, L.a, A.width, A.thickness)
  const ht = PART_SIZES.horn[c.horn.size] ?? PART_SIZES.horn.standard
  const normal = [-frame.hornDir[1], frame.hornDir[0], 0]
  const outline = hornOutline(frame, c.horn, c.face)
  const horn = [-1, 1].map((k) => outline.map((p) => v3.add(p, v3.mul(normal, (k * ht) / 2))))
  const rod = rodRings(L.arm(t0), g.horn, PART_SIZES.rod[c.arm.size] ?? PART_SIZES.rod.standard)
  return [
    { kind: 'servoArm', rings: arm },
    { kind: 'horn', rings: horn },
    { kind: 'pushrod', rings: rod },
  ]
}

// --- Fit in the wing -----------------------------------------------------------------------------

// The pushrod's clearance over the skin, beyond the wire's radius, m: its clevis or Z-bend
export const ROD_CLEAR = 0.001

// Whether the linkage works outside the wing over the travel the designed throws use. The arm
// comes out through the skin on the horn's face: its slot, drawn on the plan, is in the hatch when
// every point of it is inside the hatch's outline, else in the skin. Warned: the arm's hole in use
// going inside the wing (the pushrod would have to enter it), the pushrod touching the skin
// between its holes, and the arm's end sweeping into the bay's ribs inside the wing.
// { slots: [{ what, surface, hatch, x0, x1, s0, s1 }], clashes: ['inside' | 'rod' | 'rib'],
// warnings }.
export function linkageFit(a, b, frame, c) {
  const out = { slots: [], clashes: [], warnings: [] }
  const r = c.result
  if (!r?.ok) return out
  const st = a.structure
  const g = assemblyGeometry(frame, b.servo, c, c.armHole, c.hornHole, c.face)
  const L = linkage(g)
  const A = PART_SIZES.arm[c.arm.size] ?? PART_SIZES.arm.standard
  const rod = PART_SIZES.rod[c.arm.size] ?? PART_SIZES.rod.standard
  const reach = c.arm.holes[c.armRow].radii.at(-1) + A.tip
  const T = Math.min(r.travelNeeded, c.travel)
  const sweep = Array.from({ length: 13 }, (_, i) => -T + (2 * T * i) / 12)
  const face = c.face
  const which = face === 'top' ? 'upper' : 'lower'
  const up = face === 'top' ? 1 : -1
  const onChord = ([x, s]) => {
    const sec = a.section(s)
    return !!sec && x >= sec.xl && x <= sec.xl + sec.c
  }
  // How far a point is beyond the face's outer surface, and beyond its skin's inner face
  // (positive outwards)
  const outside = ([x, s, z]) => up * (z - surfaceHeight(a, s, x, which))
  const beyondInner = ([x, s, z]) => up * (z - insetHeight(a, st, s, x, which))
  const inWing = ([x, s, z]) => onChord([x, s]) && z < insetHeight(a, st, s, x, 'upper') && z > insetHeight(a, st, s, x, 'lower')
  const mm = (v) => `${(v * 1000).toFixed(0)} mm`
  const name = `${b.label} (${frame.label})`

  // The slot: where the arm passes through the skin over its sweep, half its thickness either side
  const half = A.thickness / 2
  const through = []
  for (const x of sweep) {
    const dir = L.armDir(armAngle(r, x))
    for (let i = 0; i <= 40; i++) {
      const p = v3.add(g.pivot, v3.mul(dir, (reach * i) / 40))
      if (onChord(p) && beyondInner(p) > -half && outside(p) < half) through.push(p)
    }
  }
  if (through.length) {
    const xs = through.map((p) => p[0])
    const qs = through.map((p) => p[1])
    const hatch = b.hatch
    const inHatch = ([x, s]) => hatch && x >= hatch.x0 && x <= hatch.x1 && s >= hatch.s0 && s <= hatch.s1
    const pad = A.width / 2
    out.slots.push({ what: 'arm', surface: face, hatch: face === 'bottom' && through.every(inHatch), x0: Math.min(...xs) - pad, x1: Math.max(...xs) + pad, s0: Math.min(...qs) - pad, s1: Math.max(...qs) + pad })
  }

  // The hole in use stays outside the skin, with room for the pushrod's end
  const holes = sweep.map((x) => L.arm(armAngle(r, x)))
  const short = Math.max(...holes.map((p) => rod + ROD_CLEAR - outside(p)))
  if (short > 0) {
    out.clashes.push('inside')
    out.warnings.push({
      id: `linkage-inside-${b.surface}`,
      message: `${name}: the arm's hole goes ${mm(short)} too far into the ${face} skin over its travel, so the pushrod would have to run inside the wing. Bring the servo nearer the ${face} skin, use a hole further out or a longer arm, or point the arm to the ${face}.`,
    })
  }

  // The pushrod at mid travel and each end, ahead of the hinge: clear of the skin
  let rubs = false
  for (const x of [-T, 0, T]) {
    const p0 = L.arm(armAngle(r, x))
    const d = r.surfaceAt(x)
    if (d == null) continue
    const p1 = L.hornAt((d * Math.PI) / 180)
    for (let i = 1; i < 40; i++) {
      const p = v3.add(p0, v3.mul(v3.sub(p1, p0), i / 40))
      if (!onChord(p) || p[0] > frame.surface.hingeX(p[1]) - 0.001) continue
      if (outside(p) < rod) rubs = true
    }
  }
  if (rubs && short <= 0) {
    out.clashes.push('rod')
    out.warnings.push({
      id: `linkage-rod-${b.surface}`,
      message: `${name}: the pushrod rubs on the ${face} skin between the arm and the horn. Use a higher horn hole or a longer arm, or bring the servo nearer the ${face} skin.`,
    })
  }

  // Inside the wing, the arm's end clear of the bay's ribs
  const ends = sweep.map((x) => v3.add(g.pivot, v3.mul(L.armDir(armAngle(r, x)), reach)))
  const ribs = b.inner ?? [b.sA, b.sB]
  // The arm's end reaches this far along the span either side of its centre line: half its
  // width across it and half its thickness along the output's axis, as they lie
  const spread = (t) => Math.abs(v3.cross(L.a, L.armDir(t))[1]) * (A.width / 2) + Math.abs(L.a[1]) * half
  if (ends.some((p, i) => inWing(p) && (p[1] - spread(armAngle(r, sweep[i])) < ribs[0] || p[1] + spread(armAngle(r, sweep[i])) > ribs[1]))) {
    out.clashes.push('rib')
    out.warnings.push({ id: `linkage-rib-${b.surface}`, message: `${name}: its arm sweeps into the bay's ribs. Use a shorter arm or an inner hole.` })
  }
  return out
}
