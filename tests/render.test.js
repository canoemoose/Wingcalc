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

  // The structure editor's window isn't rendered on the server (it's teleported), so its
  // parts are rendered on their own
  it('renders the structure editor and charts for each leading edge type', async () => {
    const { default: StructureEditor } = await import('../src/components/StructureEditor.vue')
    const { default: LoadsChart } = await import('../src/components/LoadsChart.vue')
    let fitDrawn = 0
    let misfits = 0
    for (const [type, diameter, stock = 'auto'] of [
      ['balsa', null],
      ['balsa', null, 'L320'],
      ['rod', 0.003],
      ['rod', 0.008],
      ['none', null],
    ]) {
      const s = defaultState()
      const structure = defaultStructure()
      structure.le = { ...structure.le, type, diameter, stock }
      const airfoil = resolveAirfoil(s.airfoil)
      const g = wingGeometry({ ...s.input, mode: 'panels' })
      const planform = projectedSampler(wingSampler(s.input, airfoil.params.thickness))
      const perf = airfoilPerformance(airfoil, { mass: s.input.mass, area: g.projectedArea, chord: g.mac, wing: { planform, span: g.span, sweepCos: 1 } })
      const a = analyseStructure({ wing: s.input, airfoil, structure, mass: s.input.mass, spanwise: perf.spanwise })
      const { parts } = buildParts(a, a.structure)
      const html = await renderToString(
        createSSRApp({
          render: () => [
            h(StructureEditor, { structure, system: 'metric', edges: a.edges }),
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
