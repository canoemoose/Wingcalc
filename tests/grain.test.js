import { describe, it, expect } from 'vitest'
import { partEntities, defaultExportOptions } from '../src/lib/dxf.js'
import { bounds } from '../src/lib/ribs.js'

// Export options with no labels and no kerf, so the cut outline is the part outline in mm
const opts = { ...defaultExportOptions(), labels: false, kerf: 0 }

const cutOf = (res) => res.ents.find((e) => e.layer === 'cut').pts

describe('grain direction on the sheet', () => {
  it('turns a shear web so its height runs along sheet x', () => {
    // 300 mm long, 100 mm high at the root, 50 mm at the tip (part coordinates: u along span, y is height)
    const web = {
      name: 'Shear web',
      group: 'webs',
      grainAngle: Math.PI / 2,
      outline: [
        [0, 0],
        [0.3, 0],
        [0.3, 0.05],
        [0, 0.1],
      ],
      holes: [],
      etch: [],
    }
    const res = partEntities(web, opts)
    const b = bounds(cutOf(res))
    // Height (100 mm, the taller edge) now runs along x; length (300 mm) runs along y
    expect(b.w).toBeCloseTo(100, 6)
    expect(b.h).toBeCloseTo(300, 6)
    expect(res.w).toBeCloseTo(100, 6)
    expect(res.h).toBeCloseTo(300, 6)
  })

  it('turns a corner gusset so its hypotenuse is horizontal', () => {
    const g = 0.04
    const th = Math.PI / 3
    // Same construction as the gusset in ribs.js: legs of length g from the origin at angle th
    const gusset = {
      name: 'Corner gusset',
      group: 'gussets',
      grainAngle: Math.atan2(g * Math.sin(th), g * (Math.cos(th) - 1)),
      outline: [
        [0, 0],
        [g, 0],
        [g * Math.cos(th), g * Math.sin(th)],
      ],
      holes: [],
      etch: [],
    }
    const pts = cutOf(partEntities(gusset, opts))
    // Vertices 1 and 2 are the ends of the hypotenuse
    expect(pts[1][1]).toBeCloseTo(pts[2][1], 6)
    expect(Math.abs(pts[1][0] - pts[2][0])).toBeGreaterThan(1)
    // The hypotenuse length is preserved by the turn
    const len = Math.hypot(pts[1][0] - pts[2][0], pts[1][1] - pts[2][1])
    // Chord of the two legs: 2 g sin(th/2), in mm
    expect(len).toBeCloseTo(2 * g * Math.sin(th / 2) * 1000, 6)
  })

  it('leaves a part without a grain angle unturned', () => {
    const plate = {
      name: 'Plate',
      group: 'parts',
      outline: [
        [0, 0],
        [0.1, 0],
        [0.1, 0.05],
        [0, 0.05],
      ],
      holes: [],
      etch: [],
    }
    const res = partEntities(plate, opts)
    const b = bounds(cutOf(res))
    expect(b.w).toBeCloseTo(100, 6)
    expect(b.h).toBeCloseTo(50, 6)
  })
})
