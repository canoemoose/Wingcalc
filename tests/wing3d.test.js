import { describe, it, expect } from 'vitest'
import { defaultState } from '../src/lib/projects.js'
import { resolveAirfoil, airfoilPerformance } from '../src/lib/airfoils.js'
import { wingGeometry } from '../src/lib/calc.js'
import { wingSampler, projectedSampler, normalisePanels } from '../src/lib/wing.js'
import { analyseStructure, defaultStructure } from '../src/lib/structure.js'
import { buildParts } from '../src/lib/ribs.js'
import { wing3d, worldPoint, applyMatrix, loft, stringerBox, sparBoxes, webBoxes, insetHeight } from '../src/lib/wing3d.js'

function build(edit = () => {}, wingEdit = () => {}) {
  const s = defaultState()
  wingEdit(s.input)
  const st = defaultStructure()
  edit(st)
  const airfoil = resolveAirfoil(s.airfoil)
  const g = wingGeometry({ ...s.input, mode: 'panels' })
  const planform = projectedSampler(wingSampler(s.input, airfoil.params.thickness))
  const perf = airfoilPerformance(airfoil, { mass: s.input.mass, area: g.projectedArea, chord: g.mac, wing: { planform, span: g.span, sweepCos: 1 } })
  const a = analyseStructure({ wing: s.input, airfoil, structure: st, mass: s.input.mass, spanwise: perf.spanwise })
  const { parts } = buildParts(a, st)
  return { a, st, parts, g, w: wing3d(a, st, parts) }
}

const swept = (input) => {
  input.panels = normalisePanels([
    { length: 0.5, tipChord: 0.18, sweep: 0.08, dihedral: 4, washout: 1.5 },
    { length: 0.25, tipChord: 0.1, sweep: 0.08, dihedral: 12, washout: 3 },
  ])
  input.tip = { extension: 0.04, peak: 0.4 }
}

describe('3D wing', () => {
  it('lofts rings into a closed mesh, with caps', () => {
    const ring = (z) => [
      [0, 0, z],
      [1, 0, z],
      [1, 1, z],
      [0, 1, z],
    ]
    const m = loft([ring(0), ring(1), ring(2)], { closed: true, caps: true })
    expect(m.positions.length).toBe((12 + 2) * 3)
    expect(m.indices.length).toBe(2 * 4 * 6 + 2 * 4 * 3)
    expect(Math.max(...m.indices)).toBeLessThan(m.positions.length / 3)
  })

  it('lifts a dihedral panel and spans the projected half wing', () => {
    const { w, g } = build(() => {}, swept)
    expect(w.bounds.max[0]).toBeCloseTo(g.span / 2, 3)
    expect(w.bounds.max[1]).toBeGreaterThan(0.25 * Math.sin((12 * Math.PI) / 180))
    for (const k of [0, 1, 2]) expect(Number.isFinite(w.bounds.min[k])).toBe(true)
  })

  it('places every rib on the wing: its outline lands where the lofted wing has that point', () => {
    for (const orientation of ['streamwise', 'perpendicular']) {
      const { a, w, parts } = build((st) => (st.ribs.orientation = orientation), swept)
      for (const rib of w.ribs) {
        const part = parts.find((p) => p.id === rib.id)
        const r = part.rib
        const ang = (r.angle * Math.PI) / 180
        // Mid-thickness, a few points along the rib's top edge
        for (const [u, z] of rib.outline.filter((_, i) => i % 25 === 0)) {
          const got = applyMatrix(rib.matrix, [u, z, rib.thickness / 2])
          const s = part.s + Math.sin(ang) * (u - r.sparU)
          const x = a.sparX(part.s) + Math.cos(ang) * (u - r.sparU)
          const tol = 1e-9
          const want = worldPoint(a, s, x, z)
          for (const k of [0, 1, 2]) expect(Math.abs(got[k] - want[k]), `${rib.name} ${orientation}`).toBeLessThan(tol + 1e-9)
        }
      }
    }
  })

  it('builds the spar, webs, edges and stringers, all with valid indices', () => {
    const { w } = build((st) => {
      st.spar.type = 'box'
      st.stringers = [{ id: 1, position: 0.12, surface: 'both', width: 0.003, height: 0.003, material: 'balsa-hard' }]
    })
    const kinds = w.solids.map((s) => s.kind)
    expect(kinds.filter((k) => k === 'spar')).toHaveLength(2)
    // Two webs (front and rear) in every bay between ribs
    expect(kinds.filter((k) => k === 'web').length).toBe(2 * (w.ribs.length - 1))
    expect(kinds).toContain('le')
    expect(kinds).toContain('te')
    expect(kinds.filter((k) => k === 'stringer')).toHaveLength(2)
    for (const m of [w.skin, ...w.solids]) {
      expect(Math.max(...m.indices)).toBeLessThan(m.positions.length / 3)
      expect(m.positions.every(Number.isFinite)).toBe(true)
    }
  })

  it('stops a short tube where it ends', () => {
    const { w } = build((st) => {
      st.spar.type = 'tube'
      st.spar.tubeLength = 0.3
    })
    const tube = w.solids.find((s) => s.kind === 'spar')
    let maxX = 0
    for (let i = 0; i < tube.positions.length; i += 3) maxX = Math.max(maxX, tube.positions[i])
    expect(maxX).toBeCloseTo(0.3, 2)
  })

  it('seats each stringer in its notch at every rib, in the D-box and under cap strips', () => {
    const stringers = [
      { id: 1, position: 0.12, surface: 'both', width: 0.003, height: 0.003, material: 'balsa-hard' },
      { id: 2, position: 0.6, surface: 'both', width: 0.004, height: 0.002, material: 'balsa-hard' },
    ]
    for (const type of ['dbox', 'open']) {
      const { a, st, parts } = build((x) => {
        x.covering.type = type
        x.stringers = stringers
      })
      for (const p of parts.filter((q) => q.group === 'ribs')) {
        const r = p.rib
        const xOf = (u) => a.sparX(p.s) + (u - r.sparU) // streamwise: u runs with x
        for (const str of stringers) {
          for (const which of ['upper', 'lower']) {
            const box = stringerBox(a, st, str, p.s, which)
            const [x0, x1] = [box[0][0], box[1][0]]
            const floor = which === 'upper' ? box[0][1] : box[2][1]
            // The notch walls in the rib outline, at the stringer's sides
            const wall = (x) => p.outline.filter(([u]) => Math.abs(xOf(u) - x) < 1e-6).map(([, z]) => z)
            for (const x of [x0, x1]) {
              const zs = wall(x)
              expect(zs.length, `${p.name} ${type} ${str.id} ${which}`).toBeGreaterThanOrEqual(2)
              // The stringer's floor is one of the wall's points (the notch bottom)
              expect(Math.min(...zs.map((z) => Math.abs(z - floor))), `${p.name} ${type} ${str.id} ${which}`).toBeLessThan(0.0001)
            }
          }
        }
      }
    }
  })

  it('centres a tube between the same inset surfaces as the rib holes', () => {
    const { a, st, parts } = build((x) => {
      x.spar.type = 'tube'
      x.covering.type = 'open'
    })
    for (const p of parts.filter((q) => q.group === 'ribs')) {
      const hole = p.holes[0]
      const cz = hole.reduce((m, [, z]) => m + z, 0) / hole.length
      const ring = sparBoxes(a, st, p.s)[0]
      const tz = ring.reduce((m, [, h]) => m + h, 0) / ring.length
      expect(Math.abs(cz - tz), p.name).toBeLessThan(0.0001)
    }
  })

  // Every joint in the assembly, checked where each rib meets it: the rib's notch walls on the
  // spar's faces, its notch floors on the caps, its cut-backs on the edge stock, and the webs
  // filling the gap between the caps. Swept, polyhedral and twisted, both rib directions, D-box
  // and open. Everything meets to a micron, except one thing that can't: a rib square to a swept
  // spar has a flat notch floor in its own plane while the cap's top follows the surface along
  // the span, so they differ by a few hundredths of a millimetre across the notch.
  it('fits every part together where it meets a rib', () => {
    for (const type of ['dbox', 'open']) {
      for (const orientation of ['streamwise', 'perpendicular']) {
        const { a, st, parts } = build((x) => {
          x.covering.type = type
          x.ribs.orientation = orientation
        }, swept)
        const label = `${type} ${orientation}`
        for (const p of parts.filter((q) => q.group === 'ribs')) {
          const r = p.rib
          const ang = (r.angle * Math.PI) / 180
          const plan = (u) => [p.s + Math.sin(ang) * (u - r.sparU), a.sparX(p.s) + Math.cos(ang) * (u - r.sparU)]
          const floorTol = orientation === 'perpendicular' ? 5e-5 : 1e-6
          r.sparNotch.forEach((u, side) => {
            const [S, X] = plan(u)
            const [up, lo] = sparBoxes(a, st, S)
            const zs = p.outline.filter(([x]) => Math.abs(x - u) < 1e-9).map(([, z]) => z).sort((m, n) => n - m)
            expect(Math.abs(X - up[side][0]), `${p.name} ${label} cap wall`).toBeLessThan(1e-6)
            expect(Math.abs(zs[1] - up[0][1]), `${p.name} ${label} upper cap floor`).toBeLessThan(floorTol)
            expect(Math.abs(zs[2] - lo[2][1]), `${p.name} ${label} lower cap floor`).toBeLessThan(floorTol)
            const [web] = webBoxes(a, st, S)
            expect(web[0][1]).toBeCloseTo(lo[2][1], 9)
            expect(web[2][1]).toBeCloseTo(up[0][1], 9)
          })
          for (const [u, edge] of [
            [r.uA, (sec) => sec.xl + st.le.width],
            [r.uB, (sec) => sec.xl + sec.c - st.te.width],
          ]) {
            const [S, X] = plan(u)
            expect(Math.abs(X - edge(a.section(S))), `${p.name} ${label} edge stock`).toBeLessThan(1e-6)
          }
        }
      }
    }
  })

  it('cuts the shear webs to the gap between the caps at each rib', () => {
    const { a, st, parts } = build()
    const ribs = parts.filter((q) => q.group === 'ribs')
    for (const web of parts.filter((q) => q.group === 'webs')) {
      const i = Number(web.name.slice(1))
      const [, , [, hb], [, ha]] = web.outline
      for (const [rib, h] of [
        [ribs[i - 1], ha],
        [ribs[i], hb],
      ]) {
        const [up, lo] = sparBoxes(a, st, rib.s)
        expect(Math.abs(h - (up[0][1] - lo[2][1])), `${web.name} at ${rib.name}`).toBeLessThan(1e-6)
      }
    }
  })

  it('lays the D-box sheeting on the rib tops, and cap strips on the open part of each rib', () => {
    const { a, st, parts, w } = build((x) => (x.covering.type = 'dbox'), swept)
    expect(w.solids.filter((x) => x.kind === 'sheet')).toHaveLength(2)
    const ribs = parts.filter((q) => q.group === 'ribs')
    expect(w.capStrips).toHaveLength(2 * ribs.length) // top and bottom of every rib
    for (const p of ribs) {
      const r = p.rib
      const ang = (r.angle * Math.PI) / 180
      // Rib top edge ahead of the spar: where the sheeting's inner face is
      for (const [u, z] of p.outline.filter(([u, z]) => u > r.uA + 0.002 && u < r.sparNotch[0] - 0.002 && z > 0)) {
        const S = p.s + Math.sin(ang) * (u - r.sparU)
        const X = a.sparX(p.s) + Math.cos(ang) * (u - r.sparU)
        // The rib's outline comes from 120 sampled points, the sheeting from the exact surface
        expect(Math.abs(z - insetHeight(a, st, S, X, 'upper')), p.name).toBeLessThan(5e-5)
      }
      const strips = w.capStrips.filter((c) => c.id === `${p.id}-cs`)
      for (const c of strips) expect(Math.min(...c.outline.map(([u]) => u))).toBeCloseTo(r.sparNotch[1], 9)
    }
  })

  it('draws no sheeting on an open wing, and no cap strips when fully sheeted', () => {
    expect(build((x) => (x.covering.type = 'open')).w.solids.some((x) => x.kind === 'sheet')).toBe(false)
    expect(build((x) => (x.covering.type = 'sheeted')).w.capStrips).toHaveLength(0)
  })

  it('runs every spanwise part to the outer face of the end ribs, and keeps cap strips within them', () => {
    const xRange = (m) => {
      let lo = Infinity
      let hi = -Infinity
      for (let i = 0; i < m.positions.length; i += 3) {
        lo = Math.min(lo, m.positions[i])
        hi = Math.max(hi, m.positions[i])
      }
      return [lo, hi]
    }
    const stringers = [{ id: 1, position: 0.12, surface: 'upper', width: 0.003, height: 0.003, material: 'balsa-hard' }]
    // One piece, flat: from the centreline (the centre rib is shared) to the tip rib's outer face
    const one = build((x) => (x.stringers = stringers))
    const t = one.st.ribs.thickness
    for (const m of one.w.solids.filter((x) => x.kind !== 'web')) {
      const [lo, hi] = xRange(m)
      expect(lo, m.kind).toBeCloseTo(0, 6)
      expect(hi, m.kind).toBeCloseTo(0.7 + t / 2, 6)
    }
    // Two pieces with a fuselage: from the root rib's inboard face
    const two = build(
      (x) => {
        x.stringers = stringers
        x.ribs.rootJoint = 'two-piece'
      },
      (input) => (input.fuselageWidth = 0.1),
    )
    for (const m of two.w.solids.filter((x) => x.kind !== 'web')) expect(xRange(m)[0], m.kind).toBeCloseTo(0.05 - t / 2, 6)
    // Cap strips: none beyond the tip rib or across the centreline
    for (const res of [one, two]) {
      for (const c of res.w.capStrips) {
        const xs = [0, t].flatMap((w) => c.outline.map(([u, z]) => applyMatrix(c.matrix, [u, z, w])[0]))
        expect(Math.min(...xs)).toBeGreaterThan(-1e-6)
      }
      const tipX = res.w.bounds.max[0]
      for (const c of res.w.capStrips) {
        const xs = [0, c.thickness].flatMap((w) => c.outline.map(([u, z]) => applyMatrix(c.matrix, [u, z, w])[0]))
        expect(Math.max(...xs)).toBeLessThan(tipX + t / 2 + 1e-6)
      }
    }
  })

  it('closes a thin shell across its thickness, not across its hollow', () => {
    // A U-shaped shell section, 1 thick, swept along y
    const outer = [
      [0, 10],
      [0, 0],
      [10, 0],
      [10, 10],
    ]
    const inner = [
      [9, 10],
      [9, 1],
      [1, 1],
      [1, 10],
    ]
    const ring = (y) => [...outer, ...inner].map(([x, z]) => [x, y, z])
    const m = loft([ring(0), ring(1)], { closed: true, caps: 'strip' })
    const sides = 8 * 2 * 3 // 8 sides between the two rings, two triangles each
    const capIdx = m.indices.slice(sides)
    for (let i = 0; i < capIdx.length; i += 3) {
      const c = [0, 2].map((k) => (m.positions[capIdx[i] * 3 + k] + m.positions[capIdx[i + 1] * 3 + k] + m.positions[capIdx[i + 2] * 3 + k]) / 3)
      // Every cap triangle's centre is in the shell's wall, never in the hollow
      const inHollow = c[0] > 1 && c[0] < 9 && c[1] > 1
      expect(inHollow).toBe(false)
    }
  })
})
