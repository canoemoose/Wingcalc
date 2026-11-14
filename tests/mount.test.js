// @vitest-environment happy-dom
// Mounts components in a DOM (happy-dom), which the server render in render.test.js can't do:
// template refs, mounted hooks and event wiring only run here. Fails on any error or Vue warning.
import { describe, it, expect, vi } from 'vitest'
import { createApp, h, nextTick } from 'vue'
import { defaultState } from '../src/lib/projects.js'
import { resolveAirfoil, airfoilPerformance } from '../src/lib/airfoils.js'
import { wingGeometry } from '../src/lib/calc.js'
import { wingSampler, projectedSampler, normalisePanels } from '../src/lib/wing.js'
import { analyseStructure, defaultStructure } from '../src/lib/structure.js'
import { newSurface, defaultControls } from '../src/lib/controlSurfaces.js'
import { linkOf, bayLinkages } from '../src/lib/bayLinkage.js'
import ServoConfigurator from '../src/components/ServoConfigurator.vue'

describe('mounted in a DOM', () => {
  it('opens the servo configurator', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    const s = defaultState()
    s.input.rootChord = 0.45
    s.input.panels = normalisePanels([{ id: 1, length: 0.9, tipChord: 0.4, dihedral: 0 }])
    s.input.mass = 2
    const bay = { surface: 1 }
    const controls = { ...defaultControls(), surfaces: [newSurface('aileron', 1, 0.45, 0.85, 1)], bays: [bay] }
    const airfoil = resolveAirfoil(s.airfoil)
    const g = wingGeometry({ ...s.input, mode: 'panels' })
    const planform = projectedSampler(wingSampler(s.input, airfoil.params.thickness))
    const perf = airfoilPerformance(airfoil, { mass: 2, area: g.projectedArea, chord: g.mac, wing: { planform, span: g.span, sweepCos: 1 } })
    const a = analyseStructure({ wing: s.input, airfoil, structure: defaultStructure(), mass: 2, spanwise: perf.spanwise, controls })
    const l = bayLinkages(a, controls).get(1)
    const props = { system: 'metric', linkage: l, title: l.bay.label, bay: { class: null, rotate: false, flip: false, fore: null, inset: null, link: linkOf(bay) }, autoClass: l.bay.class, mass: 2 }
    const root = document.createElement('div')
    document.body.appendChild(root)
    let failed = null
    const app = createApp({ render: () => h('div', { class: 'wingcalc' }, [h(ServoConfigurator, props)]) })
    app.config.errorHandler = (e) => (failed = e)
    app.mount(root)
    await nextTick()
    await nextTick()
    expect(failed).toBe(null)
    expect(root.textContent).toContain('Servo travel')
    expect(root.querySelectorAll('[role="listbox"]').length).toBe(3)
    expect(warn).not.toHaveBeenCalled()
    expect(error).not.toHaveBeenCalled()
    app.unmount()
  })
})
