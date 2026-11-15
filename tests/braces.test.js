import { describe, it, expect } from 'vitest'
import { defaultState } from '../src/lib/projects.js'
import { resolveAirfoil, airfoilPerformance } from '../src/lib/airfoils.js'
import { wingGeometry } from '../src/lib/calc.js'
import { wingSampler, projectedSampler, normalisePanels } from '../src/lib/wing.js'
import { analyseStructure, defaultStructure } from '../src/lib/structure.js'
import { braceSizing, buildParts } from '../src/lib/ribs.js'
import { sectionAt, sparBoxes } from '../src/lib/wing3d.js'

// A swept, polyhedral wing: two dihedral breaks (the centreline and the panel joint) to brace
const swept = (input) => {
  input.panels = normalisePanels([
    { length: 0.5, tipChord: 0.18, sweep: 0.08, dihedral: 3, washout: 1.5 },
    { length: 0.25, tipChord: 0.1, sweep: 0.08, dihedral: 10, washout: 3, thickness: 0.09 },
  ])
  input.tip = { extension: 0.04, peak: 0.4 }
}

// Analysis for the swept wing, with optional edits to the structure and the mass (kg)
function analyse(edit = () => {}, mass) {
  const s = defaultState()
  swept(s.input)
  if (mass) s.input.mass = mass
  const st = defaultStructure()
  st.le.stock = 'custom'
  st.te.stock = 'custom'
  edit(st)
  const airfoil = resolveAirfoil(s.airfoil)
  const g = wingGeometry({ ...s.input, mode: 'panels' })
  const planform = projectedSampler(wingSampler(s.input, airfoil.params.thickness))
  const perf = airfoilPerformance(airfoil, { mass: s.input.mass, area: g.projectedArea, chord: g.mac, wing: { planform, span: g.span, sweepCos: 1 } })
  const a = analyseStructure({ wing: s.input, airfoil, structure: st, mass: s.input.mass, spanwise: perf.spanwise })
  return { a, st }
}

describe('dihedral braces', () => {
  it('gives one entry per dihedral break, with the sizing fields', () => {
    const { a, st } = analyse()
    const braces = braceSizing(a, st)
    expect(braces.length).toBe(2) // centreline and the polyhedral joint
    expect(braces.map((b) => b.name)).toEqual(['B1', 'B2'])
    for (const b of braces) {
      expect(b.ok).toBe(true)
      expect(b.moment).toBeGreaterThan(0)
      expect(b.height).toBeGreaterThan(0.01)
      expect(b.needT).toBeGreaterThan(0)
      expect(b.chosenT).toBeGreaterThanOrEqual(b.needT - 1e-12)
      expect(b.margin).toBeCloseTo(b.chosenT / b.needT - 1, 9)
    }
  })

  it('needs more thickness as the bending moment grows', () => {
    const light = braceSizing(...Object.values(analyse(() => {}, 0.5)))
    const heavy = braceSizing(...Object.values(analyse(() => {}, 2)))
    expect(light.length).toBe(heavy.length)
    for (let i = 0; i < light.length; i++) {
      expect(heavy[i].moment).toBeGreaterThan(light[i].moment)
      expect(heavy[i].needT).toBeGreaterThan(light[i].needT)
    }
  })

  it('warns when an entered thickness is below what the bending needs', () => {
    const { a } = analyse((st) => {
      st.braces.thickness = 0.0004 // 0.4 mm, too thin for the bending at the centreline
    })
    const warnings = a.warnings.filter((w) => w.id === 'brace-B1')
    expect(warnings.length).toBe(1)
    expect(warnings[0].message).toMatch(/Dihedral brace B1/)
    expect(a.braces.find((b) => b.name === 'B1').margin).toBeLessThan(0)
  })

  it('gives no brace warning when the entered thickness is enough', () => {
    const { a } = analyse((st) => {
      st.braces.thickness = 0.006 // 6 mm, well above what the bending needs
    })
    expect(a.warnings.some((w) => String(w.id).startsWith('brace-'))).toBe(false)
  })

  it('shares the web shear with the braces along their arms, and only there', () => {
    const { a } = analyse((st) => {
      st.spar.type = 'caps'
    })
    const { a: bare } = analyse((st) => {
      st.spar.type = 'caps'
      st.braces.enabled = false
    })
    const [b1, b2] = a.braces
    const rows = a.stations.filter((r) => r.tau > 0)
    const bareAt = (s) => bare.stations.find((r) => Math.abs(r.s - s) < 1e-9)
    const onArm = (r, b) => r.s >= b.s - (b.geom.centre ? 0 : b.geom.Lin) && r.s <= b.s + b.geom.Lout
    const covered = rows.filter((r) => onArm(r, b1) || onArm(r, b2))
    const clear = rows.filter((r) => !onArm(r, b1) && !onArm(r, b2))
    expect(covered.length).toBeGreaterThan(2)
    expect(clear.length).toBeGreaterThan(2)
    for (const r of covered) {
      expect(r.braceShare).toBeGreaterThan(0)
      expect(r.braceShare).toBeLessThan(1)
      expect(r.tau).toBeCloseTo(bareAt(r.s).tau * (1 - r.braceShare), 6)
      expect(r.ms.webShear).toBeGreaterThan(bareAt(r.s).ms.webShear)
    }
    for (const r of clear) {
      expect(r.braceShare).toBeUndefined()
      expect(r.tau).toBeCloseTo(bareAt(r.s).tau, 9)
    }
  })

  it('shares a solid spar\'s shear with the braces too', () => {
    const { a } = analyse((st) => (st.spar.type = 'solid'))
    const { a: bare } = analyse((st) => {
      st.spar.type = 'solid'
      st.braces.enabled = false
    })
    const r = a.stations.find((x) => x.braceShare > 0 && x.tau > 0)
    const b = bare.stations.find((x) => Math.abs(x.s - r.s) < 1e-9)
    expect(r.tau).toBeCloseTo(b.tau * (1 - r.braceShare), 6)
    expect(r.ms.sparShear).toBeGreaterThan(b.ms.sparShear)
  })

  it('fills the depth inside the wing, never less than the spar, on a shallow solid spar too', () => {
    const { a: caps, st } = analyse((st) => (st.spar.type = 'caps'))
    const { a: solid, st: ss } = analyse((st) => {
      st.spar.type = 'solid'
      st.spar.solidDepth = 0.004
    })
    const [c1] = braceSizing(caps, st)
    const [s1] = braceSizing(solid, ss)
    // A 4 mm spar still takes a brace, as tall as the wing is deep there, whatever the spar
    expect(s1.ok).toBe(true)
    expect(s1.height).toBeGreaterThan(0.004)
    // (measured beside each spar's own faces, so within a little of the caps spar's)
    expect(Math.abs(s1.height / c1.height - 1)).toBeLessThan(0.03)
    expect(Math.abs(s1.needT / c1.needT - 1)).toBeLessThan(0.07)
  })

  it('reports a brace where the solid spar has tapered away at the break', () => {
    const { a, st } = analyse((st) => {
      st.spar.type = 'solid'
      st.spar.solidDepth = 0.0005
    })
    const b = braceSizing(a, st).find((x) => !x.ok)
    expect(b).toBeTruthy()
    expect(b.reason).toMatch(/only 0\.5 mm deep at the break/)
  })

  it('takes a height set for a brace on a solid spar, held between the spar and the wing', () => {
    const solid = (h) =>
      analyse((st) => {
        st.spar.type = 'solid'
        st.spar.solidDepth = 0.004
        st.spar.solidMount = 'bottom'
        if (h !== undefined) st.braces.heights = { B2: h }
      })
    const { a: full, st: sf } = solid()
    const fb = braceSizing(full, sf)[1]
    expect(fb.heightSet).toBeNull()
    const [lo, hi] = fb.heightRange
    expect(lo).toBeGreaterThan(0.001)
    expect(hi).toBeCloseTo(fb.height, 9)
    // In range: made that tall, and a shorter brace needs thicker ply
    const mid = (lo + hi) / 2
    const { a, st } = solid(mid)
    const b = braceSizing(a, st)[1]
    expect(b.height).toBeCloseTo(mid, 9)
    expect(b.heightHeld).toBe(false)
    expect(b.needT).toBeGreaterThan(fb.needT)
    expect(Math.max(b.geom.hi, b.geom.ho)).toBeLessThanOrEqual(mid + 1e-9)
    expect(a.warnings.some((w) => w.id === 'brace-B2-height')).toBe(false)
    // Out of range: held to the spar, with a warning
    const { a: low, st: sl } = solid(0.0005)
    const bl = braceSizing(low, sl)[1]
    expect(bl.height).toBeCloseTo(lo, 9)
    expect(bl.heightHeld).toBe(true)
    expect(low.warnings.find((w) => w.id === 'brace-B2-height')?.message).toMatch(/can only be from/)
    // In 3D the short brace still covers the spar, which sits on the bottom of the ribs
    const parts = buildParts(a, a.structure).parts
    const p = parts.find((q) => q.group === 'braces' && q.id === 'B2')
    const cutAt = p.at.s + p.at.outer / 2
    const zs = sectionAt(a, a.structure, parts, cutAt).pieces.filter((q) => q.kind === 'brace').flatMap((q) => q.pts.map(([, z]) => z))
    const box = sparBoxes(a, a.structure, cutAt)[0].map(([, z]) => z)
    expect(Math.min(...zs)).toBeLessThanOrEqual(Math.min(...box) + 1e-6)
    expect(Math.max(...zs)).toBeGreaterThanOrEqual(Math.max(...box) - 1e-6)
  })

  it('notches the ribs round a short brace on a solid spar, and cuts them in two round a full one', () => {
    const ribsAt = (h) => {
      const { a } = analyse((st) => {
        st.spar.type = 'solid'
        st.spar.solidDepth = 0.004
        st.spar.solidMount = 'bottom'
        if (h) st.braces.heights = { B1: h, B2: h }
      })
      const parts = buildParts(a, a.structure).parts
      const b = a.braces[1]
      const lo = b.s - b.geom.Lin - 1e-6
      const hi = b.s + b.geom.Lout + 1e-6
      return parts.filter((p) => p.group === 'ribs' && p.s >= lo && p.s <= hi)
    }
    const notched = ribsAt(0.004)
    expect(notched.length).toBeGreaterThan(0)
    for (const p of notched) {
      expect(p.notes.some((n) => /Notched round the spar and the dihedral brace B2/.test(n))).toBe(true)
      expect(p.rib.sparSplit).toBe(false)
    }
    const split = ribsAt(null)
    expect(split.some((p) => p.rib.sparSplit && p.notes.some((n) => /Cut in two round the spar and the dihedral brace B2/.test(n)))).toBe(true)
  })

  it('ignores a height on a caps spar, whose braces fill the depth as the spar does', () => {
    const { a, st } = analyse((st) => {
      st.spar.type = 'caps'
      st.braces.heights = { B1: 0.003 }
    })
    const b = braceSizing(a, st)[0]
    expect(b.heightRange).toBeNull()
    expect(b.heightSet).toBeNull()
    expect(b.height).toBeGreaterThan(0.01)
  })

  it('takes the brace thickness set for it, then the one for all, then the loads', () => {
    const { a, st } = analyse((st) => {
      st.braces.thickness = 0.004
      st.braces.thicknesses = { B2: 0.0015 }
    })
    const [b1, b2] = braceSizing(a, st)
    expect(b1.chosenT).toBe(0.004)
    expect(b2.chosenT).toBe(0.0015)
    expect(b2.entered).toBe(true)
    const { a: a0, st: st0 } = analyse()
    expect(braceSizing(a0, st0).every((b) => !b.entered)).toBe(true)
  })

  it('lays the grain along the brace, half way between its arms', () => {
    const { a, st } = analyse()
    const braces = braceSizing(a, st)
    const parts = buildParts(a, a.structure).parts.filter((p) => p.group === 'braces')
    expect(parts.length).toBe(braces.length)
    for (const p of parts) {
      const b = braces.find((x) => x.name === p.name)
      expect(p.grainAngle).toBeCloseTo((b.dihedralDeg * Math.PI) / 180 / 2, 9)
    }
  })
})
