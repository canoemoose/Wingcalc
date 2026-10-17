// Smoke test: render the whole app on the server (Vue's server renderer runs every
// component's setup, computed values and template) from a saved working state, and fail on
// any error or Vue warning. Catches template and wiring crashes that unit tests of
// src/lib can't; it doesn't replace looking at the running app.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createSSRApp, h } from 'vue'
import { renderToString } from 'vue/server-renderer'
import { defaultState } from '../src/lib/projects.js'
import { resolveAirfoil, airfoilPerformance } from '../src/lib/airfoils.js'
import { wingGeometry } from '../src/lib/calc.js'
import { wingSampler, projectedSampler } from '../src/lib/wing.js'
import { analyseStructure, defaultStructure, MODES } from '../src/lib/structure.js'
import { buildParts } from '../src/lib/ribs.js'

function memoryStorage(entries = {}) {
  const m = new Map(Object.entries(entries))
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: (k) => m.delete(k),
  }
}

async function render(state) {
  globalThis.localStorage = memoryStorage({
    'wingcalc.autosave.v1': JSON.stringify({ projectId: null, name: 'Test', state, version: 1 }),
  })
  const { default: WingCalc } = await import('../src/WingCalc.vue')
  return renderToString(createSSRApp({ render: () => h(WingCalc) }))
}

describe('app render', () => {
  let warn
  beforeEach(() => {
    warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
  })
  afterEach(() => {
    warn.mockRestore()
    delete globalThis.localStorage
  })

  it('renders a new project without errors or warnings', async () => {
    const html = await render(defaultState())
    expect(html).toContain('Wing cube loading')
    expect(html).toContain('Structure and ribs')
    expect(html).toContain('Lowest margin at 6 g')
    expect(warn).not.toHaveBeenCalled()
  })

  it('renders a tapered, washed-out multi-panel wing', async () => {
    const s = defaultState()
    s.input.panels = [
      { id: 1, length: 0.45, tipChord: 0.2, sweep: 0.02, dihedral: 3, washout: 1, thickness: 0.1 },
      { id: 2, length: 0.25, tipChord: 0.12, sweep: 0.04, dihedral: 8, washout: 2.5, thickness: 0.08 },
    ]
    s.input.tip = { extension: 0.04, peak: 0.4 }
    const html = await render(s)
    expect(html).toContain('Washout at outer end')
    expect(html).toContain('2.5° washout at the tip')
    expect(html).toContain('stalls first at')
    expect(html).toContain('Spanwise lift at the stall')
    expect(warn).not.toHaveBeenCalled()
  })

  it('renders a wing with ailerons and flaps, crow and their hinges', async () => {
    const s = defaultState()
    s.input.controls = {
      surfaces: [
        { id: 1, role: 'aileron', panel: 1, from: 0.35, to: 0.65, hingeIn: 0.75, hingeOut: 0.78, up: 20, down: 15, gap: 0.001 },
        { id: 2, role: 'flap', panel: 1, from: 0.05, to: 0.3, hingeIn: 0.75, hingeOut: 0.75, up: 5, down: 45, gap: 0.001 },
        // Overlaps the flap, so it's drawn but not built, with a warning
        { id: 3, role: 'flap', panel: 1, from: 0.25, to: 0.32, hingeIn: 0.75, hingeOut: 0.75, up: 5, down: 45, gap: 0.001 },
      ],
      crow: { enabled: true, aileronUp: 25, flapDown: 45 },
      // The aileron's servo bay is a mini servo off to one side; the flap's is the automatic one
      bays: [{ surface: 1, class: 'mini', at: 0.5 }],
    }
    const html = await render(s)
    expect(html).toContain('Control surfaces')
    expect(html).toContain('F1, A1, Mylar-tab hinges; 2 servo bays per side; crow on')
    expect(html).toContain("Flap F2 isn&#39;t built")
    expect(html).toContain('wc-plan__surface')
    expect(html).toContain('wc-plan__hinge')
    // The flight configurations under Stall speed: clean by default, flaps and crow offered
    expect(html).toContain('aria-label="Configuration"')
    expect(html).toMatch(/>Flaps \d+\.\d km\/h</)
    expect(html).toMatch(/>Crow \d+\.\d km\/h</)
    expect(warn).not.toHaveBeenCalled()

    // The structure editor's hinge settings, and the plan with the surfaces drawn
    const { default: StructureEditor } = await import('../src/components/StructureEditor.vue')
    const { default: StructurePlan } = await import('../src/components/StructurePlan.vue')
    const { default: ControlSurfaceEditor } = await import('../src/components/ControlSurfaceEditor.vue')
    const structure = defaultStructure()
    const airfoil = resolveAirfoil(s.airfoil)
    const g = wingGeometry({ ...s.input, mode: 'panels' })
    const planform = projectedSampler(wingSampler(s.input, airfoil.params.thickness))
    const perf = airfoilPerformance(airfoil, { mass: s.input.mass, area: g.projectedArea, chord: g.mac, wing: { planform, span: g.span, sweepCos: 1 } })
    const a = analyseStructure({ wing: s.input, airfoil, structure, mass: s.input.mass, spanwise: perf.spanwise, controls: s.input.controls })
    const { parts } = buildParts(a, a.structure)
    const parts2 = await renderToString(
      createSSRApp({
        render: () => [
          h(StructureEditor, { structure, system: 'metric', edges: a.edges }),
          h(StructurePlan, { structure, analysis: a, parts, selected: 'A1-2', system: 'metric' }),
          h(ControlSurfaceEditor, { controls: s.input.controls, selected: 1, wing: s.input, system: 'metric' }),
        ],
      }),
    )
    expect(parts2).toContain('Control surface hinges')
    expect(parts2).toContain('wc-sp__hinge')
    expect(parts2).toContain('Aileron A1 rib')
    expect(parts2).toContain('Crow braking')
    expect(parts2).toContain('Landing flap')
    // The servo bays: settings in the editor, drawn on the structure plan, in the weight
    expect(parts2).toContain('A bay for this surface')
    expect(parts2).toContain('Mini (the 17 g class)')
    expect(parts2).toContain('wc-sp__servo')
    expect(parts2).toContain('wc-sp__lead')
    expect(parts.some((p) => p.group === 'servos')).toBe(true)
    expect(parts2).toContain('overlaps another surface')
    expect(html).toContain('servos ')
    // Without separate flaps, crow isn't offered
    const flaperons = { ...s.input.controls, surfaces: [{ ...s.input.controls.surfaces[0], role: 'flaperon' }] }
    const alone = await renderToString(createSSRApp({ render: () => h(ControlSurfaceEditor, { controls: flaperons, wing: s.input, system: 'metric' }) }))
    expect(alone).toContain('A flaperon is both at once')
    expect(warn).not.toHaveBeenCalled()
  })

  it('renders a wing with a blade brake, a spoiler and their servo bays', async () => {
    const s = defaultState()
    s.input.rootChord = 0.45
    s.input.panels = [{ id: 1, length: 0.9, tipChord: 0.4, sweep: 0, dihedral: 0, washout: 0 }]
    s.input.mass = 2
    s.input.controls = {
      surfaces: [],
      crow: { enabled: false, aileronUp: 25, flapDown: 45 },
      bays: [{ surface: 'b2', class: 'mini' }],
      brakes: [
        { id: 1, type: 'blade', panel: 1, at: 0.3, length: 0.08, x: 0.6, chord: 0.03, height: 0.012, blades: 3, surface: 'both', angle: 60 },
        { id: 2, type: 'spoiler', panel: 1, at: 0.65, length: 0.1, x: 0.6, chord: 0.04, height: 0.012, blades: 1, surface: 'top', angle: 60 },
        // Its ribs sit on the spoiler's, so it's drawn but not built, with a warning
        { id: 3, type: 'blade', panel: 1, at: 0.67, length: 0.08, x: 0.6, chord: 0.03, height: 0.012, blades: 1, surface: 'top', angle: 60 },
      ],
    }
    const html = await render(s)
    expect(html).toContain('Air brakes')
    expect(html).toContain('AB1 (3 blades), AB2 (spoiler)')
    expect(html).toContain('wc-plan__brake')
    expect(html).toContain('Blade brake AB1')
    expect(html).toContain('Spoiler AB2')
    expect(html).toContain('A bay for this brake')
    expect(html).toContain('Mini (the 17 g class)')
    expect(html).toContain('on top of another air brake')
    expect(warn).not.toHaveBeenCalled()

    const { default: StructurePlan } = await import('../src/components/StructurePlan.vue')
    const { default: AirBrakeEditor } = await import('../src/components/AirBrakeEditor.vue')
    const structure = defaultStructure()
    const airfoil = resolveAirfoil(s.airfoil)
    const g = wingGeometry({ ...s.input, mode: 'panels' })
    const planform = projectedSampler(wingSampler(s.input, airfoil.params.thickness))
    const perf = airfoilPerformance(airfoil, { mass: s.input.mass, area: g.projectedArea, chord: g.mac, wing: { planform, span: g.span, sweepCos: 1 } })
    const a = analyseStructure({ wing: s.input, airfoil, structure, mass: s.input.mass, spanwise: perf.spanwise, controls: s.input.controls })
    const { parts } = buildParts(a, a.structure)
    const out = await renderToString(
      createSSRApp({
        render: () => [
          h(StructurePlan, { structure, analysis: a, parts, selected: null, system: 'metric' }),
          h(AirBrakeEditor, { controls: s.input.controls, selected: 1, wing: s.input, system: 'metric', mass: 2 }),
        ],
      }),
    )
    expect(out).toContain('wc-sp__brake')
    expect(out).toContain('wc-sp__slot')
    expect(out).toContain('wc-sp__brake-hinge')
    expect(out).toContain('Blades')
    expect(out).toContain('Add spoiler to panel 1')
    expect(parts.some((p) => p.group === 'brakes')).toBe(true)
    expect(warn).not.toHaveBeenCalled()
  })

  // The structure editor's window isn't rendered on the server (it's teleported), so its
  // parts are rendered on their own
  it('renders the structure editor and charts for each leading edge type', async () => {
    const { default: StructureEditor } = await import('../src/components/StructureEditor.vue')
    const { default: LoadsChart } = await import('../src/components/LoadsChart.vue')
    let fitDrawn = 0
    let misfits = 0
    // Each leading edge type, and each covering's hint (glass over sheeting and over an open wing)
    for (const [type, diameter, stock, finish, covering = 'dbox'] of [
      ['balsa', null, 'auto', 'film'],
      ['balsa', null, 'L320', 'glass'],
      ['rod', 0.003, 'auto', 'tissue'],
      ['rod', 0.008, 'auto', 'glass', 'open'],
      ['none', null, 'auto', 'fabric'],
    ]) {
      const s = defaultState()
      const structure = defaultStructure()
      structure.le = { ...structure.le, type, diameter, stock }
      structure.covering = { ...structure.covering, finish, type: covering }
      const airfoil = resolveAirfoil(s.airfoil)
      const g = wingGeometry({ ...s.input, mode: 'panels' })
      const planform = projectedSampler(wingSampler(s.input, airfoil.params.thickness))
      const perf = airfoilPerformance(airfoil, { mass: s.input.mass, area: g.projectedArea, chord: g.mac, wing: { planform, span: g.span, sweepCos: 1 } })
      const a = analyseStructure({ wing: s.input, airfoil, structure, mass: s.input.mass, spanwise: perf.spanwise })
      const { parts } = buildParts(a, a.structure)
      const html = await renderToString(
        createSSRApp({
          render: () => [
            h(StructureEditor, { structure, system: 'metric', edges: a.edges, coveringMass: 0.05 }),
            h(LoadsChart, { analysis: a, ribs: parts.filter((p) => p.group === 'ribs'), system: 'metric', designG: 6 }),
          ],
        }),
      )
      expect(html).toContain('Leading edge')
      // The margin chart's legend names every mode it draws
      expect(html).toContain('wc-loads__legend')
      for (const k of Object.keys(a.summary.modes)) expect(html).toContain(MODES[k])
      if (html.includes('wc-edgefit')) fitDrawn++
      if (!a.edges.le.fits) misfits++
    }
    // The fit is drawn for those that don't fit (L320 doesn't)
    expect(misfits).toBeGreaterThan(0)
    expect(fitDrawn).toBe(misfits)
    expect(warn).not.toHaveBeenCalled()
  })
})
