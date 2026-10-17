// Servos and their bays: the catalogue by class, which bay each control surface gets, where it
// goes along the span, and what its mass does to the spar loads.
//
// Nothing here knows which wing it's on: placement takes a wing sampler and resolved control
// surfaces (controlSurfaces.js), so a tailplane's elevator servo uses the same code. The
// bay's geometry in the built-up structure (plate, hatch, lead holes) is in structure.js
// bayLayouts and ribs.js.
//
// A bay is saved as the settings that differ from the defaults, in controls.bays:
//   surface   the id of the control surface it works
//   enabled   false once removed (default true: every surface has a bay)
//   class     a servo class from SERVOS, or null for the one that suits the model's weight
//   at        where its centre is, m from the panel's inner end, flat; null for the middle of
//             the surface

// Servo classes. Generic sizes, no brand: each is the rounded figures of the common hobby
// servos of that class (docs/methods.md), all in SI base units.
//   length, width, height  the case body, lengths along the chord, across the span (a bay is
//                          this wide between its ribs) and from the base to the top of the case
//   lugSpan, lugThickness  overall length across the mounting lugs, and the lugs' thickness
//   lugHeight              from the case base up to the underside of the lugs
//   mass                   the servo with its lead, kg
//   torque                 stall torque at 4.8 V, rounded down, N·m
//   plate                  the mount plate's ply thickness, m
//   leadHole               the hole a lead passes through the ribs by, m
export const SERVOS = {
  'sub-micro': {
    label: 'Sub-micro',
    size: 'about 4 g',
    length: 0.0205,
    width: 0.0085,
    height: 0.016,
    lugSpan: 0.0275,
    lugThickness: 0.0015,
    lugHeight: 0.011,
    mass: 0.004,
    torque: 0.06,
    plate: 0.0015,
    leadHole: 0.004,
  },
  micro: {
    label: 'Micro',
    size: 'the 9 g class',
    length: 0.023,
    width: 0.0122,
    height: 0.0225,
    lugSpan: 0.0325,
    lugThickness: 0.0025,
    lugHeight: 0.0155,
    mass: 0.009,
    torque: 0.15,
    plate: 0.0015,
    leadHole: 0.006,
  },
  mini: {
    label: 'Mini',
    size: 'the 17 g class',
    length: 0.0285,
    width: 0.0125,
    height: 0.026,
    lugSpan: 0.039,
    lugThickness: 0.0025,
    lugHeight: 0.0185,
    mass: 0.017,
    torque: 0.28,
    plate: 0.002,
    leadHole: 0.007,
  },
  standard: {
    label: 'Standard',
    size: 'the 40 g class',
    length: 0.0405,
    width: 0.02,
    height: 0.0365,
    lugSpan: 0.055,
    lugThickness: 0.0025,
    lugHeight: 0.0255,
    mass: 0.045,
    torque: 0.4,
    plate: 0.003,
    leadHole: 0.01,
  },
}

export const SERVO_CLASSES = Object.keys(SERVOS)

// Room left round the case in the bay, each side across the span, m
export const SERVO_CLEARANCE = 0.0015
// The top of the case's clearance under the upper skin, m
export const SERVO_HEADROOM = 0.002
// Gap kept between ribs and plate rim, hatch margin and the like, m
export const BAY_MARGIN = 0.003

// The class that suits a model of this all-up mass (kg) when none's chosen: what wing servos
// of that size usually are. Sub-micro up to 0.6 kg, micro to 2.5 kg, mini to 6 kg, standard
// beyond.
export function defaultServoClass(mass) {
  if (!(mass > 0) || mass <= 0.6) return mass > 0 ? 'sub-micro' : 'micro'
  if (mass <= 2.5) return 'micro'
  if (mass <= 6) return 'mini'
  return 'standard'
}

export const servoOf = (cls) => SERVOS[cls] ?? SERVOS.micro

// The settings for a surface's bay: the saved ones over the defaults.
export function bayOf(controls, surfaceId) {
  const saved = (controls?.bays ?? []).find((b) => b.surface === surfaceId)
  return { surface: surfaceId, enabled: true, class: null, at: null, ...(saved ?? {}) }
}

// controls with one surface's bay settings changed. Settings that come back to the defaults
// are dropped, so the saved list stays only what was chosen.
export function setBay(controls, surfaceId, patch) {
  const next = { ...bayOf(controls, surfaceId), ...patch }
  const rest = (controls.bays ?? []).filter((b) => b.surface !== surfaceId)
  const same = next.enabled && !next.class && !Number.isFinite(next.at)
  const entry = { surface: surfaceId }
  if (!next.enabled) entry.enabled = false
  if (next.class) entry.class = next.class
  if (Number.isFinite(next.at)) entry.at = next.at
  return { ...controls, bays: same ? rest : [...rest, entry] }
}

// controls without the bay settings of a surface that's gone
export const dropBay = (controls, surfaceId) => ({ ...controls, bays: (controls.bays ?? []).filter((b) => b.surface !== surfaceId) })

// Where each enabled bay goes, one per placed control surface (surfaces: resolveSurfaces
// output): its servo, its centre s (flat along the span), the two ribs either side (sA, sB,
// their centres, a rib thickness t out from the servo's width plus its clearance) and the
// gap between the ribs' faces (width). Named SB1, SB2 … root outward. ok is false, with a
// problem, if it can't be placed: 'surface' (its control surface isn't built), 'span' (the
// ribs would be off the panel) or 'overlap' (it clashes with a bay before it). beyond says
// it sticks out past the ends of its surface. Only the ok ones are built and weighed.
export function placeBays({ sampler, surfaces, controls, mass, ribThickness = 0.002 }) {
  const out = []
  const order = [...(surfaces ?? [])].sort((a, b) => (a.s0 ?? Infinity) - (b.s0 ?? Infinity) || (a.id ?? 0) - (b.id ?? 0))
  const t = Math.max(0, ribThickness)
  const placed = []
  for (const r of order) {
    const cfg = bayOf(controls, r.id)
    if (!cfg.enabled) continue
    const cls = SERVOS[cfg.class] ? cfg.class : defaultServoClass(mass)
    const servo = SERVOS[cls]
    const bay = { id: r.id, surface: r.id, label: '', name: '', class: cls, auto: !SERVOS[cfg.class], servo, mass: servo.mass, ok: false, problem: null }
    out.push(bay)
    if (!r.ok) {
      bay.problem = 'surface'
      continue
    }
    const p = sampler.ends[r.panelIndex]
    const width = servo.width + 2 * SERVO_CLEARANCE
    const half = width / 2 + t / 2
    const s = Number.isFinite(cfg.at) ? p.inner.s + cfg.at : (r.s0 + r.s1) / 2
    Object.assign(bay, { s, sA: s - half, sB: s + half, width, panelIndex: r.panelIndex, rib: t })
    // Ribs inside the panel, a few millimetres clear of its ends (which have ribs of their own)
    if (bay.sA < p.inner.s + 0.005 || bay.sB > p.outer.s - 0.005) {
      bay.problem = 'span'
      continue
    }
    bay.beyond = bay.sA < r.s0 - 1e-6 || bay.sB > r.s1 + 1e-6
    if (placed.some((q) => bay.sA < q.sB + 0.005 && bay.sB > q.sA - 0.005)) {
      bay.problem = 'overlap'
      continue
    }
    bay.ok = true
    placed.push(bay)
  }
  out.forEach((b, i) => {
    b.name = `SB${i + 1}`
    b.label = `Servo bay ${b.name}`
  })
  return out
}

// The servos' masses and where they hang along the half wing, for the bending check:
// [{ s, mass, name }] for the bays that are built (ok).
export const servoMasses = (bays) => (bays ?? []).filter((b) => b.ok).map((b) => ({ s: b.s, mass: b.mass, name: b.name }))
