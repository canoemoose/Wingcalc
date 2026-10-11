import { describe, it, expect } from 'vitest'
import { defaultState } from '../src/lib/projects.js'
import { resolveAirfoil, airfoilPerformance, sectionModel } from '../src/lib/airfoils.js'
import { wingGeometry } from '../src/lib/calc.js'
import { wingSampler, projectedSampler } from '../src/lib/wing.js'
import { spanwiseStall } from '../src/lib/stall.js'

function run(panels) {
  const s = defaultState()
  if (panels) s.input.panels = panels
  const a = resolveAirfoil(s.airfoil)
  const g = wingGeometry({ ...s.input, mode: 'panels' })
  const planform = projectedSampler(wingSampler(s.input, a.params.thickness))
  const opts = { mass: s.input.mass, area: g.projectedArea, chord: g.mac }
  return {
    factor: airfoilPerformance(a, { ...opts, clMaxFactor: 0.9 }),
    ll: airfoilPerformance(a, { ...opts, wing: { planform, span: g.span, sweepCos: 1 } }),
  }
}

const tapered = (o = {}) => [{ id: 1, length: 0.7, tipChord: 0.1, dihedral: 0, washout: 0, thickness: null, ...o }]

describe('wing stall from the lifting line', () => {
  it('agrees with the 0.9 rule of thumb for a moderately tapered wing', () => {
    const { factor, ll } = run()
    expect(ll.method).toBe('lifting-line')
    expect(ll.stallSpeed / factor.stallSpeed).toBeGreaterThan(0.97)
    expect(ll.stallSpeed / factor.stallSpeed).toBeLessThan(1.03)
    expect(ll.spanwise.onsetEta).toBeLessThan(0.5)
  })

  it('finds a sharply tapered wing stalls outboard, and rates it one step sharper', () => {
    const { ll } = run(tapered())
    expect(ll.spanwise.onsetEta).toBeGreaterThan(0.6)
    expect(ll.stall.spanwise.where).toBe('outboard')
    expect(ll.stall.rating).toBe('sharp')
    expect(ll.stall.sectionRating).toBe('moderate')
  })

  it('moves the stall inboard with washout, and lowers the stall speed', () => {
    const flat = run(tapered()).ll
    const washed = run(tapered({ washout: 3 })).ll
    expect(washed.spanwise.onsetEta).toBeLessThan(flat.spanwise.onsetEta - 0.1)
    expect(washed.stallSpeed).toBeLessThan(flat.stallSpeed)
  })

  it('stalls a thinner tip section earlier', () => {
    const base = run(tapered()).ll
    const thin = run(tapered({ thickness: 0.08 })).ll
    expect(thin.wingClMax).toBeLessThan(base.wingClMax)
  })

  it('credits a thinner section with less Clmax at the same Reynolds number', () => {
    const m = sectionModel(resolveAirfoil(defaultState().airfoil))
    expect(m.clMaxAt(200000, 0.08)).toBeLessThan(m.clMaxAt(200000))
    expect(m.clMaxAt(200000, 0.12)).toBeCloseTo(m.clMaxAt(200000), 12)
    expect(m.a0At(200000)).toBeGreaterThan(5)
    expect(m.a0At(200000)).toBeLessThan(7)
  })
})

describe('spanwise stall notes', () => {
  it('words the three cases', () => {
    expect(spanwiseStall(0.2)).toMatchObject({ where: 'inboard', sharper: false })
    expect(spanwiseStall(0.5)).toMatchObject({ where: 'mid', sharper: false })
    expect(spanwiseStall(0.8)).toMatchObject({ where: 'outboard', sharper: true })
    expect(spanwiseStall(0.8).text).toContain('80%')
  })
})
