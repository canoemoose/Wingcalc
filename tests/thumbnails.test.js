import { describe, it, expect } from 'vitest'
import { defaultState } from '../src/lib/projects.js'
import { resolveAirfoil, airfoilPerformance } from '../src/lib/airfoils.js'
import { wingGeometry } from '../src/lib/calc.js'
import { wingSampler, projectedSampler } from '../src/lib/wing.js'
import { analyseStructure } from '../src/lib/structure.js'
import { buildParts } from '../src/lib/ribs.js'
import { planThumb, isoThumb } from '../src/lib/thumbnails.js'

function build() {
  const s = defaultState()
  const airfoil = resolveAirfoil(s.airfoil)
  const g = wingGeometry({ ...s.input, mode: 'panels' })
  const planform = projectedSampler(wingSampler(s.input, airfoil.params.thickness))
  const perf = airfoilPerformance(airfoil, { mass: s.input.mass, area: g.projectedArea, chord: g.mac, wing: { planform, span: g.span, sweepCos: 1 } })
  const a = analyseStructure({ wing: s.input, airfoil, structure: s.input.structure, mass: s.input.mass, spanwise: perf.spanwise })
  return { a, parts: buildParts(a, a.structure).parts }
}

const numbers = (d) => d.match(/-?\d+(\.\d+)?/g).map(Number)

describe('structure thumbnails', () => {
  const { a, parts } = build()
  const ribs = parts.filter((p) => p.group === 'ribs').length

  it('draws the plan with every rib, inside its view box', () => {
    const t = planThumb(a, a.structure, parts)
    expect(t.lines.filter((l) => l.kind === 'rib')).toHaveLength(ribs)
    const [x, y, w, h] = t.box.split(' ').map(Number)
    for (const l of t.lines) {
      const n = numbers(l.d)
      for (let i = 0; i < n.length; i += 2) {
        expect(n[i]).toBeGreaterThanOrEqual(x)
        expect(n[i]).toBeLessThanOrEqual(x + w)
        expect(n[i + 1]).toBeGreaterThanOrEqual(y)
        expect(n[i + 1]).toBeLessThanOrEqual(y + h)
      }
    }
    // The half span runs across, the chord down: wider than tall
    expect(w).toBeGreaterThan(h)
  })

  it('draws the wireframe with every rib, the edges and the spar, all finite', () => {
    const t = isoThumb(a, a.structure, parts)
    expect(t.lines.filter((l) => l.kind === 'rib')).toHaveLength(ribs)
    expect(t.lines.filter((l) => l.kind === 'edge')).toHaveLength(2)
    expect(t.lines.filter((l) => l.kind === 'spar')).toHaveLength(2)
    for (const l of t.lines) expect(numbers(l.d).every(Number.isFinite)).toBe(true)
  })

  it('keeps each rib outline smooth, not snapped to a coarse grid', () => {
    const t = isoThumb(a, a.structure, parts)
    const rib = parts.filter((p) => p.group === 'ribs')[0]
    const n = numbers(t.lines.find((l) => l.kind === 'rib').d)
    const distinct = new Set()
    for (let i = 0; i < n.length; i += 2) distinct.add(`${n[i]},${n[i + 1]}`)
    expect(distinct.size).toBeGreaterThan(rib.outline.length * 0.9)
  })
})
