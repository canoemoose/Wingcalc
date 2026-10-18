// Edge stock turned to follow the camber: the ribs' faces are cut to its angle, and the 3D stock
// ends at the same face, so the two meet along a flat glue joint.
import { describe, it, expect } from 'vitest'
import { defaultState } from '../src/lib/projects.js'
import { resolveAirfoil, airfoilPerformance } from '../src/lib/airfoils.js'
import { wingGeometry } from '../src/lib/calc.js'
import { wingSampler, projectedSampler } from '../src/lib/wing.js'
import { analyseStructure, defaultStructure } from '../src/lib/structure.js'
import { buildParts, buildRib } from '../src/lib/ribs.js'
import { teSection, sheetSection } from '../src/lib/wing3d.js'

function build(fit) {
  const s = defaultState()
  const st = defaultStructure()
  st.te.fit = fit
  const airfoil = resolveAirfoil(s.airfoil)
  const g = wingGeometry({ ...s.input, mode: 'panels' })
  const planform = projectedSampler(wingSampler(s.input, airfoil.params.thickness))
  const perf = airfoilPerformance(airfoil, { mass: s.input.mass, area: g.projectedArea, chord: g.mac, wing: { planform, span: g.span, sweepCos: 1 } })
  const a = analyseStructure({ wing: s.input, airfoil, structure: st, mass: s.input.mass, spanwise: perf.spanwise })
  return { a, st: a.structure, ...buildParts(a, a.structure) }
}

// The rib's rear face: the edge of its outline that runs from the rearmost corner up (or down)
// to the other corner, as how far the top corner is behind the bottom one (lean) and its height
function rearFace(outline) {
  const n = outline.length
  const k = outline.reduce((b, p, i) => (p[0] > outline[b][0] ? i : b), 0)
  // Of the corner's two neighbours, the face is the one more above or below it than along
  const [prev, next] = [outline[(k - 1 + n) % n], outline[(k + 1) % n]]
  const p = outline[k]
  const steep = (q) => Math.abs(q[1] - p[1]) / (Math.abs(q[0] - p[0]) + 1e-12)
  const q = steep(prev) > steep(next) ? prev : next
  const [top, bottom] = p[1] > q[1] ? [p, q] : [q, p]
  return { lean: top[0] - bottom[0], height: top[1] - bottom[1] }
}

describe('edge stock turned to the camber', () => {
  const square = build('square')
  const turned = build('rotated')

  it('turns the trailing edge stock of the default wing', () => {
    expect(square.a.edges.te.angle).toBe(0)
    expect(Math.abs(turned.a.edges.te.angle)).toBeGreaterThan(0.01)
    expect(turned.st.te.face).toBeTruthy()
    expect(square.st.te.face).toBeNull()
  })

  it('cuts the trailing-edge face of the ribs to the angle of the stock', () => {
    const rb = (r) => buildRib(r.a, r.st, r.a.ribs[0])
    const sq = rearFace(rb(square).outline)
    const tu = rearFace(rb(turned).outline)
    // Square: the face is square to the chord
    expect(Math.abs(sq.lean)).toBeLessThan(1e-6)
    // Turned: it leans by the tangent of the stock's angle (a streamwise rib)
    expect(tu.height).toBeGreaterThan(0.0005)
    expect(Math.abs(tu.lean) / tu.height).toBeCloseTo(Math.tan(Math.abs(turned.a.edges.te.angle)), 2)
  })

  it('ends the 3D stock at the same leaning face', () => {
    const s = turned.a.rootS + 0.05
    const P = teSection(turned.a, turned.st, s)
    const n = P.length / 2
    const frontTop = P[0][0], frontBottom = P.at(-1)[0]
    expect(Math.abs(frontTop - frontBottom)).toBeGreaterThan(0.0003)
    const Q = teSection(square.a, square.st, s)
    expect(Math.abs(Q[0][0] - Q.at(-1)[0])).toBeLessThan(1e-9)
    expect(n).toBeGreaterThan(2)
  })
})

describe('capping and sheeting at a turned edge', () => {
  function buildWith(edit) {
    const s = defaultState()
    const st = defaultStructure()
    edit(st)
    const airfoil = resolveAirfoil(s.airfoil)
    const g = wingGeometry({ ...s.input, mode: 'panels' })
    const planform = projectedSampler(wingSampler(s.input, airfoil.params.thickness))
    const perf = airfoilPerformance(airfoil, { mass: s.input.mass, area: g.projectedArea, chord: g.mac, wing: { planform, span: g.span, sweepCos: 1 } })
    const a = analyseStructure({ wing: s.input, airfoil, structure: st, mass: s.input.mass, spanwise: perf.spanwise })
    return { a, st: a.structure }
  }
  // L345 turns on the default wing
  const turnLe = (st) => {
    st.le.stock = 'L345'
    st.le.fit = 'rotated'
  }

  it('starts the cap strips on each side where the turned leading-edge face meets that side', () => {
    const { a, st } = buildWith((st) => {
      turnLe(st)
      st.covering.type = 'open'
      st.covering.capStrips = true
    })
    expect(Math.abs(a.edges.le.angle)).toBeGreaterThan(0.01)
    const rb = buildRib(a, st, a.ribs[0])
    const c = a.section(a.ribs[0].s).c
    expect(rb.capStripFrom.top).toBeCloseTo(st.le.face.topXi * c, 3)
    expect(rb.capStripFrom.bottom).toBeCloseTo(st.le.face.bottomXi * c, 3)
    expect(Math.abs(rb.capStripFrom.top - rb.capStripFrom.bottom)).toBeGreaterThan(0.0005)
    // Each strip's end is cut along the leaning face: its outer and inner corners apart by about
    // its thickness times the tangent of the angle
    const t = st.covering.capStripThickness
    for (const side of ['top', 'bottom']) {
      const [o, i] = rb.capStripEnds[side].from
      expect(i).toBeCloseTo(rb.capStripFrom[side], 9)
      expect(Math.abs(o - i)).toBeCloseTo(t * Math.tan(Math.abs(a.edges.le.angle)), 4)
    }
  })

  it('brings D-box sheeting to the turned face on each side', () => {
    const { a, st } = buildWith((st) => {
      turnLe(st)
      st.covering.type = 'dbox'
    })
    const s = a.rootS
    const sec = a.section(s)
    const start = (P) => Math.min(...P.map(([x]) => x)) - sec.xl
    expect(start(sheetSection(a, st, s, 'upper'))).toBeCloseTo(st.le.face.topXi * sec.c, 4)
    expect(start(sheetSection(a, st, s, 'lower'))).toBeCloseTo(st.le.face.bottomXi * sec.c, 4)
  })

  it('ends the cap strips on each side where a turned trailing-edge face meets it', () => {
    const { a, st } = buildWith((st) => {
      st.te.fit = 'rotated'
      st.covering.type = 'open'
      st.covering.capStrips = true
    })
    const rb = buildRib(a, st, a.ribs[0])
    expect(Math.abs(rb.capStripTo.top - rb.capStripTo.bottom)).toBeGreaterThan(1e-5)
    // Each within the rib, near its end
    for (const k of ['top', 'bottom']) {
      expect(rb.capStripTo[k]).toBeLessThan(rb.uB + 0.003)
      expect(rb.capStripTo[k]).toBeGreaterThan(rb.uB - 0.003)
    }
  })
})
