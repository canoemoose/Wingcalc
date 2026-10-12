import { describe, it, expect } from 'vitest'
import { defaultState } from '../src/lib/projects.js'
import { resolveAirfoil, airfoilPerformance } from '../src/lib/airfoils.js'
import { wingGeometry } from '../src/lib/calc.js'
import { wingSampler, projectedSampler } from '../src/lib/wing.js'
import { analyseStructure, defaultStructure, sheetOutline } from '../src/lib/structure.js'
import { buildParts, bounds, polygonArea } from '../src/lib/ribs.js'
import {
  offsetContour,
  addDogbones,
  toDxf,
  parseDxf,
  partsDxf,
  planDxf,
  cutListCsv,
  defaultExportOptions,
  layoutParts,
  hatchLines,
  partEntities,
} from '../src/lib/dxf.js'
import { strokeText, textWidth } from '../src/lib/strokeFont.js'

const square = [
  [0, 0],
  [10, 0],
  [10, 10],
  [0, 10],
]
// A 20 × 10 block with a 6 wide, 3 deep notch in the top, anticlockwise
const notched = [
  [0, 0],
  [20, 0],
  [20, 10],
  [13, 10],
  [13, 7],
  [7, 7],
  [7, 10],
  [0, 10],
]

describe('contour offsets', () => {
  it('grows and shrinks a square either way round', () => {
    for (const pts of [square, [...square].reverse()]) {
      const b = bounds(offsetContour(pts, 1))
      expect(b.w).toBeCloseTo(12, 9)
      expect(b.h).toBeCloseTo(12, 9)
      expect(bounds(offsetContour(pts, -1)).w).toBeCloseTo(8, 9)
    }
  })

  it('narrows a notch when the outline grows, as a laser kerf needs', () => {
    const out = offsetContour(notched, 0.1)
    const walls = out.filter(([, y]) => y > 7 && y < 9.5).map(([x]) => x)
    expect(Math.min(...walls.filter((x) => x > 10))).toBeCloseTo(12.9, 9)
    expect(Math.max(...walls.filter((x) => x < 10))).toBeCloseTo(7.1, 9)
  })
})

describe('dogbones', () => {
  it('overcuts the two inside corners of a notch, through the corner point', () => {
    const { pts, added } = addDogbones(notched, 1.5, false)
    expect(added).toBe(2)
    for (const corner of [
      [13, 7],
      [7, 7],
    ]) {
      const nearest = Math.min(...pts.map(([x, y]) => Math.hypot(x - corner[0], y - corner[1])))
      expect(nearest).toBeLessThan(0.2)
      // The overcut reaches past the notch floor into the part
      expect(Math.min(...pts.filter(([x]) => Math.abs(x - corner[0]) < 2).map(([, y]) => y))).toBeLessThan(7)
    }
    // Outside corners are left alone
    expect(pts).toContainEqual([0, 0])
    expect(pts).toContainEqual([20, 10])
  })

  it('overcuts every corner of a square hole, and skips corners too tight for the tool', () => {
    expect(addDogbones(square, 1, true).added).toBe(4)
    const tiny = addDogbones(
      [
        [0, 0],
        [2, 0],
        [2, 2],
        [0, 2],
      ],
      1.5,
      true,
    )
    expect(tiny.added).toBe(0)
    expect(tiny.skipped).toBe(4)
  })
})

describe('DXF text', () => {
  it('round-trips polylines, lines and text', () => {
    const ents = [
      { type: 'poly', layer: 'cut', pts: square, closed: true },
      { type: 'poly', layer: 'etch', pts: [[1, 1], [2, 2]], closed: false },
      { type: 'text', layer: 'etch', x: 1, y: 2, h: 3, text: 'R1 2.5° × 3' },
    ]
    const dxf = toDxf(ents)
    const back = parseDxf(dxf)
    expect(back.version).toBe('AC1009')
    expect(back.layers).toEqual(['CUT', 'ENGRAVE'])
    expect(back.polylines[0]).toEqual({ layer: 'CUT', closed: true, pts: square })
    expect(back.polylines[1].closed).toBe(false)
    expect(back.texts[0]).toMatchObject({ layer: 'ENGRAVE', x: 1, y: 2, h: 3, text: 'R1 2.5 deg x 3' })
    // Plain ASCII throughout, CRLF line ends
    expect(/^[\x20-\x7e\r\n]*$/.test(dxf)).toBe(true)
    const lines = parseDxf(toDxf(ents, { format: 'lines', layerNames: { cut: 'Cut-red', etch: 'E', guide: 'G' } }))
    expect(lines.lines.filter((l) => l.layer === 'Cut-red')).toHaveLength(4)
    expect(lines.polylines).toHaveLength(0)
  })

  it('draws stroke labels at the height asked', () => {
    const strokes = strokeText('R12', 0, 0, 5)
    const b = bounds(strokes.flat())
    expect(b.h).toBeCloseTo(5, 9)
    expect(b.w).toBeLessThanOrEqual(textWidth('R12', 5) + 1e-9)
  })
})

describe('wing export', () => {
  const s = defaultState()
  const st = defaultStructure()
  // Fixed edge widths, so the geometry checks below have known numbers
  st.le.stock = 'custom'
  st.te.stock = 'custom'
  st.gussets.te = true
  const airfoil = resolveAirfoil(s.airfoil)
  const g = wingGeometry({ ...s.input, mode: 'panels' })
  const planform = projectedSampler(wingSampler(s.input, airfoil.params.thickness))
  const perf = airfoilPerformance(airfoil, { mass: s.input.mass, area: g.projectedArea, chord: g.mac, wing: { planform, span: g.span, sweepCos: 1 } })
  const a = analyseStructure({ wing: s.input, airfoil, structure: st, mass: s.input.mass, spanwise: perf.spanwise })
  const { parts, cutList } = buildParts(a, st)

  it('cuts every part, one copy per piece, at true size plus the kerf', () => {
    const opts = defaultExportOptions()
    const [file] = partsDxf(parts, opts)
    const back = parseDxf(file.text)
    const cut = back.polylines.filter((p) => p.layer === 'CUT')
    const chosen = parts.filter((p) => opts.parts[p.group])
    const expected = chosen.reduce((n, p) => n + p.qty * (1 + p.holes.length), 0)
    expect(cut).toHaveLength(expected)
    // R1 is the centre rib, cut once: 229 mm long (250 chord less 6 LE and 15 TE stock)
    const r1 = cut[0]
    expect(bounds(r1.pts).w).toBeCloseTo(229 + 0.15, 1)
    expect(back.polylines.some((p) => p.layer === 'ENGRAVE')).toBe(true)
    expect(back.polylines.some((p) => p.layer === 'GUIDE')).toBe(true)
  })

  it('labels a part on itself if the label fits, else in the waste just below it', () => {
    const opts = { ...defaultExportOptions(), kerf: 0 }
    const inside = (poly, [x, y]) => {
      let c = false
      for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
        const [xi, yi] = poly[i]
        const [xj, yj] = poly[j]
        if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c
      }
      return c
    }
    const gusset = parts.find((p) => p.group === 'gussets')
    const web = parts.find((p) => p.group === 'webs')
    for (const p of [gusset, web].filter(Boolean)) {
      const pe = partEntities(p, opts)
      const outline = pe.ents.find((e) => e.layer === 'cut').pts
      const label = pe.ents.filter((e) => e.layer === 'etch' && !p.etch.length)
      expect(label.length, p.name).toBeGreaterThan(0)
      const ob = bounds(outline)
      if (label[0].waste) {
        // Below the part, clear of it
        for (const e of label) for (const [, y] of e.pts) expect(y).toBeLessThan(ob.y0)
      } else {
        for (const e of label) for (const pt of e.pts) expect(inside(outline, pt), `${p.name} label`).toBe(true)
      }
    }
    // A 10 mm gusset can't take a legible label inside its triangle
    expect(partEntities(gusset, opts).ents.some((e) => e.waste)).toBe(true)
  })

  it('keeps each row within the sheet length', () => {
    const opts = { ...defaultExportOptions(), rowLength: 0.5 }
    const { groups } = layoutParts(parts, opts)
    for (const grp of groups) {
      const xs = grp.entities.filter((e) => e.type === 'poly').flatMap((e) => e.pts.map(([x]) => x))
      expect(Math.max(...xs)).toBeLessThanOrEqual(500 + 1)
    }
  })

  it('splits into one file per material and thickness', () => {
    const files = partsDxf(parts, { ...defaultExportOptions(), split: true })
    expect(files.length).toBeGreaterThan(1)
    expect(new Set(files.map((f) => f.name)).size).toBe(files.length)
  })

  it('adds dogbones for a router, so the cap notches still take square caps', () => {
    const firstCut = (opts) => parseDxf(partsDxf(parts, opts)[0].text).polylines.find((p) => p.layer === 'CUT')
    const laser = firstCut({ ...defaultExportOptions(), kerf: 0 })
    const router = firstCut({ ...defaultExportOptions(), machine: 'router', toolDiameter: 0.002 })
    expect(router.pts.length).toBeGreaterThan(laser.pts.length)
    expect(Math.abs(polygonArea(router.pts))).toBeLessThan(Math.abs(polygonArea(laser.pts)))
  })

  it('draws a plan with every rib, mirrored for a pair', () => {
    const one = parseDxf(planDxf(a, st, parts, { ...defaultExportOptions(), handedness: 'right' }).text)
    const pair = parseDxf(planDxf(a, st, parts, { ...defaultExportOptions(), handedness: 'pair' }).text)
    const ribs = parts.filter((p) => p.group === 'ribs').length
    expect(one.polylines.filter((p) => p.layer === 'RIBS')).toHaveLength(ribs)
    expect(pair.polylines.filter((p) => p.layer === 'RIBS')).toHaveLength(2 * ribs)
    const xs = one.polylines.filter((p) => p.layer === 'OUTLINE').flatMap((p) => p.pts.map(([x]) => x))
    expect(Math.min(...xs)).toBeCloseTo(0, 6)
    expect(Math.max(...xs)).toBeCloseTo(700, 0)
  })

  it('hatches the sheeted area on the plan, inside it, and nothing when open', () => {
    const plan = (s) => parseDxf(planDxf(a, s, parts, { ...defaultExportOptions(), handedness: 'right' }).text)
    const hatch = plan(st).polylines.filter((p) => p.layer === 'HATCH')
    expect(hatch.length).toBeGreaterThan(20)
    // Every hatch line ends on the D-box: between the LE stock and the spar's rear face
    const outline = sheetOutline(a, st)
    for (const p of hatch) for (const [x, y] of p.pts) expect(inside(outline.map(([s, c]) => [s * 1000, -c * 1000]), [x, y], 0.01)).toBe(true)
    const open = { ...st, covering: { ...st.covering, type: 'open' } }
    expect(plan(open).polylines.some((p) => p.layer === 'HATCH')).toBe(false)
  })

  it('clips hatch lines to a polygon at 45°, a step apart', () => {
    const lines = hatchLines([[0, 0], [1, 0], [1, 1], [0, 1]], 0.1)
    for (const [p, q] of lines) {
      expect(Math.abs(q[0] - p[0])).toBeCloseTo(Math.abs(q[1] - p[1]), 9)
      for (const [x, y] of [p, q]) expect(x >= -1e-9 && x <= 1 + 1e-9 && y >= -1e-9 && y <= 1 + 1e-9).toBe(true)
    }
    // Total hatched length ≈ area / step
    const total = lines.reduce((n, [p, q]) => n + Math.hypot(q[0] - p[0], q[1] - p[1]), 0)
    expect(total).toBeCloseTo(10, 0)
  })

  it('lists every part and strip in the cut list', () => {
    const csv = cutListCsv(parts, cutList)
    const rows = csv.trim().split('\r\n')
    expect(rows).toHaveLength(1 + parts.length + cutList.length)
    expect(rows[0]).toBe('Item,Quantity,Material,Size (mm),Length (mm),Notes')
    expect(csv).toContain('Spar caps, panel 1')
  })
})

// Point in polygon, or within tol of its boundary
function inside(poly, [x, y], tol) {
  let c = false
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i]
    const [xj, yj] = poly[j]
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c
    const dx = xj - xi
    const dy = yj - yi
    const t = Math.max(0, Math.min(1, ((x - xi) * dx + (y - yi) * dy) / (dx * dx + dy * dy || 1)))
    if (Math.hypot(x - xi - t * dx, y - yi - t * dy) <= tol) return true
  }
  return c
}
