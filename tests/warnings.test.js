import { describe, it, expect } from 'vitest'
import { structureSection, bySection } from '../src/lib/warnings.js'

describe('where a structure warning is shown', () => {
  it('puts each warning beside the settings that fix it', () => {
    expect(structureSection('short-compression')).toBe('spar')
    expect(structureSection('short-sheet')).toBe('covering')
    expect(structureSection('short-spacing')).toBe('ribs')
    expect(structureSection('le-stock')).toBe('edges')
    expect(structureSection('te-stock')).toBe('edges')
    expect(structureSection('finish-open')).toBe('finish')
    expect(structureSection('rib-pitch-covering')).toBe('ribs')
    expect(structureSection('brace-B1')).toBe('braces')
    expect(structureSection('gussets-le')).toBe('gussets')
    expect(structureSection('surface-s1-0')).toBe('hinges')
    // A linkage's are in its surface's own section
    expect(structureSection('linkage-travel-1')).toBe('surfaces')
  })

  it("puts a control surface's servo bay warnings in that surface's section", () => {
    expect(structureSection('bay-3')).toBe('surfaces')
    expect(structureSection('bay-3-0')).toBe('surfaces')
    expect(structureSection('bay-12-4')).toBe('surfaces')
    // An air brake's bay and the brake itself stay in the list
    expect(structureSection('bay-b1')).toBe(null)
    expect(structureSection('bay-b1-0')).toBe(null)
    expect(structureSection('brake-b1')).toBe(null)
  })

  it('sends foam core warnings to the core section', () => {
    expect(structureSection('short-wrinkling')).toBe('foamcore')
    expect(structureSection('short-coreShear')).toBe('foamcore')
    expect(structureSection('short-core')).toBe(null)
    expect(structureSection('short-sheet', true)).toBe('foamcore')
  })

  it('leaves warnings set in the wing editor under the structure editor', () => {
    const { sections, rest } = bySection([
      { id: 'bay-b1', message: 'bay' },
      { id: 'brake-a1', message: 'brake' },
      { id: 'le-stock', message: 'edge' },
      { id: 'bay-2-0', message: 'surface bay' },
    ])
    expect(rest.map((w) => w.message)).toEqual(['bay', 'brake'])
    expect(sections.edges.map((w) => w.message)).toEqual(['edge'])
    expect(sections.surfaces.map((w) => w.message)).toEqual(['surface bay'])
  })
})
