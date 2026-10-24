<script setup>
// One piece of the wing on its own. The selection is a part (from the plan or the list) or a
// piece picked in the 3D view (wing3d.js wingPieces): a rib, a gusset, the leading edge, a
// spar cap, a servo, whatever is drawn. A part cut from sheet is drawn flat at true
// proportions (outline, holes, engraved lines and label, with its size, quantity and notes), and
// any other piece as pieceDrawing.js draws it (a cap strip's profile, a strip's section, a
// foam core's block, a servo's side view), dimensioned;
// under that, the piece in 3D as it sits in the wing (a part picked from the list shows its
// first piece; one not drawn in the wing, such as a hatch or a template, shows as a solid of
// its thickness). The list opens with a thumbnail of each part, then the pieces that aren't
// cut from sheet; the arrows step through it.
import { computed, ref, nextTick, onMounted, onBeforeUnmount, defineAsyncComponent } from 'vue'
import { bounds } from '../lib/ribs.js'
import { strokeText } from '../lib/strokeFont.js'
import { MATERIALS } from '../lib/structure.js'
import { pieceOutline } from '../lib/wing3d.js'
import { pieceDrawing } from '../lib/pieceDrawing.js'
import { format, defaultUnit } from '../lib/units.js'

// The 3D view loads with three.js, in its own chunk
const PartSolid = defineAsyncComponent(() => import('./PartSolid.vue'))

const props = defineProps({
  parts: { type: Array, required: true },
  // The wing's pieces and the model they're drawn from (wing3d), for showing one as placed
  pieces: { type: Array, default: () => [] },
  model: { type: Object, default: null },
  // The structure analysis, for drawing a piece that isn't a part (a core's block)
  analysis: { type: Object, default: null },
  // The direction the wing's 3D view looks from, for showing a placed piece the same way round
  viewDir: { type: Array, default: null },
  selected: { type: String, default: null },
  system: { type: [String, Object], required: true }, // a units setting (units.js normaliseUnits) or system name
})
const emit = defineEmits(['select'])

// --- What's selected --------------------------------------------------------------------------

const selPiece = computed(() => props.pieces.find((p) => p.id === props.selected) ?? null)
// The part: selected, or the one the selected piece is cut as
const part = computed(() => props.parts.find((p) => p.id === props.selected) ?? (selPiece.value?.part ? props.parts.find((p) => p.id === selPiece.value.part) : null) ?? null)
// The pieces cut as that part, and the one shown: the selected piece, or the part's first
const placed = computed(() => (part.value ? props.pieces.filter((p) => p.part === part.value.id) : []))
const piece = computed(() => selPiece.value ?? placed.value[0] ?? null)
const title = computed(() => selPiece.value?.name ?? part.value?.name ?? '')

// SVG y runs down, so flip z.
const pts = (list) => list.map(([u, z]) => `${u.toFixed(5)},${(-z).toFixed(5)}`).join(' ')
const view = computed(() => {
  const b = bounds(part.value.outline)
  const pad = Math.max(b.w, b.h) * 0.04
  return { box: `${b.x0 - pad} ${-b.y1 - pad} ${b.w + 2 * pad} ${b.h + 2 * pad}`, b }
})
const label = computed(() => {
  const l = part.value?.label
  if (!l?.text) return []
  return strokeText(l.text, l.u, l.z, l.h)
})
const len = (v) => format(v, 'thin', defaultUnit(props.system, 'thin'))
const long = (v) => format(v, 'length', defaultUnit(props.system, 'length'))
const material = (key) => (key ? (MATERIALS[key]?.label.toLowerCase() ?? key) : '')

// A piece that isn't a part, drawn flat (pieceDrawing), with its dimension lines placed: each
// off its side by a gap in proportion to the drawing, its label beside it
const drawing = computed(() => {
  if (part.value || !piece.value || !props.analysis) return null
  const d = pieceDrawing(props.analysis, props.analysis.structure, piece.value)
  if (!d) return null
  const b = bounds(d.shapes.flatMap((s) => s.pts))
  const k = Math.max(b.w, b.h)
  const gap = k * 0.08
  const text = k * 0.055
  const dims = d.dims.map((m) => {
    const [[u0, z0], [u1, z1]] = [m.from, m.to]
    const o = m.side === 'below' ? [0, -gap] : m.side === 'left' ? [-gap, 0] : [gap, 0]
    const a = [u0 + o[0], z0 + o[1]]
    const c = [u1 + o[0], z1 + o[1]]
    const L = Math.hypot(u1 - u0, z1 - z0)
    const mid = [(a[0] + c[0]) / 2, (a[1] + c[1]) / 2]
    const label = m.side === 'below' ? { x: mid[0], y: -(mid[1] - text * 1.1), anchor: 'middle' } : m.side === 'left' ? { x: mid[0] - text * 0.4, y: -mid[1] + text * 0.35, anchor: 'end' } : { x: mid[0] + text * 0.4, y: -mid[1] + text * 0.35, anchor: 'start' }
    return { line: [a, c], ext: [[[u0, z0], a], [[u1, z1], c]], label: { ...label, text: len(L) } }
  })
  // Room round it for the dimensions and their labels
  const padL = d.dims.some((m) => m.side === 'left') ? gap + text * 5 : gap
  const padR = d.dims.some((m) => m.side === 'right') ? gap + text * 5 : gap
  const padB = d.dims.some((m) => m.side === 'below') ? gap + text * 1.8 : gap
  const pad = gap * 0.6
  // A section's hatching, its spacing in proportion to the drawing; the label above it
  const hatch = k * 0.045
  const padT = d.label ? gap + text * 1.6 : pad
  const label = d.label ? { x: b.x0, y: -b.y1 - gap * 0.6, text: d.label } : null
  return { ...d, dims, text, hatch, label, box: `${b.x0 - padL} ${-b.y1 - padT} ${b.w + padL + padR} ${b.h + padT + padB}` }
})

// The 3D view's subject: the piece's own geometry as placed, or the part as a flat solid
const solid = computed(() => {
  const p = piece.value
  if (p && props.model) {
    const solids = p.solids.map((i) => props.model.solids[i])
    const plates = [p.rib, p.capStrip].filter(Boolean)
    return { solids, plates, material: p.material, kind: p.kind }
  }
  if (!part.value) return null
  return { flat: { ...part.value, etch: [...(part.value.etch ?? []), ...label.value] }, material: part.value.material }
})
// A piece that isn't a part: its material and its greatest length
const pieceSize = computed(() => {
  const p = piece.value
  if (!p || !props.model) return ''
  if (p.capStrip) return [material(p.material), `${long(bounds(p.capStrip.outline).w)} long`].filter(Boolean).join(', ')
  const lo = [Infinity, Infinity, Infinity]
  const hi = [-Infinity, -Infinity, -Infinity]
  for (const i of p.solids) {
    const pos = props.model.solids[i].positions
    for (let k = 0; k < pos.length; k += 3) {
      for (let j = 0; j < 3; j++) {
        lo[j] = Math.min(lo[j], pos[k + j])
        hi[j] = Math.max(hi[j], pos[k + j])
      }
    }
  }
  if (!Number.isFinite(lo[0])) return material(p.material)
  const L = Math.max(...hi.map((v, j) => v - lo[j]))
  return [material(p.material), `${long(L)} long`].filter(Boolean).join(', ')
})

// --- The list: the parts, then the pieces that aren't parts --------------------------------------

const GROUPS = {
  ribs: 'Ribs',
  surfaces: 'Control surface ribs',
  hinges: 'Hinges',
  servos: 'Servo bays',
  brakes: 'Air brakes',
  gussets: 'Gussets',
  braces: 'Dihedral braces',
  webs: 'Shear webs',
  spars: 'Spar templates',
  sheeting: 'Sheeting',
  tip: 'Tip',
  templates: 'Hot-wire templates',
  skins: 'Skins',
  pockets: 'Pocket templates',
}
const PIECE_GROUPS = {
  spar: 'Spar and edges',
  le: 'Spar and edges',
  te: 'Spar and edges',
  teMoving: 'Spar and edges',
  hinge: 'Hinge spars',
  hingeMoving: 'Hinge spars',
  stringer: 'Stringers',
  capStrip: 'Cap strips',
  servo: 'Servos',
  servoOutput: 'Servos',
  servoLead: 'Servos',
  servoArm: 'Servo linkages',
  horn: 'Servo linkages',
  pushrod: 'Servo linkages',
  core: 'Foam cores',
  coreMoving: 'Foam cores',
  web: 'Shear webs',
  sheet: 'Sheeting',
}
const sizeText = (p) => {
  const b = bounds(p.outline)
  return `${len(b.w)} × ${len(b.h)}`
}
const entries = computed(() => [
  ...props.parts.map((p) => ({ id: p.id, name: p.name, group: GROUPS[p.group] ?? p.group, outline: p.outline, holes: p.holes ?? [], detail: `${sizeText(p)}, ${p.qty} off` })),
  ...(props.model ? props.pieces.filter((p) => !p.part) : []).map((p) => ({ id: p.id, name: p.name, group: PIECE_GROUPS[p.kind] ?? 'Other pieces', outline: pieceOutline(props.model, p), holes: [], detail: material(p.material) })),
])
// The list entry for the selection: its part, or the piece itself
const index = computed(() => Math.max(0, entries.value.findIndex((e) => e.id === (part.value?.id ?? selPiece.value?.id))))
// Groups in the order they first appear
const runs = computed(() => {
  const out = []
  entries.value.forEach((p, i) => {
    const last = out.at(-1)
    if (last?.group === p.group) last.items.push({ p, i })
    else out.push({ group: p.group, items: [{ p, i }] })
  })
  return out
})
const step = (k) => {
  const n = entries.value.length
  if (n) emit('select', entries.value[(index.value + k + n) % n].id)
}

// Each thumbnail fitted to its own box, so a gusset reads as well as a rib: the outline and
// holes as one path, the holes cut out
const TW = 56
const TH = 30
function thumb(p) {
  if (!p.outline?.length) return ''
  const b = bounds(p.outline)
  const k = Math.min((TW - 4) / Math.max(b.w, 1e-6), (TH - 4) / Math.max(b.h, 1e-6))
  const x0 = (TW - b.w * k) / 2
  const y0 = (TH - b.h * k) / 2
  const ring = (list) => 'M' + list.map(([u, z]) => `${(x0 + (u - b.x0) * k).toFixed(1)},${(y0 + (b.y1 - z) * k).toFixed(1)}`).join('L') + 'Z'
  return [p.outline, ...p.holes].map(ring).join('')
}

const open = ref(false)
const active = ref(0)
const root = ref(null)
const list = ref(null)
const button = ref(null)
// The open list is fixed to the viewport, so it isn't clipped by the card
const place = ref({})
function position() {
  const r = button.value?.getBoundingClientRect()
  if (!r) return
  const vh = window.innerHeight
  const below = vh - r.bottom - 8
  const above = r.top - 8
  const up = below < 240 && above > below
  place.value = {
    left: `${Math.max(8, Math.min(r.left, window.innerWidth - 308))}px`,
    maxHeight: `${Math.min(420, up ? above : below)}px`,
    ...(up ? { bottom: `${vh - r.top + 2}px` } : { top: `${r.bottom + 2}px` }),
  }
}
async function show() {
  position()
  open.value = true
  active.value = index.value
  await nextTick()
  list.value?.focus()
  reveal()
}
function hide(focusButton = true) {
  open.value = false
  if (focusButton) button.value?.focus()
}
function choose(i) {
  const p = entries.value[i]
  if (p) emit('select', p.id)
  hide()
}
function reveal() {
  list.value?.querySelector(`[data-i="${active.value}"]`)?.scrollIntoView({ block: 'nearest' })
}
function onButtonKey(e) {
  if (['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(e.key)) {
    e.preventDefault()
    show()
  }
}
function onListKey(e) {
  const n = entries.value.length
  const stepBy = { ArrowDown: 1, ArrowUp: -1 }[e.key]
  if (stepBy) active.value = (active.value + stepBy + n) % n
  else if (e.key === 'Home') active.value = 0
  else if (e.key === 'End') active.value = n - 1
  else if (e.key === 'Enter' || e.key === ' ') return e.preventDefault(), choose(active.value)
  else if (e.key === 'Escape') return e.preventDefault(), e.stopPropagation(), hide()
  else if (e.key === 'Tab') return hide(false)
  else return
  e.preventDefault()
  reveal()
}
function onOutside(e) {
  if (open.value && !root.value?.contains(e.target)) hide(false)
}
function onScroll(e) {
  if (open.value && e.target !== list.value) position()
}
onMounted(() => {
  document.addEventListener('pointerdown', onOutside)
  document.addEventListener('scroll', onScroll, true)
  window.addEventListener('resize', onScroll)
})
onBeforeUnmount(() => {
  document.removeEventListener('pointerdown', onOutside)
  document.removeEventListener('scroll', onScroll, true)
  window.removeEventListener('resize', onScroll)
})
const uid = `wc-part-${Math.random().toString(36).slice(2, 8)}`
</script>

<template>
  <figure v-if="part || piece" class="wc-figure wc-part">
    <div class="wc-part__head">
      <button type="button" class="wc-iconbtn" aria-label="Previous" title="Previous" @click="step(-1)">←</button>
      <div ref="root" class="wc-part__picker">
        <button
          ref="button"
          type="button"
          class="wc-input wc-select wc-select--small wc-part__pick"
          aria-haspopup="listbox"
          :aria-expanded="open"
          :aria-controls="`${uid}-list`"
          aria-label="Part"
          :title="title"
          @click="open ? hide() : show()"
          @keydown="onButtonKey"
        >
          <span>{{ title }}</span>
          <span class="wc-part__caret" aria-hidden="true">▾</span>
        </button>
        <ul
          v-if="open"
          :id="`${uid}-list`"
          ref="list"
          class="wc-part__list"
          :style="place"
          role="listbox"
          tabindex="-1"
          aria-label="Parts and pieces"
          :aria-activedescendant="`${uid}-opt-${active}`"
          @keydown="onListKey"
        >
          <template v-for="r in runs" :key="r.group + r.items[0].i">
            <li class="wc-part__group" role="presentation">{{ r.group }}</li>
            <li
              v-for="{ p, i } in r.items"
              :id="`${uid}-opt-${i}`"
              :key="p.id"
              :data-i="i"
              class="wc-part__opt"
              :class="{ 'wc-part__opt--active': i === active }"
              role="option"
              :aria-selected="i === index"
              @pointerenter="active = i"
              @click="choose(i)"
            >
              <svg class="wc-part__thumb" :viewBox="`0 0 ${TW} ${TH}`" aria-hidden="true"><path :d="thumb(p)" /></svg>
              <span class="wc-part__opt-text">
                <span>{{ p.name }}</span>
                <span v-if="p.detail" class="wc-part__opt-size">{{ p.detail }}</span>
              </span>
            </li>
          </template>
        </ul>
      </div>
      <button type="button" class="wc-iconbtn" aria-label="Next" title="Next" @click="step(1)">→</button>
      <span v-if="part" class="wc-part__size">
        <template v-if="selPiece && selPiece.id !== part.id">Cut as {{ part.name }}: </template>{{ len(view.b.w) }} × {{ len(view.b.h) }}, {{ len(part.thickness) }} {{ material(part.material) }}, {{ part.qty }} off
      </span>
      <span v-else class="wc-part__size">{{ pieceSize }}<template v-if="drawing?.extra?.blockLength">; block {{ long(drawing.extra.blockLength) }} long</template></span>
    </div>
    <svg v-if="part" :viewBox="view.box" preserveAspectRatio="xMidYMid meet" role="img" :aria-label="`Part ${part.name}`">
      <polygon :points="pts(part.outline)" class="wc-part__cut" />
      <polygon v-for="(h, i) in part.holes" :key="'h' + i" :points="pts(h)" class="wc-part__hole" />
      <polyline v-for="(e, i) in part.etch" :key="'e' + i" :points="pts(e)" class="wc-part__etch" />
      <polyline v-for="(e, i) in label" :key="'l' + i" :points="pts(e)" class="wc-part__etch" />
    </svg>
    <svg v-else-if="drawing" :viewBox="drawing.box" preserveAspectRatio="xMidYMid meet" role="img" :aria-label="drawing.caption">
      <defs>
        <pattern :id="`${uid}-hatch`" patternUnits="userSpaceOnUse" :width="drawing.hatch" :height="drawing.hatch" patternTransform="rotate(45)">
          <line x1="0" y1="0" x2="0" :y2="drawing.hatch" class="wc-part__hatch" :stroke-width="drawing.hatch * 0.14" />
        </pattern>
      </defs>
      <text v-if="drawing.label" :x="drawing.label.x" :y="drawing.label.y" :font-size="drawing.text * 1.05" class="wc-part__sectionlabel">{{ drawing.label.text }}</text>
      <template v-for="(s, i) in drawing.shapes" :key="'s' + i">
        <template v-if="s.kind === 'section'">
          <polygon :points="pts(s.pts)" class="wc-part__cut" />
          <polygon :points="pts(s.pts)" class="wc-part__section" :fill="`url(#${uid}-hatch)`" />
        </template>
        <polygon v-else :points="pts(s.pts)" :class="`wc-part__${s.kind === 'cut' ? 'cut' : s.kind === 'hole' ? 'hole' : s.kind === 'dash' ? 'dash' : 'line'}`" />
      </template>
      <g v-for="(m, i) in drawing.dims" :key="'d' + i" class="wc-part__dim">
        <polyline v-for="(e, j) in m.ext" :key="j" :points="pts(e)" class="wc-part__dimext" />
        <polyline :points="pts(m.line)" class="wc-part__dimline" />
        <text :x="m.label.x" :y="m.label.y" :text-anchor="m.label.anchor" :font-size="drawing.text" class="wc-part__dimtext">{{ m.label.text }}</text>
      </g>
    </svg>
    <PartSolid v-if="solid" :subject="solid" :view-dir="viewDir" />
    <figcaption v-if="part?.notes.length || (part && placed.length > 1 && !selPiece) || drawing" class="wc-figure__caption">
      <span v-if="drawing">{{ drawing.caption }}.</span>
      <span v-if="part && placed.length > 1 && !selPiece">In 3D, the first of the {{ placed.length }} pieces cut as {{ part.name }}, as it sits in the wing.</span>
      <span v-for="(n, i) in part?.notes ?? []" :key="i">{{ n }}.</span>
    </figcaption>
  </figure>
</template>
