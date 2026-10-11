import { describe, it, expect } from 'vitest'
import { panelWingGeometry, edgeX, panelEnds } from '../src/lib/wing.js'

const rect = (o = {}) => ({ length: 0.5, tipChord: 0.2, dihedral: 0, ...o })

describe('edges', () => {
  it('runs straight between the ends when there is no curve', () => {
    expect(edgeX(0, 0.1, null, 0.5)).toBeCloseTo(0.05, 12)
  })

  it('passes through both ends when curved', () => {
    const curve = { u: 0.7, d: 0.04 }
    expect(edgeX(0, 0.1, curve, 0)).toBeCloseTo(0, 12)
    expect(edgeX(0, 0.1, curve, 1)).toBeCloseTo(0.1, 12)
  })

  it('reduces to a straight line with zero offset', () => {
    for (const f of [0.1, 0.4, 0.9]) expect(edgeX(0.02, 0.08, { u: 0.3, d: 0 }, f)).toBeCloseTo(0.02 + 0.06 * f, 12)
  })

  it('bulges by half the control offset at the middle of a symmetric curve', () => {
    // Quadratic Bézier midpoint = (P0 + 2C + P2) / 4
    expect(edgeX(0, 0, { u: 0.5, d: 0.08 }, 0.5)).toBeCloseTo(0.04, 12)
  })
})

describe('fuselage width', () => {
  it('adds a constant-chord centre section and shifts the panels out', () => {
    const g = panelWingGeometry({ fuselageWidth: 0.1, rootChord: 0.2, panels: [rect()] })
    expect(g.span).toBeCloseTo(1.1, 12)
    expect(g.area).toBeCloseTo(0.1 * 0.2 + 2 * 0.5 * 0.2, 12)
    expect(g.exposedArea).toBeCloseTo(2 * 0.5 * 0.2, 12)
    expect(g.mac).toBeCloseTo(0.2, 12)
  })

  it('keeps the fuselage section flat when the panels have dihedral', () => {
    const g = panelWingGeometry({ fuselageWidth: 0.1, rootChord: 0.2, panels: [rect({ dihedral: 60 })] })
    expect(g.projectedArea).toBeCloseTo(0.1 * 0.2 + 2 * 0.25 * 0.2, 12)
    expect(g.stations.map((s) => s.y)).toEqual([0, 0.05, expect.closeTo(0.3, 12)])
  })
})

describe('sweep', () => {
  it('leaves area unchanged and measures the quarter-chord sweep', () => {
    const straight = panelWingGeometry({ rootChord: 0.2, panels: [rect()] })
    const swept = panelWingGeometry({ rootChord: 0.2, panels: [rect({ sweep: 0.2 })] })
    expect(swept.area).toBeCloseTo(straight.area, 12)
    expect((swept.sweepQuarter * 180) / Math.PI).toBeCloseTo(21.8, 1) // atan(0.2 / 0.5)
    expect(straight.sweepQuarter).toBeCloseTo(0, 12)
    // MAC leading edge sits at mid-span of a constant-chord panel
    expect(swept.macX).toBeCloseTo(0.1, 12)
  })

  it('carries sweep through to later panels', () => {
    const ends = panelEnds({ rootChord: 0.2, panels: [rect({ sweep: 0.05 }), rect({ sweep: 0.05 })] })
    expect(ends[1].outer.x).toBeCloseTo(0.1, 12)
  })
})

describe('curved edges', () => {
  it('changes area by the area under the curve', () => {
    // A quadratic Bézier bulges by d/2 at its middle and encloses a parabolic segment of
    // area (2/3)·(d/2)·L = d·L/3 against the straight edge, per side.
    const base = panelWingGeometry({ rootChord: 0.2, panels: [rect()] })
    const bulged = panelWingGeometry({ rootChord: 0.2, panels: [rect({ te: { u: 0.5, d: 0.06 } })] })
    expect(bulged.area - base.area).toBeCloseTo(2 * ((0.06 * 0.5) / 3), 4)
  })

  it('makes a rounded tip from a zero tip chord', () => {
    const g = panelWingGeometry({
      rootChord: 0.2,
      panels: [rect({ tipChord: 0, sweep: 0.1, le: { u: 0.8, d: -0.08 }, te: { u: 0.8, d: 0.08 } })],
    })
    expect(g.area).toBeGreaterThan(0.1) // more than the straight triangle
    expect(g.invalid).toBeNull()
  })

  it('rejects edges that cross', () => {
    const g = panelWingGeometry({ rootChord: 0.2, panels: [rect({ le: { u: 0.5, d: 0.5 } })] })
    expect(g.invalid).toBe('edges-cross')
    expect(g.area).toBeNull()
  })

  it('rejects a control point outside the panel', () => {
    expect(panelWingGeometry({ rootChord: 0.2, panels: [rect({ le: { u: 1.2, d: 0 } })] }).area).toBeNull()
  })
})

describe('outline', () => {
  it('runs LE root to tip then TE back, closing at the root', () => {
    const g = panelWingGeometry({ fuselageWidth: 0.1, rootChord: 0.2, panels: [rect()] })
    expect(g.outline[0]).toEqual([0, 0])
    expect(g.outline.at(-1)).toEqual([0, 0.2])
    expect(Math.max(...g.outline.map(([y]) => y))).toBeCloseTo(0.55, 12)
  })
})
