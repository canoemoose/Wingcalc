<script setup>
// Getting a picture ready to trace over in the section editor: turn it level, crop it, and mark its leading and
// trailing edges. The markers set where it lands on the drawing's chord; rotation and crop are for comfort and to trim
// what isn't needed. Use image renders the turned crop to a canvas and hands it back with the markers in its pixels.
// The maths is in src/lib/traceImage.js.
import { ref, computed, watch, onMounted, onBeforeUnmount, nextTick, useId } from 'vue'
import StageZoom from './StageZoom.vue'
import { usePinch } from '../composables/usePinch.js'
import {
  rotatedBounds, toRotated, fromRotated, levelAngle, chordTilt, splitAngle, wrapDeg, dragCrop, outputScale, markersOut,
} from '../lib/traceImage.js'

const props = defineProps({
  // The picture: { url, w, h } and, when adjusting an earlier one, its { deg, crop, le, te }
  source: { type: Object, required: true },
})
const emit = defineEmits(['accept', 'cancel'])

const id = useId()
const src = props.source
const deg = ref(src.deg ?? 0)
const bounds = computed(() => rotatedBounds(src.w, src.h, deg.value))
const fullCrop = () => ({ x: 0, y: 0, w: bounds.value.w, h: bounds.value.h })
const crop = ref(src.crop ? { ...src.crop } : fullCrop())
// Until the crop is dragged it follows the whole picture as it turns
const cropped = ref(!!src.crop)
const le = ref(src.le ? [...src.le] : [src.w * 0.1, src.h / 2])
const te = ref(src.te ? [...src.te] : [src.w * 0.9, src.h / 2])
// The marker the arrow keys move: the last one dragged
const active = ref('le')

watch(deg, () => {
  const B = bounds.value
  if (!cropped.value) crop.value = fullCrop()
  else {
    const w = Math.min(B.w, crop.value.w)
    const h = Math.min(B.h, crop.value.h)
    crop.value = { x: Math.min(B.w - w, Math.max(0, crop.value.x)), y: Math.min(B.h - h, Math.max(0, crop.value.y)), w, h }
  }
})

const fine = computed(() => splitAngle(deg.value).fine)
const quarter = computed(() => splitAngle(deg.value).quarter)
const tilt = computed(() => chordTilt(le.value, te.value, src.w, src.h, deg.value))
const markersApart = computed(() => Math.hypot(te.value[0] - le.value[0], te.value[1] - le.value[1]) >= 10)

function turn(by) {
  deg.value = wrapDeg(deg.value + by)
}
function setFine(v) {
  deg.value = wrapDeg(quarter.value + Number(v))
}
function level() {
  deg.value = levelAngle(le.value, te.value)
}
function resetCrop() {
  cropped.value = false
  crop.value = fullCrop()
}

// The angle box commits on Enter or blur, like every other number box
const angleText = ref(deg.value.toFixed(1))
const angleFocused = ref(false)
watch(deg, (d) => {
  if (!angleFocused.value) angleText.value = d.toFixed(1)
})
function commitAngle() {
  const n = Number(String(angleText.value).replace('−', '-').replace('°', ''))
  if (Number.isFinite(n)) deg.value = wrapDeg(n)
  angleText.value = deg.value.toFixed(1)
}

/* ------------------------------ view ------------------------------ */

const MARGIN = 24
const BOTTOM = 50
const stageEl = ref(null)
const svgEl = ref(null)
const W = ref(800)
const H = ref(480)
const k = ref(1)
const tx = ref(0)
const ty = ref(0)
const toScreen = ([x, y]) => [tx.value + x * k.value, ty.value + y * k.value]
const fromScreen = ([x, y]) => [(x - tx.value) / k.value, (y - ty.value) / k.value]

function fit() {
  const B = bounds.value
  k.value = Math.max(1e-4, Math.min((W.value - 2 * MARGIN) / B.w, (H.value - MARGIN - BOTTOM) / B.h))
  tx.value = (W.value - B.w * k.value) / 2
  ty.value = MARGIN + (H.value - MARGIN - BOTTOM - B.h * k.value) / 2
}
function zoomAt(px, py, f) {
  const [x, y] = fromScreen([px, py])
  k.value = Math.max(1e-4, Math.min(k.value * f, 64))
  tx.value = px - x * k.value
  ty.value = py - y * k.value
}
const zoom = (f) => zoomAt(W.value / 2, H.value / 2, f)

let ro = null
let fitted = false
function measure() {
  const r = stageEl.value?.getBoundingClientRect()
  if (!r || !(r.width > 0) || !(r.height > 0)) {
    if (!fitted) fit()
    return
  }
  W.value = r.width
  H.value = r.height
  if (!fitted) {
    fitted = true
    fit()
  }
}

/* ------------------------------ handles ------------------------------ */

const HIT_MARK = 14
const HIT_CROP = 10
const markScreen = (p) => toScreen(toRotated(p, src.w, src.h, deg.value))
const leS = computed(() => markScreen(le.value))
const teS = computed(() => markScreen(te.value))
const cropS = computed(() => {
  const [x0, y0] = toScreen([crop.value.x, crop.value.y])
  const [x1, y1] = toScreen([crop.value.x + crop.value.w, crop.value.y + crop.value.h])
  return { x0, y0, x1, y1 }
})
const cropHandles = computed(() => {
  const { x0, y0, x1, y1 } = cropS.value
  const xm = (x0 + x1) / 2
  const ym = (y0 + y1) / 2
  return [
    ['nw', x0, y0], ['n', xm, y0], ['ne', x1, y0], ['e', x1, ym],
    ['se', x1, y1], ['s', xm, y1], ['sw', x0, y1], ['w', x0, ym],
  ]
})
// The dimmed surround: the whole stage with the crop cut out
const shade = computed(() => {
  const { x0, y0, x1, y1 } = cropS.value
  return `M0,0H${W.value}V${H.value}H0Z M${x0},${y0}V${y1}H${x1}V${y0}Z`
})
const imgTransform = computed(() => {
  const B = bounds.value
  return `translate(${B.w / 2},${B.h / 2}) rotate(${deg.value}) translate(${-src.w / 2},${-src.h / 2})`
})

function hit(p) {
  for (const [name, s] of [['te', teS.value], ['le', leS.value]]) if (Math.hypot(p[0] - s[0], p[1] - s[1]) <= HIT_MARK) return { kind: 'mark', name }
  for (const [h, x, y] of cropHandles.value) if (Math.abs(p[0] - x) <= HIT_CROP && Math.abs(p[1] - y) <= HIT_CROP) return { kind: 'crop', handle: h }
  const { x0, y0, x1, y1 } = cropS.value
  if (p[0] > x0 && p[0] < x1 && p[1] > y0 && p[1] < y1) return { kind: 'crop', handle: 'move' }
  return null
}

const CURSORS = { n: 'ns-resize', s: 'ns-resize', e: 'ew-resize', w: 'ew-resize', nw: 'nwse-resize', se: 'nwse-resize', ne: 'nesw-resize', sw: 'nesw-resize', move: 'move' }
const cursor = ref('')
const panning = ref(false)
let gesture = null

const local = (e) => {
  const r = svgEl.value.getBoundingClientRect()
  return [e.clientX - r.left, e.clientY - r.top]
}

function onDown(e) {
  stageEl.value?.focus({ preventScroll: true })
  const p = local(e)
  const h = e.button === 0 ? hit(p) : null
  // Right or middle button pans, as does a finger anywhere but on a handle. The left button never pans.
  if (e.button === 1 || e.button === 2 || (e.pointerType === 'touch' && !h)) {
    e.preventDefault()
    svgEl.value.setPointerCapture?.(e.pointerId)
    gesture = { kind: 'pan', start: p, tx0: tx.value, ty0: ty.value }
    panning.value = true
    return
  }
  if (!h) return
  e.preventDefault()
  svgEl.value.setPointerCapture?.(e.pointerId)
  if (h.kind === 'mark') active.value = h.name
  gesture = { ...h, start: p, crop0: { ...crop.value }, mark0: h.kind === 'mark' ? toRotated((h.name === 'le' ? le : te).value, src.w, src.h, deg.value) : null }
}

function onMove(e) {
  const p = local(e)
  if (!gesture) {
    const h = hit(p)
    cursor.value = !h ? '' : h.kind === 'mark' ? 'grab' : CURSORS[h.handle]
    return
  }
  const dxs = p[0] - gesture.start[0]
  const dys = p[1] - gesture.start[1]
  if (gesture.kind === 'pan') {
    tx.value = gesture.tx0 + dxs
    ty.value = gesture.ty0 + dys
    return
  }
  const dx = dxs / k.value
  const dy = dys / k.value
  if (gesture.kind === 'mark') {
    const q = fromRotated([gesture.mark0[0] + dx, gesture.mark0[1] + dy], src.w, src.h, deg.value)
    if (gesture.name === 'le') le.value = q
    else te.value = q
    return
  }
  cropped.value = true
  crop.value = dragCrop(gesture.crop0, gesture.handle, dx, dy, bounds.value.w, bounds.value.h, 8 / Math.max(k.value, 1e-4))
}

function onUp(e) {
  if (gesture) svgEl.value?.releasePointerCapture?.(e.pointerId)
  gesture = null
  panning.value = false
}

// The wheel always zooms about the cursor: the dialogue is modal, so there's no page to scroll
function onWheel(e) {
  e.preventDefault()
  const p = local(e)
  zoomAt(p[0], p[1], Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0015)))
}

usePinch(stageEl, {
  start() {
    gesture = null
    panning.value = false
  },
  change({ k: f, x, y, dx: mx, dy: my }) {
    const r = svgEl.value?.getBoundingClientRect()
    if (!r) return
    zoomAt(x - r.left, y - r.top, f)
    tx.value += mx
    ty.value += my
  },
})

// Arrow keys move the last marker dragged a pixel of the picture as shown (Shift for ten)
const NUDGE = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }
function onStageKey(e) {
  if (NUDGE[e.key]) {
    const step = (e.shiftKey ? 10 : 1) / k.value
    const m = active.value === 'le' ? le : te
    const r = toRotated(m.value, src.w, src.h, deg.value)
    m.value = fromRotated([r[0] + NUDGE[e.key][0] * step, r[1] + NUDGE[e.key][1] * step], src.w, src.h, deg.value)
  } else if (e.key === 'f' || e.key === 'F') fit()
  else if (e.key === '+' || e.key === '=') zoom(1.25)
  else if (e.key === '-' || e.key === '_') zoom(1 / 1.25)
  else return
  e.preventDefault()
}

/* ------------------------------ dialogue ------------------------------ */

const dialog = ref(null)
const busy = ref(false)
const failed = ref('')
let opener = null
let img = null
onMounted(() => {
  opener = document.activeElement
  measure()
  if (typeof ResizeObserver !== 'undefined' && stageEl.value) {
    ro = new ResizeObserver(measure)
    ro.observe(stageEl.value)
  }
  svgEl.value?.addEventListener('wheel', onWheel, { passive: false })
  nextTick(() => {
    measure()
    stageEl.value?.focus({ preventScroll: true })
  })
})
onBeforeUnmount(() => {
  ro?.disconnect()
  svgEl.value?.removeEventListener('wheel', onWheel)
  opener?.focus?.()
})

function loadImage() {
  if (img?.complete && img.naturalWidth) return Promise.resolve(img)
  return new Promise((resolve, reject) => {
    img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('load'))
    img.src = src.url
  })
}

// Renders the turned crop and hands it back with the markers in its pixels
async function accept() {
  if (!markersApart.value || busy.value) return
  busy.value = true
  failed.value = ''
  try {
    const picture = await loadImage()
    const c = crop.value
    const B = bounds.value
    const s = outputScale(c)
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(c.w * s))
    canvas.height = Math.max(1, Math.round(c.h * s))
    const ctx = canvas.getContext('2d')
    ctx.imageSmoothingQuality = 'high'
    ctx.scale(s, s)
    ctx.translate(-c.x, -c.y)
    ctx.translate(B.w / 2, B.h / 2)
    ctx.rotate((deg.value * Math.PI) / 180)
    ctx.drawImage(picture, -src.w / 2, -src.h / 2, src.w, src.h)
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'))
    if (!blob) throw new Error('render')
    const where = { w: src.w, h: src.h, deg: deg.value }
    emit('accept', {
      url: URL.createObjectURL(blob),
      w: canvas.width,
      h: canvas.height,
      le: markersOut(le.value, where, c, s),
      te: markersOut(te.value, where, c, s),
      source: { url: src.url, w: src.w, h: src.h, deg: deg.value, crop: { ...c }, le: [...le.value], te: [...te.value] },
    })
  } catch {
    failed.value = "The picture couldn't be prepared. Try a smaller image, or a PNG or JPEG."
  } finally {
    busy.value = false
  }
}

function onKey(e) {
  if (e.key === 'Escape') {
    e.preventDefault()
    e.stopPropagation()
    emit('cancel')
  } else if (e.key === 'Enter' && e.target?.tagName !== 'INPUT' && e.target?.tagName !== 'BUTTON') {
    e.preventDefault()
    accept()
  }
}

const tiltText = computed(() => {
  const t = Math.abs(tilt.value) > 90 ? wrapDeg(tilt.value + 180) : tilt.value
  return `${t >= 0 ? '' : '−'}${Math.abs(t).toFixed(1)}°`
})
</script>

<template>
  <div class="wc-confirm__backdrop" @pointerdown.self="emit('cancel')">
    <div ref="dialog" class="wc-config wc-trace" role="dialog" aria-modal="true" :aria-labelledby="`${id}-title`" tabindex="-1" @keydown="onKey">
      <header class="wc-config__head">
        <h3 :id="`${id}-title`" class="wc-confirm__title">Trace image</h3>
        <p class="wc-config__summary">
          Drag <strong>LE</strong> and <strong>TE</strong> onto the section's leading and trailing edges: the picture is scaled and turned so they land
          on the drawing's chord. Turn it level and drag the frame's edges to crop if that helps.
        </p>
      </header>

      <div
        ref="stageEl"
        class="wc-trace__stage"
        tabindex="0"
        role="group"
        aria-label="Picture to crop and mark"
        @keydown="onStageKey"
        @contextmenu.prevent
      >
        <svg
          ref="svgEl"
          class="wc-trace__svg"
          :class="{ 'wc-trace__svg--panning': panning }"
          :style="cursor && !panning ? { cursor } : null"
          :viewBox="`0 0 ${W} ${H}`"
          aria-hidden="true"
          @pointerdown="onDown"
          @pointermove="onMove"
          @pointerup="onUp"
          @pointercancel="onUp"
        >
          <g :transform="`translate(${tx},${ty}) scale(${k})`">
            <image :href="source.url" :width="source.w" :height="source.h" :transform="imgTransform" preserveAspectRatio="none" />
          </g>
          <path class="wc-trace__shade" :d="shade" fill-rule="evenodd" />
          <rect class="wc-trace__crop" :x="cropS.x0" :y="cropS.y0" :width="cropS.x1 - cropS.x0" :height="cropS.y1 - cropS.y0" />
          <rect v-for="[h, x, y] in cropHandles" :key="h" class="wc-trace__handle" :x="x - 5" :y="y - 5" width="10" height="10" />
          <!-- A level line through the leading edge, to turn the chord against -->
          <line class="wc-trace__level" x1="0" :x2="W" :y1="leS[1]" :y2="leS[1]" />
          <line class="wc-trace__chord" :x1="leS[0]" :y1="leS[1]" :x2="teS[0]" :y2="teS[1]" />
          <g v-for="[name, s] in [['le', leS], ['te', teS]]" :key="name" class="wc-trace__mark" :class="{ 'wc-trace__mark--active': active === name }">
            <circle :cx="s[0]" :cy="s[1]" r="9" />
            <line :x1="s[0] - 14" :x2="s[0] + 14" :y1="s[1]" :y2="s[1]" />
            <line :x1="s[0]" :x2="s[0]" :y1="s[1] - 14" :y2="s[1] + 14" />
            <text :x="s[0] + 12" :y="s[1] - 12">{{ name.toUpperCase() }}</text>
          </g>
        </svg>
        <StageZoom fit-title="Fit the picture to the view (F)" @zoom-in="zoom(1.25)" @zoom-out="zoom(1 / 1.25)" @fit="fit" />
      </div>

      <div class="wc-trace__controls">
        <button type="button" class="wc-button" title="Turn a quarter turn anticlockwise" @click="turn(-90)">Turn left 90°</button>
        <button type="button" class="wc-button" title="Turn a quarter turn clockwise" @click="turn(90)">Turn right 90°</button>
        <label class="wc-trace__fine">
          <span class="wc-field__label">Rotate</span>
          <input class="wc-range" type="range" min="-45" max="45" step="0.1" :value="fine" aria-label="Fine rotation" @input="setFine($event.target.value)" />
        </label>
        <label class="wc-trace__angle">
          <span class="wc-sr-only">Rotation in degrees</span>
          <input
            v-model="angleText"
            class="wc-input wc-input--short"
            inputmode="decimal"
            aria-label="Rotation in degrees"
            @focus="angleFocused = true"
            @blur="angleFocused = false; commitAngle()"
            @keydown.enter.prevent="commitAngle()"
          />°
        </label>
        <button type="button" class="wc-button" title="Turn the picture so the line from LE to TE is level" @click="level">Level chord</button>
        <span class="wc-muted wc-trace__tilt">Chord tilt {{ tiltText }}</span>
        <span class="wc-trace__spacer"></span>
        <button type="button" class="wc-button" :disabled="!cropped" title="Show the whole picture again" @click="resetCrop">Reset crop</button>
      </div>

      <p v-if="failed" class="wc-field__warn">{{ failed }}</p>
      <p v-else-if="!markersApart" class="wc-field__warn">LE and TE are on top of each other. Drag them to the two ends of the section.</p>

      <div class="wc-confirm__actions">
        <button type="button" class="wc-button" @click="emit('cancel')">Cancel</button>
        <button type="button" class="wc-button wc-button--primary" :disabled="!markersApart || busy" @click="accept">Use image</button>
      </div>
    </div>
  </div>
</template>
