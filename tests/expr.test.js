import { describe, it, expect } from 'vitest'
import { evaluate, isExpression } from '../src/lib/expr.js'

describe('arithmetic in entry boxes', () => {
  it('reads plain numbers, with commas as thousands separators', () => {
    expect(evaluate('250')).toBe(250)
    expect(evaluate('1,250')).toBe(1250)
    expect(evaluate('.5')).toBe(0.5)
    expect(evaluate('-12.5')).toBe(-12.5)
  })

  it('follows the usual order of operations and brackets', () => {
    expect(evaluate('250 - 12')).toBe(238)
    expect(evaluate('2 + 3 * 4')).toBe(14)
    expect(evaluate('(2 + 3) * 4')).toBe(20)
    expect(evaluate('(120 + 80) / 2')).toBe(100)
    expect(evaluate('10 × 3 ÷ 4')).toBe(7.5)
    expect(evaluate('-(3 - 5)')).toBe(2)
  })

  it('converts numbers with their own unit to the box unit', () => {
    expect(evaluate('12in', { quantity: 'length', unit: 'mm' })).toBeCloseTo(304.8, 10)
    expect(evaluate('300mm + 2in', { quantity: 'length', unit: 'mm' })).toBeCloseTo(350.8, 10)
    expect(evaluate('1 ft', { quantity: 'length', unit: 'in' })).toBeCloseTo(12, 10)
    expect(evaluate('6"', { quantity: 'length', unit: 'mm' })).toBeCloseTo(152.4, 10)
    expect(evaluate('2lb', { quantity: 'mass', unit: 'g' })).toBeCloseTo(907.18474, 6)
    expect(evaluate('1 m²', { quantity: 'area', unit: 'dm2' })).toBeCloseTo(100, 10)
  })

  it('returns null for incomplete or invalid input, so the last good value stands', () => {
    for (const t of ['', '250 -', '(2 + 3', '2 ** 3', 'abc', '12 furlongs', '1/0']) {
      expect(evaluate(t, { quantity: 'length', unit: 'mm' }), t).toBeNull()
    }
    // A unit where the box has none
    expect(evaluate('12in')).toBeNull()
  })

  it('tells plain numbers from expressions', () => {
    expect(isExpression('250')).toBe(false)
    expect(isExpression('1,250.5')).toBe(false)
    expect(isExpression('250-12')).toBe(true)
    expect(isExpression('12in')).toBe(true)
  })
})
