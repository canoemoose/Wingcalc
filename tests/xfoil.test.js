import { describe, it, expect } from 'vitest'
import {
  XFOIL_SETTINGS,
  quantiseRe,
  seligText,
  alphaGrid,
  xfoilScript,
  parsePolarFile,
  toPolar,
  polarSegments,
  comparePolars,
  coordsKey,
  flapSpec,
  flapKey,
} from '../src/lib/xfoil.js'

const POLAR_FILE = `
       XFOIL         Version 7.00

 Calculated polar for: Wingcalc section

 xtrf =   1.000 (top)        1.000 (bottom)
 Mach =   0.000     Re =     0.200 e 6     Ncrit =   9.000  9.000

   alpha    CL        CD       CDp       CM      Top_Xtr  Bot_Xtr   Top_Itr  Bot_Itr
  ------ -------- --------- --------- --------  -------- --------  -------- --------
   0.000   0.2857   0.01001   0.00362  -0.0607    0.8403  19.7551   0.9793 235.7595
   0.500   0.3500   0.00990   0.00300  -0.0630    0.8000  20.0000   1.0000 240.0000
   1.500   0.4800   0.00980   0.00290  -0.0650    0.7500  25.0000   1.0000 240.0000
  -0.500   0.2200   0.01020   0.00380  -0.0590    0.8600  18.0000   0.9700 230.0000
`

describe('XFOIL command script', () => {
  it('sets panels, Re, Ncrit and iterations, and sweeps out from 0° both ways', () => {
    const s = xfoilScript(123456.7)
    const lines = s.split('\n')
    expect(lines).toContain('N 160')
    expect(lines).toContain('VISC 123457')
    expect(lines).toContain('N 9')
    expect(lines).toContain('ITER 50')
    const up = lines.indexOf('ASEQ 0 18 0.5')
    const init = lines.indexOf('INIT')
    const down = lines.indexOf('ASEQ -0.5 -4 -0.5')
    expect(up).toBeGreaterThan(0)
    expect(init).toBeGreaterThan(up)
    expect(down).toBeGreaterThan(init)
    expect(lines.at(-2)).toBe('QUIT')
  })

  it('uses a single sweep when the range does not straddle 0°', () => {
    const s = xfoilScript(1e5, { ...XFOIL_SETTINGS, alphaStart: 2, alphaEnd: 10 })
    expect(s).toContain('ASEQ 2 10 0.5')
    expect(s).not.toContain('INIT')
  })

  it('deflects a flap with GDES FLAP before repanelling, hinge height as a fraction of the thickness', () => {
    const lines = xfoilScript(200000, XFOIL_SETTINGS, { hinge: 0.75, deflection: 20 }).split('\n')
    const g = lines.indexOf('GDES')
    expect(g).toBeGreaterThan(lines.indexOf('LOAD foil.dat'))
    expect(lines.slice(g, g + 8)).toEqual(['GDES', 'FLAP', '0.75', '999', '0.5', '20', 'EXEC', ''])
    expect(lines.indexOf('PPAR')).toBe(g + 8)
    // Up is negative, and the rest of the script is as without a flap
    const up = xfoilScript(200000, XFOIL_SETTINGS, { hinge: 0.7, deflection: -25, yt: 0.4 }).split('\n')
    expect(up.slice(up.indexOf('FLAP') + 1, up.indexOf('FLAP') + 5)).toEqual(['0.7', '999', '0.4', '-25'])
    const plain = xfoilScript(200000).split('\n')
    expect(plain).not.toContain('GDES')
    expect(up.slice(up.indexOf('PPAR'))).toEqual(plain.slice(plain.indexOf('PPAR')))
  })

  it('rounds a flap for the cache: hinge to 1% of the chord, deflection to 0.5 degrees', () => {
    expect(flapSpec({ hinge: 0.7483, deflection: 44.8 })).toEqual({ hinge: 0.75, yt: 0.5, deflection: 45 })
    expect(flapKey({ hinge: 0.7483, deflection: 44.8 })).toBe(flapKey({ hinge: 0.7512, deflection: 45.1 }))
    expect(flapKey({ hinge: 0.75, deflection: 20 })).not.toBe(flapKey({ hinge: 0.75, deflection: -20 }))
    expect(flapKey(null)).toBe('')
  })
})

describe('polar parsing', () => {
  it('reads the rows under the dashed rule', () => {
    const rows = parsePolarFile(POLAR_FILE)
    expect(rows).toHaveLength(4)
    expect(rows[0]).toEqual({ alpha: 0, cl: 0.2857, cd: 0.01001, cm: -0.0607 })
  })

  it('returns converged points in alpha order and lists the rest as failed', () => {
    const s = { ...XFOIL_SETTINGS, alphaStart: -1, alphaEnd: 2 }
    const p = toPolar(parsePolarFile(POLAR_FILE), 2e5, s)
    expect(p.alpha).toEqual([-0.5, 0, 0.5, 1.5])
    expect(p.cl).toEqual([0.22, 0.2857, 0.35, 0.48])
    expect(p.failed).toEqual([-1, 1, 2])
    expect(p.re).toBe(2e5)
  })

  it('handles an empty file', () => {
    const p = toPolar(parsePolarFile(''), 1e5)
    expect(p.alpha).toEqual([])
    expect(p.failed).toHaveLength(alphaGrid(XFOIL_SETTINGS).length)
  })

  it('splits a polar into runs at non-converged gaps', () => {
    expect(polarSegments({ alpha: [0, 0.5, 1, 2, 2.5, 4], step: 0.5 })).toEqual([[0, 2], [3, 4], [5, 5]])
    expect(polarSegments({ alpha: [], step: 0.5 })).toEqual([])
  })
})

describe('helpers', () => {
  it('quantises Re onto a grid about 10% apart', () => {
    expect(quantiseRe(200000)).toBe(quantiseRe(203000))
    const a = quantiseRe(150000)
    const b = quantiseRe(a * 1.12)
    expect(b / a).toBeGreaterThan(1.05)
    expect(b / a).toBeLessThan(1.15)
    expect(Math.abs(quantiseRe(87000) / 87000 - 1)).toBeLessThan(0.06)
  })

  it('writes Selig text with a name line', () => {
    const t = seligText([[1, 0], [0, 0], [1, -0.001]], 'Test')
    expect(t.split('\n')).toEqual(['Test', '1.000000 0.000000', '0.000000 0.000000', '1.000000 -0.001000', ''])
  })

  it('keys coordinates stably and distinctly', () => {
    const c = [[1, 0], [0.5, 0.06], [0, 0], [0.5, -0.04], [1, 0]]
    expect(coordsKey(c)).toBe(coordsKey(c.map(([x, y]) => [x + 1e-9, y])))
    expect(coordsKey(c)).not.toBe(coordsKey([[1, 0], [0.5, 0.061], [0, 0], [0.5, -0.04], [1, 0]]))
  })

  it('compares polars on Clmax, its angle, slope and RMS', () => {
    const alpha = [-2, -1, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10]
    const ref = { alpha, cl: alpha.map((a) => Math.min(0.2 + 0.1 * a, 1.1)) }
    expect(comparePolars(ref, ref).allWithin).toBe(true)
    const off = { alpha, cl: ref.cl.map((v) => v + 0.05) }
    const m = comparePolars(ref, off)
    expect(m.dClMax).toBeCloseTo(0.05, 9)
    expect(m.rms).toBeCloseTo(0.05, 9)
    expect(m.within.clMax).toBe(false)
    expect(m.within.slope).toBe(true)
    expect(m.allWithin).toBe(false)
  })
})
