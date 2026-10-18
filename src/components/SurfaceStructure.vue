<script setup>
// The structural side of each control surface, in the structure editor: its hinge gap and its
// servo bay (on or off, which servo, how it's mounted, where along the span). The surface itself
// (where it is, its depth, its throws) is drawn and set in the wing editor. Every change
// replaces the whole controls object, so undo/redo and autosave see it.
import { computed } from 'vue'
import UnitInput from './UnitInput.vue'
import SelectField from './SelectField.vue'
import SegmentedField from './SegmentedField.vue'
import { wingSampler } from '../lib/wing.js'
import { resolveSurfaces } from '../lib/controlSurfaces.js'
import { SERVOS, MOUNTINGS, bayOf, setBay, servoOptions, servoById, installedServo, defaultServoClass } from '../lib/servos.js'
import { format, defaultUnit } from '../lib/units.js'

const props = defineProps({
  system: { type: [String, Object], required: true },
  // The wing the surfaces sit on: { fuselageWidth, rootChord, panels, tip }
  wing: { type: Object, required: true },
  // The all-up mass, kg: which servo class a bay takes unless one is chosen
  mass: { type: Number, default: 0 },
  idPrefix: { type: String, default: 'wcs' },
})
const controls = defineModel('controls', { type: Object, required: true })

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
const mountOptions = () => Object.entries(MOUNTINGS).map(([value, label]) => ({ value, label }))
// The bay's centre, m from the surface's inner end. An older save only has `at` (from the panel's
// inner end), so convert it by the surface's own start.
const bayAlong = (s) => {
  const b = bayFor(s)
  if (Number.isFinite(b.along)) return b.along
  return Number.isFinite(b.at) ? b.at - s.from : null
}
function servoText(s) {
  const b = bayFor(s)
  const v = installedServo(b.class, b.mounting, props.mass)
  const mu = defaultUnit(props.system, 'mass')
  return `${v.label}: ${format(v.mass, 'mass', mu)}, about ${(v.torque / 0.0980665).toFixed(1)} kg·cm. Installed, lugs, output and lead included, it takes ${mm(v.run)} mm along the chord, ${mm(v.width)} mm across the span and ${mm(v.height)} mm of depth.${v.estimated ? ` ${v.maker} publishes no drawing, so its lugs and output are placed as a typical ${SERVOS[v.class].label.toLowerCase()} servo's.` : ''}${v.plan?.screws?.length ? '' : ' Its lugs don\'t bear on the plate this way up, so it needs fixing another way (the plate\'s note says how).'}`
}
</script>

<template>
  <div class="wc-surfaces">
    <p v-if="!shown.length" class="wc-field__hint">No control surfaces yet: draw them in the wing editor.</p>
    <div v-for="{ r, s } in shown" :key="s.id" class="wc-structure-editor__sub">
      <span class="wc-field__label">{{ r.label }}</span>
      <UnitInput :id="id(`${s.id}-gap`)" :model-value="s.gap" quantity="thin" :system="system" label="Hinge gap" @update:model-value="update(s.id, { gap: $event ?? 0 })" />
      <label class="wc-check wc-structure-editor__check">
        <input type="checkbox" :checked="bayFor(s).enabled" @change="setBayFor(s, { enabled: $event.target.checked })" />
        A servo bay for this surface
      </label>
      <template v-if="bayFor(s).enabled">
        <SelectField :id="id(`${s.id}-servo`)" :model-value="bayFor(s).class ?? ''" label="Servo" :options="SERVO_OPTIONS" @update:model-value="setBayFor(s, { class: $event || null })" />
        <SegmentedField :model-value="bayFor(s).mounting ?? 'upright'" label="Mounted" :options="mountOptions()" @update:model-value="setBayFor(s, { mounting: $event })" />
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
      </template>
    </div>
  </div>
</template>
