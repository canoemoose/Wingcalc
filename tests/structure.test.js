import { describe, it, expect } from 'vitest'
import { defaultState } from '../src/lib/projects.js'
import { resolveAirfoil, airfoilPerformance } from '../src/lib/airfoils.js'
import { wingGeometry, G } from '../src/lib/calc.js'
import { wingSampler, projectedSampler, normalisePanels } from '../src/lib/wing.js'
import {
  defaultStructure,
  spanLoads,
  loadAt,
  sheetBuckling,
  sheetSpacing,
  spacedRibs,
  hardPoints,
  ribStations,
  bendingProps,
  analyseStructure,
  sparFraction,
  sparLine,
} from '../src/lib/structure.js'

// A synthetic lifting-line result with the same cl everywhere: on a constant-chord wing
// that gives a uniform spanwise load, whose shear and bending are textbook.
const uniformLL = { CLa: 1, CLb: 0, stations: [0, 0.25, 0.5, 0.75, 0.999].map((eta) => ({ eta, c: 0.2, cla: 1, clb: 0 })) }

const rectWing = { fuselageWidth: 0, rootChord: 0.2, panels: normalisePanels([{ length: 0.6, tipChord: 0.2, dihedral: 0 }]) }

describe('span loads', () => {
  it('gives a uniform load the textbook shear and bending', () => {
    const sampler = wingSampler(rectWing, 0.12)
    const { rows, halfLift } = spanLoads(sampler, uniformLL, 1, { mass: 2, n: 5 })
    expect(halfLift).toBeCloseTo((5 * 2 * G) / 2, 9)
    expect(loadAt(rows, 0, 'V')).toBeCloseTo(halfLift, 1)
    // Uniform load w over length L: M = w L² / 2 = (half lift) L / 2
    expect(loadAt(rows, 0, 'M')).toBeCloseTo((halfLift * 0.6) / 2, 1)
    expect(loadAt(rows, 0.6, 'M')).toBeCloseTo(0, 6)
    expect(loadAt(rows, 0.3, 'M')).toBeCloseTo((halfLift / 0.6) * 0.3 ** 2 / 2, 1)
  })
})

describe('sheet buckling', () => {
  it('finds the rib spacing that just carries a stress', () => {
    const E = 3.4e9
    const t = 0.0015
    const b = 0.08
    const sigma = 6e6
    const a = sheetSpacing(E, t, b, sigma)
    expect(a).toBeGreaterThan(0)
    expect(a).toBeLessThan(b)
    expect(sheetBuckling(E, t, b, a)).toBeCloseTo(sigma, -3)
  })

  it('needs no ribs to stabilise a sheet that holds at any spacing', () => {
    expect(sheetSpacing(3.4e9, 0.003, 0.03, 1e6)).toBe(Infinity)
  })
})

describe('rib spacing', () => {
  const ends = [
    { s: 0, kind: 'root' },
    { s: 0.5, kind: 'tip' },
  ]

  it('spaces evenly under a constant limit', () => {
    const ribs = spacedRibs(ends, () => 0.07)
    const bays = ribs.slice(1).map((r, i) => r.s - ribs[i].s)
    expect(ribs).toHaveLength(Math.ceil(0.5 / 0.07) + 1)
    for (const b of bays) {
      expect(b).toBeLessThanOrEqual(0.07 + 0.0005)
      expect(b).toBeCloseTo(0.5 / bays.length, 3)
    }
  })

  it('keeps every bay within the tightest limit along it, closer at the root', () => {
    const limit = (s) => 0.03 + 0.12 * s
    const ribs = spacedRibs(ends, limit)
    for (let i = 1; i < ribs.length; i++) {
      const a = ribs[i - 1].s
      const b = ribs[i].s
      let m = Infinity
      for (let k = 0; k <= 20; k++) m = Math.min(m, limit(a + ((b - a) * k) / 20))
      expect(b - a).toBeLessThanOrEqual(m + 0.0006) // positions rounded to 0.5 mm
    }
    expect(ribs[1].s - ribs[0].s).toBeLessThan(ribs.at(-1).s - ribs.at(-2).s)
  })

  it('puts ribs at the root, panel breaks, tip and hard points', () => {
    const wing = {
      fuselageWidth: 0.1,
      rootChord: 0.25,
      panels: normalisePanels([
        { length: 0.4, tipChord: 0.2, dihedral: 0 },
        { length: 0.2, tipChord: 0.12, dihedral: 10 },
      ]),
      tip: { extension: 0.04, peak: 0.4 },
    }
    const sampler = wingSampler(wing, 0.12)
    const st = defaultStructure()
    st.ribs.hardPoints = [{ id: 1, d: 0.3, label: 'Servo bay' }]
    const one = hardPoints(sampler, st).map((p) => [Math.round(p.s * 1000), p.kind])
    expect(one).toEqual([
      [0, 'root'],
      [50, 'break'],
      [300, 'hard'],
      [450, 'break'],
      [650, 'tip'],
    ])
    st.ribs.rootJoint = 'two-piece'
    const two = hardPoints(sampler, st).map((p) => Math.round(p.s * 1000))
    expect(two[0]).toBe(50)
    expect(two).toContain(350) // the hard point is measured from the root rib
  })

  it('uses manual positions as given, plus the hard points', () => {
    const sampler = wingSampler(rectWing, 0.12)
    const st = defaultStructure()
    st.ribs.spacing = 'manual'
    st.ribs.manual = [
      { id: 1, d: 0.1 },
      { id: 2, d: 0.25 },
      { id: 3, d: 0.9 }, // beyond the tip: ignored
    ]
    expect(ribStations(sampler, st).map((r) => Math.round(r.s * 1000))).toEqual([0, 100, 250, 600])
  })
})

describe('bending section', () => {
  it('puts the neutral axis midway between equal caps', () => {
    const E = 9e9
    const A = 18e-6
    const els = [
      { E, A, z: 0.012, I0: 0 },
      { E, A, z: -0.012, I0: 0 },
    ]
    const { zbar, EI } = bendingProps(els)
    expect(zbar).toBeCloseTo(0, 12)
    expect(EI).toBeCloseTo(2 * E * A * 0.012 ** 2, 6)
  })

  it('runs the spar line straight across each panel at its chord fraction', () => {
    const sampler = wingSampler(
      { fuselageWidth: 0, rootChord: 0.3, panels: normalisePanels([{ length: 0.5, tipChord: 0.1, sweep: 0.1, dihedral: 0 }]) },
      0.12,
    )
    const x = sparLine(sampler, 0.25)
    expect(x(0)).toBeCloseTo(0.075, 12)
    expect(x(0.5)).toBeCloseTo(0.1 + 0.025, 12)
    expect(x(0.25)).toBeCloseTo((0.075 + 0.125) / 2, 12)
  })

  it("puts the spar at the section's thickest point unless set", () => {
    const st = defaultStructure()
    expect(sparFraction(st, { thicknessPos: 0.3 })).toBe(0.3)
    st.spar.position = 0.25
    expect(sparFraction(st, { thicknessPos: 0.3 })).toBe(0.25)
  })
})

describe('structure analysis', () => {
  const s = defaultState()
  const airfoil = resolveAirfoil(s.airfoil)
  const g = wingGeometry({ ...s.input, mode: 'panels' })
  const planform = projectedSampler(wingSampler(s.input, airfoil.params.thickness))
  const perf = airfoilPerformance(airfoil, {
    mass: s.input.mass,
    area: g.projectedArea,
    chord: g.mac,
    wing: { planform, span: g.span, sweepCos: 1 },
  })
  const run = (edit = () => {}) => {
    const st = defaultStructure()
    edit(st)
    return analyseStructure({ wing: s.input, airfoil, structure: st, mass: s.input.mass, spanwise: perf.spanwise })
  }

  it('carries half the design lift at the root', () => {
    const r = run()
    expect(r.rootShear).toBeCloseTo((6 * s.input.mass * G) / 2, 0)
    // Root bending: the lift's centroid sits a little inboard of 42% of the semi-span
    // (4 / 3π for an elliptical load)
    const arm = r.rootMoment / r.rootShear / 0.7
    expect(arm).toBeGreaterThan(0.38)
    expect(arm).toBeLessThan(0.46)
  })

  it('finds a D-box stronger than an open structure with the same caps', () => {
    const dbox = run()
    const open = run((st) => (st.covering.type = 'open'))
    expect(dbox.summary.modes.compression.ms).toBeGreaterThan(open.summary.modes.compression.ms)
  })

  it('loses margin with thinner caps, and says so at the root', () => {
    const thick = run((st) => (st.covering.type = 'open'))
    const thin = run((st) => {
      st.covering.type = 'open'
      st.spar.capThickness = 0.0015
    })
    expect(thin.summary.modes.compression.ms).toBeLessThan(thick.summary.modes.compression.ms)
    expect(thin.summary.modes.compression.d).toBeCloseTo(0, 6)
  })

  it('suggests ribs that keep every bay within its buckling limit', () => {
    const r = run((st) => (st.covering.type = 'sheeted'))
    for (const row of r.stations) if (row.ms.spacing !== undefined) expect(row.ms.spacing).toBeGreaterThan(-0.02)
    expect(r.ribs[0].kind).toBe('root')
    expect(r.ribs.at(-1).kind).toBe('tip')
  })

  it('warns when the spar does not fit, or stops short', () => {
    expect(run((st) => (st.spar.capThickness = 0.02)).warnings.map((w) => w.id)).toContain('spar-fit')
    const tube = run((st) => {
      st.spar.type = 'tube'
      st.spar.tubeLength = 0.3
    })
    expect(tube.warnings.map((w) => w.id)).toContain('tube-short')
    expect(tube.stations.at(-1).spar).toBe('none')
  })

  it('spaces ribs from the loads so no spacing or web-buckling margin is negative', () => {
    for (const cov of ['open', 'dbox', 'sheeted']) {
      for (const type of ['caps', 'box', 'tube', 'solid']) {
        for (const g of [6, 12]) {
          const r = run((st) => {
            st.covering.type = cov
            st.spar.type = type
            st.loads.designG = g
            st.spar.webThickness = 0.0008
          })
          for (const row of r.stations) {
            for (const k of ['spacing', 'webBuckling']) if (row.ms[k] !== undefined) expect(row.ms[k], `${cov} ${type} ${g}g ${k}`).toBeGreaterThanOrEqual(0)
          }
        }
      }
    }
  })

  it('explains a strength shortfall that closer ribs cannot fix', () => {
    const r = run((st) => (st.covering.type = 'open'))
    const w = r.warnings.find((x) => x.id === 'short-compression')
    expect(r.summary.modes.compression.ms).toBeLessThan(0)
    expect(w.message).toContain("Closer ribs won't help")
    expect(w.message).toMatch(/thicker caps \(about \d+\.\d mm there\)/)
    // Plenty of strength: no such warning
    expect(run().warnings.some((x) => x.id.startsWith('short-'))).toBe(false)
  })
})
