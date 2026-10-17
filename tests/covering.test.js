import { describe, it, expect } from 'vitest'
import { defaultState, migrate } from '../src/lib/projects.js'
import { resolveAirfoil, airfoilPerformance } from '../src/lib/airfoils.js'
import { wingGeometry } from '../src/lib/calc.js'
import { wingSampler, projectedSampler } from '../src/lib/wing.js'
import { analyseStructure, defaultStructure, FINISHES, finishOf, laminatedSheetE, sheetBuckling } from '../src/lib/structure.js'
import { buildParts } from '../src/lib/ribs.js'

function build(edit = () => {}) {
  const s = defaultState()
  const st = defaultStructure()
  edit(st)
  const airfoil = resolveAirfoil(s.airfoil)
  const g = wingGeometry({ ...s.input, mode: 'panels' })
  const planform = projectedSampler(wingSampler(s.input, airfoil.params.thickness))
  const perf = airfoilPerformance(airfoil, { mass: s.input.mass, area: g.projectedArea, chord: g.mac, wing: { planform, span: g.span, sweepCos: 1 } })
  const a = analyseStructure({ wing: s.input, airfoil, structure: st, mass: s.input.mass, spanwise: perf.spanwise })
  return { a, g, ...buildParts(a, a.structure) }
}
const margins = (a) => Object.fromEntries(Object.entries(a.summary.modes).map(([k, v]) => [k, v.ms]))

describe('covering', () => {
  it('defaults to film, and older saves take it', () => {
    expect(defaultStructure().covering.finish).toBe('film')
    const old = defaultState()
    delete old.input.structure.covering.finish
    expect(migrate(JSON.parse(JSON.stringify(old))).input.structure.covering.finish).toBe('film')
  })

  it('covers both surfaces, about twice the plan area', () => {
    const { covered, g } = build()
    const half = g.projectedArea / 2
    const total = covered.sheeted + covered.open
    expect(total).toBeGreaterThan(2 * half)
    expect(total).toBeLessThan(2.15 * half)
    // A D-box: the nose back to the spar is over sheeting, roughly a third
    expect(covered.sheeted / total).toBeGreaterThan(0.2)
    expect(covered.sheeted / total).toBeLessThan(0.45)
    const open = build((st) => (st.covering.type = 'open')).covered
    expect(open.sheeted).toBe(0)
    expect(open.open).toBeCloseTo(total, 3)
  })

  it('adds its weight per area to the wing, both halves', () => {
    const film = build()
    const { covered } = film
    expect(film.weight.covering).toBeCloseTo((covered.sheeted + covered.open) * FINISHES.film.mass * 2, 9)
    expect(film.weight.total).toBeCloseTo(film.weight.bare + film.weight.covering, 9)
    const fabric = build((st) => (st.covering.finish = 'fabric'))
    expect(fabric.weight.covering / film.weight.covering).toBeCloseTo(FINISHES.fabric.mass / FINISHES.film.mass, 9)
    expect(fabric.weight.bare).toBeCloseTo(film.weight.bare, 9)
    // Glass goes on the sheeting; the open bays behind a D-box take lightweight film
    const glass = build((st) => (st.covering.finish = 'glass'))
    expect(glass.weight.covering).toBeCloseTo((covered.sheeted * FINISHES.glass.mass + covered.open * FINISHES['film-light'].mass) * 2, 9)
  })

  it('counts film, fabric and tissue as weight only', () => {
    const base = margins(build().a)
    for (const finish of ['film-light', 'fabric', 'tissue']) expect(margins(build((st) => (st.covering.finish = finish)).a)).toEqual(base)
  })

  it('credits glass and epoxy over sheeting in bending and against buckling', () => {
    const film = build((st) => (st.covering.type = 'sheeted'))
    const glass = build((st) => {
      st.covering.type = 'sheeted'
      st.covering.finish = 'glass'
    })
    const f = margins(film.a)
    const g = margins(glass.a)
    expect(g.compression).toBeGreaterThan(f.compression)
    expect(g.sheet).toBeGreaterThan(f.sheet)
    expect(g.spacing).toBeGreaterThan(f.spacing)
    expect(glass.a.warnings.some((w) => w.id === 'finish-open')).toBe(false)
    // Over an open wing it has nothing to go on
    const open = build((st) => {
      st.covering.type = 'open'
      st.covering.finish = 'glass'
    })
    expect(open.a.warnings.some((w) => w.id === 'finish-open')).toBe(true)
    expect(margins(open.a)).toEqual(margins(build((st) => (st.covering.type = 'open')).a))
  })

  it('stiffens a sheet panel by its laminate', () => {
    const E = 3.4e9
    const t = 0.0015
    expect(laminatedSheetE(E, t, null)).toBe(E)
    const lam = FINISHES.glass.laminate
    const Ee = laminatedSheetE(E, t, lam)
    expect(Ee).toBeGreaterThan(E)
    // Check against the panel's buckling load worked out directly: the pair's flexural
    // rigidity about its neutral axis, and the load shared in proportion to EA
    const zg = t / 2 + lam.t / 2
    const zbar = (lam.E * lam.t * zg) / (E * t + lam.E * lam.t)
    const D = E * (t ** 3 / 12 + t * zbar ** 2) + lam.E * (lam.t ** 3 / 12 + lam.t * (zg - zbar) ** 2)
    const b = 0.05
    const a = 0.07
    const sigmaPlain = sheetBuckling(E, t, b, a)
    const NcrRatio = D / ((E * t ** 3) / 12) // panel load at buckling, relative to the plain sheet's
    const sheetStress = (sigmaPlain * t * NcrRatio) / (t + (lam.E / E) * lam.t)
    expect(sheetBuckling(Ee, t, b, a)).toBeCloseTo(sheetStress, 0)
  })
})

describe('the covering list', () => {
  it('describes every finish, grouped by maker', () => {
    for (const f of Object.values(FINISHES)) {
      expect(f.label).toBeTruthy()
      expect(f.short).toBeTruthy()
      expect(f.group).toBeTruthy()
      expect(f.mass).toBeGreaterThan(0.01)
      expect(f.mass).toBeLessThan(0.2)
    }
  })

  it('lays every glass and carbon cloth over sheeting only, as a laminate', () => {
    const cloths = Object.entries(FINISHES).filter(([k]) => k.startsWith('glass') || k.startsWith('carbon'))
    expect(cloths.length).toBe(6)
    for (const [, f] of cloths) {
      expect(f.sheetedOnly).toBe(true)
      expect(f.laminate.t).toBeGreaterThan(0)
      expect(f.laminate.E).toBeGreaterThan(1e9)
    }
  })

  it('still reads a project saved with the old glass finish', () => {
    expect(finishOf({ finish: 'glass' })).toBe(FINISHES.glass)
    expect(finishOf({ finish: 'no-such-finish' })).toBe(FINISHES.film)
  })
})
