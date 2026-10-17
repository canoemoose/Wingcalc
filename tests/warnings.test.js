import { describe, it, expect } from 'vitest'
import { structureSection, bySection } from '../src/lib/warnings.js'

describe('where a structure warning is shown', () => {
  it('puts each warning beside the settings that fix it', () => {
    expect(structureSection('short-compression')).toBe('spar')
    expect(structureSection('short-compression', true)).toBe('foamcaps')
    expect(structureSection('short-sheet')).toBe('covering')
    expect(structureSection('short-spacing')).toBe('ribs')
    expect(structureSection('le-stock')).toBe('edges')
    expect(structureSection('te-stock')).toBe('edges')
    expect(structureSection('finish-open')).toBe('covering')
    expect(structureSection('brace-B1')).toBe('braces')
    expect(structureSection('gussets-le')).toBe('gussets')
    expect(structureSection('surface-s1-0')).toBe('hinges')
  })

  it('leaves warnings set in the wing editor under the structure editor', () => {
    const { sections, rest } = bySection([
      { id: 'bay-b1', message: 'bay' },
      { id: 'brake-a1', message: 'brake' },
      { id: 'le-stock', message: 'edge' },
    ])
    expect(rest.map((w) => w.message)).toEqual(['bay', 'brake'])
    expect(sections.edges.map((w) => w.message)).toEqual(['edge'])
  })
})
