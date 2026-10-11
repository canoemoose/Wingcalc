import { describe, it, expect } from 'vitest'
import {
  wingGeometry,
  wingLoading,
  cubeLoading,
  cubeBand,
  stallSpeed,
  reynolds,
  validate,
  panelAngle,
  CUBE_BANDS,
  G,
  RHO_SEA_LEVEL,
} from '../src/lib/calc.js'
import { convert } from '../src/lib/units.js'

describe('wing geometry', () => {
  it('derives area and MAC from root and tip chord', () => {
    const g = wingGeometry({ mode: 'chords', span: 1.4, rootChord: 0.25, tipChord: 0.18 })
    expect(g.area).toBeCloseTo(0.301, 10)
    expect(g.meanChord).toBeCloseTo(0.215, 10)
    // MAC = 2/3 cr (1 + λ + λ²)/(1 + λ), λ = 0.72
    expect(g.mac).toBeCloseTo(((2 / 3) * 0.25 * (1 + 0.72 + 0.72 * 0.72)) / 1.72, 10)
    expect(g.aspectRatio).toBeCloseTo(1.96 / 0.301, 10)
  })

  it('gives MAC equal to chord for a rectangular wing', () => {
    const g = wingGeometry({ mode: 'chords', span: 1.2, rootChord: 0.2, tipChord: 0.2 })
    expect(g.mac).toBeCloseTo(0.2, 12)
    expect(g.area).toBeCloseTo(0.24, 12)
  })

  it('accepts mean chord or area directly', () => {
    expect(wingGeometry({ mode: 'mean', span: 2, meanChord: 0.2 }).area).toBeCloseTo(0.4, 12)
    const g = wingGeometry({ mode: 'area', span: 2, area: 0.5 })
    expect(g.meanChord).toBeCloseTo(0.25, 12)
    expect(g.aspectRatio).toBeCloseTo(8, 12)
  })

  it('treats a single flat panel exactly like root and tip chord', () => {
    const a = wingGeometry({ mode: 'chords', span: 1.4, rootChord: 0.25, tipChord: 0.18 })
    const b = wingGeometry({ mode: 'panels', rootChord: 0.25, panels: [{ length: 0.7, tipChord: 0.18, dihedral: 0 }] })
    for (const k of ['span', 'area', 'projectedArea', 'mac', 'aspectRatio']) expect(b[k], k).toBeCloseTo(a[k], 12)
    expect(b.hasDihedral).toBe(false)
  })

  it('adds up panels with different chords', () => {
    // Constant 0.25 m centre panel (0.4 m each side), then tapering to 0.15 over 0.3 m
    const g = wingGeometry({
      mode: 'panels',
      rootChord: 0.25,
      panels: [
        { length: 0.4, tipChord: 0.25, dihedral: 0 },
        { length: 0.3, tipChord: 0.15, dihedral: 0 },
      ],
    })
    expect(g.span).toBeCloseTo(1.4, 12)
    expect(g.area).toBeCloseTo(2 * (0.4 * 0.25 + 0.3 * 0.2), 12)
    // MAC = ∫c² dy / ∫c dy over a half wing
    const c2 = 0.4 * 0.0625 + (0.3 * (0.0625 + 0.0375 + 0.0225)) / 3
    expect(g.mac).toBeCloseTo(c2 / (0.4 * 0.25 + 0.3 * 0.2), 12)
    expect(g.tipChord).toBe(0.15)
  })

  it('uses projected area and span for dihedral, flat area for loading', () => {
    const g = wingGeometry({ mode: 'panels', rootChord: 0.2, panels: [{ length: 0.75, tipChord: 0.2, dihedral: 10 }] })
    const cos = Math.cos((10 * Math.PI) / 180)
    expect(g.area).toBeCloseTo(0.3, 12)
    expect(g.projectedArea).toBeCloseTo(0.3 * cos, 12)
    expect(g.flatSpan).toBeCloseTo(1.5, 12)
    expect(g.span).toBeCloseTo(1.5 * cos, 12)
    expect(g.mac).toBeCloseTo(0.2, 12)
    expect(g.stations.at(-1).z).toBeCloseTo(0.75 * Math.sin((10 * Math.PI) / 180), 12)
    expect(g.hasDihedral).toBe(true)
  })

  it('handles polyhedral: flat centre, angled tips', () => {
    const g = wingGeometry({
      mode: 'panels',
      rootChord: 0.2,
      panels: [
        { length: 0.5, tipChord: 0.2, dihedral: 0 },
        { length: 0.5, tipChord: 0.2, dihedral: 60 },
      ],
    })
    // Tip panels project to half their length
    expect(g.span).toBeCloseTo(1.5, 12)
    expect(g.projectedArea).toBeCloseTo(0.3, 12)
    expect(g.area).toBeCloseTo(0.4, 12)
    expect(g.stations.map((s) => s.z)).toEqual([0, 0, expect.closeTo(0.5 * Math.sin(Math.PI / 3), 12)])
    // Constant chord: MAC sits at the middle of the projected half-span
    expect(g.macY).toBeCloseTo(0.375, 12)
  })

  it('places the MAC of a straight taper at the textbook spanwise station', () => {
    const g = wingGeometry({ mode: 'chords', span: 2, rootChord: 0.3, tipChord: 0.15 })
    // y = (b/6)(1 + 2λ)/(1 + λ)
    expect(g.macY).toBeCloseTo((2 / 6) * (2 / 1.5), 12)
  })

  it('accepts dihedral as the rise of the outer end', () => {
    // 0.5 m panel rising 0.25 m is 30°
    const byRise = wingGeometry({ mode: 'panels', rootChord: 0.2, panels: [{ length: 0.5, tipChord: 0.2, rise: 0.25 }] })
    const byAngle = wingGeometry({ mode: 'panels', rootChord: 0.2, panels: [{ length: 0.5, tipChord: 0.2, dihedral: 30 }] })
    for (const k of ['span', 'area', 'projectedArea', 'mac']) expect(byRise[k], k).toBeCloseTo(byAngle[k], 12)
    expect(byRise.stations.at(-1).z).toBeCloseTo(0.25, 12)
    expect(panelAngle({ length: 0.5, rise: -0.25 })).toBeCloseTo(-Math.PI / 6, 12)
  })

  it('mixes rise across polyhedral panels', () => {
    const g = wingGeometry({
      mode: 'panels',
      rootChord: 0.2,
      panels: [
        { length: 0.6, tipChord: 0.2, rise: 0.03 },
        { length: 0.3, tipChord: 0.15, rise: 0.06 },
      ],
    })
    // Tip height is the sum of the rises
    expect(g.stations.at(-1).z).toBeCloseTo(0.09, 12)
  })

  it('rejects a rise longer than the panel, and warns about it', () => {
    const panels = [{ length: 0.3, tipChord: 0.2, rise: 0.4 }]
    const g = wingGeometry({ mode: 'panels', rootChord: 0.2, panels })
    expect(g.area).toBeNull()
    expect(panelAngle(panels[0])).toBeNull()
    expect(validate({ mass: 1, geometry: g, panels }).map((w) => w.field)).toContain('panel-0-rise')
  })

  it('treats an empty rise box as incomplete rather than flat', () => {
    expect(wingGeometry({ mode: 'panels', rootChord: 0.2, panels: [{ length: 0.5, tipChord: 0.2, rise: null }] }).area).toBeNull()
  })

  it('rejects incomplete panels', () => {
    expect(wingGeometry({ mode: 'panels', rootChord: 0.2, panels: [{ length: 0, tipChord: 0.2, dihedral: 0 }] }).area).toBeNull()
    expect(wingGeometry({ mode: 'panels', rootChord: 0.2, panels: [] }).area).toBeNull()
  })

  it('returns nulls for incomplete input', () => {
    expect(wingGeometry({ mode: 'chords', span: 1.4, rootChord: null, tipChord: 0.1 }).area).toBeNull()
    expect(wingGeometry({ mode: 'area', span: 0, area: 0.3 }).area).toBeNull()
  })
})

describe('loading', () => {
  it('computes wing loading', () => {
    // 1.4 kg on 30.1 dm² = 46.5 g/dm²
    const wl = wingLoading(1.4, 0.301)
    expect(convert(wl, 'wingLoading', 'kgm2', 'gdm2')).toBeCloseTo(46.51, 2)
  })

  it('computes cube loading in g/dm³', () => {
    expect(cubeLoading(1.4, 0.301)).toBeCloseTo(1400 / Math.pow(30.1, 1.5), 8)
  })

  it('matches a hand-worked imperial cube loading', () => {
    // 48 oz on 3 ft² -> 48 / 3^1.5 = 9.24 oz/ft³
    const mass = convert(48, 'mass', 'oz', 'kg')
    const area = convert(3, 'area', 'ft2', 'm2')
    expect(convert(cubeLoading(mass, area), 'cubeLoading', 'gdm3', 'ozft3')).toBeCloseTo(9.2376, 3)
  })

  it('rejects missing or zero inputs', () => {
    expect(wingLoading(0, 0.3)).toBeNull()
    expect(cubeLoading(1, null)).toBeNull()
  })
})

describe('cube-loading bands', () => {
  const ozft3 = (v) => convert(v, 'cubeLoading', 'ozft3', 'gdm3')

  it('places values in the right band, lower bound inclusive', () => {
    expect(cubeBand(ozft3(2)).id).toBe('glider')
    expect(cubeBand(ozft3(4)).id).toBe('trainer')
    expect(cubeBand(ozft3(6.99)).id).toBe('trainer')
    expect(cubeBand(ozft3(8.5)).id).toBe('sport')
    expect(cubeBand(ozft3(11)).id).toBe('sportscale')
    expect(cubeBand(ozft3(14)).id).toBe('warbird')
    expect(cubeBand(ozft3(30)).id).toBe('racer')
    expect(cubeBand(null)).toBeNull()
  })

  it('has contiguous bands from zero to infinity', () => {
    expect(CUBE_BANDS[0].min).toBe(0)
    for (let i = 1; i < CUBE_BANDS.length; i++) expect(CUBE_BANDS[i].min).toBe(CUBE_BANDS[i - 1].max)
    expect(CUBE_BANDS.at(-1).max).toBe(Infinity)
  })
})

describe('stall speed', () => {
  it('follows V = sqrt(2mg / (rho S CL))', () => {
    const v = stallSpeed(1.4, 0.301, 1.1)
    expect(v).toBeCloseTo(Math.sqrt((2 * 1.4 * G) / (RHO_SEA_LEVEL * 0.301 * 1.1)), 12)
    expect(v).toBeCloseTo(8.228, 3)
  })

  it('scales with the square root of weight', () => {
    expect(stallSpeed(4, 0.3, 1) / stallSpeed(1, 0.3, 1)).toBeCloseTo(2, 12)
  })

  it('rejects impossible inputs', () => {
    expect(stallSpeed(1, 0.3, 0)).toBeNull()
    expect(stallSpeed(1, 0, 1)).toBeNull()
  })

  it('computes Reynolds number', () => {
    // 10 m/s, 0.2 m chord, sea level: about 137,000
    expect(reynolds(10, 0.2) / 1000).toBeCloseTo(136.92, 1)
  })
})

describe('validation', () => {
  const geom = (o) => wingGeometry({ mode: 'chords', span: 1.4, rootChord: 0.25, tipChord: 0.18, ...o })

  it('accepts a typical model', () => {
    expect(validate({ mass: 1.4, geometry: geom({}) })).toEqual([])
  })

  it('warns outside the 600 mm to 3 m span range', () => {
    const fields = (o, mass = 1) => validate({ mass, geometry: geom(o) }).map((w) => w.field)
    expect(fields({ span: 0.5 })).toContain('span')
    expect(fields({ span: 3.2, rootChord: 0.4, tipChord: 0.3 })).toContain('span')
    expect(fields({ span: 0.6, rootChord: 0.15, tipChord: 0.12 })).toEqual([])
    expect(fields({ span: 3.0, rootChord: 0.4, tipChord: 0.3 }, 5)).toEqual([])
  })

  it('warns about a tip chord bigger than the root', () => {
    expect(validate({ mass: 1, geometry: geom({ tipChord: 0.3 }) }).map((w) => w.field)).toContain('panel-0')
  })
})

describe('station warnings', () => {
  it('names the panel, the station and the reason', () => {
    const panels = [{ id: 1, length: 0.5, tipChord: 0.2, dihedral: 0, stations: [{ id: 9, d: 0.7, chord: 0.2, le: 0 }] }]
    const geometry = wingGeometry({ mode: 'panels', rootChord: 0.2, panels })
    expect(geometry.area).not.toBeNull()
    const w = validate({ mass: 1, geometry, panels })
    expect(w.map((x) => x.message)).toContain("Panel 1, station 1 is beyond the tip, so it's ignored.")
    expect(w.map((x) => x.field)).toContain('station-0-9')
  })
})

describe('blank station warnings', () => {
  it("doesn't warn about a station that just isn't filled in yet", () => {
    const panels = [{ id: 1, length: 0.5, tipChord: 0.2, dihedral: 0, stations: [{ id: 1, d: null, chord: null, le: null }] }]
    const geometry = wingGeometry({ mode: 'panels', rootChord: 0.2, panels })
    expect(validate({ mass: 1, geometry, panels })).toEqual([])
  })
})
