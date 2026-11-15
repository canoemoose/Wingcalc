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
import TraceImport from '../src/components/TraceImport.vue'
import SectionEditor from '../src/components/SectionEditor.vue'
import { setTrace, clearTrace } from '../src/composables/useTraceImage.js'
import { placeTrace } from '../src/lib/traceImage.js'
import { naca4Points } from '../src/lib/sectionSpline.js'

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

  // Mounts a component inside a .wingcalc root, failing on any error or Vue warning
  async function mount(component, props) {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    const root = document.createElement('div')
    document.body.appendChild(root)
    let failed = null
    const app = createApp({ render: () => h('div', { class: 'wingcalc' }, [h(component, props)]) })
    app.config.errorHandler = (e) => (failed = e)
    app.mount(root)
    await nextTick()
    await nextTick()
    const check = () => {
      expect(failed).toBe(null)
      expect(warn).not.toHaveBeenCalled()
      expect(error).not.toHaveBeenCalled()
      warn.mockRestore()
      error.mockRestore()
    }
    return { root, app, check }
  }
  const pointer = (el, type, x, y, button = 0) => el.dispatchEvent(new PointerEvent(type, { clientX: x, clientY: y, button, pointerId: 1, pointerType: 'mouse', bubbles: true }))

  it('opens the trace image dialogue, drags a marker and turns the picture', async () => {
    const accept = vi.fn()
    const { root, app, check } = await mount(TraceImport, { source: { url: 'blob:x', w: 1000, h: 400 }, onAccept: accept, onCancel: () => {} })
    expect(root.textContent).toContain('Trace image')
    const svg = root.querySelector('.wc-trace__svg')
    const mark = () => root.querySelector('.wc-trace__mark circle')
    const x0 = Number(mark().getAttribute('cx'))
    const y0 = Number(mark().getAttribute('cy'))
    pointer(svg, 'pointerdown', x0, y0)
    pointer(svg, 'pointermove', x0 + 40, y0 + 10)
    pointer(svg, 'pointerup', x0 + 40, y0 + 10)
    await nextTick()
    expect(Number(mark().getAttribute('cx'))).toBeCloseTo(x0 + 40, 6)
    expect(Number(mark().getAttribute('cy'))).toBeCloseTo(y0 + 10, 6)
    // A quarter turn shows in the angle box, and Level chord brings the tilt back to zero
    const button = (t) => [...root.querySelectorAll('button')].find((b) => b.textContent.trim() === t)
    button('Turn right 90°').click()
    await nextTick()
    expect(root.querySelector('.wc-trace__angle input').value).toBe('90.0')
    button('Level chord').click()
    await nextTick()
    expect(root.querySelector('.wc-trace__tilt').textContent).toMatch(/0\.0°/)
    check()
    app.unmount()
  })

  it('draws the trace image behind the section editor grid', async () => {
    setTrace({ url: 'blob:y', w: 800, h: 200, place: placeTrace([50, 100], [750, 100], { le: { x: 0, y: 0 }, ux: 1, uy: 0, L: 1 }), source: { url: 'blob:z', w: 800, h: 200, deg: 0 } })
    const { root, app, check } = await mount(SectionEditor, { pts: naca4Points('2412'), seed: '2412' })
    const svg = root.querySelector('.wc-sec__svg')
    // First in the drawing, so the grid, axes and outline draw over it
    expect(svg.firstElementChild.tagName.toLowerCase()).toBe('image')
    expect(svg.firstElementChild.getAttribute('transform')).toMatch(/^matrix\(/)
    expect([...root.querySelectorAll('.wc-stage__corner--tl button')].some((b) => b.textContent.trim() === 'Image')).toBe(true)
    check()
    app.unmount()
    clearTrace()
  })
})
