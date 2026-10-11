<script setup>
// The half wing seen from above, flat as built, with its structure: leading and trailing
// edge stock, the spar, stringers and every rib. Bays where a margin falls below zero are
// shaded. Click a rib to select it.
import { computed } from 'vue'
import { flatPanels } from '../lib/wing.js'

const props = defineProps({
  analysis: { type: Object, required: true },
  structure: { type: Object, required: true },
  parts: { type: Array, required: true },
  selected: { type: String, default: null },
})
const emit = defineEmits(['select'])

const a = computed(() => props.analysis)
const flat = computed(() => flatPanels(a.value.wing))

const ribs = computed(() => props.parts.filter((p) => p.group === 'ribs'))

const geom = computed(() => {
  const an = a.value
  const st = props.structure
  const s0 = an.rootS
  const s1 = an.tipS
  const n = 80
  const line = (fn) => {
    const pts = []
    for (let i = 0; i <= n; i++) {
      const s = s0 + ((s1 - s0) * i) / n
      const v = fn(s)
      if (Number.isFinite(v)) pts.push(`${s.toFixed(5)},${v.toFixed(5)}`)
    }
    return pts.join(' ')
  }
  const sec = (s) => an.section(s)
  const sp = st.spar
  const halfW = (sp.type === 'caps' || sp.type === 'box' ? sp.capWidth : sp.type === 'solid' ? sp.solidWidth : sp.tubeDiameter) / 2
  const sparEnd = sp.type === 'tube' && Number.isFinite(sp.tubeLength) ? Math.min(s1, s0 + sp.tubeLength) : s1
  const band = []
  for (let i = 0; i <= n; i++) {
    const s = s0 + ((sparEnd - s0) * i) / n
    band.push([s, an.sparX(s) - halfW])
  }
  for (let i = n; i >= 0; i--) {
    const s = s0 + ((sparEnd - s0) * i) / n
    band.push([s, an.sparX(s) + halfW])
  }
  // D-box or sheeting area, lightly shaded
  const sheetTo = st.covering.type === 'sheeted' ? (s) => sec(s).xl + sec(s).c - st.te.width : st.covering.type === 'dbox' ? (s) => an.sparX(s) + halfW : null
  let sheet = null
  if (sheetTo) {
    const pts = []
    for (let i = 0; i <= n; i++) {
      const s = s0 + ((s1 - s0) * i) / n
      pts.push([s, sec(s).xl])
    }
    for (let i = n; i >= 0; i--) {
      const s = s0 + ((s1 - s0) * i) / n
      pts.push([s, sheetTo(s)])
    }
    sheet = pts.map(([x, y]) => `${x.toFixed(5)},${y.toFixed(5)}`).join(' ')
  }
  return {
    le: line((s) => sec(s).xl + st.le.width),
    te: line((s) => sec(s).xl + sec(s).c - st.te.width),
    spar: band.map(([x, y]) => `${x.toFixed(5)},${y.toFixed(5)}`).join(' '),
    stringers: (st.stringers ?? []).filter((x) => Number.isFinite(x.position)).map((x) => line((s) => sec(s).xl + x.position * sec(s).c)),
    sheet,
  }
})

// Each rib as a line in plan, from the LE stock to the TE stock
const ribLines = computed(() =>
  ribs.value.map((p) => {
    const r = p.rib
    const ang = (r.angle * Math.PI) / 180
    const d = [Math.sin(ang), Math.cos(ang)]
    const P = [p.s, a.value.sparX(p.s)]
    const at = (u) => [P[0] + d[0] * (u - r.sparU), P[1] + d[1] * (u - r.sparU)]
    const [x1, y1] = at(r.uA)
    const [x2, y2] = at(r.uB)
    return { id: p.id, name: p.name, kind: p.kind, x1, y1, x2, y2 }
  }),
)

// Bays with a negative margin anywhere in them
const weak = computed(() => {
  const list = ribs.value
  const out = []
  for (let i = 1; i < list.length; i++) {
    const s0 = list[i - 1].s
    const s1 = list[i].s
    const bad = a.value.stations.some((r) => r.s >= s0 - 1e-9 && r.s <= s1 + 1e-9 && Object.values(r.ms).some((m) => Number.isFinite(m) && m < 0))
    if (bad) out.push({ s0, s1 })
  }
  return out
})

const view = computed(() => {
  const pts = [...flat.value.panels.flatMap((p) => p.polygon), ...(flat.value.tip?.polygon ?? [])]
  const xs = pts.map(([s]) => s)
  const ys = pts.map(([, x]) => x)
  const x0 = Math.min(0, ...xs)
  const x1 = Math.max(...xs)
  const y0 = Math.min(...ys)
  const y1 = Math.max(...ys)
  const pad = Math.max(x1 - x0, y1 - y0) * 0.04
  const top = y0 - pad - (y1 - y0) * 0.12 // room for rib names above the leading edge
  return { x0: x0 - pad, y0: top, w: x1 - x0 + 2 * pad, h: y1 - top + pad, font: (y1 - y0) * 0.07, y1 }
})

const poly = (pts) => pts.map(([s, x]) => `${s.toFixed(5)},${x.toFixed(5)}`).join(' ')
const fuselage = computed(() => {
  const an = a.value
  const half = an.sampler.half
  if (!(half > 0) || an.rootS >= half) return null
  return poly([
    [0, 0],
    [half, 0],
    [half, an.wing.rootChord],
    [0, an.wing.rootChord],
  ])
})
const labelEvery = computed(() => Math.max(1, Math.ceil(ribs.value.length / 24)))
</script>

<template>
  <figure class="wc-figure wc-structure-plan">
    <svg
      :viewBox="`${view.x0} ${view.y0} ${view.w} ${view.h}`"
      preserveAspectRatio="xMidYMid meet"
      role="img"
      aria-label="Wing structure seen from above, one side"
    >
      <rect v-for="(b, i) in weak" :key="'w' + i" :x="b.s0" :y="view.y0" :width="b.s1 - b.s0" :height="view.h" class="wc-sp__weak" />
      <polygon v-if="fuselage" :points="fuselage" class="wc-sp__outline" />
      <polygon v-for="p in flat.panels" :key="'p' + p.index" :points="poly(p.polygon)" class="wc-sp__outline" />
      <polygon v-if="flat.tip" :points="poly(flat.tip.polygon)" class="wc-sp__outline wc-sp__tip" />
      <polygon v-if="geom.sheet" :points="geom.sheet" class="wc-sp__sheet" />
      <polyline :points="geom.le" class="wc-sp__stock" />
      <polyline :points="geom.te" class="wc-sp__stock" />
      <polyline v-for="(s, i) in geom.stringers" :key="'s' + i" :points="s" class="wc-sp__stringer" />
      <polygon :points="geom.spar" class="wc-sp__spar" />
      <g v-for="(r, i) in ribLines" :key="r.id" class="wc-sp__rib" :class="{ 'wc-sp__rib--selected': r.id === selected, 'wc-sp__rib--hard': r.kind !== 'normal' }">
        <line :x1="r.x1" :y1="r.y1" :x2="r.x2" :y2="r.y2" class="wc-sp__ribline" />
        <line :x1="r.x1" :y1="r.y1" :x2="r.x2" :y2="r.y2" class="wc-sp__ribhit" @click="emit('select', r.id)">
          <title>{{ r.name }}</title>
        </line>
        <text
          v-if="i % labelEvery === 0 || r.id === selected"
          :x="r.x1"
          :y="r.y1 - view.font * 0.6"
          :font-size="view.font"
          text-anchor="middle"
          class="wc-sp__label"
        >
          {{ r.name }}
        </text>
      </g>
    </svg>
    <figcaption class="wc-figure__caption">
      One side, flat as built, leading edge at the top. Spar in accent colour<template v-if="geom.sheet">,
        sheeted area shaded</template
      ><template v-if="weak.length">; bays shaded red have a negative margin somewhere</template>. Click a rib to see it.
    </figcaption>
  </figure>
</template>
