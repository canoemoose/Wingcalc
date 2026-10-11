// Smoke test: render the whole app on the server (Vue's server renderer runs every
// component's setup, computed values and template) from a saved working state, and fail on
// any error or Vue warning. Catches template and wiring crashes that unit tests of
// src/lib can't; it doesn't replace looking at the running app.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createSSRApp, h } from 'vue'
import { renderToString } from 'vue/server-renderer'
import { defaultState } from '../src/lib/projects.js'

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
})
