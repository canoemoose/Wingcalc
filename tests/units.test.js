import { describe, it, expect } from 'vitest'
import { UNITS, SYSTEMS, toBase, fromBase, convert, format, inputValue, defaultUnit, otherSystem, normaliseUnits } from '../src/lib/units.js'

describe('unit conversions', () => {
  it('converts lengths', () => {
    expect(convert(1, 'length', 'in', 'mm')).toBeCloseTo(25.4, 10)
    expect(convert(1, 'length', 'ft', 'in')).toBeCloseTo(12, 10)
    expect(convert(1500, 'length', 'mm', 'm')).toBeCloseTo(1.5, 10)
  })

  it('converts areas', () => {
    expect(convert(1, 'area', 'ft2', 'in2')).toBeCloseTo(144, 8)
    expect(convert(1, 'area', 'm2', 'dm2')).toBeCloseTo(100, 10)
    expect(convert(1, 'area', 'dm2', 'in2')).toBeCloseTo(15.5000310001, 6)
  })

  it('converts masses', () => {
    expect(convert(1, 'mass', 'lb', 'oz')).toBeCloseTo(16, 10)
    expect(convert(1, 'mass', 'oz', 'g')).toBeCloseTo(28.349523125, 9)
    expect(convert(2.5, 'mass', 'kg', 'g')).toBeCloseTo(2500, 9)
  })

  it('converts wing loading between g/dm² and oz/ft²', () => {
    // 1 oz/ft² = 28.3495 g / 9.2903 dm² = 3.0515 g/dm²
    expect(convert(1, 'wingLoading', 'ozft2', 'gdm2')).toBeCloseTo(3.05152, 4)
    expect(convert(10, 'wingLoading', 'gdm2', 'kgm2')).toBeCloseTo(1, 10)
  })

  it('treats g/dm³ and oz/ft³ as nearly identical', () => {
    expect(convert(1, 'cubeLoading', 'ozft3', 'gdm3')).toBeCloseTo(1.001154, 5)
  })

  it('converts speeds', () => {
    expect(convert(36, 'speed', 'kmh', 'ms')).toBeCloseTo(10, 10)
    expect(convert(60, 'speed', 'mph', 'kmh')).toBeCloseTo(96.56064, 5)
  })

  it('round-trips every unit through the base unit', () => {
    for (const [q, units] of Object.entries(UNITS)) {
      for (const u of Object.keys(units)) {
        expect(fromBase(toBase(123.456, q, u), q, u)).toBeCloseTo(123.456, 9)
      }
    }
  })

  it('offers only defined units in each system', () => {
    for (const system of Object.values(SYSTEMS)) {
      for (const [q, list] of Object.entries(system)) {
        if (q === 'label') continue
        for (const u of list) expect(UNITS[q][u], `${q}.${u}`).toBeDefined()
      }
    }
    expect(defaultUnit('metric', 'mass')).toBe('g')
    expect(defaultUnit('imperial', 'speed')).toBe('mph')
    expect(otherSystem('metric')).toBe('imperial')
  })

  it("takes a project's units setting, areas following lengths and loading following weights", () => {
    const metres = { system: 'metric', length: 'm', mass: 'kg', speed: 'ms' }
    expect(['length', 'area', 'mass', 'wingLoading', 'speed', 'thin'].map((q) => defaultUnit(metres, q))).toEqual(['m', 'm2', 'kg', 'kgm2', 'ms', 'mm'])
    const feet = normaliseUnits({ system: 'imperial', length: 'ft', mass: 'lb' })
    expect(['length', 'area', 'mass', 'wingLoading', 'speed'].map((q) => defaultUnit(feet, q))).toEqual(['ft', 'ft2', 'lb', 'ozft2', 'mph'])
    expect(otherSystem(feet)).toBe('metric')
    expect(normaliseUnits('metric')).toEqual({ system: 'metric', length: 'mm', mass: 'g', speed: 'kmh' })
  })
})

describe('formatting', () => {
  it('formats with the unit label and UK separators', () => {
    expect(format(1.25, 'mass', 'g')).toBe('1,250 g')
    expect(format(0.30125, 'area', 'dm2')).toBe('30.13 dm²')
  })

  it('shows a dash for missing values', () => {
    expect(format(null, 'mass', 'g')).toBe('–')
    expect(format(NaN, 'mass', 'g')).toBe('–')
  })

  it('produces tidy input values', () => {
    expect(inputValue(1.4, 'mass', 'g')).toBe('1400')
    expect(inputValue(0.0254, 'length', 'in')).toBe('1')
    expect(inputValue(null, 'mass', 'g')).toBe('')
  })
})
