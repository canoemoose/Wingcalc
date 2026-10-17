import { describe, it, expect } from 'vitest'
import { createSSRApp, h } from 'vue'
import { renderToString } from 'vue/server-renderer'
import { LE_STOCK, TE_STOCK, profileOutline } from '../src/lib/edgeStock.js'
import EdgeStockPicker from '../src/components/EdgeStockPicker.vue'

describe('edge stock thumbnails', () => {
  it('outlines each kind of stock at its own depth and height', () => {
    const kinds = new Map([...LE_STOCK, ...TE_STOCK].map((it) => [it.kind, it]))
    expect([...kinds.keys()].sort()).toEqual(['square', 'strip', 'symmetrical', 'triangular'])
    for (const it of kinds.values()) {
      const o = profileOutline(it)
      const us = o.map(([u]) => u), zs = o.map(([, z]) => z)
      expect(Math.min(...us)).toBeCloseTo(0, 9)
      expect(Math.max(...us)).toBeCloseTo(it.width, 9)
      expect(Math.max(...zs) - Math.min(...zs)).toBeCloseTo(it.height, 4)
    }
  })

  it('renders the chosen stock with its cross-section', async () => {
    const it = LE_STOCK[0]
    const html = await renderToString(
      createSSRApp({
        render: () =>
          h(EdgeStockPicker, {
            id: 'les',
            label: 'Leading edge stock',
            modelValue: it.id,
            options: [{ value: 'auto', label: 'Auto' }, { value: it.id, label: it.code }, { value: 'custom', label: 'Custom' }],
            items: { [it.id]: it },
          }),
      }),
    )
    expect(html).toContain(it.code)
    expect(html).toContain('aria-haspopup="listbox"')
    expect(html).toMatch(/<polygon points="[\d.,\s]+"/)
  })
})
