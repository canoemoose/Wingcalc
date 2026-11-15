import { describe, it, expect } from 'vitest'
import {
  rotatedBounds, toRotated, fromRotated, wrapDeg, levelAngle, chordTilt, splitAngle, clampCrop, dragCrop,
  outputScale, markersOut, placeTrace, traceToDrawing, traceMatrix, renormalised,
} from '../src/lib/traceImage.js'
import { normalise, naca4Points, leIndex } from '../src/lib/sectionSpline.js'

const close = (a, b, d = 6) => {
  expect(a[0]).toBeCloseTo(b[0], d)
  expect(a[1]).toBeCloseTo(b[1], d)
}
const frameOf = (P) => {
  const le = P[leIndex(P)], a = P[0], b = P[P.length - 1]
  const mx = (a.x + b.x) / 2 - le.x, my = (a.y + b.y) / 2 - le.y, L = Math.hypot(mx, my)
  return { le, ux: mx / L, uy: my / L, L }
}

describe('trace image: rotating and cropping', () => {
  it('holds the turned picture in its bounds', () => {
    expect(rotatedBounds(400, 200, 0)).toEqual({ w: 400, h: 200 })
    const q = rotatedBounds(400, 200, 90)
    expect(q.w).toBeCloseTo(200, 9)
    expect(q.h).toBeCloseTo(400, 9)
    // Every corner lands inside the box at any angle
    for (const deg of [-170, -45, 12.5, 33, 90, 135]) {
      const b = rotatedBounds(400, 200, deg)
      for (const p of [[0, 0], [400, 0], [0, 200], [400, 200]]) {
        const [x, y] = toRotated(p, 400, 200, deg)
        expect(x).toBeGreaterThanOrEqual(-1e-9)
        expect(y).toBeGreaterThanOrEqual(-1e-9)
        expect(x).toBeLessThanOrEqual(b.w + 1e-9)
        expect(y).toBeLessThanOrEqual(b.h + 1e-9)
      }
    }
  })

  it('maps to the rotated frame and back', () => {
    for (const deg of [0, 7, -30, 90, 180]) close(fromRotated(toRotated([123, 45], 400, 200, deg), 400, 200, deg), [123, 45])
  })

  it('turns clockwise on screen for a positive angle', () => {
    // The top-right corner of a square goes to the bottom-right at a quarter turn
    close(toRotated([100, 0], 100, 100, 90), [100, 100])
  })

  it('levels the chord, whichever way the picture was turned', () => {
    for (const [le, te] of [[[10, 50], [300, 80]], [[300, 40], [20, 10]], [[50, 50], [60, 300]]]) {
      const deg = levelAngle(le, te)
      expect(chordTilt(le, te, 400, 400, deg)).toBeCloseTo(0, 9)
    }
    expect(wrapDeg(190)).toBeCloseTo(-170, 9)
    expect(wrapDeg(-180)).toBe(180)
  })

  it('splits an angle into a quarter turn and a fine part', () => {
    expect(splitAngle(97)).toEqual({ quarter: 90, fine: 7 })
    expect(splitAngle(-3.5).quarter).toBe(0)
    expect(splitAngle(-3.5).fine).toBeCloseTo(-3.5, 9)
    expect(splitAngle(-100).quarter).toBe(-90)
  })

  it('keeps the crop inside the picture and no smaller than the minimum', () => {
    expect(clampCrop({ x: -5, y: 190, w: 50, h: 50 }, 400, 200)).toEqual({ x: 0, y: 150, w: 50, h: 50 })
    const r = { x: 10, y: 10, w: 100, h: 100 }
    expect(dragCrop(r, 'nw', -20, -20, 400, 200)).toEqual({ x: 0, y: 0, w: 110, h: 110 })
    expect(dragCrop(r, 'e', -200, 0, 400, 200).w).toBe(8)
    expect(dragCrop(r, 'move', 1000, 0, 400, 200)).toEqual({ x: 300, y: 10, w: 100, h: 100 })
  })

  it('renders a large crop smaller, never a small one larger', () => {
    expect(outputScale({ w: 1200, h: 300 })).toBe(1)
    expect(outputScale({ w: 4800, h: 300 })).toBe(0.5)
  })
})

describe('trace image: placing it on the chord', () => {
  it('lands the leading and trailing edges on the drawing chord', () => {
    const P = naca4Points('2412')
    const f = frameOf(P)
    const place = placeTrace([100, 300], [900, 280], f)
    const a = traceToDrawing(place, [100, 300])
    const b = traceToDrawing(place, [900, 280])
    close([a.x, a.y], [f.le.x, f.le.y])
    close([b.x, b.y], [f.le.x + f.ux * f.L, f.le.y + f.uy * f.L])
    // Up in the picture is up in the drawing (y flips)
    expect(traceToDrawing(place, [500, 200]).y).toBeGreaterThan(traceToDrawing(place, [500, 400]).y)
  })

  it('gives a matrix that draws each pixel where traceToDrawing puts it, at any vertical scale', () => {
    const f = { le: { x: 0.02, y: -0.01 }, ux: Math.cos(0.1), uy: Math.sin(0.1), L: 0.9 }
    const place = placeTrace([40, 70], [640, 130], f)
    for (const view of [{ S: 600, ox: 80, oy: 250, ve: 1 }, { S: 1500, ox: -30, oy: 400, ve: 3 }]) {
      const [a, b, c, d, e, g] = traceMatrix(place, view)
      for (const p of [[40, 70], [640, 130], [300, 5], [12, 400]]) {
        const q = traceToDrawing(place, p)
        close([a * p[0] + c * p[1] + e, b * p[0] + d * p[1] + g], [view.ox + view.S * q.x, view.oy - view.S * view.ve * q.y])
      }
    }
  })

  it('finds the markers in the rendered crop', () => {
    const src = { w: 400, h: 200, deg: 0 }
    close(markersOut([110, 60], src, { x: 100, y: 50, w: 200, h: 100 }, 0.5), [5, 5])
  })

  it('moves with the section when it is normalised', () => {
    // A section turned, moved and scaled off the unit chord
    const t = 0.2, L = 1.7
    const P = naca4Points('2412').map((p) => ({ ...p, x: 0.3 + L * (p.x * Math.cos(t) - p.y * Math.sin(t)), y: -0.1 + L * (p.x * Math.sin(t) + p.y * Math.cos(t)) }))
    const place = placeTrace([10, 20], [510, 20], frameOf(P))
    const pixel = [260, 40]
    const before = traceToDrawing(place, pixel)
    const n = normalise(P)
    const after = traceToDrawing(renormalised(place, P[leIndex(P)], n), pixel)
    // The pixel's drawing position moves exactly as the outline's points do
    const le = P[leIndex(P)]
    const r = (n.angle * Math.PI) / 180
    const expectX = ((before.x - le.x) * Math.cos(r) + (before.y - le.y) * Math.sin(r)) / n.chord
    const expectY = (-(before.x - le.x) * Math.sin(r) + (before.y - le.y) * Math.cos(r)) / n.chord
    close([after.x, after.y], [expectX, expectY])
    // and the markers sit on the normalised chord, (0, 0) to (1, 0)
    const a = traceToDrawing(renormalised(place, le, n), [10, 20])
    const b = traceToDrawing(renormalised(place, le, n), [510, 20])
    close([a.x, a.y], [0, 0])
    close([b.x, b.y], [1, 0])
  })

  it('refuses markers on top of each other', () => {
    expect(placeTrace([5, 5], [5, 5], { le: { x: 0, y: 0 }, ux: 1, uy: 0, L: 1 })).toBeNull()
  })
})
