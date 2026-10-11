import { describe, it, expect } from 'vitest'
import { panelSections, wingSampler, normalisePanels, appendPanel, insertPanel } from '../src/lib/wing.js'
import { surfaceFns, scaleThickness, sectionStats, generateSection } from '../src/lib/airfoilGeom.js'

const naca2412 = generateSection({ thickness: 0.12, thicknessPos: 0.3, camber: 0.02, camberPos: 0.4, leRadius: 0.0158 }, 100).coords

describe('section thickness scaling', () => {
  it('evaluates both surfaces by binary search, matching the coordinates', () => {
    const { upper, lower } = surfaceFns(naca2412)
    expect(upper(0)).toBeCloseTo(0, 2)
    expect(upper(0.3) - lower(0.3)).toBeCloseTo(0.12, 2)
    // Clamped outside 0..1
    expect(upper(-1)).toBe(upper(0))
    expect(lower(2)).toBe(lower(1))
  })

  it('scales the thickness and keeps the camber', () => {
    const thin = scaleThickness(naca2412, 0.75)
    const a = sectionStats(naca2412)
    const b = sectionStats(thin)
    expect(b.thickness).toBeCloseTo(a.thickness * 0.75, 3)
    expect(b.camber).toBeCloseTo(a.camber, 3)
    expect(b.camberPos).toBeCloseTo(a.camberPos, 1)
  })

  it('returns the same section at a scale of 1', () => {
    const same = scaleThickness(naca2412, 1)
    const { upper, lower } = surfaceFns(same)
    const o = surfaceFns(naca2412)
    for (const x of [0.05, 0.25, 0.6, 0.9]) {
      expect(upper(x)).toBeCloseTo(o.upper(x), 3)
      expect(lower(x)).toBeCloseTo(o.lower(x), 3)
    }
  })
})

describe('panel washout and thickness', () => {
  const panels = normalisePanels([
    { length: 0.4, tipChord: 0.2, dihedral: 0, washout: 1, thickness: 0.1 },
    { length: 0.3, tipChord: 0.15, dihedral: 0 },
    { length: 0.2, tipChord: 0.1, dihedral: 0, washout: 3, thickness: 0.08 },
  ])

  it('chains each panel from the end of the one inboard', () => {
    const s = panelSections(panels, 0.12)
    expect(s[0].inner).toEqual({ twist: 0, thickness: 0.12 })
    expect(s[0].outer).toEqual({ twist: 1, thickness: 0.1 })
    // Normalised panels default to zero washout (relative to the root) and a blank thickness
    expect(s[1].outer).toEqual({ twist: 0, thickness: 0.1 })
    expect(s[2].outer).toEqual({ twist: 3, thickness: 0.08 })
  })

  it('keeps the inner thickness when there is no aerofoil thickness to start from', () => {
    const s = panelSections([{ length: 1, tipChord: 0.1 }], null)
    expect(s[0].outer.thickness).toBe(null)
  })

  it('continues the twist when a panel is appended or inserted', () => {
    const more = appendPanel(panels, 0.25)
    expect(more.at(-1).washout).toBe(3)
    const ins = insertPanel(panels, 0, 0.25)
    expect(ins[1].washout).toBe(1)
    expect(ins[2].washout).toBe(0)
  })
})

describe('wing sampler', () => {
  const wing = {
    fuselageWidth: 0.1,
    rootChord: 0.3,
    panels: normalisePanels([
      { length: 0.5, tipChord: 0.2, sweep: 0.05, dihedral: 0, washout: 2, thickness: 0.09 },
      { length: 0.2, tipChord: 0.1, sweep: 0.05, dihedral: 30, washout: 4 },
    ]),
    tip: { extension: 0.05, peak: 0.4 },
  }
  const w = wingSampler(wing, 0.12)

  it('is constant through the fuselage section', () => {
    const p = w.at(0.03)
    expect(p).toMatchObject({ xl: 0, c: 0.3, twist: 0, thickness: 0.12, panel: -1 })
  })

  it('interpolates chord, twist and thickness across a panel', () => {
    const p = w.at(0.05 + 0.25)
    expect(p.panel).toBe(0)
    expect(p.f).toBeCloseTo(0.5, 12)
    expect(p.c).toBeCloseTo(0.25, 12)
    expect(p.xl).toBeCloseTo(0.025, 12)
    expect(p.twist).toBeCloseTo(1, 12)
    expect(p.thickness).toBeCloseTo(0.105, 12)
  })

  it('follows dihedral in projected y and height', () => {
    const p = w.at(0.55 + 0.1)
    expect(p.panel).toBe(1)
    expect(p.y).toBeCloseTo(0.55 + 0.1 * Math.cos(Math.PI / 6), 12)
    expect(p.z).toBeCloseTo(0.1 * Math.sin(Math.PI / 6), 12)
    expect(p.twist).toBeCloseTo(3, 12)
    expect(p.thickness).toBeCloseTo(0.09, 12)
  })

  it('runs out through the tip cap and stops beyond it', () => {
    expect(w.reach).toBeCloseTo(0.8, 12)
    const p = w.at(0.8)
    expect(p.panel).toBe(2)
    expect(p.c).toBeCloseTo(0, 9)
    expect(p.twist).toBe(4)
    expect(w.at(0.81)).toBe(null)
  })
})
