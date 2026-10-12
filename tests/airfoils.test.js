import { describe, it, expect } from 'vitest'
import {
  LIBRARY,
  sectionsIn,
  findSection,
  nearestPolar,
  sectionClMaxAt,
  resolveAirfoil,
  airfoilPerformance,
  loadCatalogue,
  catalogueFor,
  libraryCalibration,
  estimateClMax,
  UIUC_PREFIX,
  entryCoords,
  isMultiElementEntry,
} from '../src/lib/airfoils.js'
import { generateSection, nacaLeRadius, isMultiElement } from '../src/lib/airfoilGeom.js'
import { stallSpeed, reynolds, WING_CLMAX_FACTOR } from '../src/lib/calc.js'

describe('bundled aerofoil data', () => {
  it('has NACA four-digit and Eppler sections, including the ones the brief names', () => {
    expect(sectionsIn('naca').length).toBeGreaterThanOrEqual(10)
    expect(sectionsIn('eppler').length).toBeGreaterThanOrEqual(10)
    for (const id of ['naca2412-il', 'n0012-il', 'naca4412-il', 'e205-il', 'e374-il']) {
      expect(findSection(id), id).not.toBeNull()
    }
  })

  it('records a source URL and Reynolds number for every polar', () => {
    for (const s of LIBRARY.sections) {
      expect(s.source).toMatch(/^http:\/\/airfoiltools\.com\//)
      expect(s.polars.length, s.id).toBeGreaterThan(0)
      for (const p of s.polars) {
        expect(p.source).toContain(String(p.re))
        expect(p.alpha.length).toBe(p.cl.length)
        expect(p.alpha.length).toBeGreaterThan(10)
      }
    }
  })

  it('has sensible geometry for every section', () => {
    for (const s of LIBRARY.sections) {
      expect(s.thicknessPct, s.id).toBeGreaterThan(5)
      expect(s.thicknessPct, s.id).toBeLessThan(25)
      expect(s.leRadiusPct, s.id).toBeGreaterThan(0.2)
      expect(s.leRadiusPct, s.id).toBeLessThan(5)
      expect(s.coords.length, s.id).toBeGreaterThan(20) // RAF 6 is a coarse historic table of 25 points
    }
  })

  it('measures the NACA 2412 leading-edge radius close to the published 1.58%', () => {
    expect(findSection('naca2412-il').leRadiusPct).toBeGreaterThan(1.4)
    expect(findSection('naca2412-il').leRadiusPct).toBeLessThan(1.75)
  })
})

describe('Reynolds-dependent lookup', () => {
  const s = findSection('naca2412-il')

  it('picks the nearest polar in log terms', () => {
    expect(nearestPolar(s, 140000).re).toBe(100000)
    expect(nearestPolar(s, 150000).re).toBe(200000)
    expect(nearestPolar(s, 5e6).re).toBe(1000000)
  })

  it('interpolates Clmax between polars and clamps at the ends', () => {
    const at100 = sectionClMaxAt(s, 100000)
    const at200 = sectionClMaxAt(s, 200000)
    const mid = sectionClMaxAt(s, Math.sqrt(100000 * 200000))
    expect(mid).toBeCloseTo((at100 + at200) / 2, 6)
    expect(sectionClMaxAt(s, 1e7)).toBe(sectionClMaxAt(s, 1000000))
  })
})

describe('airfoil performance', () => {
  const wing = { mass: 1.4, area: 0.301, chord: 0.217 }

  it('iterates to a self-consistent stall speed and Reynolds number', () => {
    const perf = airfoilPerformance(resolveAirfoil({ source: 'naca', id: 'naca2412-il' }), wing)
    expect(perf.wingClMax).toBeCloseTo(perf.sectionClMax * WING_CLMAX_FACTOR, 12)
    expect(perf.stallSpeed).toBeCloseTo(stallSpeed(wing.mass, wing.area, perf.wingClMax), 6)
    expect(perf.reynolds).toBeCloseTo(reynolds(perf.stallSpeed, wing.chord), -2)
    expect(perf.stallSpeed).toBeGreaterThan(6)
    expect(perf.stallSpeed).toBeLessThan(11)
    expect(['gentle', 'moderate', 'sharp']).toContain(perf.stall.rating)
  })

  it('estimates Clmax from camber and thickness and uses the geometry heuristic for a custom section', () => {
    const custom = { thicknessPct: 12, thicknessPosPct: 30, camberPct: 2, camberPosPct: 40, leRadiusPct: 1.59 }
    const perf = airfoilPerformance(resolveAirfoil({ source: 'custom', custom }), wing)
    expect(perf.clMaxSource).toBe('estimated')
    expect(perf.sectionClMax).toBeCloseTo(estimateClMax(custom, perf.reynolds), 2)
    expect(perf.stallSpeed).toBeCloseTo(stallSpeed(wing.mass, wing.area, perf.sectionClMax * WING_CLMAX_FACTOR), 9)
    expect(perf.stall.method).toBe('geometry')
    expect(perf.polar).toBeNull()
  })
})

describe('UIUC catalogue', async () => {
  const uiuc = await loadCatalogue()

  it('holds the full database, classified into families', () => {
    expect(uiuc.sections.length).toBeGreaterThan(1500)
    const fam = (f) => uiuc.sections.filter((s) => s.family === f).length
    expect(fam('naca')).toBeGreaterThan(100)
    expect(fam('eppler')).toBeGreaterThan(150)
    expect(fam('other')).toBeGreaterThan(1000)
  })

  it('lists polar-backed sections first and never twice', () => {
    const list = catalogueFor('naca', uiuc)
    const firstNoPolar = list.findIndex((e) => !e.hasPolar)
    expect(list.slice(0, firstNoPolar).every((e) => e.hasPolar)).toBe(true)
    expect(list.slice(firstNoPolar).every((e) => !e.hasPolar)).toBe(true)
    expect(list.some((e) => e.key === `${UIUC_PREFIX}naca2412`)).toBe(false) // covered by the polar library
    expect(new Set(list.map((e) => e.key)).size).toBe(list.length)
  })

  it('lists no multi-element sets', () => {
    for (const family of ['naca', 'eppler', 'other']) {
      for (const e of catalogueFor(family, uiuc)) expect(isMultiElement(entryCoords(e)), e.key).toBe(false)
    }
    for (const s of LIBRARY.sections) expect(isMultiElement(s.coords), s.id).toBe(false)
  })

  // The only multi-element set in the catalogue as built in October 2026. The fetch script now
  // skips such sets, so this runs only while the bundled data still has it.
  const set = uiuc.sections.find((s) => s.id === '30p-30n')
  it.runIf(set)('drops 30P-30N but keeps its elements, which come as separate files', () => {
    expect(isMultiElementEntry(set, uiuc.packScale)).toBe(true)
    const keys = catalogueFor('other', uiuc).map((e) => e.key)
    expect(keys).not.toContain(`${UIUC_PREFIX}30p-30n`)
    expect(keys).toContain(`${UIUC_PREFIX}30p-30n-main`)
    expect(keys).toContain(`${UIUC_PREFIX}30p-30n-flap`)
  })

  it('estimates Clmax and draws an indicative curve for a coordinates-only section', () => {
    const entry = catalogueFor('other', uiuc).find((e) => !e.hasPolar)
    const a = resolveAirfoil({ source: 'other', id: entry.key }, uiuc)
    const perf = airfoilPerformance(a, { mass: 1.4, area: 0.3, chord: 0.22 })
    expect(perf.clMaxSource).toBe('estimated')
    expect(perf.curve.indicative).toBe(true)
    expect(perf.stall.method).toBe('geometry')
  })
})

describe('Clmax estimate for sections without polars', () => {
  it('fits the polar library to within about 0.2 Clmax at every Reynolds number', () => {
    for (const c of libraryCalibration()) expect(c.rms, `Re ${c.re}`).toBeLessThan(0.2)
  })

  it('lands close to the real value for well-known sections', () => {
    for (const id of ['clarky-il', 'naca2412-il', 'n0012-il']) {
      const s = findSection(id)
      expect(Math.abs(estimateClMax(s, 150000) - sectionClMaxAt(s, 150000)), id).toBeLessThan(0.15)
    }
  })

  it('applies a Clmax factor for sweep', () => {
    const a = resolveAirfoil({ source: 'naca', id: 'naca2412-il' })
    const wing = { mass: 1.4, area: 0.301, chord: 0.217 }
    const swept = airfoilPerformance(a, { ...wing, clMaxFactor: 0.9 * Math.cos(Math.PI / 6) })
    const straight = airfoilPerformance(a, wing)
    expect(swept.stallSpeed).toBeGreaterThan(straight.stallSpeed)
  })
})

describe('a saved project naming a multi-element set', () => {
  // A two-element set (main element and flap) packed as the catalogue packs it
  const sec = (t) => generateSection({ thickness: t, thicknessPos: 0.3, camber: 0.02, camberPos: 0.4, leRadius: nacaLeRadius(t) }).coords
  const coords = [...sec(0.12).map(([x, y]) => [0.8 * x, 0.8 * y]), ...sec(0.1).map(([x, y]) => [0.82 + 0.3 * x, -0.02 + 0.3 * y])]
  const entry = (id) => ({
    id,
    family: 'other',
    name: id.toUpperCase(),
    description: id,
    thicknessPct: 9.6,
    thicknessPosPct: 24,
    camberPct: 1.6,
    camberPosPct: 32,
    leRadiusPct: 1,
    upper125Pct: 1.5,
    pts: (id === 'twin' ? coords : sec(0.12)).flatMap(([x, y]) => [Math.round(x * 1e4), Math.round(y * 1e4)]),
  })
  const uiuc = { packScale: 10000, coordUrl: 'https://example.invalid/', sections: [entry('twin'), entry('single')] }

  it('is left out of the picker', () => {
    const listed = catalogueFor('other', uiuc).filter((e) => !e.hasPolar)
    expect(listed.map((e) => e.key)).toEqual([`${UIUC_PREFIX}single`])
  })

  it('still resolves, but as unusable, so no figures, XFOIL or structure are worked out from it', () => {
    const a = resolveAirfoil({ source: 'other', id: `${UIUC_PREFIX}twin` }, uiuc)
    expect(a.name).toBe('TWIN')
    expect(a.multiElement).toBe(true)
    expect(a.valid).toBe(false)
    const ok = resolveAirfoil({ source: 'other', id: `${UIUC_PREFIX}single` }, uiuc)
    expect(ok.multiElement).toBe(false)
    expect(ok.valid).toBe(true)
  })
})
