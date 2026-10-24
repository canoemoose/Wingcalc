<script setup>
// The servo configurator: a bay's whole servo-to-surface assembly (servo, arm, pushrod, horn) in
// one dialogue, opened from the bay in the structure editor. Columns pick the servo, its arm and
// the horn, each filtering the next; a side view square to the hinge shows the assembly at
// surface neutral, with the designed and achieved throw ranges, and its holes are picked by
// clicking them there or in the table of hole pairs. Nothing changes until "Use this", which
// hands back the bay's class, mounting and link in one go (one undo step).
import { ref, reactive, computed, nextTick, onMounted, useId } from 'vue'
import SegmentedField from './SegmentedField.vue'
import { MOUNTINGS, servoOptions, installedServo, placeServo, SERVOS } from '../lib/servos.js'
import { HORNS, linkage, splineError } from '../lib/linkage.js'
import { configureBay, assemblyGeometry, servoChoices, linkSummary, TRAVELS } from '../lib/bayLinkage.js'
import { format, defaultUnit } from '../lib/units.js'

const props = defineProps({
  system: { type: [String, Object], required: true },
  // bayLinkage.js bayFrame: where the bay's servo stands, the hinge, the throws
  frame: { type: Object, required: true },
  // The bay's name, e.g. "Servo bay SB1"
  title: { type: String, required: true },
  // The bay's settings as saved: class (null for automatic), mounting, link (resolved, linkOf)
  bay: { type: Object, required: true },
  // The class a bay takes automatically, for this weight
  autoClass: { type: String, required: true },
  mass: { type: Number, default: 0 },
})
const emit = defineEmits(['apply', 'cancel'])

const id = useId()
const RAD = Math.PI / 180
const draft = reactive({ cls: props.bay.class ?? '', mounting: props.bay.mounting ?? 'upright', link: { ...props.bay.link } })

const servo = computed(() => installedServo(draft.cls || props.autoClass, draft.mounting, props.mass))
const config = computed(() => configureBay(props.frame, servo.value, draft.link))
const result = computed(() => config.value.result)

// --- Columns ------------------------------------------------------------------------------

const autoLabel = computed(() => `Automatic (${SERVOS[props.autoClass].label.toLowerCase()})`)
const servoGroups = computed(() => {
  const list = servoChoices(props.frame, [{ value: '', label: autoLabel.value, group: 'Generic' }, ...servoOptions()], draft.mounting, props.mass)
  const groups = []
  for (const o of list) {
    const g = groups.at(-1)
    if (g && g.name === o.group) g.items.push(o)
    else groups.push({ name: o.group, items: [o] })
  }
  return groups
})
function pickServo(value) {
  draft.cls = value
  // Holes are per arm and horn: let the new servo find its own
  draft.link = { ...draft.link, arm: null, armRow: 0, armHole: null, hornHole: null }
}

const thin = (v) => format(v, 'thin', defaultUnit(props.system, 'thin'))
const armName = (a) => (a.maker === 'Generic' ? a.name : `${a.maker} ${a.part}`)
const armItems = computed(() =>
  config.value.arms.flatMap((a) =>
    a.holes.map((row, r) => ({
      key: `${a.id}:${r}`,
      arm: a,
      row: r,
      label: a.holes.length > 1 ? `${armName(a)}, ${row.arm}` : armName(a),
      sub: `${a.holes.length > 1 ? '' : `${row.arm}: `}holes at ${row.radii.map((x) => (x * 1000).toFixed(1)).join(', ')} mm`,
      title: a.name,
    })),
  ),
)
const pickArm = (it) => (draft.link = { ...draft.link, arm: it.arm.id, armRow: it.row, armHole: null })
const pickHorn = (h) => (draft.link = { ...draft.link, horn: h.id, hornHole: null })
const pickPair = (i, j) => (draft.link = { ...draft.link, armHole: i, hornHole: j })
const setLink = (patch) => (draft.link = { ...draft.link, ...patch })

const travelOptions = TRAVELS.map((t) => ({ value: t, label: `±${t}°`, title: t === 60 ? 'Extended end points' : 'Standard end points' }))
const faceOptions = [
  { value: 'top', label: 'Top' },
  { value: 'bottom', label: 'Bottom' },
]
const mountOptions = Object.entries(MOUNTINGS).map(([value, label]) => ({ value, label }))
const linkageOptions = [{ value: 'pushrod', label: 'Pushrod', title: 'Pull-pull and torque rods come with the tail and fuselage' }]

// The summary's crumbs jump to their column
const columns = { servo: ref(null), arm: ref(null), horn: ref(null) }
function jump(which) {
  const el = columns[which].value?.querySelector('[aria-selected="true"]') ?? columns[which].value
  el?.scrollIntoView({ block: 'nearest' })
  el?.focus?.()
}
onMounted(() => nextTick(() => ['servo', 'arm', 'horn'].forEach((k) => columns[k].value?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' }))))

// --- Drawing -------------------------------------------------------------------------------

// The view: square to the hinge, x aft along u (in plan), y up, origin on the hinge, mm
const view = computed(() => {
  const h = props.frame.hinge.axis
  let u = [h[1], -h[0], 0]
  const n = Math.hypot(u[0], u[1]) || 1
  u = [u[0] / n, u[1] / n, 0]
  if (u[0] < 0) u = [-u[0], -u[1], 0]
  const H = props.frame.hinge.point
  return (p) => [((p[0] - H[0]) * u[0] + (p[1] - H[1]) * u[1]) * 1000, -(p[2] - H[2]) * 1000]
})
const sv = (p) => view.value(p)

const drawing = computed(() => {
  const c = config.value
  const r = result.value
  const f = props.frame
  const P = sv
  // The servo's solids, each as the box round its projected corners
  const boxes = placeServo(servo.value, f.at)
    .filter((p) => p.box)
    .map((p) => {
      const pts = []
      for (const x of p.box.x) for (const z of p.box.z) pts.push(P([x, f.s, z]))
      const xs = pts.map((q) => q[0])
      const ys = pts.map((q) => q[1])
      return { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys), kind: p.kind }
    })
  const top = f.faces.top * 1000
  const bottom = f.faces.bottom * 1000
  const depth = f.depth * 1000
  const out = { boxes, top, bottom, depth, ok: r.ok }
  // The surface at neutral, and its throw ranges
  const ray = (deg) => [depth * Math.cos(deg * RAD), depth * Math.sin(deg * RAD)]
  out.designUp = ray(-f.up)
  out.designDown = ray(f.down)
  if (r.ok) {
    out.achUp = ray(-r.achieved.up)
    out.achDown = ray(r.achieved.down)
    out.arc = (a0, a1) => {
      const p0 = ray(a0)
      const p1 = ray(a1)
      return `M ${p0[0]} ${-p0[1]} A ${depth} ${depth} 0 0 1 ${p1[0]} ${-p1[1]}`
    }
  }
  // Arm, horn and pushrod at surface neutral
  const radii = c.arm.holes[c.armRow].radii
  // The geometry for the holes in use
  const g = assemblyGeometry(props.frame, servo.value, c, c.armHole, c.hornHole, c.face)
  if (g.radius > 0) {
    const L = linkage(g)
    const t0 = r.ok ? (r.midpoint + r.direction * r.neutralArm) * RAD : 0
    const d = L.armDir(t0)
    const pv = P(g.pivot)
    out.pivot = pv
    out.armHoles = radii.map((rad, i) => ({ i, p: P([g.pivot[0] + d[0] * rad, g.pivot[1] + d[1] * rad, g.pivot[2] + d[2] * rad]) }))
    out.armTip = out.armHoles.at(-1)?.p
    out.armDir = [out.armTip[0] - pv[0], out.armTip[1] - pv[1]]
    const sign = c.face === 'bottom' ? 1 : -1
    out.hornBase = [0, sign * (c.face === 'bottom' ? bottom : top)]
    out.hornTip = [0, sign * ((c.face === 'bottom' ? bottom : top) + c.horn.height * 1000)]
    out.hornHoles = c.horn.holes.map((hh, j) => ({ j, p: [0, sign * ((c.face === 'bottom' ? bottom : top) + hh * 1000)] }))
    out.rod = r.ok ? [out.armHoles[c.armHole].p, out.hornHoles[c.hornHole].p] : null
    out.edgeOn = Math.abs(L.a[0] * L.h[0] + L.a[1] * L.h[1] + L.a[2] * L.h[2]) < 0.5
    out.boss = (servo.value.frame.output.diameter * 1000) / 2
  }
  // The view box round everything, a margin beyond
  const xs = [0, depth, ...boxes.flatMap((b) => [b.x, b.x + b.w]), out.pivot?.[0] ?? 0, ...(out.armHoles ?? []).map((q) => q.p[0])]
  const ys = [-top, bottom, out.designUp[1] * -1, out.designDown[1] * -1, out.hornTip?.[1] ?? 0, ...boxes.flatMap((b) => [b.y, b.y + b.h]), ...(out.armHoles ?? []).map((q) => q.p[1])]
  const x0 = Math.min(...xs) - 8
  const x1 = Math.max(...xs) + 8
  const y0 = Math.min(...ys) - 8
  const y1 = Math.max(...ys) + 8
  out.box = [x0, y0, x1 - x0, y1 - y0]
  out.dot = Math.max(0.6, (x1 - x0) / 170)
  return out
})

// Dragging the arm picks which way it faces: to the other side of the pivot flips it
const svgEl = ref(null)
let dragging = false
function svgPoint(e) {
  const svg = svgEl.value
  const pt = svg.createSVGPoint()
  pt.x = e.clientX
  pt.y = e.clientY
  const q = pt.matrixTransform(svg.getScreenCTM().inverse())
  return [q.x, q.y]
}
function armDown(e) {
  dragging = true
  e.currentTarget.setPointerCapture?.(e.pointerId)
}
function armMove(e) {
  if (!dragging) return
  const d = drawing.value
  if (!d.pivot) return
  const [x, y] = svgPoint(e)
  const v = [x - d.pivot[0], y - d.pivot[1]]
  if (v[0] * d.armDir[0] + v[1] * d.armDir[1] < 0) setLink({ facing: -config.value.facing })
}
const armUp = () => (dragging = false)

// --- Readouts ------------------------------------------------------------------------------

const deg = (v, dp = 0) => `${v.toFixed(dp)}°`
const summary = computed(() => linkSummary(servo.value, config.value))
const crumbs = computed(() => summary.value.split(' › '))

const lines = computed(() => {
  const r = result.value
  const f = props.frame
  if (!r.ok) return []
  const out = []
  out.push({ k: 'Up', v: `${deg(r.achieved.up, 1)} (${thin(r.achieved.upMm)} at the trailing edge), designed ${deg(f.up)}` })
  out.push({ k: 'Down', v: `${deg(r.achieved.down, 1)} (${thin(r.achieved.downMm)}), designed ${deg(f.down)}` })
  out.push({ k: 'Servo travel', v: `±${deg(r.travelNeeded, 1)} of ±${config.value.travel}°` })
  const off = Math.abs(r.neutralArm)
  out.push({
    k: 'Arm at neutral',
    v: off < 0.5 ? 'square to the pushrod' : `${deg(off, 1)} off square, towards ${r.neutralArm > 0 ? 'down' : 'up'}: the differential the throws ask for`,
  })
  out.push({ k: 'Advantage', v: `${r.advantage.toFixed(2)} : 1 (the servo turns ${r.advantage.toFixed(2)}° per degree of surface, and holds that many times its torque at the hinge)` })
  out.push({ k: 'Pushrod', v: `${thin(r.pushrod)} between the holes` })
  out.push({ k: 'Horn', v: Math.abs(r.hornSquare) < 1 ? 'square to the pushrod at mid travel' : `${deg(Math.abs(r.hornSquare), 1)} off square to the pushrod at mid travel` })
  const teeth = servo.value.spline?.teeth
  const at = r.midpoint + r.direction * r.neutralArm
  const here = splineError(at, teeth)
  const there = splineError(-at, teeth)
  out.push({
    k: 'Other side',
    v: `the same throws, the servo turning the other way (reverse it in the transmitter)${here == null ? '' : `. On its ${teeth}-tooth spline the arm is ${deg(Math.abs(here), 1)} from a tooth here and ${deg(Math.abs(there), 1)} there, for the subtrim`}`,
  })
  return out
})
const warning = computed(() => {
  const r = result.value
  const c = config.value
  if (!r.ok) return 'These holes can\'t give the designed throws: the arm would have to go past dead centre. Pick another pair from the table.'
  if (!r.fits) return `The designed throws need ±${deg(r.travelNeeded, 1)} of servo travel, more than ±${c.travel}°, so the surface only reaches ${deg(r.achieved.up, 1)} up and ${deg(r.achieved.down, 1)} down. Use an arm hole further out, a horn hole lower down${c.travel === 45 ? ', or extended end points' : ''}.`
  return ''
})
const basis = computed(() => `Hole positions are estimated, not measured: the arm's from ${config.value.arm.basis}, the horn's from its height.`)

// Hole table cells
const cellText = (r) => (r.ok ? `±${r.travelNeeded.toFixed(0)}°` : '–')
const cellTitle = (r) => (!r.ok ? 'Past dead centre' : r.fits ? `Needs ±${r.travelNeeded.toFixed(1)}° of servo travel` : `Needs ±${r.travelNeeded.toFixed(1)}°, beyond ±${config.value.travel}°`)

// --- Dialogue ------------------------------------------------------------------------------

const dialog = ref(null)
let opener = null
onMounted(() => {
  opener = document.activeElement
  nextTick(() => dialog.value?.focus())
})
function close(apply) {
  if (apply) emit('apply', { class: draft.cls || null, mounting: draft.mounting, link: draft.link })
  else emit('cancel')
  opener?.focus?.()
}
function onKey(e) {
  if (e.key === 'Escape') {
    e.preventDefault()
    e.stopPropagation()
    close(false)
  }
}
</script>

<template>
  <div class="wc-confirm__backdrop" @pointerdown.self="close(false)">
    <div ref="dialog" class="wc-config" role="dialog" aria-modal="true" :aria-labelledby="`${id}-title`" tabindex="-1" @keydown="onKey">
      <header class="wc-config__head">
        <h3 :id="`${id}-title`" class="wc-confirm__title">{{ title }}: servo and linkage, {{ frame.label }}</h3>
        <nav class="wc-config__crumbs" aria-label="Choices">
          <template v-for="(c, i) in crumbs" :key="i">
            <span v-if="i" aria-hidden="true"> › </span>
            <button type="button" class="wc-config__crumb" @click="jump(['servo', 'arm', 'horn'][i])">{{ c }}</button>
          </template>
        </nav>
      </header>

      <div class="wc-config__columns">
        <div class="wc-config__col">
          <span class="wc-field__label">Servo</span>
          <div :ref="columns.servo" class="wc-config__list" role="listbox" aria-label="Servo">
            <template v-for="g in servoGroups" :key="g.name">
              <div class="wc-config__group">{{ g.name }}</div>
              <button
                v-for="o in g.items"
                :key="o.value"
                type="button"
                role="option"
                class="wc-config__item"
                :class="{ 'wc-config__item--off': !o.fits }"
                :aria-selected="draft.cls === o.value"
                :title="o.reason || undefined"
                @click="pickServo(o.value)"
              >
                {{ o.label }}
              </button>
            </template>
          </div>
        </div>
        <div class="wc-config__col">
          <span class="wc-field__label">Arm</span>
          <div :ref="columns.arm" class="wc-config__list" role="listbox" aria-label="Arm">
            <button
              v-for="it in armItems"
              :key="it.key"
              type="button"
              role="option"
              class="wc-config__item"
              :aria-selected="config.arm.id === it.arm.id && config.armRow === it.row"
              :title="it.title"
              @click="pickArm(it)"
            >
              {{ it.label }}<span class="wc-config__sub">{{ it.sub }}</span>
            </button>
          </div>
        </div>
        <div class="wc-config__col">
          <span class="wc-field__label">Horn</span>
          <div :ref="columns.horn" class="wc-config__list" role="listbox" aria-label="Horn">
            <button
              v-for="h in HORNS"
              :key="h.id"
              type="button"
              role="option"
              class="wc-config__item"
              :aria-selected="config.horn.id === h.id"
              @click="pickHorn(h)"
            >
              {{ h.maker }} {{ h.part }}<span class="wc-config__sub">{{ h.name }}, {{ (h.height * 1000).toFixed(1) }} mm{{ h.heightEstimated ? ' (estimated)' : '' }}</span>
            </button>
          </div>
        </div>
      </div>

      <div class="wc-config__switches">
        <SegmentedField :model-value="draft.mounting" label="Mounted" :options="mountOptions" @update:model-value="draft.mounting = $event" />
        <SegmentedField model-value="pushrod" label="Linkage" :options="linkageOptions" />
        <SegmentedField :model-value="config.travel" label="Servo travel" :options="travelOptions" @update:model-value="setLink({ travel: $event })" />
        <SegmentedField :model-value="config.face" label="Horn on" :options="faceOptions" @update:model-value="setLink({ hornFace: $event, facing: null })" />
      </div>

      <div class="wc-config__body">
        <figure class="wc-config__figure">
          <svg ref="svgEl" class="wc-config__svg" :viewBox="drawing.box.join(' ')" role="img" aria-label="Side view of the linkage, square to the hinge">
            <!-- The fixed part's skins ahead of the hinge, and the surface at neutral -->
            <line class="wc-config__skin" :x1="drawing.box[0]" :y1="-drawing.top" x2="0" :y2="-drawing.top" />
            <line class="wc-config__skin" :x1="drawing.box[0]" :y1="drawing.bottom" x2="0" :y2="drawing.bottom" />
            <polygon class="wc-config__surface" :points="`0,${-drawing.top} ${drawing.depth},0 0,${drawing.bottom}`" />
            <!-- Designed throws, faint; achieved over them -->
            <line class="wc-config__design" x1="0" y1="0" :x2="drawing.designUp[0]" :y2="-drawing.designUp[1]" />
            <line class="wc-config__design" x1="0" y1="0" :x2="drawing.designDown[0]" :y2="-drawing.designDown[1]" />
            <path v-if="drawing.ok" class="wc-config__achieved" :d="drawing.arc(-result.achieved.up, result.achieved.down)" />
            <circle class="wc-config__hinge" cx="0" cy="0" :r="drawing.dot" />
            <!-- The servo -->
            <rect v-for="(b, i) in drawing.boxes" :key="i" class="wc-config__servo" :x="b.x" :y="b.y" :width="b.w" :height="b.h" />
            <template v-if="drawing.pivot">
              <circle class="wc-config__boss" :cx="drawing.pivot[0]" :cy="drawing.pivot[1]" :r="drawing.boss" />
              <!-- Horn -->
              <line class="wc-config__horn" :x1="drawing.hornBase[0]" :y1="drawing.hornBase[1]" :x2="drawing.hornTip[0]" :y2="drawing.hornTip[1]" />
              <circle
                v-for="q in drawing.hornHoles"
                :key="`h${q.j}`"
                class="wc-config__hole"
                :class="{ 'wc-config__hole--on': q.j === config.hornHole }"
                :cx="q.p[0]"
                :cy="q.p[1]"
                :r="drawing.dot"
                @click="setLink({ hornHole: q.j })"
              >
                <title>Horn hole {{ q.j + 1 }}, {{ (config.horn.holes[q.j] * 1000).toFixed(1) }} mm above the face</title>
              </circle>
              <!-- Pushrod -->
              <line v-if="drawing.rod" class="wc-config__rod" :x1="drawing.rod[0][0]" :y1="drawing.rod[0][1]" :x2="drawing.rod[1][0]" :y2="drawing.rod[1][1]" />
              <!-- Arm: drag it to the other side of the output to turn it round -->
              <line
                class="wc-config__arm"
                :x1="drawing.pivot[0]"
                :y1="drawing.pivot[1]"
                :x2="drawing.armTip[0]"
                :y2="drawing.armTip[1]"
                @pointerdown="armDown"
                @pointermove="armMove"
                @pointerup="armUp"
                @pointercancel="armUp"
              >
                <title>Drag to the other side of the output to turn the arm round</title>
              </line>
              <circle
                v-for="q in drawing.armHoles"
                :key="`a${q.i}`"
                class="wc-config__hole"
                :class="{ 'wc-config__hole--on': q.i === config.armHole }"
                :cx="q.p[0]"
                :cy="q.p[1]"
                :r="drawing.dot"
                @click="setLink({ armHole: q.i })"
              >
                <title>Arm hole {{ q.i + 1 }}, {{ (config.arm.holes[config.armRow].radii[q.i] * 1000).toFixed(1) }} mm from the output</title>
              </circle>
            </template>
          </svg>
          <figcaption class="wc-field__hint">
            Side view square to the hinge, at surface neutral: the designed throws dashed, the throw reached in blue.
            <template v-if="drawing.edgeOn"> This servo's arm swings in the wing's plane, so it's seen edge-on here: pick its holes from the table.</template>
            <template v-else> Click a hole to use it; drag the arm across the output to turn it round.</template>
          </figcaption>
        </figure>

        <div class="wc-config__side">
          <table class="wc-config__table">
            <caption class="wc-field__hint">Servo travel each way for each pair of holes. Green fits within ±{{ config.travel }}°; the outlined one uses the most of it (finest control).</caption>
            <thead>
              <tr>
                <th scope="col">Arm \ horn</th>
                <th v-for="(hh, j) in config.horn.holes" :key="j" scope="col">{{ (hh * 1000).toFixed(1) }}</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="(row, i) in config.matrix.cells" :key="i">
                <th scope="row">{{ (config.arm.holes[config.armRow].radii[i] * 1000).toFixed(1) }}</th>
                <td v-for="(r, j) in row" :key="j">
                  <button
                    type="button"
                    class="wc-config__cell"
                    :class="{
                      'wc-config__cell--fits': r.ok && r.fits,
                      'wc-config__cell--best': config.matrix.best && config.matrix.best.armHole === i && config.matrix.best.hornHole === j,
                      'wc-config__cell--on': config.armHole === i && config.hornHole === j,
                    }"
                    :title="cellTitle(r)"
                    :aria-pressed="config.armHole === i && config.hornHole === j"
                    @click="pickPair(i, j)"
                  >
                    {{ cellText(r) }}
                  </button>
                </td>
              </tr>
            </tbody>
          </table>
          <p v-if="warning" class="wc-field__warn">{{ warning }}</p>
          <dl class="wc-config__results">
            <template v-for="l in lines" :key="l.k">
              <dt>{{ l.k }}</dt>
              <dd>{{ l.v }}</dd>
            </template>
          </dl>
          <p class="wc-field__hint">{{ basis }} Arm holes in mm from the output, horn holes in mm above the face.</p>
        </div>
      </div>

      <div class="wc-confirm__actions">
        <button type="button" class="wc-button" @click="close(false)">Cancel</button>
        <button type="button" class="wc-button wc-button--primary" @click="close(true)">Use this</button>
      </div>
    </div>
  </div>
</template>
