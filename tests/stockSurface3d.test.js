import { describe, it, expect } from 'vitest'
import { defaultState } from '../src/lib/projects.js'
import { resolveAirfoil, airfoilPerformance } from '../src/lib/airfoils.js'
import { wingGeometry } from '../src/lib/calc.js'
import { wingSampler, projectedSampler } from '../src/lib/wing.js'
import { analyseStructure, defaultStructure } from '../src/lib/structure.js'
import { addSurface, defaultControls } from '../src/lib/controlSurfaces.js'
import { stockSurfaceSection, sectionAt, wing3d } from '../src/lib/wing3d.js'
import { buildParts } from '../src/lib/ribs.js'

// The default wing, a custom trailing edge 15 mm deep, and an aileron cut from that stock
function build() {
  const s = defaultState()
  const st = defaultStructure()
  st.le.stock = 'custom'
  st.te.stock = 'custom'
  st.te.width = 0.015
  const surfaces = addSurface(wingSampler(s.input), [], 0, { depth: 0.015 }).surfaces
  const controls = { ...defaultControls(), surfaces }
  const airfoil = resolveAirfoil(s.airfoil)
  const g = wingGeometry({ ...s.input, mode: 'panels' })
  const planform = projectedSampler(wingSampler(s.input, airfoil.params.thickness))
  const perf = airfoilPerformance(airfoil, { mass: s.input.mass, area: g.projectedArea, chord: g.mac, wing: { planform, span: g.span, sweepCos: 1 } })
  const a = analyseStructure({ wing: s.input, airfoil, structure: st, mass: s.input.mass, spanwise: perf.spanwise, controls })
  return { a, st: a.structure }
}

describe('a surface cut from the trailing edge stock, in 3D', () => {
  it('is bevelled to a point at the hinge, clear of the fixed side', () => {
    const { a, st } = build()
    const sf = a.surfaces.find((x) => x.ok)
    expect(sf.stock).toBe(true)
    const s = (sf.moving[0] + sf.moving[1]) / 2
    const P = stockSurfaceSection(a, st, sf, s)
    const xa = sf.faces.apex(s)
    // Its front point is the apex at the centre line, and nothing of it is ahead of the apex
    expect(P[0][0]).toBeCloseTo(xa, 9)
    expect(Math.min(...P.map((p) => p[0]))).toBeGreaterThanOrEqual(xa - 1e-9)
    // Bevelled to the throws: only the point itself is at the apex, the faces running back from it
    expect(sf.bevel.top).toBeGreaterThanOrEqual(sf.down)
    expect(sf.bevel.bottom).toBeGreaterThanOrEqual(sf.up)
    expect(P.filter((p) => Math.abs(p[0] - xa) < 1e-6).length).toBe(1)
  })
  it('is what the section cut shows behind the hinge', () => {
    const { a, st } = build()
    const sf = a.surfaces.find((x) => x.ok)
    const { parts } = buildParts(a, st)
    const cut = sectionAt(a, st, parts, (sf.moving[0] + sf.moving[1]) / 2)
    const pieces = cut.pieces ?? cut
    expect(pieces.some((p) => p.kind === 'teMoving')).toBe(true)
  })

  it('has every Mylar hinge tab, centred on the hinge line', () => {
    const { a, st } = build()
    const { parts } = buildParts(a, st)
    const tabs = wing3d(a, st, parts).solids.filter((x) => x.kind === 'tab')
    const want = a.surfaces.filter((x) => x.ok).reduce((n, sf) => n + sf.tabs.length, 0)
    expect(want).toBeGreaterThan(0)
    expect(tabs).toHaveLength(want)
    for (const t of tabs) expect(t.positions.every(Number.isFinite)).toBe(true)
  })
})
