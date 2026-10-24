<script setup>
// The structural side of each control surface, in the structure editor: its hinge gap and its
// servo bay (on or off, which servo, square to the chord or the hinge, where along the span), and
// the bay's servo and linkage, set in the servo configurator (ServoConfigurator.vue), with where
// its horn sits. While the configurator is open its draft is handed up as `preview` (the controls
// with the draft bay), which the caller analyses in place of the saved ones.
// The surface itself
// (where it is, its depth, its throws) is drawn and set in the wing editor. Every change
// replaces the whole controls object, so undo/redo and autosave see it.
import { computed, ref, watch } from 'vue'
import UnitInput from './UnitInput.vue'
import SelectField from './SelectField.vue'
import SegmentedField from './SegmentedField.vue'
import ParamInput from './ParamInput.vue'
import InspectorSection from './InspectorSection.vue'
import { wingSampler } from '../lib/wing.js'
import { resolveSurfaces } from '../lib/controlSurfaces.js'
import { SERVOS, bayOf, setBay, servoOptions, servoById, installedServo, defaultServoClass } from '../lib/servos.js'
import { bayProblem } from '../lib/structure.js'
import { format, defaultUnit } from '../lib/units.js'
import { bayLinkages, linkOf, savedLink, linkSummary } from '../lib/bayLinkage.js'
import ServoConfigurator from './ServoConfigurator.vue'

const props = defineProps({
  system: { type: [String, Object], required: true },
  // The wing the surfaces sit on: { fuselageWidth, rootChord, panels, tip }
  wing: { type: Object, required: true },
  // The all-up mass, kg: which servo class a bay takes unless one is chosen
  mass: { type: Number, default: 0 },
  idPrefix: { type: String, default: 'wcs' },
  // analyseStructure's result, for where each bay is built (its linkage needs it); null if the
  // wing can't be analysed
  analysis: { type: Object, default: null },
  // bayLinkage.js bayLinkages for the analysis, when the caller has them; else worked out here
  linkages: { type: Map, default: null },
})
const controls = defineModel('controls', { type: Object, required: true })
// The surface whose bay the servo configurator is open on, or null (the plan opens it too)
const configuring = defineModel('configuring', { type: [Number, String], default: null })
// The controls with the configurator's draft bay, while it's open; null otherwise
const preview = defineModel('preview', { type: Object, default: null })

const sampler = computed(() => wingSampler(props.wing))
const shown = computed(() =>
  (sampler.value ? resolveSurfaces(sampler.value, controls.value.surfaces) : [])
    .map((r) => ({ r, s: controls.value.surfaces.find((x) => x.id === r.id) }))
    .filter((x) => x.s),
)
const id = (k) => `${props.idPrefix}-ss-${k}`
const mm = (v) => `${Math.round(v * 10000) / 10}`

function update(sid, patch) {
  controls.value = { ...controls.value, surfaces: controls.value.surfaces.map((x) => (x.id === sid ? { ...x, ...patch } : x)) }
}
const bayFor = (s) => bayOf(controls.value, s.id)
const setBayFor = (s, patch) => (controls.value = setBay(controls.value, s.id, patch))

const autoClass = computed(() => defaultServoClass(props.mass))
const SERVO_OPTIONS = computed(() => [
  { value: '', label: `Automatic (${SERVOS[autoClass.value].label.toLowerCase()}, for this weight)` },
  ...servoOptions(),
])
// The bay's centre, m from the surface's inner end. An older save only has `at` (from the panel's
// inner end), so convert it by the surface's own start.
const bayAlong = (s) => {
  const b = bayFor(s)
  if (Number.isFinite(b.along)) return b.along
  return Number.isFinite(b.at) ? b.at - s.from : null
}
function servoText(s) {
  const b = bayFor(s)
  const v = linked.value.get(s.id)?.bay.servo ?? installedServo(b.class, props.mass, { rotate: b.rotate, flip: b.flip })
  const mu = defaultUnit(props.system, 'mass')
  return `${v.label}: ${format(v.mass, 'mass', mu)}, about ${(v.torque / 0.0980665).toFixed(1)} kg·cm. Installed, lugs, output and lead included, it takes ${mm(v.run)} mm along the chord, ${mm(v.width)} mm across the span and ${mm(v.height)} mm of depth.${v.estimated?.includes('lugs') ? ` ${v.maker} publishes no drawing of it, so its lugs and output are placed as a typical ${SERVOS[v.class].label.toLowerCase()} servo's.` : ''}${v.plan?.screws?.length ? '' : ' Its lugs don\'t bear on the plate this way up, so it needs fixing another way (the plate\'s note says how).'}`
}

// Each built bay's frame for its linkage, and the linkage as set (or by default)
const linked = computed(() => props.linkages ?? (props.analysis ? bayLinkages(props.analysis, controls.value) : new Map()))
function linkText(s) {
  const l = linked.value.get(s.id)
  if (!l) return ''
  const r = l.c.result
  const sum = linkSummary(l.bay.servo, l.c)
  if (!r.ok) return `${sum}. These holes can't give the designed throws.`
  return `${sum}: ${r.achieved.up.toFixed(0)}° up, ${r.achieved.down.toFixed(0)}° down, using ±${r.travelNeeded.toFixed(0)}° of ±${l.c.travel}° servo travel.`
}
const linkWarn = (s) => !!linked.value.get(s.id)?.warnings.length
// A surface's heading, closed: its gap and its servo; and its linkage's warnings, listed in it and
// counted on the heading (warnings.js keeps them out of the Control surfaces section's own list)
function surfaceSummary(s) {
  const b = bayFor(s)
  const gap = `${mm(s.gap ?? 0)} mm gap`
  if (!b.enabled) return `${gap}, no servo bay`
  const l = linked.value.get(s.id)
  const v = l?.bay.servo ?? installedServo(b.class, props.mass, { rotate: b.rotate, flip: b.flip })
  return `${gap}, ${l ? `${l.bay.name} ` : ''}${v.label}`
}
const surfaceWarnings = (s) => linked.value.get(s.id)?.warnings ?? []
const squareOptions = [
  { value: 'chord', label: 'Chord', title: "The servo's length along the chord" },
  { value: 'hinge', label: 'Hinge', title: "The servo's length square to the hinge line, so the pushrod meets the horn square" },
]
const setLink = (s, patch) => setBayFor(s, { link: savedLink({ ...linkOf(bayFor(s)), ...patch }) })
const hornAt = (s) => linkOf(bayFor(s)).hornAt
// The horn's turn as set, or as lined up with the pushrod (rounded to the degree)
const hornAngle = (s) => {
  const v = linkOf(bayFor(s)).hornAngle
  return Number.isFinite(v) ? v : Math.round(linked.value.get(s.id)?.frame.hornAngle ?? 0)
}
const hornHint = (s) =>
  `Where the horn is, from the surface's inner end along it (or drag it on the plan); empty puts it in line with the servo, where its arm's plane meets the hinge. ${
    Number.isFinite(linkOf(bayFor(s)).hornAngle) ? 'Its turn is set by hand.' : "Its turn lines it up with the pushrod (and with the servo, when it's in line with it)."
  }`

// The configurator, open on one surface's bay. It's teleported to the nearest .wingcalc (the
// structure editor's window), since the side panel it's opened from would trap a fixed dialogue.
const rootEl = ref(null)
const dialogueTarget = computed(() => (configuring.value == null ? null : (rootEl.value?.closest('.wingcalc') ?? 'body')))
// The bay as saved when the configurator opened (its draft starts there), and the last linkage it
// had built: a draft that can't be built (a servo too long for the bay, say) keeps showing that,
// with the reason
const opened = ref(null)
let lastBuilt = null
const open = computed(() => {
  const sid = configuring.value
  if (sid == null) return null
  const l = linked.value.get(sid)
  const bay = props.analysis?.bays?.find((x) => x.surface === sid)
  if (l) lastBuilt = { sid, l }
  const shown = l ?? (lastBuilt?.sid === sid ? lastBuilt.l : null)
  if (!shown) return null
  return { sid, l: shown, problem: l ? '' : bay && !bay.ok ? bayProblem(bay) : '', title: shown.bay.label }
})
const draftOf = (b) => ({ class: b.class ?? null, rotate: !!b.rotate, flip: !!b.flip, fore: b.fore, inset: b.inset, link: linkOf(b) })
function startConfiguring() {
  const sid = configuring.value
  opened.value = sid == null ? null : draftOf(bayFor({ id: sid }))
  lastBuilt = null
  if (sid == null) preview.value = null
}
watch(configuring, startConfiguring, { immediate: true })
const withDraft = (sid, d) => setBay(controls.value, sid, { class: d.class, rotate: d.rotate, flip: d.flip, fore: d.fore, inset: d.inset, link: savedLink(d.link) })
function change(sid, d) {
  preview.value = withDraft(sid, d)
}
function apply(sid, d) {
  controls.value = withDraft(sid, d)
  preview.value = null
  configuring.value = null
}
function cancel() {
  preview.value = null
  configuring.value = null
}
</script>

<template>
  <div ref="rootEl" class="wc-surfaces">
    <p v-if="!shown.length" class="wc-field__hint">No control surfaces yet: draw them in the wing editor.</p>
    <InspectorSection v-for="{ r, s } in shown" :key="s.id" :title="r.label" :fold-key="`structure:surface-${s.id}`" :summary="surfaceSummary(s)" :warnings="surfaceWarnings(s)">
      <UnitInput :id="id(`${s.id}-gap`)" :model-value="s.gap" quantity="thin" :system="system" label="Hinge gap" @update:model-value="update(s.id, { gap: $event ?? 0 })" />
      <label class="wc-check wc-structure-editor__check">
        <input type="checkbox" :checked="bayFor(s).enabled" @change="setBayFor(s, { enabled: $event.target.checked })" />
        A servo bay for this surface
      </label>
      <template v-if="bayFor(s).enabled">
        <SelectField :id="id(`${s.id}-servo`)" :model-value="bayFor(s).class ?? ''" label="Servo" :options="SERVO_OPTIONS" @update:model-value="setBayFor(s, { class: $event || null })" />
        <UnitInput
          :id="id(`${s.id}-bay`)"
          :model-value="bayAlong(s)"
          quantity="length"
          :system="system"
          label="Bay centre"
          placeholder="A third of the way along"
          @update:model-value="setBayFor(s, { along: $event, at: null })"
        />
        <p class="wc-field__hint">
          Measured from the surface's inner end, along the surface; leave it empty for a third of the way along. {{ servoText(s) }}
        </p>
        <SegmentedField :model-value="bayFor(s).square ?? 'chord'" label="Servo square to" :options="squareOptions" @update:model-value="setBayFor(s, { square: $event })" />
        <template v-if="linked.get(s.id)">
          <p :class="linkWarn(s) ? 'wc-field__warn' : 'wc-field__hint'">Linkage: {{ linkText(s) }}</p>
          <button type="button" class="wc-button" @click="configuring = s.id">Servo and linkage…</button>
          <UnitInput
            :id="id(`${s.id}-horn`)"
            :model-value="hornAt(s)"
            quantity="length"
            :system="system"
            label="Horn"
            placeholder="In line with the servo"
            @update:model-value="setLink(s, { hornAt: $event })"
          />
          <ParamInput
            :id="id(`${s.id}-horn-angle`)"
            :model-value="hornAngle(s)"
            label="Horn turned from square to the hinge"
            suffix="°"
            :min="-45"
            :max="45"
            :step="1"
            :hint="hornHint(s)"
            @update:model-value="setLink(s, { hornAngle: $event })"
          />
          <button v-if="Number.isFinite(linkOf(bayFor(s)).hornAngle)" type="button" class="wc-button wc-button--small" @click="setLink(s, { hornAngle: null })">Line it up with the pushrod</button>
        </template>
        <p v-else-if="analysis" class="wc-field__hint">The linkage can be set once the bay is built.</p>
      </template>
    </InspectorSection>
    <Teleport v-if="open && opened" :to="dialogueTarget">
      <ServoConfigurator
        :key="open.sid"
        :system="system"
        :linkage="open.l"
        :problem="open.problem"
        :title="open.title"
        :bay="opened"
        :auto-class="autoClass"
        :mass="mass"
        @change="change(open.sid, $event)"
        @apply="apply(open.sid, $event)"
        @cancel="cancel"
      />
    </Teleport>
  </div>
</template>
