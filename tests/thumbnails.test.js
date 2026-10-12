import { describe, it, expect } from 'vitest'
import { defaultState } from '../src/lib/projects.js'
import { resolveAirfoil, airfoilPerformance } from '../src/lib/airfoils.js'
import { wingGeometry } from '../src/lib/calc.js'
import { wingSampler, projectedSampler } from '../src/lib/wing.js'
import { analyseStructure } from '../src/lib/structure.js'
import { buildParts } from '../src/lib/ribs.js'
import { normalisePanels } from '../src/lib/wing.js'
import { planThumb, isoThumb } from '../src/lib/thumbnails.js'

function build(tweak = () => {}) {
  const s = defaultState()
  tweak(s.input)
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

  it('runs the edge lines through the rib ends, washout and dihedral included', () => {
    const twisted = build((input) => (input.panels = normalisePanels([{ length: 0.7, tipChord: 0.18, dihedral: 5, washout: 4 }])))
    const t = isoThumb(twisted.a, twisted.a.structure, twisted.parts)
    const pairs = (d) => {
      const n = numbers(d)
      return Array.from({ length: n.length / 2 }, (_, i) => [n[2 * i], n[2 * i + 1]])
    }
    // Distance from a point to a polyline, in the drawing's millimetres
    const gap = (q, line) => {
      let best = Infinity
      for (let i = 1; i < line.length; i++) {
        const [a, b] = [line[i - 1], line[i]]
        const d = [b[0] - a[0], b[1] - a[1]]
        const f = Math.max(0, Math.min(1, ((q[0] - a[0]) * d[0] + (q[1] - a[1]) * d[1]) / (d[0] * d[0] + d[1] * d[1] || 1)))
        best = Math.min(best, Math.hypot(q[0] - a[0] - f * d[0], q[1] - a[1] - f * d[1]))
      }
      return best
    }
    const ribLines = t.lines.filter((l) => l.kind === 'rib').map((l) => pairs(l.d))
    const edges = t.lines.filter((l) => l.kind === 'edge').map((l) => pairs(l.d))
    expect(edges).toHaveLength(2)
    // Both edges touch every rib (at its corner against the stock)
    for (const line of edges) for (const rib of ribLines) expect(Math.min(...rib.map((q) => gap(q, line)))).toBeLessThan(0.15)
  })
})
