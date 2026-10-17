import { describe, it, expect } from 'vitest'
import { notchFront } from '../src/lib/ribs.js'

// Shoelace area of a closed polygon
const area = (pts) => {
  let s = 0
  for (let i = 0; i < pts.length; i++) {
    const [x1, y1] = pts[i]
    const [x2, y2] = pts[(i + 1) % pts.length]
    s += x1 * y2 - x2 * y1
  }
  return Math.abs(s) / 2
}

describe('notchFront', () => {
  // A 10 x 10 rectangle with vertices only at its corners, wound as rib outlines are (front
  // edge run bottom to top). A radius-2 notch centred on the front edge (u = 0) crosses that
  // edge with no vertex inside it, the case that used to be skipped.
  const rect = [
    [0, -5],
    [0, 5],
    [10, 5],
    [10, -5],
  ]

  it('cuts a notch that falls between two vertices', () => {
    const out = notchFront(rect, 0, 0, 2, 2)
    expect(out).not.toBe(rect)
    // Half a radius-2 disc (area 2*pi) is removed from the rectangle
    expect(area(out)).toBeCloseTo(100 - 2 * Math.PI, 1)
  })

  it('leaves the outline alone when the notch misses it entirely', () => {
    const out = notchFront(rect, -20, 0, 2, 2)
    expect(area(out)).toBeCloseTo(100, 6)
  })

  it('removes no point inside the notch from the result', () => {
    const out = notchFront(rect, 0, 0, 2, 2)
    const inside = out.filter(([u, z]) => (u / 2) ** 2 + (z / 2) ** 2 < 1 - 1e-6)
    expect(inside).toHaveLength(0)
  })
})

// Real build: a full wing from the default state
import { defaultState } from '../src/lib/projects.js'
import { resolveAirfoil, airfoilPerformance } from '../src/lib/airfoils.js'
import { wingGeometry } from '../src/lib/calc.js'
import { wingSampler, projectedSampler } from '../src/lib/wing.js'
import { analyseStructure, defaultStructure } from '../src/lib/structure.js'
import { buildParts } from '../src/lib/ribs.js'

function buildWing(edit) {
  const s = defaultState()
  const st = defaultStructure()
  edit(st)
  const airfoil = resolveAirfoil(s.airfoil)
  const g = wingGeometry({ ...s.input, mode: 'panels' })
  const planform = projectedSampler(wingSampler(s.input, airfoil.params.thickness))
  const perf = airfoilPerformance(airfoil, { mass: s.input.mass, area: g.projectedArea, chord: g.mac, wing: { planform, span: g.span, sweepCos: 1 } })
  const a = analyseStructure({ wing: s.input, airfoil, structure: st, mass: s.input.mass, spanwise: perf.spanwise })
  return buildParts(a, a.structure).parts.filter((p) => p.group === 'ribs')
}

describe('leading-edge notch in a full build', () => {
  // Against a custom balsa leading edge as deep as the rod's radius: the ribs are cut back to the same line, so the
  // only difference is the notch. Each rib loses most of a half disc of the rod's radius (less where a thin rib
  // can't hold the whole notch). An open structure, so the ribs run right forward to the rod: under a D-box the
  // sheeting thins a rib's nose to nothing a little behind the leading edge, and a small rod sits ahead of it.
  // (1.5 and 2 mm rods are left out: the root rib's nose stops just behind them, so there's nothing there to notch)
  for (const [type, d] of [['rod', 0.003], ['rod', 0.004], ['rod', 0.006], ['dowel', 0.006], ['dowel', 0.008]]) {
    it(`${type} ${d * 1000} mm notches every rib`, () => {
      const plain = buildWing((st) => { st.covering.type = 'open'; Object.assign(st.le, { type: 'balsa', stock: 'custom', width: d / 2 }) })
      const ribs = buildWing((st) => { st.covering.type = 'open'; Object.assign(st.le, { type, diameter: d }) })
      expect(ribs.length).toBe(plain.length)
      const half = (Math.PI * (d / 2) ** 2) / 2
      ribs.forEach((p, i) => {
        const removed = area(plain[i].outline) - area(p.outline)
        expect(removed, p.name).toBeGreaterThan(half * 0.5)
        expect(removed, p.name).toBeLessThan(half * 1.2)
      })
    })
  }
})
