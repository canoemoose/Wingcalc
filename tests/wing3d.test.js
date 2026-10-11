import { describe, it, expect } from 'vitest'
import { defaultState } from '../src/lib/projects.js'
import { resolveAirfoil, airfoilPerformance } from '../src/lib/airfoils.js'
import { wingGeometry } from '../src/lib/calc.js'
import { wingSampler, projectedSampler, normalisePanels } from '../src/lib/wing.js'
import { analyseStructure, defaultStructure } from '../src/lib/structure.js'
import { buildParts } from '../src/lib/ribs.js'
import { wing3d, worldPoint, applyMatrix, loft } from '../src/lib/wing3d.js'

function build(edit = () => {}, wingEdit = () => {}) {
  const s = defaultState()
  wingEdit(s.input)
  const st = defaultStructure()
  edit(st)
  const airfoil = resolveAirfoil(s.airfoil)
  const g = wingGeometry({ ...s.input, mode: 'panels' })
  const planform = projectedSampler(wingSampler(s.input, airfoil.params.thickness))
  const perf = airfoilPerformance(airfoil, { mass: s.input.mass, area: g.projectedArea, chord: g.mac, wing: { planform, span: g.span, sweepCos: 1 } })
  const a = analyseStructure({ wing: s.input, airfoil, structure: st, mass: s.input.mass, spanwise: perf.spanwise })
  const { parts } = buildParts(a, st)
  return { a, st, parts, g, w: wing3d(a, st, parts) }
}

const swept = (input) => {
  input.panels = normalisePanels([
    { length: 0.5, tipChord: 0.18, sweep: 0.08, dihedral: 4, washout: 1.5 },
    { length: 0.25, tipChord: 0.1, sweep: 0.08, dihedral: 12, washout: 3 },
  ])
  input.tip = { extension: 0.04, peak: 0.4 }
}

describe('3D wing', () => {
  it('lofts rings into a closed mesh, with caps', () => {
    const ring = (z) => [
      [0, 0, z],
      [1, 0, z],
      [1, 1, z],
      [0, 1, z],
    ]
    const m = loft([ring(0), ring(1), ring(2)], { closed: true, caps: true })
    expect(m.positions.length).toBe((12 + 2) * 3)
    expect(m.indices.length).toBe(2 * 4 * 6 + 2 * 4 * 3)
    expect(Math.max(...m.indices)).toBeLessThan(m.positions.length / 3)
  })

  it('lifts a dihedral panel and spans the projected half wing', () => {
    const { w, g } = build(() => {}, swept)
    expect(w.bounds.max[0]).toBeCloseTo(g.span / 2, 3)
    expect(w.bounds.max[1]).toBeGreaterThan(0.25 * Math.sin((12 * Math.PI) / 180))
    for (const k of [0, 1, 2]) expect(Number.isFinite(w.bounds.min[k])).toBe(true)
  })

  it('places every rib on the wing: its outline lands where the lofted wing has that point', () => {
    for (const orientation of ['streamwise', 'perpendicular']) {
      const { a, w, parts } = build((st) => (st.ribs.orientation = orientation), swept)
      for (const rib of w.ribs) {
        const part = parts.find((p) => p.id === rib.id)
        const r = part.rib
        const ang = (r.angle * Math.PI) / 180
        // Mid-thickness, a few points along the rib's top edge
        for (const [u, z] of rib.outline.filter((_, i) => i % 25 === 0)) {
          const got = applyMatrix(rib.matrix, [u, z, rib.thickness / 2])
          const s = part.s + Math.sin(ang) * (u - r.sparU)
          const x = a.sparX(part.s) + Math.cos(ang) * (u - r.sparU)
          // Break ribs sit at the mean of the two panels' angles, so allow for the cant there
          const tol = part.kind === 'normal' || part.kind === 'tip' ? 1e-9 : 0.002
          const want = worldPoint(a, s, x, z)
          for (const k of [0, 1, 2]) expect(Math.abs(got[k] - want[k]), `${rib.name} ${orientation}`).toBeLessThan(tol + 1e-9)
        }
      }
    }
  })

  it('builds the spar, webs, edges and stringers, all with valid indices', () => {
    const { w } = build((st) => {
      st.spar.type = 'box'
      st.stringers = [{ id: 1, position: 0.12, surface: 'both', width: 0.003, height: 0.003, material: 'balsa-hard' }]
    })
    const kinds = w.solids.map((s) => s.kind)
    expect(kinds.filter((k) => k === 'spar')).toHaveLength(2)
    expect(kinds.filter((k) => k === 'web')).toHaveLength(2)
    expect(kinds).toContain('le')
    expect(kinds).toContain('te')
    expect(kinds.filter((k) => k === 'stringer')).toHaveLength(2)
    for (const m of [w.skin, ...w.solids]) {
      expect(Math.max(...m.indices)).toBeLessThan(m.positions.length / 3)
      expect(m.positions.every(Number.isFinite)).toBe(true)
    }
  })

  it('stops a short tube where it ends', () => {
    const { w } = build((st) => {
      st.spar.type = 'tube'
      st.spar.tubeLength = 0.3
    })
    const tube = w.solids.find((s) => s.kind === 'spar')
    let maxX = 0
    for (let i = 0; i < tube.positions.length; i += 3) maxX = Math.max(maxX, tube.positions[i])
    expect(maxX).toBeCloseTo(0.3, 2)
  })
})
