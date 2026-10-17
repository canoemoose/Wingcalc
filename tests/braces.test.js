import { describe, it, expect } from 'vitest'
import { defaultState } from '../src/lib/projects.js'
import { resolveAirfoil, airfoilPerformance } from '../src/lib/airfoils.js'
import { wingGeometry } from '../src/lib/calc.js'
import { wingSampler, projectedSampler, normalisePanels } from '../src/lib/wing.js'
import { analyseStructure, defaultStructure } from '../src/lib/structure.js'
import { braceSizing, buildParts } from '../src/lib/ribs.js'

// A swept, polyhedral wing: two dihedral breaks (the centreline and the panel joint) to brace
const swept = (input) => {
  input.panels = normalisePanels([
    { length: 0.5, tipChord: 0.18, sweep: 0.08, dihedral: 3, washout: 1.5 },
    { length: 0.25, tipChord: 0.1, sweep: 0.08, dihedral: 10, washout: 3, thickness: 0.09 },
  ])
  input.tip = { extension: 0.04, peak: 0.4 }
}

// Analysis for the swept wing, with optional edits to the structure and the mass (kg)
function analyse(edit = () => {}, mass) {
  const s = defaultState()
  swept(s.input)
  if (mass) s.input.mass = mass
  const st = defaultStructure()
  st.le.stock = 'custom'
  st.te.stock = 'custom'
  edit(st)
  const airfoil = resolveAirfoil(s.airfoil)
  const g = wingGeometry({ ...s.input, mode: 'panels' })
  const planform = projectedSampler(wingSampler(s.input, airfoil.params.thickness))
  const perf = airfoilPerformance(airfoil, { mass: s.input.mass, area: g.projectedArea, chord: g.mac, wing: { planform, span: g.span, sweepCos: 1 } })
  const a = analyseStructure({ wing: s.input, airfoil, structure: st, mass: s.input.mass, spanwise: perf.spanwise })
  return { a, st }
}

describe('dihedral braces', () => {
  it('gives one entry per dihedral break, with the sizing fields', () => {
    const { a, st } = analyse()
    const braces = braceSizing(a, st)
    expect(braces.length).toBe(2) // centreline and the polyhedral joint
    expect(braces.map((b) => b.name)).toEqual(['B1', 'B2'])
    for (const b of braces) {
      expect(b.ok).toBe(true)
      expect(b.moment).toBeGreaterThan(0)
      expect(b.height).toBeGreaterThan(0.01)
      expect(b.needT).toBeGreaterThan(0)
      expect(b.chosenT).toBeGreaterThanOrEqual(b.needT - 1e-12)
      expect(b.margin).toBeCloseTo(b.chosenT / b.needT - 1, 9)
    }
  })

  it('needs more thickness as the bending moment grows', () => {
    const light = braceSizing(...Object.values(analyse(() => {}, 0.5)))
    const heavy = braceSizing(...Object.values(analyse(() => {}, 2)))
    expect(light.length).toBe(heavy.length)
    for (let i = 0; i < light.length; i++) {
      expect(heavy[i].moment).toBeGreaterThan(light[i].moment)
      expect(heavy[i].needT).toBeGreaterThan(light[i].needT)
    }
  })

  it('warns when an entered thickness is below what the bending needs', () => {
    const { a } = analyse((st) => {
      st.braces.thickness = 0.0004 // 0.4 mm, too thin for the bending at the centreline
    })
    const warnings = a.warnings.filter((w) => w.id === 'brace-B1')
    expect(warnings.length).toBe(1)
    expect(warnings[0].message).toMatch(/Dihedral brace B1/)
    expect(a.braces.find((b) => b.name === 'B1').margin).toBeLessThan(0)
  })

  it('gives no brace warning when the entered thickness is enough', () => {
    const { a } = analyse((st) => {
      st.braces.thickness = 0.006 // 6 mm, well above what the bending needs
    })
    expect(a.warnings.some((w) => String(w.id).startsWith('brace-'))).toBe(false)
  })

  it('takes the brace thickness set for it, then the one for all, then the loads', () => {
    const { a, st } = analyse((st) => {
      st.braces.thickness = 0.004
      st.braces.thicknesses = { B2: 0.0015 }
    })
    const [b1, b2] = braceSizing(a, st)
    expect(b1.chosenT).toBe(0.004)
    expect(b2.chosenT).toBe(0.0015)
    expect(b2.entered).toBe(true)
    const { a: a0, st: st0 } = analyse()
    expect(braceSizing(a0, st0).every((b) => !b.entered)).toBe(true)
  })

  it('lays the grain along the brace, half way between its arms', () => {
    const { a, st } = analyse()
    const braces = braceSizing(a, st)
    const parts = buildParts(a, a.structure).parts.filter((p) => p.group === 'braces')
    expect(parts.length).toBe(braces.length)
    for (const p of parts) {
      const b = braces.find((x) => x.name === p.name)
      expect(p.grainAngle).toBeCloseTo((b.dihedralDeg * Math.PI) / 180 / 2, 9)
    }
  })
})
