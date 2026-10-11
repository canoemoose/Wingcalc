// Access to the bundled aerofoil library, and the airfoil-dependent part of the
// performance calculation (section Clmax depends on Reynolds number, which depends on
// stall speed, which depends on Clmax).

import data from '../data/airfoils.json'
import { analysePolar, ratePolar, rateGeometry } from './stall.js'
import { generateSection, upperOrdinate } from './airfoilGeom.js'
import { stallSpeed, reynolds, WING_CLMAX_FACTOR } from './calc.js'

export const LIBRARY = data
export const FAMILIES = {
  naca: { label: 'NACA' },
  eppler: { label: 'Eppler' },
  custom: { label: 'Custom' },
}

export function sectionsIn(family) {
  return data.sections.filter((s) => s.family === family)
}

export function findSection(id) {
  return data.sections.find((s) => s.id === id) ?? null
}

// Polar whose Reynolds number is nearest to re (in log terms).
export function nearestPolar(section, re) {
  if (!section?.polars?.length) return null
  const target = Math.log(re)
  let best = section.polars[0]
  for (const p of section.polars) {
    if (Math.abs(Math.log(p.re) - target) < Math.abs(Math.log(best.re) - target)) best = p
  }
  return best
}

// Section Clmax at a Reynolds number, interpolated linearly in log(Re) between the
// bundled polars and held constant beyond the ends of the range.
export function sectionClMaxAt(section, re) {
  // Skip polars that stop at the peak: XFOIL failing to converge there often means the
  // true maximum was never reached, so the reported Clmax is unreliable.
  const pts = section.polars
    .map((p) => ({ re: p.re, ...analysePolar(p) }))
    .filter((p) => p.postStallSpan >= 0.5)
    .sort((a, b) => a.re - b.re)
  if (!pts.length) return null
  if (re <= pts[0].re) return pts[0].clMax
  if (re >= pts[pts.length - 1].re) return pts[pts.length - 1].clMax
  for (let i = 1; i < pts.length; i++) {
    if (re <= pts[i].re) {
      const t = (Math.log(re) - Math.log(pts[i - 1].re)) / (Math.log(pts[i].re) - Math.log(pts[i - 1].re))
      return pts[i - 1].clMax + t * (pts[i].clMax - pts[i - 1].clMax)
    }
  }
  return null
}

// Resolve the user's airfoil selection to drawable coordinates and section parameters.
// custom: { clMax, thicknessPct, thicknessPosPct, camberPct, camberPosPct, leRadiusPct }
export function resolveAirfoil(selection) {
  if (selection.source === 'custom') {
    const c = selection.custom
    const params = {
      thickness: c.thicknessPct / 100,
      thicknessPos: c.thicknessPosPct / 100,
      camber: c.camberPct / 100,
      camberPos: c.camberPosPct / 100,
      leRadius: c.leRadiusPct / 100,
    }
    const { coords, valid } = generateSection(params)
    return { kind: 'custom', name: 'Custom section', coords, valid, params, clMax: c.clMax }
  }
  const s = findSection(selection.id)
  if (!s) return null
  return {
    kind: 'library',
    name: s.name,
    section: s,
    coords: s.coords,
    valid: true,
    params: {
      thickness: s.thicknessPct / 100,
      thicknessPos: s.thicknessPosPct / 100,
      camber: s.camberPct / 100,
      camberPos: s.camberPosPct / 100,
      leRadius: s.leRadiusPct / 100,
    },
  }
}

// Stall speed, Reynolds number and stall character for a resolved airfoil.
// For library sections Clmax is looked up at the Reynolds number of the stall itself,
// which needs a short fixed-point iteration (converges in a handful of steps).
export function airfoilPerformance(airfoil, { mass, area, chord }) {
  if (!airfoil) return null
  if (airfoil.kind === 'custom') {
    const wingClMax = airfoil.clMax * WING_CLMAX_FACTOR
    const vs = stallSpeed(mass, area, wingClMax)
    const re = reynolds(vs, chord)
    const stall = rateGeometry({
      ...airfoil.params,
      upper125: upperOrdinate(airfoil.coords, 0.0125),
      re,
    })
    return { sectionClMax: airfoil.clMax, wingClMax, stallSpeed: vs, reynolds: re, stall, polar: null }
  }
  const s = airfoil.section
  let re = 200000
  let sectionClMax = sectionClMaxAt(s, re)
  let vs = null
  for (let i = 0; i < 8; i++) {
    vs = stallSpeed(mass, area, sectionClMax * WING_CLMAX_FACTOR)
    const next = reynolds(vs, chord)
    if (!next) break
    re = next
    sectionClMax = sectionClMaxAt(s, re)
  }
  const polar = re ? nearestPolar(s, re) : nearestPolar(s, 200000)
  const stall = polar ? ratePolar(polar) : null
  return {
    sectionClMax,
    wingClMax: sectionClMax * WING_CLMAX_FACTOR,
    stallSpeed: vs,
    reynolds: vs ? re : null,
    stall,
    polar,
  }
}
