// The linkage from a servo to its control surface: the servo arms each maker sells, the control
// horns, which arms fit which servo, and the geometry of the assembly (where the arm's and the
// horn's holes are, the throw it gives, the servo travel it needs).
//
// Gathered 18 October 2026 from hitecrcd.com, futabausa.com and rc.futaba.co.jp (arms) and
// makers' and retailers' pages (horns). Neither maker publishes an arm's hole positions, and no
// horn maker its holes' heights, so the holes are estimated from what is published (an arm's
// length in its name, a horn's height, a few retailer measurements) by the rules below, and
// marked as estimated (docs/backlog.md lists the bases, for measuring).
//
// Arm:
//   id, maker, part, name   the maker's part number and name
//   kind      'single', 'double', 'cross', 'star', 'tee', 'disc' (a round horn or wheel) or 'set'
//   size      'micro', 'standard' or 'large', for the estimates and the seat
//   spline    the spline it fits, as servos name theirs (servoCatalogue.js), or null if unknown
//   inferred  true where the spline is read from the part's name or tooth count rather than
//             stated: Futaba's FSH-6 series as its Φ6 horns, Hitec's 24T arms as Standard 24
//   models    servos the maker names it for (some only by family), for a horn set made for them
//   holes     its rows of holes: [{ arm, radii }], arm naming which arm of a set or which side
//             of a double or cross, radii the holes' distances from the pivot, m, nearest first
//   seat      the holes' plane above the top of the output spline, m (about half the arm's
//             thickness over its boss, by size)
//   estimated true: the holes are estimated, not measured
//   basis     what the estimate is from
//   source    the page it's from
// Left out: sail-winch arms and drums (HS-815BB, HS-715BB/765HB, HS-725, Futaba FSH-38), which
// aren't for control surfaces.
//
// Estimating holes. An arm sold by its length (0.75 in, 1 in, 20 mm) is taken to be that long
// from the pivot to its tip (rather than overall: unmeasured), its outermost hole 2 mm (micro) or
// 2.5 mm in from the tip. Holes step inwards from it at a pitch, 2.4 mm (3/32 in) on micro arms, 3.5 mm on
// standard plastic ones (a retailer's measured Hitec-fit set: 11.5, 15.5, 19, 22.5 mm) and 4.8 mm
// (3/16 in) on large and aluminium ones (two measured 24T aluminium arms: 19 and 24 mm, 19.75 and
// 24.25 mm), as far as the boss allows (6, 9 and 12 mm from the pivot); an aluminium arm has
// three at most. An arm with no length published takes its size's usual one.
import { servoPoint, servoDir } from './servos.js'

const PITCH = { micro: 2.4, plastic: 3.5, metal: 4.8 }
const INNER = { micro: 6, standard: 9, large: 12 }
const SEAT = { micro: 0.0015, standard: 0.002, large: 0.0025 }
const mm = (x) => Math.round(x * 100) / 100000
// The outermost hole of an arm sold by its length, mm: that far to its tip, the hole in from it
const TIP = { micro: 2, standard: 2.5, large: 2.5 }
const tip = (length, size) => length - TIP[size]

// A row of holes from the outermost inwards, at most n of them, none nearer than inner (mm)
const row = (arm, outer, pitch, inner, n = Infinity) => {
  const radii = []
  for (let r = outer; r >= inner - 1e-9 && radii.length < n; r -= pitch) radii.unshift(mm(r))
  return { arm, radii }
}
// A row as measured or listed, mm
const listed = (arm, radii) => ({ arm, radii: radii.map(mm) })
const metal = (arm, outer, inner) => row(arm, outer, PITCH.metal, inner, 3)

const arm = (maker, part, name, kind, size, spline, { inferred = false, models = [], holes, basis, source }) => ({
  id: `${maker.toLowerCase()}-${part.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
  maker,
  part,
  name,
  kind,
  size,
  spline,
  inferred,
  models,
  holes,
  seat: SEAT[size],
  estimated: true,
  basis,
  source,
})

// Rows several arms share
const RETAILER = 'holes as a retailer measured a Hitec-fit 24T nylon set (wirelessmadness.com)'
const STANDARD_SET = [listed('single', [11.5, 15.5, 19, 22.5]), listed('double', [17, 19, 21, 25])]
const MICRO = "a micro set's usual arms (single 14 mm, double 12 mm, cross 10 mm)"
const MICRO_SET = [row('single', 14, PITCH.micro, INNER.micro), row('double', 12, PITCH.micro, INNER.micro), row('cross', 10, PITCH.micro, INNER.micro)]
const LARGE = "a large set's usual arms (single 30 mm, double 27 mm)"
const LARGE_SET = [row('single', 30, PITCH.metal, INNER.large), row('double', 27, PITCH.metal, INNER.large)]
const ALU_24 = 'holes as measured on a 24T aluminium arm (HobbyKing: 19 and 24 mm)'

const HITEC_HORNS = 'https://hitecrcd.com/'
const FUTABA_HORNS = 'https://futabausa.com/product-category/accessories/servo-parts/horns/'

export const ARMS = [
  arm('Hitec', '55702', 'Heavy duty double-sided aluminium servo arm, 24T', 'double', 'standard', 'Standard 24', { holes: [listed('each side', [19, 24])], basis: ALU_24, inferred: true, source: 'https://hitecrcd.com/24t-double-aluminum-horn/' }),
  arm('Hitec', '55709', 'Heavy duty and large horn set with mounting hardware, 24T', 'set', 'standard', 'Standard 24', { holes: STANDARD_SET, basis: RETAILER, inferred: true, source: 'https://hitecrcd.com/heavy-duty-large-and-regular-horn-set-24t/' }),
  arm('Hitec', '55701', 'Standard aluminium servo arm', 'single', 'standard', 'Standard 24', { holes: [listed('single', [19, 24])], basis: ALU_24, inferred: true, source: 'https://hitecrcd.com/std-aluminum-servo-arm/' }),
  arm('Hitec', '55725', 'Mega horn set and hardware, 24T (HS-755HB/MG, HS-5765MH)', 'set', 'large', null, { holes: LARGE_SET, basis: LARGE, models: ['HS-755HB', 'HS-755MG', 'HS-5765MH'], source: 'https://hitecrcd.com/hs-5755-5765-mega-horn-set/' }),
  arm('Hitec', '55732', 'H25T heavy duty horn and hardware set, airplane', 'set', 'standard', 'H25T', { holes: STANDARD_SET, basis: RETAILER, source: 'https://hitecrcd.com/h25t-hd-horn-hdwr-airplane/' }),
  arm('Hitec', '55706', 'Micro 25T horn set and mounting hardware', 'set', 'micro', 'Micro 25', { holes: MICRO_SET, basis: MICRO, models: ['HS-65HB', 'HS-65MG', 'HS-5065MG', 'HS-70MG', 'HS-5070MH', 'HS-125MG', 'HS-5125MG'], source: 'https://hitecrcd.com/hs-125mg-5125mg-horn-set/' }),
  arm('Hitec', '55707', 'MS-ML25 aluminium horn, 0.75 in, Micro 25T', 'single', 'micro', 'Micro 25', { holes: [metal('single', tip(19.05, 'micro'), INNER.micro)], basis: '0.75 in, pivot to tip', source: 'https://hitecrcd.com/hs-125-5125mg-65mg-5065mg-70mg-5070mg-aluminum-horn/' }),
  arm('Hitec', '55718', 'Micro horn set, Micro 25T', 'set', 'micro', 'Micro 25', { holes: MICRO_SET, basis: MICRO, source: HITEC_HORNS }),
  arm('Hitec', '55738', 'R-ML25 aluminium horn, 0.75 in, 25T', 'single', 'standard', null, { holes: [metal('single', tip(19.05, 'standard'), INNER.standard)], basis: '0.75 in, pivot to tip', source: 'https://hitecrcd.com/25t-aluminum-servo-horn/' }),
  arm('Hitec', '56326', 'Micro horn set', 'set', 'micro', null, { holes: MICRO_SET, basis: MICRO, source: HITEC_HORNS }),
  arm('Hitec', '55713', 'Heavy duty horn set (HS-755HB/MG)', 'set', 'large', null, { holes: LARGE_SET, basis: LARGE, models: ['HS-755HB', 'HS-755MG'], source: HITEC_HORNS }),
  arm('Hitec', '55723', 'Mega servo aluminium double-sided horn', 'double', 'large', null, { holes: [metal('each side', 30, INNER.large)], basis: "a large aluminium arm's usual 30 mm", source: HITEC_HORNS }),

  arm('Futaba', 'FSH-6X', '4-arm plastic servo horn (horn A)', 'cross', 'standard', 'Φ6', { holes: [row('long', 20, PITCH.plastic, INNER.standard), row('short', 15, PITCH.plastic, INNER.standard)], basis: "a Futaba-fit cross 44 mm across (lindinger.at): long arms' outer hole 20 mm, short 15 mm", inferred: true, source: 'https://futabausa.com/product/fsh-6x/' }),
  arm('Futaba', 'FSH-6S', '6-arm plastic servo horn, star (horn B)', 'star', 'standard', 'Φ6', { holes: [row('each arm', 14, PITCH.plastic, INNER.standard)], basis: "a star's usual 14 mm arms", inferred: true, source: 'https://futabausa.com/product/fsh-6s/' }),
  arm('Futaba', 'FSH-6E', '1 in double plastic horn (horn E)', 'double', 'standard', 'Φ6', { holes: [row('each side', tip(25.4, 'standard'), PITCH.plastic, INNER.standard)], basis: '1 in, pivot to tip, each side', inferred: true, source: 'https://futabausa.com/product/fsh-6e/' }),
  arm('Futaba', 'FSH-6F', 'Plastic double horn', 'double', 'standard', 'Φ6', { holes: [row('each side', 22, PITCH.plastic, INNER.standard)], basis: "a standard double arm's usual 22 mm a side", inferred: true, source: FUTABA_HORNS }),
  arm('Futaba', 'FSH-6T', 'Heavy duty T horn', 'tee', 'standard', 'Φ6', { holes: [row('long', 22, PITCH.plastic, INNER.standard), row('short', 12, PITCH.plastic, INNER.standard)], basis: "a T horn's usual 22 mm arm and 12 mm cross-bar", inferred: true, source: FUTABA_HORNS }),
  arm('Futaba', 'FSH-6G', 'Large round plastic horn (horn G)', 'disc', 'standard', 'Φ6', { holes: [row('disc', 17, PITCH.plastic, 7)], basis: 'a large round horn about 40 mm across', inferred: true, source: 'https://futabausa.com/product/fsh-6g/' }),
  arm('Futaba', 'FSH-6R', 'Medium round wheel horn (horn C)', 'disc', 'standard', 'Φ6', { holes: [row('disc', 12.5, PITCH.plastic, 7)], basis: 'a medium wheel about 30 mm across', inferred: true, source: FUTABA_HORNS }),
  arm('Futaba', 'FSH-6W', 'Small round horn, standard stock', 'disc', 'standard', 'Φ6', { holes: [row('disc', 9, PITCH.micro, INNER.micro)], basis: 'a small round horn about 22 mm across', inferred: true, source: FUTABA_HORNS }),
  arm('Futaba', 'FSH-T1', '1 in single aluminium horn (blue, red or silver)', 'single', 'standard', null, { holes: [metal('single', tip(25.4, 'standard'), INNER.standard)], basis: '1 in, pivot to tip', source: FUTABA_HORNS }),
  arm('Futaba', 'FSH-T2', '1.5 in single aluminium horn (blue, red or silver)', 'single', 'standard', null, { holes: [metal('single', tip(38.1, 'standard'), INNER.standard)], basis: '1.5 in, pivot to tip', source: FUTABA_HORNS }),
  arm('Futaba', 'FSH-T4', '20 mm single aluminium horn (blue, red or silver)', 'single', 'standard', null, { holes: [metal('single', tip(20, 'standard'), INNER.standard)], basis: '20 mm, pivot to tip', source: FUTABA_HORNS }),
  arm('Futaba', 'EBS0170', 'Aluminium clamping horn, 38 mm', 'single', 'standard', null, { holes: [metal('single', tip(38, 'standard'), INNER.standard)], basis: '38 mm, pivot to tip', source: FUTABA_HORNS }),
  arm('Futaba', 'FSH-63', 'Micro servo horn pack, long type', 'set', 'micro', null, { holes: [row('single', 17, PITCH.micro, INNER.micro)], basis: 'a long micro arm, 17 mm', models: ['S3103', 'S3107', 'S3270SVi'], source: 'https://futabausa.com/product/fsh-63/' }),
  arm('Futaba', 'FSH-60', 'S3108 horn and screw pack', 'set', 'micro', null, { holes: MICRO_SET, basis: MICRO, models: ['S3108', 'S3108M'], source: 'https://futabausa.com/product/fsh-60/' }),
  arm('Futaba', 'FSH-6V', 'S3156 horn variety pack', 'set', 'micro', null, { holes: MICRO_SET, basis: MICRO, models: ['S3156'], source: FUTABA_HORNS }),
]

// Generic arms: a size's usual set, for a generic class, or a servo none of its maker's arms
// are known to fit
export const GENERIC_ARMS = [
  arm('Generic', 'micro', 'Micro arm set', 'set', 'micro', null, { holes: MICRO_SET, basis: MICRO, source: null }),
  arm('Generic', 'standard', 'Standard arm set', 'set', 'standard', null, { holes: STANDARD_SET, basis: RETAILER, source: null }),
  arm('Generic', 'large', 'Large arm set', 'set', 'large', null, { holes: LARGE_SET, basis: LARGE, source: null }),
]
const GENERIC_FOR = { 'sub-micro': ['micro'], micro: ['micro'], mini: ['micro', 'standard'], standard: ['standard', 'large'] }

// The arms that fit a servo: its maker's, on its spline or made for it by name, or failing any,
// the generic arms of its size (a generic class's too).
export function armsFor(servo) {
  if (!servo) return []
  const type = servo.spline?.type
  const own = servo.maker ? ARMS.filter((a) => a.maker === servo.maker && ((type && a.spline === type) || a.models.includes(servo.model))) : []
  if (own.length) return own
  const sizes = GENERIC_FOR[servo.class ?? servo.id] ?? ['micro']
  return GENERIC_ARMS.filter((a) => sizes.includes(a.size))
}

export const armById = (id) => ARMS.find((a) => a.id === id) ?? GENERIC_ARMS.find((a) => a.id === id) ?? null

// Control horns: the horn on the moving surface the pushrod's clevis hooks into, its holes over
// the hinge line (as horn makers' instructions place them).
//   size      'micro', 'mini', 'standard' or 'large'
//   height    overall, from the face it sits on, m
//   heightEstimated  true where no height is published and it's taken from a like horn
//   holes     the holes' heights above that face, m, lowest first: estimated, n of them from
//             the tip down, the top one 2 mm (micro, mini) or 2.5 mm below the tip, at the
//             arms' pitches (2.4 mm on micro and mini horns, 3.5 mm standard, 4.8 mm large)
//   double    two-sided (for pull-pull)
const HORN_PITCH = { micro: 2.4, mini: 2.4, standard: 3.5, large: 4.8 }
const horn = (maker, part, name, size, height, n, { estimate = null, source }) => {
  const h = height ?? estimate
  const tip = h - (size === 'micro' || size === 'mini' ? 2 : 2.5)
  return {
    id: `${maker.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${part.toLowerCase()}`,
    maker,
    part,
    name,
    size,
    height: mm(h),
    heightEstimated: height == null,
    holes: Array.from({ length: n }, (_, i) => mm(tip - (n - 1 - i) * HORN_PITCH[size])),
    estimated: true,
    double: false,
    source,
  }
}

export const HORNS = [
  horn('Du-Bro', '848', 'Micro control horn, 1/2 in', 'micro', 12.7, 3, { source: 'https://motionrc.com/products/du-bro-micro-12-7mm-1-2-control-horns-2-pack-dub848' }),
  horn('Du-Bro', '107', '1/2A control horn, 3/4 in', 'mini', 19.05, 3, { source: 'https://www.dubro.com/products/1-2-a-control-horns' }),
  horn('Du-Bro', '105', 'Nylon control horn, 1-1/8 in', 'standard', 28.5, 4, { source: 'https://www.readymaderc.com/products/details/dubro-nylon-control-horns-1-left-1-right-number-105-2pcs' }),
  horn('Du-Bro', '716', 'T-style nylon control horn, 1-3/8 in', 'large', 34.7, 4, { source: 'https://motionrc.com/products/du-bro-34-7mm-1-37-super-strength-t-style-control-horns-2-pack-dub716' }),
  horn('Du-Bro', '237', 'T-style nylon control horn', 'large', 34.9, 4, { source: 'https://motionrc.com/products/du-bro-nylon-t-style-control-horns-2-pack-dub237' }),
  horn('Robart', '329', 'Ball-link control horn, 3/4 in', 'micro', 12.0, 1, { source: 'https://gator-rc.com/robart-329-ball-link-control-horn-3-4-2-pack-rob329' }),
  horn('Great Planes', 'GPMQ3900', 'Small nylon control horn', 'mini', null, 3, { estimate: 19.05, source: 'https://www.amazon.com/Great-Planes-Nylon-Control-Horns/dp/B001BHGD7K' }),
  horn('Great Planes', 'GPMQ3901', 'Large nylon control horn', 'standard', null, 4, { estimate: 28.5, source: 'https://amr-rc.com/nylon-control-horns-large-2.html' }),
  horn('Gator RC', 'GRC-34', 'Control horn, 34 mm, triangle base, angled', 'large', 34, 4, { source: 'https://www.gator-rc.com/products/gator-rc-control-horn-34mm-triangle-base-angled' }),
]

export const hornById = (id) => HORNS.find((h) => h.id === id) ?? null

// The horn a servo's class takes unless one is chosen
const HORN_FOR = { 'sub-micro': 'du-bro-848', micro: 'du-bro-848', mini: 'du-bro-107', standard: 'du-bro-105' }
export const defaultHorn = (servo) => hornById(HORN_FOR[servo?.class ?? servo?.id] ?? 'du-bro-848')

// ---------------------------------------------------------------------------------------------
// Geometry. The assembly in the wing's flat frame (x aft along the chord, s along the span, z
// up), m: the arm's hole circles about the servo's output axis, the horn's hole swings about the
// hinge line, and the pushrod between them keeps its length. That's a spatial four-bar (two
// revolutes joined by a rod with a ball or clevis at each end), so it covers an arm swinging in
// the chord's plane (a servo on its side) and one swinging in the wing's (upright) alike. Both
// joint equations reduce to a cos t + b sin t = c, solved in closed form (docs/methods.md).
//
// Angles: δ, the surface's deflection, positive trailing edge down; θ, the arm's angle about the
// output axis from its reference direction (the case's length, towards the lead end), positive
// by the right-hand rule about the axis.

const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]]
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
const scale = (a, k) => [a[0] * k, a[1] * k, a[2] * k]
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
const unit = (a) => scale(a, 1 / Math.hypot(...a))
const RAD = Math.PI / 180
// An angle wrapped to (-π, π]
const wrap = (t) => t - 2 * Math.PI * Math.round(t / (2 * Math.PI))
// v turned by t about the unit axis k (Rodrigues)
const turn = (v, k, t) => add(add(scale(v, Math.cos(t)), scale(cross(k, v), Math.sin(t))), scale(k, dot(k, v) * (1 - Math.cos(t))))

// The two t that solve a cos t + b sin t = c, as [φ + α, φ - α], or null when there's none
function trig(a, b, c) {
  const r = Math.hypot(a, b)
  if (r < 1e-15 || Math.abs(c) > r * (1 + 1e-12)) return null
  const phi = Math.atan2(b, a)
  const alpha = Math.acos(Math.max(-1, Math.min(1, c / r)))
  return [phi + alpha, phi - alpha]
}

// The output's pivot as installed, { pivot, axis, ref } in the wing's frame: the centre of the
// arm's holes (on the output axis, `seat` above the spline's top), the axis and the arm's
// reference direction (the case's length, towards the lead end). Spread into solveAssembly's
// geometry with the arm's radius. servo: an installed servo (servos.js installedServo, with its
// frame, mounting, turn and lift); at: as placeServo's ({ x, s, base }), which it follows.
export function outputPivot(servo, at, seat = SEAT.standard) {
  const f = servo.frame
  return {
    pivot: servoPoint(servo, at, [f.output.offset, 0, Math.max(f.height, f.output.top) + seat]),
    axis: servoDir(servo, [0, 0, 1]),
    ref: servoDir(servo, [1, 0, 0]),
  }
}

// The hinge at a station along a resolved surface (controlSurfaces.js resolveSurface): a point on
// it, on the centre line at height z, and its direction, outboard.
export function hingeAt(surface, s, z = 0) {
  return { point: [surface.hingeX(s), s, z], axis: unit([surface.slope, 1, 0]) }
}

// A horn's hole at neutral: `height` above the face it's on ('top' or 'bottom'), the face
// `faceOffset` from the centre line, over the hinge or `forward` of it (m, square to the hinge
// in plan).
export function hornHole(hinge, { face = 'top', faceOffset = 0, height, forward = 0 }) {
  const up = face === 'bottom' ? -1 : 1
  const fwd = unit(cross([0, 0, 1], hinge.axis))
  // cross(z, h) points forward for an outboard hinge on the right half, aft on the left
  const ahead = fwd[0] < 0 ? fwd : scale(fwd, -1)
  return add(add(hinge.point, [0, 0, up * (faceOffset + height)]), scale(ahead, forward))
}

// The hinge axis turned so that a positive turn takes the trailing edge down, on either half
function hingeAxis(axis) {
  const h = unit(axis)
  const aft = unit(cross(h, [0, 0, 1]))
  const te = aft[0] > 0 ? aft : scale(aft, -1)
  // turning +δ about h moves the trailing edge by h × te: down
  return cross(h, te)[2] < 0 ? h : scale(h, -1)
}

// A linkage: the arm's and horn's hole positions as functions of θ and δ, and the joint
// equations solved each way for a pushrod of length L.
//   pivot, axis, ref   outputPivot's; radius, the arm's hole's distance from the pivot
//   hinge              hingeAt's; horn, the horn's hole at neutral (hornHole)
export function linkage({ pivot, axis, ref, radius, hinge, horn }) {
  const a = unit(axis)
  const e1 = unit(sub(ref, scale(a, dot(ref, a))))
  const e2 = cross(a, e1)
  const h = hingeAxis(hinge.axis)
  const H = hinge.point
  const q = sub(horn, H)
  const hq = cross(h, q)
  const qh = dot(q, h)
  const armDir = (t) => add(scale(e1, Math.cos(t)), scale(e2, Math.sin(t)))
  const arm = (t) => add(pivot, scale(armDir(t), radius))
  const hornAt = (d) => add(H, turn(q, h, d))
  // The surface's two δ for the arm at θ: (A - H)·R(δ)q = (|A - H|² + |q|² - L²) / 2
  const surfaceRoots = (t, L) => {
    const w = sub(arm(t), H)
    const k0 = dot(w, h) * qh
    return trig(dot(w, q) - k0, dot(w, hq), (dot(w, w) + dot(q, q) - L * L) / 2 - k0)
  }
  // The arm's two θ for the surface at δ: v·d(θ) = (r² + |v|² - L²) / 2r, v from the pivot
  const servoRoots = (d, L) => {
    const v = sub(hornAt(d), pivot)
    return trig(dot(v, e1), dot(v, e2), (radius * radius + dot(v, v) - L * L) / (2 * radius))
  }
  return { a, e1, e2, h, arm, armDir, hornAt, surfaceRoots, servoRoots }
}

// The root of a pair nearest t0, as an angle near t0
const nearest = (roots, t0) => {
  if (!roots) return null
  const d = roots.map((r) => wrap(r - t0))
  return t0 + (Math.abs(d[0]) <= Math.abs(d[1]) ? d[0] : d[1])
}

// Solves a bay's assembly for its surface's designed throws (docs/scope-servo.md, decision 4):
// the arm is square to the pushrod at the servo's midpoint, and the midpoint sits half way
// between the servo angles the designed up and down throws need, so the travel is used evenly.
//   up, down   the designed throws, degrees (trailing edge up, down), both positive
//   travel     the servo's travel each way, degrees (45 or 60)
//   facing     1 or -1: which way the arm points, of the two square to the pushrod
//   depth      the surface's depth, hinge to trailing edge, m, for the throws in mm
// Returns { ok, problem, ... } with problem 'reach' (no midpoint gives both throws: the horn
// can't be reached, or the linkage would pass dead centre) or null, and, in degrees:
//   midpoint        the arm's angle at the servo's midpoint, from its reference
//   pushrod         the pushrod's length between the holes, m
//   travelNeeded    the servo's travel each way the designed throws need
//   fits            travelNeeded is within travel
//   neutralArm      the arm's angle from square at surface neutral, positive towards the
//                   trailing-edge-down side (more up throw than down puts it there)
//   surfaceAtMid    the surface's angle at the servo's midpoint (positive down)
//   achieved        { up, down, upMm, downMm }: the designed throws, or as far as the travel
//                   reaches when it doesn't
//   fullTravel      { up, down } at the full travel each way, or null where it passes dead
//                   centre first
//   advantage       servo degrees per surface degree at neutral: the hinge moment the servo
//                   holds is its torque times this
//   hornSquare      the pushrod's angle from square to the horn at the midpoint
//   direction       1 or -1: the sense the servo turns (about its axis) for trailing edge down
export function solveAssembly(geom, { up, down, travel = 45, facing = 1, depth = 0 }) {
  const L0 = linkage(geom)
  const { pivot, radius } = geom
  const fail = (problem) => ({ ok: false, problem })
  if (!(radius > 0)) return fail('reach')
  const dUp = -up * RAD
  const dDown = down * RAD
  // For the surface at dm at the servo's midpoint: the arm square to the pushrod there (the
  // tangent from the horn's hole to the arm's circle, one each way: facing picks which), the
  // pushrod's length, and the servo angles for the designed throws. g is how far the midpoint is
  // from half way between them.
  const trial = (dm) => {
    const v = sub(L0.hornAt(dm), pivot)
    // (P - A)·d = 0 with A = O + r d: v·d(θ) = r
    const roots = trig(dot(v, L0.e1), dot(v, L0.e2), radius)
    if (!roots) return null
    const tm = facing >= 0 ? roots[0] : roots[1]
    const L = Math.hypot(...sub(L0.arm(tm), L0.hornAt(dm)))
    const tu = nearest(L0.servoRoots(dUp, L), tm)
    const td = nearest(L0.servoRoots(dDown, L), tm)
    if (tu == null || td == null) return null
    // Both throws on the same side of the midpoint means a dead centre between
    if (Math.sign(tu - tm) === Math.sign(td - tm)) return null
    return { tm, dm, L, tu, td, g: (tu + td) / 2 - tm }
  }

  // The midpoint's surface angle lies between the designed throws: scan them in steps for where
  // g changes sign, bisect, and keep the root nearest neutral
  const steps = 160
  let best = null
  let prev = null
  for (let k = 0; k <= steps; k++) {
    const cur = trial(dUp + ((dDown - dUp) * k) / steps)
    if (cur && Math.abs(cur.g) < 1e-12) {
      if (!best || Math.abs(cur.dm) < Math.abs(best.dm)) best = cur
    } else if (cur && prev && Math.sign(cur.g) !== Math.sign(prev.g)) {
      let [lo, hi] = [prev, cur]
      for (let i = 0; i < 60; i++) {
        const mid = trial((lo.dm + hi.dm) / 2)
        if (!mid) break
        if (Math.sign(mid.g) === Math.sign(lo.g)) lo = mid
        else hi = mid
      }
      const root = Math.abs(lo.g) < Math.abs(hi.g) ? lo : hi
      // A jump in g (a root changing branch) isn't a root
      if (Math.abs(root.g) < 1e-7 && (!best || Math.abs(root.dm) < Math.abs(best.dm))) best = root
    }
    prev = cur
  }
  if (!best) return fail('reach')
  return assemblyAt(geom, best, { travel, depth })
}

// The outputs for a solved midpoint (solveAssembly)
function assemblyAt(geom, { tm, dm, L, td }, { travel, depth }) {
  const L0 = linkage(geom)
  const dir = Math.sign(td - tm)
  const need = (td - tm) * dir
  // The surface's angle with the arm at θ, on the branch through the midpoint
  const surface = (t) => nearest(L0.surfaceRoots(t, L), dm)
  // Every angle between must have a solution: no dead centre on the way
  const sweep = (t1) => {
    let last = dm
    for (let i = 1; i <= 24; i++) {
      const d = nearest(L0.surfaceRoots(tm + ((t1 - tm) * i) / 24, L), last)
      if (d == null) return null
      last = d
    }
    return last
  }
  const reach = travel * RAD
  const t0 = nearest(L0.servoRoots(0, L), tm)
  const lim = Math.min(need, reach)
  const upAt = sweep(tm - dir * lim)
  const downAt = sweep(tm + dir * lim)
  const fullUp = sweep(tm - dir * reach)
  const fullDown = sweep(tm + dir * reach)
  // Servo degrees per surface degree at neutral
  const eps = 1e-4
  const tA = nearest(L0.servoRoots(-eps, L), t0)
  const tB = nearest(L0.servoRoots(eps, L), t0)
  const rod = sub(L0.hornAt(dm), L0.arm(tm))
  const hornArm = sub(L0.hornAt(dm), geom.hinge.point)
  // The horn's lever is the part of its hole's offset square to the hinge
  const lever = sub(hornArm, scale(L0.h, dot(hornArm, L0.h)))
  const angle = (a, b) => Math.acos(Math.max(-1, Math.min(1, dot(unit(a), unit(b))))) / RAD
  const deg = (t) => t / RAD
  const mmAt = (d) => (d == null ? null : depth * Math.sin(Math.abs(d)))
  const achieved =
    upAt == null || downAt == null
      ? null
      : { up: -deg(upAt), down: deg(downAt), upMm: mmAt(upAt), downMm: mmAt(downAt) }
  return {
    ok: achieved != null,
    problem: achieved ? null : 'reach',
    midpoint: deg(tm),
    pushrod: L,
    travel,
    travelNeeded: deg(need),
    fits: deg(need) <= travel + 1e-9,
    neutralArm: deg((t0 - tm) * dir),
    surfaceAtMid: deg(dm),
    achieved,
    fullTravel: fullUp == null || fullDown == null ? null : { up: -deg(fullUp), down: deg(fullDown) },
    advantage: (((tB - tA) * dir) / (2 * eps)),
    hornSquare: angle(rod, lever) - 90,
    armSquare: angle(rod, L0.armDir(tm)) - 90,
    direction: dir,
    // The arm's and horn's holes at the servo's midpoint, for drawing
    points: { arm: L0.arm(tm), horn: L0.hornAt(dm) },
    // The surface's angle (degrees, down positive) with the servo at an angle from its midpoint
    // (degrees, in its turning direction for down), or null past dead centre
    surfaceAt: (servo) => {
      const d = surface(tm + dir * servo * RAD)
      return d == null ? null : deg(d)
    },
  }
}

// The same assembly on the other half: every point and direction reflected across the wing's
// centre plane (s to -s). The servo is the same model turned over (docs/scope-servo.md,
// decision 8), so its throws match; only its turning direction reverses.
export function mirrorGeometry(geom) {
  const m = (p) => [p[0], -p[1], p[2]]
  return {
    ...geom,
    pivot: m(geom.pivot),
    axis: m(geom.axis),
    ref: m(geom.ref),
    hinge: { point: m(geom.hinge.point), axis: m(geom.hinge.axis) },
    horn: m(geom.horn),
  }
}

// How far an arm's angle on the spline (degrees from the case's length) is from the nearest
// tooth, for a spline of `teeth` teeth: the error the subtrim has to take up. null when the tooth
// count isn't known.
export function splineError(angle, teeth) {
  if (!teeth) return null
  const pitch = 360 / teeth
  return angle - pitch * Math.round(angle / pitch)
}
