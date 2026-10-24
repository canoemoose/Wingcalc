import { describe, it, expect } from 'vitest'
import { defaultState, migrate } from '../src/lib/projects.js'
import { resolveAirfoil, airfoilPerformance } from '../src/lib/airfoils.js'
import { wingGeometry } from '../src/lib/calc.js'
import { wingSampler, projectedSampler, normalisePanels } from '../src/lib/wing.js'
import { analyseStructure, defaultStructure } from '../src/lib/structure.js'
import { polygonArea, buildParts } from '../src/lib/ribs.js'
import {
  resolveSurface,
  resolveSurfaces,
  bevelAngle,
  hingeTabs,
  crowState,
  addSurface,
  newSurface,
  surfaceOutline,
  defaultControls,
  hingeTabOutline,
} from '../src/lib/controlSurfaces.js'

// Two segments properly cross (touching at ends doesn't count)
function crosses(a, b, c, d) {
  const o = (p, q, r) => Math.sign((q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]))
  return o(a, b, c) * o(a, b, d) < 0 && o(c, d, a) * o(c, d, b) < 0
}
function selfIntersects(p) {
  const n = p.length
  for (let i = 0; i < n; i++)
    for (let j = i + 2; j < n; j++) {
      if (i === 0 && j === n - 1) continue
      if (crosses(p[i], p[(i + 1) % n], p[j], p[(j + 1) % n])) return true
    }
  return false
}
// The default wing (one 0.7 m panel, 250 to 180 mm chord) with an aileron on the outer part
// and a flap inboard
const PANEL = 1
const aileron = { ...newSurface('aileron', PANEL, 0.35, 0.65, 1) }
const flap = { ...newSurface('flap', PANEL, 0.05, 0.3, 2) }

function build({ surfaces = [aileron, flap], edit = () => {}, wingEdit = () => {} } = {}) {
  const s = defaultState()
  wingEdit(s.input)
  const st = defaultStructure()
  st.le.stock = 'custom'
  st.te.stock = 'custom'
  edit(st)
  const controls = { ...defaultControls(), surfaces }
  const airfoil = resolveAirfoil(s.airfoil)
  const g = wingGeometry({ ...s.input, mode: 'panels' })
  const planform = projectedSampler(wingSampler(s.input, airfoil.params.thickness))
  const perf = airfoilPerformance(airfoil, { mass: s.input.mass, area: g.projectedArea, chord: g.mac, wing: { planform, span: g.span, sweepCos: 1 } })
  const a = analyseStructure({ wing: s.input, airfoil, structure: st, mass: s.input.mass, spanwise: perf.spanwise, controls })
  return { a, st: a.structure }
}

describe('control surface placement', () => {
  const s = defaultState()
  const sampler = wingSampler(s.input, 0.12)

  it('runs a straight hinge line between the chord fractions at its ends', () => {
    const r = resolveSurface(sampler, { ...aileron, hingeIn: 0.7, hingeOut: 0.8 })
    expect(r.ok).toBe(true)
    expect(r.s0).toBeCloseTo(0.35, 9)
    expect(r.s1).toBeCloseTo(0.65, 9)
    const c0 = sampler.at(0.35).c
    const c1 = sampler.at(0.65).c
    expect(r.hingeX(0.35)).toBeCloseTo(0.7 * c0, 9)
    expect(r.hingeX(0.65)).toBeCloseTo(0.8 * c1, 9)
    // Straight: the middle is the mean of the ends
    expect(r.hingeX(0.5)).toBeCloseTo((0.7 * c0 + 0.8 * c1) / 2, 9)
    expect(r.hingeFraction(0.35)).toBeCloseTo(0.7, 9)
    expect(r.length).toBeCloseTo(Math.hypot(0.3, 0.8 * c1 - 0.7 * c0), 9)
  })

  it('places a surface on any panel, from that panel’s inner end', () => {
    const wing = { ...s.input, panels: normalisePanels([{ length: 0.4, tipChord: 0.22 }, { length: 0.3, tipChord: 0.15, sweep: 0.03, dihedral: 6 }]) }
    const sm = wingSampler(wing, 0.12)
    const r = resolveSurface(sm, newSurface('aileron', wing.panels[1].id, 0.05, 0.25))
    expect(r.ok).toBe(true)
    expect(r.panelIndex).toBe(1)
    expect(r.s0).toBeCloseTo(0.45, 9)
    expect(r.s1).toBeCloseTo(0.65, 9)
  })

  it('refuses surfaces it can’t place, and overlaps', () => {
    expect(resolveSurface(sampler, { ...aileron, panel: 99 }).problem).toBe('panel')
    expect(resolveSurface(sampler, { ...aileron, from: 0.5, to: 0.4 }).problem).toBe('span')
    expect(resolveSurface(sampler, { ...aileron, to: 0.8 }).problem).toBe('span')
    expect(resolveSurface(sampler, { ...aileron, hingeIn: 1.2 }).problem).toBe('hinge')
    const list = resolveSurfaces(sampler, [aileron, { ...flap, id: 3, from: 0.3, to: 0.4 }])
    // The flap starts first, so it's placed and the aileron overlapping it isn't
    expect(list.map((r) => [r.name, r.ok, r.problem ?? null])).toEqual([
      ['F1', true, null],
      ['A1', false, 'overlap'],
    ])
  })

  it('names surfaces by role, root outward', () => {
    const list = resolveSurfaces(sampler, [aileron, flap, { ...newSurface('aileron', PANEL, 0.66, 0.7, 3) }])
    expect(list.map((r) => r.name)).toEqual(['F1', 'A1', 'A2'])
    expect(list[1].label).toBe('Aileron A1')
  })

  it('draws a closed outline from the hinge line to the trailing edge', () => {
    const r = resolveSurface(sampler, aileron)
    const o = surfaceOutline(sampler, r)
    expect(selfIntersects(o)).toBe(false)
    // About a quarter of the chord deep over the surface's span
    const meanChord = (sampler.at(0.35).c + sampler.at(0.65).c) / 2
    expect(Math.abs(polygonArea(o))).toBeCloseTo(0.3 * 0.25 * meanChord, 6)
  })

  it('adds an aileron in the outer part of a free panel, then a flap inboard of it', () => {
    const one = addSurface(sampler, [], 0)
    expect(one.surfaces[0].role).toBe('aileron')
    expect(one.surfaces[0].from).toBeGreaterThan(0.2)
    expect(one.surfaces[0].to).toBeLessThanOrEqual(0.7)
    const two = addSurface(sampler, one.surfaces, 0)
    const f = two.surfaces.find((x) => x.id === two.id)
    expect(f.role).toBe('flap')
    expect(f.to).toBeLessThanOrEqual(one.surfaces[0].from)
    expect(resolveSurfaces(sampler, two.surfaces).every((r) => r.ok)).toBe(true)
  })
})

describe('control surface depth', () => {
  const s = defaultState()
  const sampler = wingSampler(s.input, 0.12)
  // The trailing edge is depth + gap/2 behind the hinge at each end, so the surface is the same
  // depth in metres from root to tip, whatever the taper
  const depthAt = (r, s, f) => {
    const w = sampler.at(s)
    return (1 - f) * w.c - r.gap / 2
  }

  it('holds the same depth in metres at both ends of a tapered panel', () => {
    const surf = { ...aileron, depth: 0.02, hingeIn: 0.5, hingeOut: 0.5 }
    const r = resolveSurface(sampler, surf)
    expect(r.ok).toBe(true)
    expect(sampler.at(r.s0).c).not.toBeCloseTo(sampler.at(r.s1).c, 3)
    expect(depthAt({ ...r, gap: surf.gap }, r.s0, r.hingeIn)).toBeCloseTo(0.02, 9)
    expect(depthAt({ ...r, gap: surf.gap }, r.s1, r.hingeOut)).toBeCloseTo(0.02, 9)
  })

  it('keeps the hinge parallel when the outer end moves', () => {
    const r = resolveSurface(sampler, { ...aileron, depth: 0.02, to: 0.5 })
    expect(r.ok).toBe(true)
    expect(r.s1).toBeCloseTo(0.5, 9)
    expect(depthAt({ ...r, gap: 0.001 }, r.s1, r.hingeOut)).toBeCloseTo(0.02, 9)
    expect(depthAt({ ...r, gap: 0.001 }, r.s0, r.hingeIn)).toBeCloseTo(0.02, 9)
  })

  it('uses the saved hinge fractions when there is no depth', () => {
    const r = resolveSurface(sampler, { ...aileron, depth: null, hingeIn: 0.7, hingeOut: 0.8 })
    expect(r.ok).toBe(true)
    expect(r.hingeIn).toBe(0.7)
    expect(r.hingeOut).toBe(0.8)
  })
})

describe('the hinge', () => {
  it('bevels the moving side by the throw, a little less for the gap', () => {
    // No gap: exactly the deflection
    expect(bevelAngle(20, 0, 0.005)).toBeCloseTo(20, 9)
    // A gap lets it be a touch shallower, more so on a thin section
    const thick = bevelAngle(20, 0.001, 0.008)
    const thin = bevelAngle(20, 0.001, 0.003)
    expect(thick).toBeLessThan(20)
    expect(thin).toBeLessThan(thick)
    // The face swung through 20° then just clears the fixed side's rear face, half the gap
    // ahead of the hinge
    const b = (thick * Math.PI) / 180
    const d = (20 * Math.PI) / 180
    const a = 0.0005
    const T = 0.008 / Math.cos(b)
    const x = (a + T * Math.sin(b)) * Math.cos(d) - T * Math.cos(b) * Math.sin(d)
    expect(x).toBeCloseTo(-a, 9)
    // Nothing to bevel with no throw, or a gap big enough on its own
    expect(bevelAngle(0, 0.001, 0.005)).toBe(0)
    expect(bevelAngle(5, 0.002, 0.004)).toBe(0)
  })

  it('spaces the tabs evenly, inset from the ends and no further apart than asked', () => {
    const tabs = hingeTabs(0.3, { spacing: 0.075, inset: 0.02, width: 0.012 })
    expect(tabs[0]).toBeCloseTo(0.02, 9)
    expect(tabs.at(-1)).toBeCloseTo(0.28, 9)
    expect(tabs).toHaveLength(5) // 260 mm in four gaps of 65 mm
    for (let i = 1; i < tabs.length; i++) expect(tabs[i] - tabs[i - 1]).toBeLessThanOrEqual(0.075 + 1e-9)
    expect(hingeTabs(0.06, { spacing: 0.075, inset: 0.02, width: 0.012 })).toHaveLength(2)
    expect(hingeTabs(0.03, { spacing: 0.075, inset: 0.02, width: 0.012 })).toEqual([0.015])
    expect(hingeTabs(0.008, { spacing: 0.075, inset: 0.02, width: 0.012 })).toEqual([])
  })
})

describe('crow', () => {
  it('needs separate ailerons and flaps, and no flaperons', () => {
    expect(crowState({ surfaces: [aileron] }).available).toBe(false)
    expect(crowState({ surfaces: [aileron] }).reason).toBe('missing')
    expect(crowState({ surfaces: [flap] }).available).toBe(false)
    expect(crowState({ surfaces: [aileron, flap, newSurface('flaperon', PANEL, 0, 0.04, 3)] }).reason).toBe('flaperon')
    expect(crowState({ surfaces: [newSurface('flaperon', PANEL, 0, 0.6, 3)] }).available).toBe(false)
    expect(crowState({ surfaces: [aileron, flap] }).available).toBe(true)
  })

  it('puts ailerons up and flaps down, within each surface’s own throw', () => {
    const c = crowState({ surfaces: [aileron, flap], crow: { enabled: true, aileronUp: 30, flapDown: 40 } })
    expect(c.enabled).toBe(true)
    const by = Object.fromEntries(c.deflections.map((d) => [d.role, d.deflection]))
    expect(by.aileron).toBe(-aileron.up) // 30 asked, the aileron only goes 20 up
    expect(by.flap).toBe(40)
    // Default deflections when the saved crow settings are missing
    const d = crowState({ surfaces: [aileron, flap] })
    expect(d.enabled).toBe(false)
    expect(d.deflections.find((x) => x.role === 'flap').deflection).toBe(defaultControls().crow.flapDown)
  })
})

describe('older saves', () => {
  it('migrate to a wing with no control surfaces and crow off', () => {
    const s = defaultState()
    delete s.input.controls
    delete s.input.structure.hinges
    const m = migrate(JSON.parse(JSON.stringify(s)))
    expect(m.input.controls).toEqual(defaultControls())
    expect(m.input.structure.hinges).toEqual(defaultStructure().hinges)
  })

  it('keep saved surfaces, and fill crow settings that are missing', () => {
    const s = defaultState()
    s.input.controls = { surfaces: [aileron] }
    const m = migrate(JSON.parse(JSON.stringify(s)))
    expect(m.input.controls.surfaces).toEqual([aileron])
    expect(m.input.controls.crow).toEqual(defaultControls().crow)
  })
})

describe('control surfaces in the structure', () => {
  it('puts a full rib at each end of each surface', () => {
    const { a } = build()
    for (const r of a.surfaces) {
      expect(r.ok, r.problem).toBe(true)
      for (const s of [r.s0, r.s1]) expect(a.ribs.some((rb) => Math.abs(rb.s - s) < 1e-9 && rb.kind !== 'normal')).toBe(true)
    }
  })

  it('lays out a hinge spar each side of the hinge line, the gap between them', () => {
    const { a, st } = build()
    const r = a.surfaces.find((x) => x.name === 'A1')
    const s = 0.5
    const k = Math.sqrt(1 + r.slope ** 2)
    expect(r.faces.fixedRear(s) - r.faces.fixedFront(s)).toBeCloseTo(st.hinges.fixedWidth * k, 9)
    expect(r.faces.apex(s) - r.faces.fixedRear(s)).toBeCloseTo(r.gap * k, 9)
    expect(r.faces.movingRear(s) - r.faces.apex(s)).toBeCloseTo(st.hinges.movingWidth * k, 9)
    expect((r.faces.fixedRear(s) + r.faces.apex(s)) / 2).toBeCloseTo(r.hingeX(s), 9)
    // The fixed spar runs between the end ribs' faces, the moving surface a gap inside them
    expect(r.fixed[0]).toBeCloseTo(r.s0 + st.ribs.thickness / 2, 9)
    expect(r.moving[0]).toBeCloseTo(r.fixed[0] + r.gap, 9)
    expect(r.moving[1]).toBeCloseTo(r.fixed[1] - r.gap, 9)
    // Tabs inside the moving surface, the end ones' nearer corners inset as asked (measured
    // along the hinge)
    expect(r.tabs.length).toBeGreaterThanOrEqual(2)
    const reach = st.hinges.tabWidth / 2 + (st.hinges.tabLength / 2) * Math.abs(r.slope)
    expect((r.tabs[0] - r.moving[0]) * k).toBeCloseTo(st.hinges.tabInset + reach, 9)
    expect((r.moving[1] - r.tabs.at(-1)) * k).toBeCloseTo(st.hinges.tabInset + reach, 9)
    expect(r.slot).toBeCloseTo((st.hinges.tabLength - r.gap) / 2, 9)
  })

  it('bevels the moving hinge spar from each throw', () => {
    const { a } = build({ surfaces: [{ ...aileron, up: 25, down: 10 }] })
    const sf = a.surfaces[0]
    // Down swings the bottom face forward, up the top: the 25° up throw bevels the top
    expect(sf.bevel.top).toBeGreaterThan(sf.bevel.bottom)
    // At least the full throw each side, more if the gap alone wouldn't clear it
    expect(sf.bevel.top).toBeCloseTo(Math.max(25, bevelAngle(25, sf.gap, sf.depth.moving / 2)), 9)
    expect(sf.bevel.bottom).toBeCloseTo(Math.max(10, bevelAngle(10, sf.gap, sf.depth.moving / 2)), 9)
  })

  it('refuses a hinge line in front of the main spar or behind the trailing edge stock, with a warning', () => {
    expect(build({ surfaces: [{ ...aileron, hingeIn: 0.3, hingeOut: 0.3 }] }).a.surfaces[0].problem).toBe('forward')
    const aft = build({ surfaces: [{ ...aileron, hingeIn: 0.97, hingeOut: 0.97 }] })
    expect(aft.a.surfaces[0].problem).toBe('aft')
    expect(aft.a.warnings.some((w) => w.message.startsWith("Aileron A1 isn't built"))).toBe(true)
    // Not built, so no ribs at its ends
    expect(aft.a.ribs.some((rb) => rb.kind === 'hard')).toBe(false)
  })

  it('warns when the tabs go deeper than a hinge spar is wide', () => {
    const { a } = build({ edit: (st) => (st.hinges.tabLength = 0.03) })
    expect(a.warnings.some((w) => /go 14\.5 mm into each hinge spar/.test(w.message))).toBe(true)
  })
})

describe('a surface cut from the trailing edge stock', () => {
  // The default wing with a custom trailing edge 15 mm deep (build's default)
  const stockSurface = () => {
    const s = defaultState()
    const sampler = wingSampler(s.input)
    const res = addSurface(sampler, [], 0, { depth: 0.015 })
    return res.surfaces
  }
  it('is added the trailing edge stock deep when given its width', () => {
    const [sf] = stockSurface()
    const s = defaultState()
    const r = resolveSurface(wingSampler(s.input), sf)
    const w0 = wingSampler(s.input).at(r.s0)
    // Hinge plus half the gap is 15 mm in from the trailing edge
    expect(w0.xl + w0.c - r.x0 - sf.gap / 2).toBeCloseTo(0.015, 6)
  })
  it('is built as the stock itself: no surface hinge spar or ribs, and the stock in the cut list', () => {
    const { a } = build({ surfaces: stockSurface() })
    const sf = a.surfaces[0]
    expect(sf.ok).toBe(true)
    expect(sf.stock).toBe(true)
    expect(sf.endRibs).toEqual([])
    const { parts, cutList } = buildParts(a, a.structure)
    expect(parts.some((p) => p.group === 'surfaces')).toBe(false)
    expect(cutList.some((c) => c.item === `Trailing edge stock as ${sf.label}`)).toBe(true)
    expect(cutList.some((c) => c.item.startsWith('Hinge spar, moving side'))).toBe(false)
  })
})

describe('hingeTabOutline', () => {
  it('lies square to a raked hinge line, centred on it', () => {
    const sf = { slope: 0.25, hingeX: (s) => 0.1 + 0.25 * s }
    const [p0, p1, p2, p3] = hingeTabOutline(sf, 0.4, 0.025, 0.015)
    const d = (a, b) => [b[0] - a[0], b[1] - a[1]]
    const along = d(p0, p1)
    const across = d(p1, p2)
    // Along the hinge: parallel to (1, slope), tab width long
    expect(along[1] / along[0]).toBeCloseTo(0.25, 9)
    expect(Math.hypot(...along)).toBeCloseTo(0.025, 9)
    // Across it: square to the hinge, tab length long
    expect(along[0] * across[0] + along[1] * across[1]).toBeCloseTo(0, 12)
    expect(Math.hypot(...across)).toBeCloseTo(0.015, 9)
    // Centred on the hinge at s
    const c = [(p0[0] + p2[0]) / 2, (p0[1] + p2[1]) / 2]
    expect(c[0]).toBeCloseTo(0.4, 12)
    expect(c[1]).toBeCloseTo(sf.hingeX(0.4), 12)
    expect(p3).toHaveLength(2)
  })
})

describe('hinge tabs on a raked hinge', () => {
  it('sets the end tabs’ nearer corners the inset in from the moving surface’s ends', () => {
    const raked = { ...aileron, hingeIn: 0.55, hingeOut: 0.8 }
    const { a, st } = build({ surfaces: [raked], edit: (x) => { x.hinges.tabInset = 0.005 } })
    const r = a.surfaces[0]
    expect(r.ok, r.problem).toBe(true)
    expect(Math.abs(r.slope)).toBeGreaterThan(0.03)
    const k = Math.hypot(1, r.slope)
    const ss = r.tabs.flatMap((s) => hingeTabOutline(r, s, st.hinges.tabWidth, st.hinges.tabLength).map(([cs]) => cs))
    // Along the hinge, the inset from each end to the nearest corner
    expect((Math.min(...ss) - r.moving[0]) * k).toBeCloseTo(0.005, 9)
    expect((r.moving[1] - Math.max(...ss)) * k).toBeCloseTo(0.005, 9)
  })
})
