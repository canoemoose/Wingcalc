// Two-finger pinch bookkeeping (src/lib/pinch.js)
import { describe, it, expect } from 'vitest'
import { pinchTracker } from '../src/lib/pinch.js'

const touch = (pointerId, clientX, clientY) => ({ pointerId, pointerType: 'touch', clientX, clientY })

describe('pinch tracking', () => {
  it('starts on the second finger, and ignores the mouse and a pen', () => {
    const p = pinchTracker()
    expect(p.down({ pointerId: 1, pointerType: 'mouse', clientX: 0, clientY: 0 })).toBe(false)
    expect(p.down(touch(2, 100, 100))).toBe(false)
    expect(p.active()).toBe(false)
    expect(p.down(touch(3, 200, 100))).toBe(true)
    expect(p.active()).toBe(true)
  })

  it('gives the zoom since the last move, about the point between the fingers', () => {
    const p = pinchTracker()
    p.down(touch(1, 100, 100))
    p.down(touch(2, 200, 100))
    // The second finger moves out: twice as far apart, and the middle moves 50 px right
    const m = p.move(touch(2, 300, 100))
    expect(m.k).toBeCloseTo(2, 9)
    expect([m.x, m.y]).toEqual([200, 100])
    expect([m.dx, m.dy]).toEqual([50, 0])
    // Both fingers moving down together: a pan, no zoom
    p.move(touch(1, 100, 140))
    const n = p.move(touch(2, 300, 140))
    expect(n.k).toBeCloseTo(Math.hypot(200, 0) / Math.hypot(200, 40), 9)
    expect(n.dy).toBe(20)
  })

  it('stops when a finger lifts, and a third finger changes nothing', () => {
    const p = pinchTracker()
    p.down(touch(1, 0, 0))
    p.down(touch(2, 100, 0))
    expect(p.down(touch(3, 50, 50))).toBe(false)
    expect(p.move(touch(3, 60, 60))).toBe(null)
    expect(p.move(touch(2, 200, 0)).k).toBeCloseTo(2, 9)
    p.up(touch(2, 200, 0))
    expect(p.active()).toBe(false)
    expect(p.move(touch(1, 10, 0))).toBe(null)
    // A new second finger starts a new pinch from where the fingers are now
    expect(p.down(touch(4, 50, 0))).toBe(true)
    expect(p.move(touch(4, 90, 0)).k).toBeCloseTo(2, 9)
  })
})
