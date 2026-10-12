import { describe, it, expect } from 'vitest'
import { liftingLine, clDistribution, firstStall, alphaForCL } from '../src/lib/liftingLine.js'

const TWO_PI = 2 * Math.PI

// Half-wing chord functions of eta = y / (b/2)
const elliptic = (c0) => (eta) => c0 * Math.sqrt(Math.max(0, 1 - eta * eta))
const tapered = (cr, ct) => (eta) => cr + (ct - cr) * eta

function wing({ span, chord, twist = () => 0, a0 = TWO_PI, area }) {
  return liftingLine({ span, area, station: (eta) => ({ c: chord(eta), twist: twist(eta), a0 }) })
}

describe('lifting line', () => {
  it('matches the closed-form elliptic wing: CLa = a0 / (1 + a0 / (pi AR)), uniform cl', () => {
    const span = 1.5
    const c0 = 0.2
    const area = (Math.PI / 4) * span * c0
    const ll = wing({ span, chord: elliptic(c0), area })
    const ar = (span * span) / area
    expect(ll.CLa).toBeCloseTo(TWO_PI / (1 + 2 / ar), 3)
    const cls = clDistribution(ll, 0.8).map((s) => s.cl)
    for (const c of cls) expect(c).toBeCloseTo(0.8, 3)
  })

  it('matches the tabulated rectangular wing (AR 6, Glauert tau about 0.17)', () => {
    const span = 1.2
    const c = 0.2
    const ll = wing({ span, chord: () => c, area: span * c })
    // CLa = a0 / (1 + (a0 / (pi AR)) (1 + tau)); tau 0.16-0.18 for AR 6 in the literature
    const lo = TWO_PI / (1 + (2 / 6) * 1.18)
    const hi = TWO_PI / (1 + (2 / 6) * 1.16)
    expect(ll.CLa).toBeGreaterThan(lo)
    expect(ll.CLa).toBeLessThan(hi)
  })

  it('loads a rectangular wing most at the root, so it stalls there first', () => {
    const ll = wing({ span: 1.2, chord: () => 0.2, area: 0.24 })
    const st = firstStall(ll, () => 1.2)
    expect(st.eta).toBeLessThan(0.1)
    // About 0.9 of section Clmax, the usual rule of thumb for such a wing
    expect(st.CLmax / 1.2).toBeGreaterThan(0.85)
    expect(st.CLmax / 1.2).toBeLessThan(0.95)
  })

  it('stalls a sharply tapered wing outboard, and washout moves it inboard', () => {
    const span = 1.4
    const chord = tapered(0.3, 0.09)
    const area = span * (0.3 + 0.09) / 2
    const flat = firstStall(wing({ span, chord, area }), () => 1.2)
    expect(flat.eta).toBeGreaterThan(0.5)
    const washed = firstStall(wing({ span, chord, area, twist: (eta) => (4 * Math.PI / 180) * eta }), () => 1.2)
    expect(washed.eta).toBeLessThan(flat.eta)
    // Washout costs a little maximum lift on a wing that stalled inboard anyway, but here it
    // delays the tip so the wing as a whole reaches more
    expect(washed.CLmax).toBeGreaterThan(flat.CLmax)
  })

  it('treats twist as a lift offset: washout gives negative lift at zero root angle', () => {
    const span = 1.5
    const c0 = 0.2
    const area = (Math.PI / 4) * span * c0
    const ll = wing({ span, chord: elliptic(c0), area, twist: (eta) => 0.05 * eta })
    expect(ll.CLb).toBeLessThan(0)
    // Superposition: solving at a CL then reading it back
    const a = alphaForCL(ll, 0.6)
    expect(a * ll.CLa + ll.CLb).toBeCloseTo(0.6, 12)
    const d = clDistribution(ll, 0.6)
    expect(d[0].cl).toBeGreaterThan(d.at(-1).cl)
  })

  it('refuses an impossible wing', () => {
    expect(liftingLine({ span: 0, area: 1, station: () => ({ c: 1, a0: 6 }) })).toBe(null)
    expect(liftingLine({ span: 1, area: 1, station: () => ({ c: 1, a0: 0 }) })).toBe(null)
  })
})
