// Runs real XFOIL polars through the WebAssembly build (about 1 s each).
import { describe, it, expect, beforeAll, vi } from 'vitest'
import { createXfoilEngine } from '../src/lib/xfoilEngine.js'
import { comparePolars, alphaGrid, XFOIL_SETTINGS } from '../src/lib/xfoil.js'
import { findSection } from '../src/lib/airfoils.js'

vi.setConfig({ testTimeout: 30000 })

let engine
beforeAll(async () => {
  engine = await createXfoilEngine()
})

const reference = (id, re) => {
  const s = findSection(id)
  return { coords: s.coords, polar: s.polars.find((p) => p.re === re) }
}

describe('XFOIL engine', () => {
  it('reproduces the bundled NACA 2412 polar at Re 200,000', () => {
    const { coords, polar } = reference('naca2412-il', 200000)
    const p = engine.runPolar(coords, 200000)
    const m = comparePolars(polar, p)
    expect(m.allWithin).toBe(true)
    expect(Math.abs(m.dClMax)).toBeLessThan(0.02)
    expect(m.rms).toBeLessThan(0.005)
    expect(p.alpha.length).toBeGreaterThan(alphaGrid(XFOIL_SETTINGS).length * 0.9)
    expect(p.cd.every((v) => v > 0.003 && v < 0.3)).toBe(true)
  })

  it('gives the same answer when run again (no state carried between runs)', () => {
    const { coords } = reference('clarky-il', 100000)
    const a = engine.runPolar(coords, 100000)
    engine.runPolar(reference('s1223-il', 500000).coords, 500000)
    const b = engine.runPolar(coords, 100000)
    expect(b.cl).toEqual(a.cl)
    expect(b.failed).toEqual(a.failed)
  })

  it('converges at most points for a hard low-Re high-lift section', () => {
    const { coords, polar } = reference('s1223-il', 100000)
    const p = engine.runPolar(coords, 100000)
    // Pre-stall points converge; the spike found the computed Clmax 0.05 to 0.1 below
    // airfoiltools.com for this section.
    expect(p.alpha.filter((a) => a <= 8).length).toBeGreaterThan(20)
    const m = comparePolars(polar, p)
    expect(Math.abs(m.dClMax)).toBeLessThan(0.15)
  })

})
