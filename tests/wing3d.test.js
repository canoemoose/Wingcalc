import { describe, it, expect } from 'vitest'
import { defaultState } from '../src/lib/projects.js'
import { resolveAirfoil, airfoilPerformance } from '../src/lib/airfoils.js'
import { wingGeometry } from '../src/lib/calc.js'
import { wingSampler, projectedSampler, normalisePanels } from '../src/lib/wing.js'
import { analyseStructure, defaultStructure } from '../src/lib/structure.js'
import { buildParts } from '../src/lib/ribs.js'
import { wing3d, worldPoint, applyMatrix, loft, stringerBox, sparBoxes, webBoxes, insetHeight, sectionAt, spanPlane, tubeBore, gussetPrisms, gussetFit, bracePlates } from '../src/lib/wing3d.js'

function build(edit = () => {}, wingEdit = () => {}) {
  const s = defaultState()
  wingEdit(s.input)
  const st = defaultStructure()
  // Fixed edge widths, so the geometry checks below have known numbers
  st.le.stock = 'custom'
  st.te.stock = 'custom'
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

  it('cuts a section between ribs through everything there, in the plane square to the span', () => {
    const { a, st, parts } = build((x) => {
      x.covering.type = 'dbox'
      x.stringers = [{ id: 1, position: 0.12, surface: 'upper', width: 0.003, height: 0.003, material: 'balsa-hard' }]
    }, swept)
    const ribs = parts.filter((q) => q.group === 'ribs')
    // Mid-bay on the polyhedral outer panel
    const s = (ribs.at(-2).s + ribs.at(-1).s) / 2
    const cut = sectionAt(a, st, parts, s)
    const count = (k) => cut.pieces.filter((p) => p.kind === k).length
    expect(cut.inRib).toBe(false)
    expect([count('sheet'), count('le'), count('te'), count('spar'), count('web'), count('stringer')]).toEqual([2, 1, 1, 2, 1, 1])
    const { point, normal } = spanPlane(a, s)
    for (const pts of [...cut.pieces.map((p) => p.pts), cut.outline]) {
      for (const [x, h] of pts) {
        const q = worldPoint(a, s, x, h)
        const off = (q[0] - point[0]) * normal[0] + (q[1] - point[1]) * normal[1] + (q[2] - point[2]) * normal[2]
        expect(Math.abs(off)).toBeLessThan(1e-9)
      }
    }
    // Through a rib, there's no web (webs sit between ribs)
    expect(sectionAt(a, st, parts, ribs[3].s).pieces.some((p) => p.kind === 'web')).toBe(false)
  })

  it('puts the shear webs between the caps, flush with their faces', () => {
    for (const type of ['caps', 'box']) {
      const { a, st } = build((x) => (x.spar.type = type), swept)
      for (const s of [0.1, 0.4, 0.6]) {
        const [up, lo] = sparBoxes(a, st, s)
        const webs = webBoxes(a, st, s)
        expect(webs).toHaveLength(type === 'box' ? 2 : 1)
        const [capFront, capRear] = [up[0][0], up[1][0]]
        // Front web from the caps' front face back by the web thickness; on a swept spar both
        // are wider in x by the same factor, so it's the same fraction of the cap
        expect(webs[0][0][0]).toBeCloseTo(capFront, 9)
        const stretch = (capRear - capFront) / st.spar.capWidth
        expect(webs[0][1][0] - capFront).toBeCloseTo(st.spar.webThickness * stretch, 6)
        if (type === 'box') expect(webs[1][1][0]).toBeCloseTo(capRear, 9)
        // Between the caps, top to bottom
        for (const w of webs) {
          expect(w[0][1]).toBeCloseTo(lo[2][1], 9)
          expect(w[2][1]).toBeCloseTo(up[0][1], 9)
          expect(w[1][0]).toBeLessThanOrEqual(capRear + 1e-9)
        }
      }
    }
  })

  it('draws a tube spar hollow, and cuts it as a ring', () => {
    const { a, st, parts, w } = build((x) => {
      x.spar.type = 'tube'
      x.covering.type = 'open'
    })
    const bore = tubeBore(a, st, 0.2)
    const outer = sparBoxes(a, st, 0.2)[0]
    const radius = (ring) => {
      const cx = ring.reduce((m, p) => m + p[0], 0) / ring.length
      const ch = ring.reduce((m, p) => m + p[1], 0) / ring.length
      return Math.max(...ring.map(([x, h]) => Math.hypot(x - cx, h - ch)))
    }
    expect(radius(outer) - radius(bore)).toBeCloseTo(st.spar.tubeWall, 6)
    const tube = w.solids.find((x) => x.kind === 'spar')
    // Twice the vertices of a solid rod: an outer and an inner wall
    expect(tube.positions.length / 3).toBe(2 * 16 * (tube.positions.length / 3 / 32))
    const cut = sectionAt(a, st, parts, 0.2).pieces.find((p) => p.kind === 'spar')
    expect(cut.holes).toHaveLength(1)
  })

  it('draws the corner gussets the export cuts, on the right sides and layers', () => {
    const { a, st, parts } = build((x) => {
      x.gussets.te = true
      x.gussets.where = 'ends'
      x.gussets.sides = 'both'
      x.gussets.layer = 'both'
    })
    // A flat one-piece wing: the centre rib (both sides, shared by the halves) and the tip rib
    // (inboard side only). Top and bottom of each.
    const exported = parts.filter((p) => p.group === 'gussets').reduce((n, p) => n + p.qty, 0)
    expect(exported).toBe(2 * 2 + 1 * 2 * 2) // centre: 2 sides x 2 layers; tip: 1 side x 2 layers x 2 halves
    const drawn = gussetPrisms(a, st, parts)
    expect(drawn).toHaveLength(2 + 2) // this half: centre outboard x 2 layers, tip inboard x 2 layers
    expect(drawn.filter((g) => g.side < 0).every((g) => g.rib === parts.filter((p) => p.group === 'ribs').at(-1).id)).toBe(true)
  })

  it('keeps top gussets under the skin, against the rib face', () => {
    const { a, st, parts } = build((x) => {
      x.gussets.le = true
      x.gussets.te = true
      x.gussets.where = 'all'
      x.gussets.layer = 'top'
    })
    const ribs = parts.filter((p) => p.group === 'ribs')
    for (const gp of gussetPrisms(a, st, parts)) {
      const rib = ribs.find((r) => r.id === gp.rib)
      const pts = []
      for (let i = 0; i < gp.positions.length; i += 3) pts.push([gp.positions[i], gp.positions[i + 1], gp.positions[i + 2]])
      // Flat wing: X is s, Y is height, Z is x. The top face sits at or below the inset surface.
      for (const [X, Y, Z] of pts) expect(Y).toBeLessThanOrEqual(insetHeight(a, st, Math.min(a.tipS, Math.max(0, X)), Z, 'upper') + 1e-6)
      // One corner on the rib's face
      const face = rib.s + (gp.side * rib.thickness) / 2
      expect(Math.min(...pts.map(([X]) => Math.abs(X - face)))).toBeLessThan(1e-6)
    }
  })

  it('places LE and TE gussets independently, the TE following the LE until set', () => {
    const count = (edit) => {
      const { parts } = build((x) => {
        x.gussets.le = x.gussets.te = true
        x.gussets.layer = 'both'
        edit(x)
      })
      return parts.filter((p) => p.group === 'gussets').reduce((n, p) => n + p.qty, 0)
    }
    const both = count(() => {})
    const teTop = count((x) => (x.gussets.teLayer = 'top'))
    // Half as many at the TE once it's top only
    expect(teTop).toBe(both * 0.75)
  })

  it('checks the gussets fit the depth between the skins at each edge', () => {
    const fit = (t) => {
      const { a, st, parts } = build((x) => {
        x.gussets.le = x.gussets.te = true
        x.gussets.thickness = t
        x.gussets.layer = 'top'
      })
      return gussetFit(a, st, parts)
    }
    const { le, te } = fit(0.0015)
    // Deep at the LE, shallow at the TE
    expect(le.room).toBeGreaterThan(te.room)
    expect(le.fits.both).toBe(true)
    // A gusset between one and two TE depths thick: top or bottom, not both
    const mid = fit(te.room * 0.7).te
    expect(mid.fits).toEqual({ top: true, bottom: true, both: false })
    expect(mid.short).toEqual([])
    // Thicker than the room: none fits, and the ribs are named
    const thick = fit(te.room * 1.2).te
    expect(thick.fits.top).toBe(false)
    expect(thick.short.length).toBeGreaterThan(0)
  })

  it('draws each brace as two plates on the spar faces, the centre one in this half only', () => {
    const { a, st, parts } = build(() => {}, swept)
    const braces = parts.filter((p) => p.group === 'braces')
    const plates = bracePlates(a, st, parts)
    expect(plates).toHaveLength(2 * braces.length)
    const centre = plates.filter((p) => p.part === braces[0].id)
    for (const p of centre) {
      for (let i = 0; i < p.positions.length; i += 3) expect(p.positions[i]).toBeGreaterThan(-1e-9)
    }
  })

  // A one-piece wing with a fuselage: the first dihedral break is at the fuselage side, closer
  // to the centreline than a brace's reach. Used to throw building the 3D view.
  it('stops brace arms at the centreline and the tip rib', () => {
    const { a, st, parts, w } = build(
      () => {},
      (input) => {
        input.fuselageWidth = 0.1
        input.panels = normalisePanels([
          { length: 0.6, tipChord: 0.18, dihedral: 5 },
          { length: 0.05, tipChord: 0.15, dihedral: 15 },
        ])
      },
    )
    expect(w.solids.some((x) => x.kind === 'brace')).toBe(true)
    const braces = parts.filter((p) => p.group === 'braces')
    expect(braces).toHaveLength(2)
    // At the fuselage side: inner arm only as far as the centreline (50 mm), outer 80 mm
    expect(braces[0].at.inner).toBeCloseTo(0.05, 9)
    expect(braces[0].at.outer).toBeCloseTo(0.08, 9)
    // At the polyhedral break 50 mm from the tip: outer arm only to the tip rib
    expect(braces[1].at.outer).toBeCloseTo(0.05, 9)
    for (const p of bracePlates(a, st, parts)) {
      for (let i = 0; i < p.positions.length; i += 3) {
        expect(p.positions[i]).toBeGreaterThan(-1e-6)
        expect(Number.isFinite(p.positions[i + 1])).toBe(true)
      }
    }
  })

  it('draws a rounded tip as a block from the tip rib out to the end of the tip', () => {
    const { a, st, w } = build(
      () => {},
      (input) => (input.tip = { extension: 0.05, peak: 0.4 }),
    )
    const block = w.solids.find((x) => x.kind === 'tip')
    let lo = Infinity
    let hi = -Infinity
    for (let i = 0; i < block.positions.length; i += 3) {
      lo = Math.min(lo, block.positions[i])
      hi = Math.max(hi, block.positions[i])
    }
    expect(lo).toBeCloseTo(a.tipS + st.ribs.thickness / 2, 6)
    expect(hi).toBeCloseTo(0.75, 6)
    expect(build().w.solids.some((x) => x.kind === 'tip')).toBe(false)
  })

  it('builds the covering over a rounded tip from the same points as the tip block', () => {
    const { w } = build(
      () => {},
      (input) => (input.tip = { extension: 0.05, peak: 0.4 }),
    )
    const key = (x, y, z) => `${x.toFixed(6)},${y.toFixed(6)},${z.toFixed(6)}`
    const skinPts = new Set()
    for (let i = 0; i < w.skin.positions.length; i += 3) skinPts.add(key(w.skin.positions[i], w.skin.positions[i + 1], w.skin.positions[i + 2]))
    const block = w.solids.find((x) => x.kind === 'tip')
    // Every ring point of the block (not the fan centres of its end caps) is a covering point
    const ringPts = block.positions.length / 3 - 2
    let missing = 0
    for (let i = 0; i < ringPts * 3; i += 3) if (!skinPts.has(key(block.positions[i], block.positions[i + 1], block.positions[i + 2]))) missing++
    expect(missing).toBe(0)
  })
})
