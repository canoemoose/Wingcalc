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
    const { default: SurfaceStructure } = await import('../src/components/SurfaceStructure.vue')
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
          // The surfaces' hinge gaps and servo bays sit in the structure editor's Control surfaces section
          h(StructureEditor, { structure, system: 'metric', edges: a.edges }, { surfaces: () => h(SurfaceStructure, { controls: s.input.controls, wing: s.input, mass: s.input.mass, system: 'metric' }) }),
          h(StructurePlan, { structure, analysis: a, parts, selected: 'A1-2', system: 'metric' }),
          h(ControlSurfaceEditor, { controls: s.input.controls, selected: 1, wing: s.input, system: 'metric' }),
        ],
      }),
    )
    expect(parts2).toContain('Control surfaces')
    expect(parts2).toContain('wc-sp__hinge')
    expect(parts2).toContain('Aileron A1 rib')
    expect(parts2).toContain('Crow braking')
    expect(parts2).toContain('Landing flap')
    // The servo bays: settings in the editor, drawn on the structure plan, in the weight
    expect(parts2).toContain('A servo bay for this surface')
    expect(parts2).toContain('Mini (the 17 g class)')
    expect(parts2).toContain('HS-65MG, 12 g')
    expect(parts2).toContain('On its side')
    expect(parts2).toContain('wc-sp__servo')
    // The sheeting hatch's pattern lines have a class of their own: the servo hatch outline once
    // shared theirs and was drawn with a stroke a metre wide (a big blue square on the plan)
    expect(parts2).toContain('class="wc-sp__hatch-line"')
    expect(parts2).not.toMatch(/<line[^>]*class="wc-sp__hatch"/)
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

  it('renders a foam-core wing, its editor, charts, plan and export dialogue', async () => {
    const s = defaultState()
    s.input.rootChord = 0.4
    s.input.panels = [
      { id: 1, length: 0.5, tipChord: 0.36, sweep: 0.01, dihedral: 0, washout: 0 },
      { id: 2, length: 0.3, tipChord: 0.25, sweep: 0.04, dihedral: 5, washout: 2 },
    ]
    s.input.mass = 2
    s.input.structure.construction = 'foam'
    s.input.controls = {
      surfaces: [{ id: 1, role: 'aileron', panel: 2, from: 0.05, to: 0.25, hingeIn: 0.75, hingeOut: 0.75, up: 20, down: 15, gap: 0.001 }],
      crow: { enabled: false, aileronUp: 25, flapDown: 45 },
      bays: [],
      brakes: [{ id: 1, type: 'blade', panel: 1, at: 0.3, length: 0.08, x: 0.6, chord: 0.03, height: 0.012, blades: 1, surface: 'top', angle: 60 }],
    }
    const html = await render(s)
    expect(html).toContain('Foam core')
    expect(html).toContain('EPS foam, 20 kg/m³ (EPS 100), 2 per side')
    expect(html).toContain('0.6 mm obechi')
    expect(warn).not.toHaveBeenCalled()

    const { default: StructureEditor } = await import('../src/components/StructureEditor.vue')
    const { default: LoadsChart } = await import('../src/components/LoadsChart.vue')
    const { default: StructurePlan } = await import('../src/components/StructurePlan.vue')
    const { default: ExportPanel } = await import('../src/components/ExportPanel.vue')
    const structure = s.input.structure
    const airfoil = resolveAirfoil(s.airfoil)
    const g = wingGeometry({ ...s.input, mode: 'panels' })
    const planform = projectedSampler(wingSampler(s.input, airfoil.params.thickness))
    const perf = airfoilPerformance(airfoil, { mass: s.input.mass, area: g.projectedArea, chord: g.mac, wing: { planform, span: g.span, sweepCos: 1 } })
    const a = analyseStructure({ wing: s.input, airfoil, structure, mass: s.input.mass, spanwise: perf.spanwise, controls: s.input.controls })
    const { parts, cutList } = buildParts(a, a.structure)
    const out = await renderToString(
      createSSRApp({
        render: () => [
          h(StructureEditor, { structure, system: 'metric', edges: a.edges, coveringMass: 0.05 }),
          h(LoadsChart, { analysis: a, ribs: [], system: 'metric', designG: 6 }),
          h(StructurePlan, { structure, analysis: a, parts, selected: null, system: 'metric' }),
          h(ExportPanel, { options: s.input.exportOptions, analysis: a, parts, cutList, system: 'metric' }),
        ],
      }),
    )
    expect(out).toContain('Foam core and skins')
    // No spar on a foam wing: no spar settings, and no spar on the plan
    expect(out).not.toContain('Spar caps')
    expect(out).not.toContain('wc-sp__spar')
    expect(out).not.toContain('Corner gussets')
    expect(out).toContain('Skin wrinkling')
    expect(out).toContain('Wire kerf')
    expect(out).toContain('Download hot-wire templates (DXF)')
    expect(out).toContain('Pocket routing templates')
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
      ['balsa', null, 'custom', 'glass'],
      ['rod', 0.003, 'auto', 'tissue'],
      ['rod', 0.008, 'auto', 'glass', 'open'],
      ['none', null, 'auto', 'fabric'],
    ]) {
      const s = defaultState()
      const structure = defaultStructure()
      structure.le = { ...structure.le, type, diameter, stock, ...(stock === 'custom' ? { width: 0.003, height: 0.003 } : {}) }
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
    // The fit is drawn for every edge with stock, fitting or not (a 3 mm custom leading edge doesn't fit)
    expect(misfits).toBeGreaterThan(0)
    expect(fitDrawn).toBe(5)
    expect(warn).not.toHaveBeenCalled()
  })

  // The section editor's drawing is teleported with the other editors, so it is rendered on its own: a drawn
  // section started from a named seed, and one started from parameters
  it('renders the section editor drawing with its seed outline and markers', async () => {
    const { default: SectionEditor } = await import('../src/components/SectionEditor.vue')
    const { naca4Points, drawnFromParams } = await import('../src/lib/sectionSpline.js')
    const seeded = naca4Points('2412')
    const html = await renderToString(
      createSSRApp({ render: () => h(SectionEditor, { pts: seeded, seed: 'NACA 2412', 'onUpdate:pts': () => {} }) }),
    )
    expect(html).toContain('wc-sec__outline')
    expect(html).toContain('wc-sec__seed')
    expect(html).toContain('wc-sec__camber')
    expect(html).toContain('Camber and markers')
    expect(html).not.toContain('wc-sec__caption')
    const fromParams = drawnFromParams({ thicknessPct: 12, thicknessPosPct: 30, camberPct: 2, camberPosPct: 40, leRadiusPct: 1.5 })
    const html2 = await renderToString(
      createSSRApp({ render: () => h(SectionEditor, { pts: fromParams, seed: null, 'onUpdate:pts': () => {} }) }),
    )
    expect(html2).toContain('wc-sec__outline')
    expect(html2).not.toContain('wc-sec__seed')
    expect(warn).not.toHaveBeenCalled()
  })
  // The side panel (readouts, selected point, curvature check, the XFOIL placeholder) and the command bar's labels
  it('renders the section side panel and the command bar', async () => {
    const { default: SectionEditor } = await import('../src/components/SectionEditor.vue')
    const { default: SectionSide } = await import('../src/components/SectionSide.vue')
    const { naca4Points } = await import('../src/lib/sectionSpline.js')
    const seeded = naca4Points('2412')
    const bar = await renderToString(
      createSSRApp({ render: () => h(SectionEditor, { pts: seeded, seed: 'NACA 2412', ask: async () => true, 'onUpdate:pts': () => {} }) }),
    )
    expect(bar).toContain('Smooth all')
    expect(bar).toContain('Smooth surface')
    expect(bar).toContain('Normalise')
    expect(bar).toContain('Reset')
    const side = await renderToString(
      createSSRApp({ render: () => h(SectionSide, { pts: seeded, selection: { points: [3], segments: [] } }) }),
    )
    expect(side).toContain('Readouts')
    expect(side).toContain('Nose radius, measured')
    expect(side).toContain('Upper point 4')
    expect(side).toContain('Curvature check')
    expect(side).toContain('XFOIL preview')
    expect(side).toContain('Solving')
    const dragging = await renderToString(
      createSSRApp({ render: () => h(SectionSide, { pts: seeded, dragging: true }) }),
    )
    expect(dragging).toContain('Updates when you let go.')
    expect(warn).not.toHaveBeenCalled()
  })

  // A drawn section in use replaces the custom parameters in the aerofoil picker
  it('shows a drawn section in use in the aerofoil picker, in place of the parameters', async () => {
    const { default: AirfoilPicker } = await import('../src/components/AirfoilPicker.vue')
    const { naca4Points } = await import('../src/lib/sectionSpline.js')
    const base = { ...defaultState().airfoil, source: 'custom' }
    const drawn = { ...base, custom: { ...base.custom, drawn: { pts: naca4Points('2412'), seed: 'NACA 2412' } } }
    const html = await renderToString(
      createSSRApp({ render: () => h(AirfoilPicker, { modelValue: drawn, 'onUpdate:modelValue': () => {} }) }),
    )
    expect(html).toContain('Drawn section in use')
    expect(html).toContain('Back to parameters')
    expect(html).not.toContain('wc-thickness')
    const plain = await renderToString(
      createSSRApp({ render: () => h(AirfoilPicker, { modelValue: base, 'onUpdate:modelValue': () => {} }) }),
    )
    expect(plain).toContain('wc-thickness')
    expect(plain).not.toContain('Drawn section in use')
    expect(warn).not.toHaveBeenCalled()
  })
})
