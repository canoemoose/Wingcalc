import { describe, it, expect } from 'vitest'
import { panelWingGeometry, edgeX, panelEnds, pchip, flatPanels, setPanelMode, addStation, panelMode, keyPoints, insertPanel, movePanel, stationOrder, addBlankStation, wingSampler } from '../src/lib/wing.js'

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

describe('monotone interpolation', () => {
  it('passes through every point', () => {
    const f = pchip([0, 0.3, 0.7, 1], [0, 0.05, 0.02, 0.04])
    expect(f(0.3)).toBeCloseTo(0.05, 12)
    expect(f(0.7)).toBeCloseTo(0.02, 12)
    expect(f(1)).toBeCloseTo(0.04, 12)
  })

  it('never overshoots between points', () => {
    const f = pchip([0, 0.5, 0.6, 1], [0, 0.1, 0.1, 0.1])
    for (let x = 0; x <= 1; x += 0.01) expect(f(x)).toBeLessThanOrEqual(0.1 + 1e-12)
  })

  it('is exact for a straight line', () => {
    const f = pchip([0, 0.2, 1], [1, 1.2, 2])
    expect(f(0.6)).toBeCloseTo(1.6, 12)
  })
})

describe('chord stations', () => {
  const wing = (stations, o = {}) => ({ rootChord: 0.2, panels: [rect({ tipChord: 0.1, stations, ...o })] })

  it('matches a straight panel when the stations sit on its edges', () => {
    const straight = panelWingGeometry(wing(null))
    const st = panelWingGeometry(wing([{ id: 1, d: 0.25, chord: 0.15, le: 0 }]))
    expect(st.area).toBeCloseTo(straight.area, 10)
  })

  it('runs the edges through each station', () => {
    const w = wing([{ id: 1, d: 0.2, chord: 0.22, le: -0.02 }])
    const { panels } = flatPanels(w)
    const edges = panels[0].edges
    expect(edges.le(0.4)).toBeCloseTo(-0.02, 12)
    expect(edges.te(0.4) - edges.le(0.4)).toBeCloseTo(0.22, 12)
  })

  it('skips unusable stations, still draws the panel, and says why', () => {
    const straight = panelWingGeometry(wing(null))
    const g = panelWingGeometry(
      wing([
        { id: 1, d: 0.6, chord: 0.1, le: 0 },
        { id: 2, d: 0.5, chord: 0.1, le: 0 },
        { id: 3, d: 0.25, chord: 0.15, le: 0 },
        { id: 4, d: 0.25, chord: 0.15, le: 0 },
        { id: 5, d: 0, chord: 0.15, le: 0 },
      ]),
    )
    expect(g.area).toBeCloseTo(straight.area, 10)
    expect(Object.fromEntries(g.ignoredStations.map((x) => [x.id, x.reason]))).toEqual({
      1: 'beyond',
      2: 'on-tip',
      4: 'duplicate',
      5: 'inner',
    })
  })

  it('adds stations on the current shape and switches modes without changing it much', () => {
    const w = { rootChord: 0.2, panels: [rect({ id: 1, tipChord: 0.1, te: { u: 0.5, d: 0.06 } })] }
    const curved = panelWingGeometry(w).area
    const asStations = { ...w, panels: setPanelMode(w, 0, 'stations') }
    expect(panelMode(asStations.panels[0])).toBe('stations')
    expect(asStations.panels[0].stations).toHaveLength(3)
    expect(panelWingGeometry(asStations).area).toBeCloseTo(curved, 3)
    const more = { ...asStations, panels: addStation(asStations, 0) }
    expect(more.panels[0].stations).toHaveLength(4)
    expect(panelWingGeometry(more).area).toBeCloseTo(curved, 3)
    expect(panelMode(setPanelMode(more, 0, 'straight')[0])).toBe('straight')
  })
})

describe('curved tip', () => {
  const base = { rootChord: 0.2, panels: [rect({ tipChord: 0.2 })] }

  it('adds a quarter-ellipse cap of area (π/4)·e·c per side', () => {
    const plain = panelWingGeometry(base)
    const tipped = panelWingGeometry({ ...base, tip: { extension: 0.1, peak: 0.4 } })
    expect(tipped.area - plain.area).toBeCloseTo(2 * (Math.PI / 4) * 0.1 * 0.2, 3)
    expect(tipped.span).toBeCloseTo(plain.span + 0.2, 12)
  })

  it('reaches furthest at the chosen point along the chord', () => {
    const { tip } = flatPanels({ ...base, tip: { extension: 0.1, peak: 0.25 } })
    expect(tip.peak.s).toBeCloseTo(0.6, 12)
    expect(tip.peak.x).toBeCloseTo(0.05, 12)
  })

  it('takes the tip panel dihedral', () => {
    const g = panelWingGeometry({ rootChord: 0.2, panels: [rect({ dihedral: 60 })], tip: { extension: 0.1, peak: 0.5 } })
    expect(g.span).toBeCloseTo(2 * (0.25 + 0.05), 12)
  })
})

describe('key points', () => {
  it('names panel corners, stations and the tip by stable ids', () => {
    const ids = keyPoints({
      rootChord: 0.2,
      fuselageWidth: 0.1,
      panels: [rect({ id: 7, stations: [{ id: 2, d: 0.2, chord: 0.2, le: 0 }] })],
      tip: { extension: 0.05, peak: 0.4 },
    }).map((p) => p.id)
    expect(ids).toEqual(expect.arrayContaining(['c.le', 'c.te', 'f.le', 'f.te', 'p7.le', 'p7.te', 'p7.s2.le', 'p7.s2.te', 'tip']))
  })
})

describe('straight segments and straight lines', () => {
  it('draws a straight segment as a straight line and keeps the join smooth', () => {
    const f = pchip([0, 0.5, 1], [0, 0.1, 0.12], [true, false])
    expect(f(0.25)).toBeCloseTo(0.05, 12)
    // The curved segment leaves along the straight one's slope (0.2 per unit)
    const h = 1e-6
    expect((f(0.5 + h) - f(0.5)) / h).toBeCloseTo(0.2, 4)
  })

  it('makes a fully faceted panel whose area is the sum of trapezoids', () => {
    const stations = [
      { id: 1, d: 0.2, chord: 0.18, le: 0.01, straightIn: true },
      { id: 2, d: 0.4, chord: 0.12, le: 0.03, straightIn: true },
    ]
    const g = panelWingGeometry({ rootChord: 0.2, panels: [rect({ tipChord: 0.06, stations, straightToTip: true })] })
    const trap = 0.2 * (0.2 + 0.18) / 2 + 0.2 * (0.18 + 0.12) / 2 + 0.1 * (0.12 + 0.06) / 2
    expect(g.area).toBeCloseTo(2 * trap, 10)
  })

  it('keeps the leading edge straight when asked, using stations for chord only', () => {
    const w = {
      rootChord: 0.2,
      panels: [rect({ tipChord: 0.1, sweep: 0.05, straightLine: 0, stations: [{ id: 1, d: 0.25, chord: 0.19, le: 0.5 }] })],
    }
    const { panels } = flatPanels(w)
    const e = panels[0].edges
    // LE runs straight from 0 to the 0.05 sweep, ignoring the station's set-back
    expect(e.le(0.5)).toBeCloseTo(0.025, 12)
    expect(e.te(0.5) - e.le(0.5)).toBeCloseTo(0.19, 12)
  })

  it('keeps a quarter-chord line straight', () => {
    const w = { rootChord: 0.2, panels: [rect({ tipChord: 0.1, straightLine: 0.25, stations: [{ id: 1, d: 0.25, chord: 0.19 }] })] }
    const e = flatPanels(w).panels[0].edges
    const q = (f) => e.le(f) + 0.25 * (e.te(f) - e.le(f))
    // Quarter-chord at root 0.05, at tip 0.025: linear between
    for (const f of [0.2, 0.5, 0.8]) expect(q(f)).toBeCloseTo(0.05 - 0.025 * f, 12)
  })

  it('keeps the other edge straight when converting a one-edge curve to stations', () => {
    const w = { rootChord: 0.2, panels: [rect({ id: 1, tipChord: 0.1, te: { u: 0.5, d: 0.05 } })] }
    expect(setPanelMode(w, 0, 'stations')[0].straightLine).toBe(0)
  })

  it('splits a straight segment into two straight ones when adding a station', () => {
    const w = { rootChord: 0.2, panels: [rect({ tipChord: 0.1, stations: [], straightToTip: true })] }
    const before = panelWingGeometry(w).area
    const after = { ...w, panels: addStation(w, 0) }
    expect(after.panels[0].stations[0].straightIn).toBe(true)
    expect(panelWingGeometry(after).area).toBeCloseTo(before, 12)
  })
})

describe('inserting and reordering panels', () => {
  const two = () => [rect({ id: 1, length: 0.5, tipChord: 0.18, sweep: 0.05 }), rect({ id: 2, length: 0.2, tipChord: 0.1 })]

  it('inserts a constant-chord panel that leaves the outer panels unchanged', () => {
    const out = insertPanel(two(), 0, 0.2)
    expect(out.map((p) => p.id)).toEqual([1, 3, 2])
    expect(out[1].tipChord).toBe(0.18)
    expect(out[1].sweep).toBeCloseTo((0.05 / 0.5) * out[1].length, 12)
    const base = panelWingGeometry({ rootChord: 0.2, panels: two() })
    const g = panelWingGeometry({ rootChord: 0.2, panels: out })
    expect(g.area - base.area).toBeCloseTo(2 * out[1].length * 0.18, 10)
  })

  it('inserts at the root with the root chord', () => {
    const out = insertPanel(two(), -1, 0.2)
    expect(out[0].tipChord).toBe(0.2)
    expect(out[0].sweep).toBe(0)
    expect(out).toHaveLength(3)
  })

  it('moves panels and ignores moves past the ends', () => {
    expect(movePanel(two(), 0, 1).map((p) => p.id)).toEqual([2, 1])
    expect(movePanel(two(), 0, -1).map((p) => p.id)).toEqual([1, 2])
    expect(movePanel(two(), 1, 1).map((p) => p.id)).toEqual([1, 2])
  })
})

describe('blank stations', () => {
  it('lists blank stations last, in the order they were added', () => {
    const order = stationOrder([
      { id: 3, d: null },
      { id: 1, d: 0.3 },
      { id: 4, d: null },
      { id: 2, d: 0.1 },
    ]).map((s) => s.id)
    expect(order).toEqual([2, 1, 3, 4])
  })

  it('adds a blank station at the end, and skips it quietly until filled in', () => {
    const panels = addBlankStation([rect({ id: 1, tipChord: 0.2, stations: [{ id: 1, d: 0.2, chord: 0.2, le: 0 }] })], 0)
    const st = panels[0].stations.at(-1)
    expect(st).toMatchObject({ id: 2, d: null, chord: null, le: null })
    const g = panelWingGeometry({ rootChord: 0.2, panels })
    expect(g.area).not.toBeNull()
    expect(g.ignoredStations).toEqual([expect.objectContaining({ id: 2, reason: 'incomplete' })])
  })

  it('takes a blank set-back from the line through its neighbours', () => {
    // Neighbours at set-back 0 (inner end), 0.04 (station at 0.25) and the 0.1 sweep at the tip
    const w = {
      rootChord: 0.2,
      panels: [
        rect({
          tipChord: 0.2,
          sweep: 0.1,
          stations: [
            { id: 1, d: 0.25, chord: 0.2, le: 0.04 },
            { id: 2, d: 0.4, chord: 0.2, le: null },
          ],
        }),
      ],
    }
    const e = flatPanels(w).panels[0].edges
    const le = e.le(0.8)
    expect(le).toBeGreaterThan(0.04)
    expect(le).toBeLessThan(0.1)
    expect(e.te(0.8) - le).toBeCloseTo(0.2, 12)
  })
})

describe('wing sampler', () => {
  it('takes a hair past the last panel as its end when there is no tip cap', () => {
    // A caller stepping to the tip can overshoot the end by a rounding error
    const wing = { fuselageWidth: 0.1, rootChord: 0.25, panels: [{ id: 1, length: 0.7, tipChord: 0.18, sweep: 0.02 }], tip: null }
    const sampler = wingSampler(wing, 0.12)
    const end = sampler.ends.at(-1).outer.s
    const at = sampler.at(end + 1e-13)
    expect(at).not.toBe(null)
    expect(at.c).toBeCloseTo(0.18, 9)
    expect(sampler.at(end + 1e-6)).toBe(null)
  })
})
