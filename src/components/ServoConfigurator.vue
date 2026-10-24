<script setup>
// The servo configurator: a bay's whole servo-to-surface assembly (servo, arm, pushrod, horn) in
// one dialogue, opened from the bay in the structure editor. Columns pick the servo, its arm and
// the horn, each row with a thumbnail at one scale; switches turn the servo round or over and pick
// the horn's face; boxes place it along the chord and set how far it sits from the skin. A side
// view square to the hinge shows the section at the horn, the servo as seen along its output, the
// arm out through the skin, the pushrod outside the wing and the horn on the surface, with the
// designed and achieved throws; holes are picked there or in the table of hole pairs.
//
// Every change goes up as `change` (the draft bay), which the caller analyses in place of the
// saved bay, and comes back as `linkage` (bayLinkage.js bayLinkages' entry for the bay), so the
// drawing is the real layout. Nothing is saved until "Use this" (one undo step).
import { ref, reactive, computed, watch, nextTick, onMounted, useId } from 'vue'
import SegmentedField from './SegmentedField.vue'
import UnitInput from './UnitInput.vue'
import { servoOptions, servoById, servoFrame, servoParts, placeServo, planCorners, SERVOS } from '../lib/servos.js'
import { HORNS, linkage, splineError } from '../lib/linkage.js'
import { assemblyGeometry, servoChoices, linkSummary, hornOutline, TRAVELS, HORN_EDGE, PART_SIZES } from '../lib/bayLinkage.js'
import { format, defaultUnit } from '../lib/units.js'

const props = defineProps({
  system: { type: [String, Object], required: true },
  // bayLinkage.js bayLinkages' entry for the bay with the draft in place: { bay, frame, c, fit,
  // warnings }
  linkage: { type: Object, required: true },
  // Why the draft's bay can't be built (it then shows the last one that could), or ''
  problem: { type: String, default: '' },
  // The bay's name, e.g. "Servo bay SB1"
  title: { type: String, required: true },
  // The bay as saved when it opened: { class (null for automatic), rotate, flip, fore, inset,
  // link (resolved, linkOf) }
  bay: { type: Object, required: true },
  // The class a bay takes automatically, for this weight
  autoClass: { type: String, required: true },
  mass: { type: Number, default: 0 },
})
const emit = defineEmits(['change', 'apply', 'cancel'])

const id = useId()
const RAD = Math.PI / 180
const draft = reactive({
  cls: props.bay.class ?? '',
  rotate: !!props.bay.rotate,
  flip: !!props.bay.flip,
  fore: props.bay.fore ?? null,
  inset: props.bay.inset ?? null,
  link: { ...props.bay.link },
})
const asBay = () => ({ class: draft.cls || null, rotate: draft.rotate, flip: draft.flip, fore: draft.fore, inset: draft.inset, link: { ...draft.link } })
watch(draft, () => emit('change', asBay()), { deep: true })

const frame = computed(() => props.linkage.frame)
const servo = computed(() => props.linkage.bay.servo)
const config = computed(() => props.linkage.c)
const result = computed(() => config.value.result)

const thin = (v) => format(v, 'thin', defaultUnit(props.system, 'thin'))
const deg = (v, dp = 0) => `${v.toFixed(dp)}°`
const pts = (list) => list.map((p) => p.map((v) => +v.toFixed(3)).join(',')).join(' ')

// --- Columns, with thumbnails --------------------------------------------------------------

// Each servo from the side, as its maker draws it (length across, height up, mm), all at one scale
function servoThumb(value) {
  const entry = servoById(value || props.autoClass)
  if (!entry) return []
  return servoParts(servoFrame(entry))
    .filter((p) => p.kind !== 'servoLead')
    .map((p) => {
      if (p.box) {
        const [[x0, x1], , [z0, z1]] = p.box
        return pts([[x0, -z0], [x1, -z0], [x1, -z1], [x0, -z1]].map((q) => q.map((v) => v * 1000)))
      }
      const c = p.cylinder
      return pts([[c.x - c.r, -c.z[0]], [c.x + c.r, -c.z[0]], [c.x + c.r, -c.z[1]], [c.x - c.r, -c.z[1]]].map((q) => q.map((v) => v * 1000)))
    })
}
const autoLabel = computed(() => `Automatic (${SERVOS[props.autoClass].label.toLowerCase()})`)
const servoGroups = computed(() => {
  const list = servoChoices(frame.value, [{ value: '', label: autoLabel.value, group: 'Generic' }, ...servoOptions()], props.mass)
  const groups = []
  for (const o of list) {
    const item = { ...o, thumb: servoThumb(o.value) }
    const g = groups.at(-1)
    if (g && g.name === o.group) g.items.push(item)
    else groups.push({ name: o.group, items: [item] })
  }
  return groups
})
function pickServo(value) {
  draft.cls = value
  // Holes are per arm and horn: let the new servo find its own
  draft.link = { ...draft.link, arm: null, armRow: 0, armHole: null, hornHole: null }
}

const armName = (a) => (a.maker === 'Generic' ? a.name : `${a.maker} ${a.part}`)
// An arm's row of holes from its hub, mm, at one scale
const armThumb = (radii) => ({ end: radii.at(-1) * 1000 + 3, holes: radii.map((r) => r * 1000) })
const armItems = computed(() =>
  config.value.arms.flatMap((a) =>
    a.holes.map((row, r) => ({
      key: `${a.id}:${r}`,
      arm: a,
      row: r,
      label: a.holes.length > 1 ? `${armName(a)}, ${row.arm}` : armName(a),
      sub: `${a.holes.length > 1 ? '' : `${row.arm}: `}holes at ${row.radii.map((x) => (x * 1000).toFixed(1)).join(', ')} mm`,
      title: a.name,
      thumb: armThumb(row.radii),
    })),
  ),
)
// A horn's outline on a flat face, as hornOutline draws it, mm, at one scale
function hornThumb(h) {
  const H = h.height * 1000
  const e = HORN_EDGE * 1000
  const len = Math.max(H * PART_SIZES.horn.base, 6)
  const low = Math.max(0, h.holes[0] * 1000 - e)
  return { outline: pts([[1, 0], [1 + len, 0], [e, -H], [-e, -H], [-e, -low]]), holes: h.holes.map((v) => -v * 1000) }
}
const hornItems = HORNS.map((h) => ({ h, thumb: hornThumb(h) }))

const pickArm = (it) => (draft.link = { ...draft.link, arm: it.arm.id, armRow: it.row, armHole: null })
const pickHorn = (h) => (draft.link = { ...draft.link, horn: h.id, hornHole: null })
const pickPair = (i, j) => (draft.link = { ...draft.link, armHole: i, hornHole: j })
const setLink = (patch) => (draft.link = { ...draft.link, ...patch })

const columns = { servo: ref(null), arm: ref(null), horn: ref(null) }
onMounted(() => nextTick(() => ['servo', 'arm', 'horn'].forEach((k) => columns[k].value?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' }))))

// --- Switches and position -----------------------------------------------------------------

const travelOptions = TRAVELS.map((t) => ({ value: t, label: `±${t}°`, title: t === 60 ? 'Extended end points' : 'Standard end points' }))
const faceOptions = [
  { value: 'top', label: 'Top', title: 'The horn on top: the arm comes out through the upper skin, the servo under it' },
  { value: 'bottom', label: 'Bottom', title: 'The horn underneath: the arm comes out through the hatch or the lower skin, the servo on it' },
]
const linkageOptions = [{ value: 'pushrod', label: 'Pushrod', title: 'Pull-pull and torque rods come with the tail and fuselage' }]
const yesNo = [
  { value: false, label: 'No' },
  { value: true, label: 'Yes' },
]
const foreBy = [
  { value: 'length', label: 'mm', title: 'From the leading edge, as a length' },
  { value: 'chord', label: '%', title: "From the leading edge, as a share of the chord at the bay (it keeps its place if the chord changes)" },
]
const foreUnit = ref(props.bay.fore?.by ?? 'length')
// Where the case's centre is now, from the leading edge (m)
const foreNow = computed(() => frame.value.at.x - frame.value.chord.xl)
const foreValue = computed(() => {
  const f = draft.fore
  if (!f) return null
  if (f.by === foreUnit.value) return f.value
  const c = frame.value.chord.c
  return foreUnit.value === 'chord' ? f.value / c : f.value * c
})
function setFore(v) {
  draft.fore = v == null ? null : { value: v, by: foreUnit.value }
}
// The same place in the other unit
function setForeUnit(by) {
  const f = draft.fore
  const c = frame.value.chord.c
  if (f && f.by !== by) draft.fore = { value: by === 'chord' ? f.value / c : f.value * c, by }
  foreUnit.value = by
}
// Empty boxes say what they'd be: the deepest spot (where it is now), as close to the skin as it goes
const forePlaceholder = computed(() => `Auto: ${foreUnit.value === 'chord' ? `${((foreNow.value / frame.value.chord.c) * 100).toFixed(1)}%` : thin(foreNow.value)}`)
const insetPlaceholder = computed(() => `0 (up to ${thin(frame.value.insetMax)})`)

// --- Drawing -------------------------------------------------------------------------------

// The view: square to the hinge, x aft along it in plan, y down, origin on the hinge, mm
const view = computed(() => {
  const h = frame.value.hinge.axis
  const n = Math.hypot(h[0], h[1]) || 1
  const u = h[1] >= 0 ? [h[1] / n, -h[0] / n] : [-h[1] / n, h[0] / n]
  const H = frame.value.hinge.point
  return (p) => [((p[0] - H[0]) * u[0] + (p[1] - H[1]) * u[1]) * 1000, -(p[2] - H[2]) * 1000]
})

const drawing = computed(() => {
  const c = config.value
  const r = result.value
  const f = frame.value
  const P = view.value
  const at = (x, z) => P([x, f.s, z])
  // The section at the horn: the fixed part (its upper and lower faces, its rear face) and the
  // moving surface, its front bevelled to the hinge
  const fx = f.outline.fixed
  const n = fx.length / 2
  const fixed = fx.map(([x, z]) => at(x, z))
  const wing = {
    fill: pts(fixed),
    upper: pts(fixed.slice(0, n)),
    lower: pts(fixed.slice(n)),
    rear: [fixed[n - 1], fixed[n]],
    cut: [fixed[0], fixed.at(-1)],
    moving: pts(f.outline.moving.map(([x, z]) => at(x, z))),
  }
  // The servo as seen along its output: the parts that show beside the case (the case first,
  // anything wholly behind it hidden), the output boss round
  const placed = placeServo(servo.value, f.at)
  const proj = placed.map((p) => {
    const corners = []
    const z = p.box ? p.box.z : p.cylinder.axis === 'z' ? [p.cylinder.from, p.cylinder.to] : [p.cylinder.z - p.cylinder.r, p.cylinder.z + p.cylinder.r]
    for (const [x, q] of planCorners(p)) for (const zz of z) corners.push(P([x, q, zz]))
    const xs = corners.map((q) => q[0])
    const ys = corners.map((q) => q[1])
    return { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys), kind: p.kind, cyl: !!p.cylinder && p.cylinder.axis !== 'z' }
  })
  const kase = proj[0]
  const inside = (b) => b.x >= kase.x - 1e-6 && b.x + b.w <= kase.x + kase.w + 1e-6 && b.y >= kase.y - 1e-6 && b.y + b.h <= kase.y + kase.h + 1e-6
  const boxes = proj.filter((b, i) => i === 0 || (!b.cyl && !inside(b) && b.kind !== 'servoOutput'))
  const rounds = proj.filter((b) => b.cyl).map((b) => ({ cx: b.x + b.w / 2, cy: b.y + b.h / 2, r: b.w / 2, kind: b.kind }))
  const depth = f.depth * 1000
  const out = { wing, boxes, rounds, depth, ok: r.ok }
  // The throw ranges, from the hinge
  const ray = (a) => [depth * Math.cos(a * RAD), depth * Math.sin(a * RAD)]
  out.designUp = ray(-f.up)
  out.designDown = ray(f.down)
  if (r.ok) {
    out.arc = (a0, a1) => {
      const p0 = ray(a0)
      const p1 = ray(a1)
      return `M ${p0[0]} ${p0[1]} A ${depth} ${depth} 0 0 1 ${p1[0]} ${p1[1]}`
    }
  }
  // The horn on the surface, its holes over the hinge
  const horn = hornOutline(f, c.horn, c.face)
  out.horn = pts(horn.map(P))
  const up = c.face === 'bottom' ? -1 : 1
  const face0 = f.hinge.point[2] + up * f.faces[c.face]
  out.hornHoles = c.horn.holes.map((hh, j) => ({ j, p: P([...f.hinge.point.slice(0, 2), face0 + up * hh]) }))
  // The arm at surface neutral, out through the skin, and the pushrod outside the wing
  const radii = c.arm.holes[c.armRow].radii
  const g = assemblyGeometry(f, servo.value, c, c.armHole, c.hornHole, c.face)
  if (g.radius > 0) {
    const L = linkage(g)
    const t0 = r.ok ? (r.midpoint + r.direction * r.neutralArm) * RAD : 0
    const d = L.armDir(t0)
    const A = PART_SIZES.arm[c.arm.size] ?? PART_SIZES.arm.standard
    const pv = P(g.pivot)
    out.pivot = pv
    out.armHoles = radii.map((rad, i) => ({ i, p: P([g.pivot[0] + d[0] * rad, g.pivot[1] + d[1] * rad, g.pivot[2] + d[2] * rad]) }))
    const tipR = radii.at(-1) + A.tip
    out.armTip = P([g.pivot[0] + d[0] * tipR, g.pivot[1] + d[1] * tipR, g.pivot[2] + d[2] * tipR])
    out.armDir = [out.armTip[0] - pv[0], out.armTip[1] - pv[1]]
    out.rod = r.ok ? [out.armHoles[c.armHole].p, out.hornHoles[c.hornHole].p] : null
    out.boss = (servo.value.frame.output.diameter * 1000) / 2
  }
  // The view box round the section from the servo to the trailing edge, the arm and the horn
  const xs = [wing.cut[0][0], depth, ...boxes.flatMap((b) => [b.x, b.x + b.w]), ...(out.armHoles ?? []).map((q) => q.p[0]), out.armTip?.[0] ?? 0]
  const ys = [...fixed.map((q) => q[1]), out.designUp[1], out.designDown[1], ...horn.map((q) => P(q)[1]), ...boxes.flatMap((b) => [b.y, b.y + b.h]), out.armTip?.[1] ?? 0]
  const x0 = Math.min(...xs) - 4
  const x1 = Math.max(...xs) + 4
  const y0 = Math.min(...ys) - 4
  const y1 = Math.max(...ys) + 4
  out.box = [x0, y0, x1 - x0, y1 - y0]
  out.dot = Math.max(0.6, (x1 - x0) / 220)
  return out
})

// Dragging the arm picks which way it faces: to the other side of the pivot turns it round
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

const summary = computed(() => linkSummary(servo.value, config.value))

// Short values, the explanation on hover
const lines = computed(() => {
  const r = result.value
  const f = frame.value
  if (!r.ok) return []
  const out = []
  out.push({ k: 'Up', v: `${deg(r.achieved.up, 1)} (${thin(r.achieved.upMm)})`, t: `${deg(r.achieved.up, 1)} up, ${thin(r.achieved.upMm)} at the trailing edge; designed ${deg(f.up)}` })
  out.push({ k: 'Down', v: `${deg(r.achieved.down, 1)} (${thin(r.achieved.downMm)})`, t: `${deg(r.achieved.down, 1)} down, ${thin(r.achieved.downMm)} at the trailing edge; designed ${deg(f.down)}` })
  out.push({ k: 'Servo travel', v: `±${deg(r.travelNeeded, 1)} of ±${config.value.travel}°`, t: 'The servo travel each way the designed throws need, of the travel set' })
  const off = Math.abs(r.neutralArm)
  out.push({ k: 'Arm at neutral', v: off < 0.5 ? 'square' : `${deg(off, 1)} ${r.neutralArm > 0 ? 'down' : 'up'}`, t: off < 0.5 ? 'Square to the pushrod at surface neutral' : `${deg(off, 1)} off square to the pushrod at surface neutral, towards ${r.neutralArm > 0 ? 'down' : 'up'}: the differential the throws ask for` })
  out.push({ k: 'Advantage', v: `${r.advantage.toFixed(2)} : 1`, t: `The servo turns ${r.advantage.toFixed(2)}° per degree of surface, and holds that many times its torque at the hinge` })
  out.push({ k: 'Pushrod', v: thin(r.pushrod), t: 'Between the holes, outside the wing' })
  out.push({ k: 'Horn', v: Math.abs(r.hornSquare) < 1 ? 'square' : `${deg(Math.abs(r.hornSquare), 1)} off square`, t: 'The horn against the pushrod at mid travel' })
  if (Number.isFinite(r.clear)) {
    out.push({ k: 'Arm hole', v: r.clear >= 0 ? `${thin(r.clear)} clear` : `${thin(-r.clear)} in`, t: `How far the arm's hole stays outside the ${config.value.face} skin over its travel, beyond the pushrod's end`, warn: r.clear < 0 })
  }
  const teeth = servo.value.spline?.teeth
  const at = r.midpoint + r.direction * r.neutralArm
  const here = splineError(at, teeth)
  const there = splineError(-at, teeth)
  out.push({
    k: 'Other side',
    v: here == null ? 'reversed' : `reversed, ${deg(Math.abs(here), 1)} / ${deg(Math.abs(there), 1)}`,
    t: `The same throws, the servo turning the other way (reverse it in the transmitter)${here == null ? '' : `. On its ${teeth}-tooth spline the arm is ${deg(Math.abs(here), 1)} from a tooth here and ${deg(Math.abs(there), 1)} on the other side, for the subtrim`}`,
  })
  return out
})
// The bay's own warnings (where the servo is) and its linkage's
const warnings = computed(() => {
  const r = result.value
  const out = [...(props.problem ? [props.problem] : []), ...(props.linkage.bay.warnings ?? []), ...props.linkage.warnings.map((w) => w.message)]
  if (!r.ok && !out.some((m) => /dead centre/.test(m))) out.unshift("These holes can't give the designed throws: the arm would have to go past dead centre. Pick another pair from the table.")
  return out
})
const basis = computed(() => `Hole positions are estimated: the arm's from ${config.value.arm.basis}, the horn's from its height; its outline is a placeholder.`)

// Hole table cells
const cellText = (r) => (r.ok ? `±${r.travelNeeded.toFixed(0)}°` : '–')
const cellTitle = (r) => {
  if (!r.ok) return 'Past dead centre'
  const t = r.fits ? `Needs ±${r.travelNeeded.toFixed(1)}° of servo travel` : `Needs ±${r.travelNeeded.toFixed(1)}°, beyond ±${config.value.travel}°`
  return r.outside ? t : `${t}; the arm's hole goes into the skin, so the pushrod can't stay outside the wing`
}

// --- Dialogue ------------------------------------------------------------------------------

const dialog = ref(null)
let opener = null
onMounted(() => {
  opener = document.activeElement
  nextTick(() => dialog.value?.focus())
})
function close(apply) {
  if (apply) emit('apply', asBay())
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
        <p class="wc-config__summary">{{ summary }}</p>
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
                <svg class="wc-thumb wc-config__thumb" viewBox="-30 -50 60 57" aria-hidden="true">
                  <polygon v-for="(q, k) in o.thumb" :key="k" :points="q" />
                </svg>
                <span class="wc-config__name">{{ o.label }}</span>
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
              <svg class="wc-thumb wc-config__thumb" viewBox="-5 -8 42 16" aria-hidden="true">
                <polygon :points="`-3,-2.5 ${it.thumb.end},-1.5 ${it.thumb.end},1.5 -3,2.5`" />
                <circle v-for="(x, k) in it.thumb.holes" :key="k" :cx="x" cy="0" r="0.8" class="wc-config__thumb-hole" />
              </svg>
              <span class="wc-config__name">{{ it.label }}<span class="wc-config__sub">{{ it.sub }}</span></span>
            </button>
          </div>
        </div>
        <div class="wc-config__col">
          <span class="wc-field__label">Horn</span>
          <div :ref="columns.horn" class="wc-config__list" role="listbox" aria-label="Horn">
            <button
              v-for="{ h, thumb } in hornItems"
              :key="h.id"
              type="button"
              role="option"
              class="wc-config__item"
              :aria-selected="config.horn.id === h.id"
              @click="pickHorn(h)"
            >
              <svg class="wc-thumb wc-config__thumb" viewBox="-6 -37 34 40" aria-hidden="true">
                <line x1="-6" y1="0" x2="28" y2="0" class="wc-config__thumb-face" />
                <polygon :points="thumb.outline" />
                <circle v-for="(y, k) in thumb.holes" :key="k" cx="0" :cy="y" r="0.9" class="wc-config__thumb-hole" />
              </svg>
              <span class="wc-config__name">{{ h.maker }} {{ h.part }}<span class="wc-config__sub">{{ h.name }}, {{ (h.height * 1000).toFixed(1) }} mm{{ h.heightEstimated ? ' (estimated)' : '' }}</span></span>
            </button>
          </div>
        </div>
      </div>

      <div class="wc-config__switches">
        <SegmentedField model-value="pushrod" label="Linkage" :options="linkageOptions" />
        <SegmentedField :model-value="config.travel" label="Servo travel" :options="travelOptions" @update:model-value="setLink({ travel: $event })" />
        <SegmentedField :model-value="config.face" label="Horn on" :options="faceOptions" @update:model-value="setLink({ hornFace: $event, facing: null })" />
        <SegmentedField :model-value="draft.rotate" label="Turned round" :options="yesNo" @update:model-value="draft.rotate = $event" />
        <SegmentedField :model-value="draft.flip" label="Upside down" :options="yesNo" @update:model-value="draft.flip = $event" />
        <div class="wc-config__fore">
          <UnitInput
            :id="`${id}-fore`"
            :model-value="foreValue"
            :quantity="foreUnit === 'chord' ? 'percent' : 'length'"
            :chord="frame.chord.c"
            chord-name="chord at the bay"
            :system="system"
            label="From the leading edge"
            :placeholder="forePlaceholder"
            @update:model-value="setFore($event)"
          />
          <SegmentedField :model-value="foreUnit" label="In" :options="foreBy" @update:model-value="setForeUnit($event)" />
        </div>
        <UnitInput :id="`${id}-inset`" :model-value="draft.inset" quantity="thin" :system="system" :label="`Inset from the ${config.face} skin`" :placeholder="insetPlaceholder" @update:model-value="draft.inset = $event" />
      </div>

      <div class="wc-config__body">
        <div class="wc-config__main">
          <figure class="wc-config__figure">
            <svg ref="svgEl" class="wc-config__svg" :viewBox="drawing.box.join(' ')" role="img" aria-label="Side view of the linkage, square to the hinge">
              <!-- The section at the horn: the fixed part, cut ahead of the servo, and the surface -->
              <polygon class="wc-config__wing" :points="drawing.wing.fill" />
              <polyline class="wc-config__skin" :points="drawing.wing.upper" />
              <polyline class="wc-config__skin" :points="drawing.wing.lower" />
              <line class="wc-config__skin" :x1="drawing.wing.rear[0][0]" :y1="drawing.wing.rear[0][1]" :x2="drawing.wing.rear[1][0]" :y2="drawing.wing.rear[1][1]" />
              <line class="wc-config__cut" :x1="drawing.wing.cut[0][0]" :y1="drawing.wing.cut[0][1]" :x2="drawing.wing.cut[1][0]" :y2="drawing.wing.cut[1][1]" />
              <polygon class="wc-config__surface" :points="drawing.wing.moving" />
              <!-- Designed throws, faint; achieved over them -->
              <line class="wc-config__design" x1="0" y1="0" :x2="drawing.designUp[0]" :y2="drawing.designUp[1]" />
              <line class="wc-config__design" x1="0" y1="0" :x2="drawing.designDown[0]" :y2="drawing.designDown[1]" />
              <path v-if="drawing.ok" class="wc-config__achieved" :d="drawing.arc(-result.achieved.up, result.achieved.down)" />
              <circle class="wc-config__hinge" cx="0" cy="0" :r="drawing.dot" />
              <!-- The servo, seen along its output -->
              <rect v-for="(b, i) in drawing.boxes" :key="i" class="wc-config__servo" :x="b.x" :y="b.y" :width="b.w" :height="b.h" />
              <circle v-for="(q, i) in drawing.rounds" :key="`r${i}`" class="wc-config__servo" :cx="q.cx" :cy="q.cy" :r="q.r" />
              <!-- Horn -->
              <polygon class="wc-config__horn" :points="drawing.horn" />
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
              <template v-if="drawing.pivot">
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
                <circle class="wc-config__boss" :cx="drawing.pivot[0]" :cy="drawing.pivot[1]" :r="drawing.boss" />
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
              Side view square to the hinge at surface neutral, the section at the horn: the designed throws dashed, the throw reached in blue. Click a hole to use it; drag the arm across the output to turn it round.
            </figcaption>
          </figure>
          <dl class="wc-config__results">
            <div v-for="l in lines" :key="l.k" class="wc-config__result" :title="l.t">
              <dt>{{ l.k }}</dt>
              <dd :class="{ 'wc-field__warn': l.warn }">{{ l.v }}</dd>
            </div>
          </dl>
          <p class="wc-field__hint">{{ basis }} Hover a result for more.</p>
        </div>

        <div class="wc-config__side">
          <table class="wc-config__table">
            <caption class="wc-field__hint">
              Servo travel for each pair of holes (arm: mm from the output; horn: mm above the face). Green fits ±{{ config.travel }}° with the pushrod outside the wing, outlined uses the most travel; amber goes into the skin.
            </caption>
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
                      'wc-config__cell--fits': r.ok && r.fits && r.outside,
                      'wc-config__cell--inside': r.ok && !r.outside,
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
          <p v-for="(w, k) in warnings" :key="k" class="wc-field__warn">{{ w }}</p>
        </div>
      </div>

      <div class="wc-confirm__actions">
        <button type="button" class="wc-button" @click="close(false)">Cancel</button>
        <button type="button" class="wc-button wc-button--primary" @click="close(true)">Use this</button>
      </div>
    </div>
  </div>
</template>
