// Stall character: how gently or abruptly a section loses lift at the stall.
//
// Two methods:
//  1. From polar data (library sections): the shape of the lift curve around and past
//     max lift. This is the primary method whenever a polar is available.
//  2. From geometry (custom sections): a heuristic built on the upper-surface ordinate
//     at 1.25% chord, after Gault's correlation of stall type with nose shape, with
//     corrections for forward camber and Reynolds number.
//
// Both return { rating: 'gentle' | 'moderate' | 'sharp', explanation, ...metrics }.
// Results are indicative only.

export const RATINGS = {
  gentle: { label: 'Gentle', summary: 'Breaks gently and progressively; easy to recover.' },
  moderate: { label: 'Moderate', summary: 'Some warning, but the break can be quick; recover promptly.' },
  sharp: { label: 'Sharp', summary: 'Stalls abruptly with little warning; recovery is harder.' },
}

// Thresholds for the polar method (see README for how they were chosen).
export const POLAR_THRESHOLDS = {
  // Average lift lost per degree over the first 2° past max lift, as a fraction of Clmax.
  dropGentle: 0.025, // below this: gentle
  dropSharp: 0.08, // above this: sharp
  // Pre-stall rounding: lift actually gained over the 3° before the peak, as a fraction of
  // what the linear lift-curve slope predicts. High = lift keeps climbing almost linearly
  // into the stall (little warning); low = the curve flattens well before the peak.
  roundingSharper: 0.5, // at or above: one step sharper
  roundingGentler: 0.12, // at or below: one step gentler
}

// Thresholds for the geometry heuristic, upper-surface ordinate at 1.25% chord (% chord).
export const GEOMETRY_THRESHOLDS = {
  sharpBelow: 1.6,
  gentleAbove: 2.1,
  // Max camber this far forward (fraction of chord) or closer tends to give an abrupt
  // leading-edge stall (e.g. the NACA 230-series), so the rating moves one step sharper.
  forwardCamberPos: 0.2,
  // Reynolds number at the stall: below lowRe one step sharper, at or above highRe one
  // step gentler. Mirrors the trend in the XFOIL polars of the library sections.
  lowRe: 100000,
  highRe: 400000,
}

function interpAt(xs, ys, x) {
  if (x <= xs[0]) return ys[0]
  for (let i = 1; i < xs.length; i++) {
    if (x <= xs[i]) {
      const t = (x - xs[i - 1]) / (xs[i] - xs[i - 1])
      return ys[i - 1] + t * (ys[i] - ys[i - 1])
    }
  }
  return ys[ys.length - 1]
}

// Least-squares slope of cl against alpha over [a0, a1] degrees.
function liftSlope(alpha, cl, a0 = -2, a1 = 4) {
  let n = 0
  let sx = 0
  let sy = 0
  let sxx = 0
  let sxy = 0
  for (let i = 0; i < alpha.length; i++) {
    if (alpha[i] < a0 || alpha[i] > a1) continue
    n++
    sx += alpha[i]
    sy += cl[i]
    sxx += alpha[i] * alpha[i]
    sxy += alpha[i] * cl[i]
  }
  if (n < 3) return null
  return (n * sxy - sx * sy) / (n * sxx - sx * sx)
}

// Extract lift-curve features from a polar.
export function analysePolar({ alpha, cl }) {
  let iMax = 0
  for (let i = 1; i < cl.length; i++) if (cl[i] > cl[iMax]) iMax = i
  const clMax = cl[iMax]
  const alphaClMax = alpha[iMax]
  const slope = liftSlope(alpha, cl)
  const lastAlpha = alpha[alpha.length - 1]

  // Post-stall drop rate, over up to 2° past the peak.
  const span = Math.min(2, lastAlpha - alphaClMax)
  let dropPerDeg = null
  if (span >= 0.5) {
    const clAfter = interpAt(alpha, cl, alphaClMax + span)
    dropPerDeg = (clMax - clAfter) / clMax / span
  }

  // Pre-stall rounding over the 3° before the peak.
  let rounding = null
  if (slope && alphaClMax - 3 >= alpha[0]) {
    const clBefore = interpAt(alpha, cl, alphaClMax - 3)
    rounding = (clMax - clBefore) / (3 * slope)
  }

  return {
    clMax,
    alphaClMax,
    liftSlopePerDeg: slope,
    dropPerDeg,
    postStallSpan: Math.max(0, lastAlpha - alphaClMax),
    rounding,
  }
}

const SHARPER = { gentle: 'moderate', moderate: 'sharp', sharp: 'sharp' }
const GENTLER = { gentle: 'gentle', moderate: 'gentle', sharp: 'moderate' }

export function ratePolar(polar, t = POLAR_THRESHOLDS) {
  const m = analysePolar(polar)
  const pct = (v) => `${(v * 100).toFixed(1)}%`
  if (m.dropPerDeg === null) {
    // The XFOIL run stopped converging at or just after the peak, which itself usually
    // means separation is sudden. Fall back to the pre-stall rounding alone.
    const rating = m.rounding !== null && m.rounding >= t.roundingSharper ? 'sharp' : 'moderate'
    return {
      ...m,
      rating,
      method: 'polar',
      confidence: 'low',
      explanation:
        'Polar data stops at max lift, so the post-stall shape is unknown; rated from how the lift curve rounds over before the peak.',
    }
  }
  let rating
  if (m.dropPerDeg < t.dropGentle) rating = 'gentle'
  else if (m.dropPerDeg > t.dropSharp) rating = 'sharp'
  else rating = 'moderate'
  // A lift curve that climbs straight into the stall gives little warning; one that
  // flattens well before the peak gives plenty.
  let shape = ''
  if (m.rounding !== null && m.rounding >= t.roundingSharper && rating !== 'sharp') {
    rating = SHARPER[rating]
    shape = ' Lift keeps climbing almost linearly right up to the stall, so there is little warning.'
  } else if (m.rounding !== null && m.rounding <= t.roundingGentler && rating !== 'gentle') {
    rating = GENTLER[rating]
    shape = ' The lift curve flattens well before the peak, which gives useful warning.'
  }
  return {
    ...m,
    rating,
    method: 'polar',
    confidence: m.postStallSpan >= 2 ? 'normal' : 'low',
    explanation: `Lift falls by about ${pct(m.dropPerDeg)} of its maximum per degree past the stall.${shape}`,
  }
}

// Geometry heuristic. Inputs are fractions of chord; upper125 is the upper-surface
// ordinate at 1.25% chord (from generated or measured coordinates). re, if given, is the
// Reynolds number at the stall.
export function rateGeometry({ upper125, camber, camberPos, re = null }, t = GEOMETRY_THRESHOLDS) {
  const y = upper125 * 100
  let rating
  if (y < t.sharpBelow) rating = 'sharp'
  else if (y > t.gentleAbove) rating = 'gentle'
  else rating = 'moderate'
  const notes = [`Nose ordinate at 1.25% chord is ${y.toFixed(2)}% of chord`]
  if (y < t.sharpBelow) notes[0] += ' (a thin, sharp nose)'
  else if (y > t.gentleAbove) notes[0] += ' (a full, rounded nose)'
  if (camber > 0.005 && camberPos <= t.forwardCamberPos) {
    rating = SHARPER[rating]
    notes.push('forward camber makes the break more abrupt')
  }
  if (re && re < t.lowRe) {
    rating = SHARPER[rating]
    notes.push('at this low Reynolds number the laminar bubble near the nose can burst suddenly')
  } else if (re && re >= t.highRe) {
    rating = GENTLER[rating]
    notes.push('the higher Reynolds number favours a progressive stall')
  }
  return {
    rating,
    method: 'geometry',
    confidence: 'low',
    upper125Pct: y,
    explanation: notes.join('; ') + '.',
  }
}

// Where along the span the wing stalls first, from the lifting line (onsetEta: fraction of
// the semi-span, 0 at the centreline). A stall that starts outboard, where the ailerons are,
// drops a wing and costs roll control just when it's needed, so it makes the wing's
// character one step sharper than the section's alone.
export const SPANWISE_THRESHOLDS = { inboard: 0.4, outboard: 0.6 }

export function spanwiseStall(onsetEta, t = SPANWISE_THRESHOLDS) {
  const pct = Math.round(onsetEta * 100)
  if (onsetEta >= t.outboard) {
    return {
      where: 'outboard',
      sharper: true,
      text: `The wing stalls first at ${pct}% of the semi-span, out where the ailerons are, so expect a wing to drop. Washout, or a thicker tip section, moves the stall inboard.`,
    }
  }
  if (onsetEta <= t.inboard) {
    return {
      where: 'inboard',
      sharper: false,
      text: `The wing stalls first at ${pct}% of the semi-span, inboard, so the ailerons keep working through the stall.`,
    }
  }
  return {
    where: 'mid',
    sharper: false,
    text: `The wing stalls first at ${pct}% of the semi-span. Some washout would move it further inboard, away from the ailerons.`,
  }
}

export function sharper(rating) {
  return SHARPER[rating] ?? rating
}

// Shape parameters for the indicative lift curve, per rating: pre-stall rounding (lift
// gained over the last 3° before the peak, as a fraction of linear) and the post-stall drop
// per degree. Values sit inside the bands the polar method uses, so the drawn curve and
// the rating tell the same story.
export const INDICATIVE_SHAPE = {
  gentle: { rounding: 0.3, dropPerDeg: 0.012 },
  moderate: { rounding: 0.4, dropPerDeg: 0.05 },
  sharp: { rounding: 0.55, dropPerDeg: 0.12 },
}

// An illustrative lift curve for a section with no polar data: linear from the zero-lift
// angle at the given slope, rounding over to clMax, then falling away as the stall rating
// suggests. It is a picture of the rating, not computed aerodynamics, and is labelled so.
export function indicativePolar({ clMax, alphaL0, slopePerDeg, rating }) {
  const { rounding, dropPerDeg } = INDICATIVE_SHAPE[rating] ?? INDICATIVE_SHAPE.moderate
  const gain = rounding * 3 * slopePerDeg // lift gained over the last 3° before the peak
  const roundStart = alphaL0 + (clMax - gain) / slopePerDeg
  const alphaClMax = roundStart + 3
  const clAtStart = clMax - gain
  const alpha = []
  const cl = []
  const end = alphaClMax + 6
  for (let a = Math.min(-4, alphaL0 - 1); a <= end + 1e-9; a += 0.25) {
    let c
    if (a <= roundStart) c = slopePerDeg * (a - alphaL0)
    else if (a <= alphaClMax) {
      const t = (a - roundStart) / 3
      c = clAtStart + gain * (2 * t - t * t)
    } else {
      // Full drop rate for 2°, then a gentler decline towards a post-stall plateau
      const d = a - alphaClMax
      const fall = dropPerDeg * Math.min(d, 2) + (dropPerDeg / 3) * Math.max(0, d - 2)
      c = clMax * Math.max(0.5, 1 - fall)
    }
    alpha.push(Number(a.toFixed(2)))
    cl.push(Number(c.toFixed(4)))
  }
  return { alpha, cl, alphaClMax, clMax, indicative: true }
}
