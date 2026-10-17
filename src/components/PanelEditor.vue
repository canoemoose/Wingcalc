<script setup>
// Numeric entry for the panel wing: fuselage width, root chord, then each panel outward
// from the fuselage side. The same values can be dragged in the wing plan editor; the two
// share the selected panel: each panel is a foldable section, and opening one selects its
// panel, while selecting a panel in the plan opens its section.
import { TRASH } from '../lib/icons.js'
import { computed, ref, nextTick } from 'vue'
import UnitInput from './UnitInput.vue'
import InspectorSection from './InspectorSection.vue'
import ParamInput from './ParamInput.vue'
import { panelAngle, appendPanel, removePanel, insertPanel, movePanel, panelMode, setPanelMode, addBlankStation, checkStations, stationOrder, panelSections } from '../lib/wing.js'
import { format, defaultUnit } from '../lib/units.js'

const props = defineProps({
  system: { type: [String, Object], required: true }, // a units setting (units.js normaliseUnits) or system name
  // Input warnings (calc.js validate: { field, message }), each shown under the box it's about
  warnings: { type: Array, default: () => [] },
  // Prefix for element ids, so two editors (page and expanded view) can coexist.
  idPrefix: { type: String, default: 'wc' },
  // The aerofoil's own thickness (fraction of chord), shown where a panel keeps it.
  baseThickness: { type: Number, default: null },
})
const rootChord = defineModel('rootChord', { type: Number, default: null })
const fuselageWidth = defineModel('fuselageWidth', { type: Number, default: 0 })
const panels = defineModel('panels', { type: Array, required: true })
const selected = defineModel('selected', { type: Number, default: null })
const tip = defineModel('tip', { type: Object, default: null })

const wing = () => ({ fuselageWidth: fuselageWidth.value, rootChord: rootChord.value, panels: panels.value })

const EDGE_MODES = [
  { id: 'straight', label: 'Straight' },
  { id: 'curves', label: 'Curves' },
  { id: 'stations', label: 'Chord stations' },
]

function setMode(i, mode) {
  if (panelMode(panels.value[i]) === mode) return
  panels.value = setPanelMode(wing(), i, mode)
}

// A new station goes at the end of the list (just before the tip), blank, with its
// distance box ready to type into.
async function newStation(i) {
  // Read the new station from the updated list: the model only reflects it after the
  // parent re-renders.
  const next = addBlankStation(panels.value, i)
  const st = next[i].stations.at(-1)
  panels.value = next
  await nextTick()
  const box = rootEl.value?.querySelector(`[id="${props.idPrefix}-p${i}-st${st.id}-d"]`)
  box?.focus()
}
const rootEl = ref(null)

function updateStation(i, id, key, value) {
  panels.value = panels.value.map((p, j) =>
    j === i ? { ...p, stations: p.stations.map((st) => (st.id === id ? { ...st, [key]: value } : st)) } : p,
  )
}

function removeStation(i, id) {
  panels.value = panels.value.map((p, j) => (j === i ? { ...p, stations: p.stations.filter((st) => st.id !== id) } : p))
}

const byDistance = (p) => stationOrder(p.stations)

// While a station's distance is being edited, the rows keep their order, so the row doesn't
// jump away mid-number (typing "1" on the way to "150" would otherwise send it to the top).
// The table re-sorts when focus leaves that row, by Tab, Enter or clicking elsewhere.
// Nothing is refocused afterwards: if the box you were heading to moved, click it again.
const frozenOrder = ref(null) // { panelId, ids: [...] }
function holdOrder(p) {
  if (frozenOrder.value?.panelId !== p.id) frozenOrder.value = { panelId: p.id, ids: byDistance(p).map((st) => st.id) }
}

function onRowFocusOut(e) {
  if (!frozenOrder.value || e.currentTarget.contains(e.relatedTarget)) return
  frozenOrder.value = null
}

function sortedStations(p) {
  const list = byDistance(p)
  const frozen = frozenOrder.value
  if (frozen?.panelId !== p.id) return list
  const rank = new Map(frozen.ids.map((id, k) => [id, k]))
  return [...list].sort((a, b) => (rank.get(a.id) ?? 1e9) - (rank.get(b.id) ?? 1e9))
}

// Distances are entered from the panel's inner end (default) or as spacing from the
// previous row. Stored distances are always from the inner end; spacing is only how
// they're shown and edited.
const spacingMode = (p) => p.distanceEntry === 'spacing'
const innerChord = (i) => (i === 0 ? rootChord.value : panels.value[i - 1]?.tipChord)

// The last filled-in distance before station st in table order (0 for the inner end).
function prevDistance(p, st) {
  const order = byDistance(p)
  const k = order.findIndex((q) => q.id === st.id)
  return order.slice(0, k).filter((q) => Number.isFinite(q.d)).at(-1)?.d ?? 0
}

function rowDistance(p, list, k) {
  const st = list[k]
  if (!Number.isFinite(st.d)) return null
  return spacingMode(p) ? st.d - prevDistance(p, st) : st.d
}

function setDistance(i, p, st, value) {
  if (value === null) return
  if (!spacingMode(p)) {
    holdOrder(p)
    updateStation(i, st.id, 'd', value)
    return
  }
  // A blank station being filled in goes in at that gap; the tip stays where it is.
  if (!Number.isFinite(st.d)) {
    updateStation(i, st.id, 'd', prevDistance(p, st) + value)
    return
  }
  // Spacing: move this station and everything outboard of it (the tip too) by the change.
  const list = byDistance(p).filter((q) => Number.isFinite(q.d))
  const k = list.findIndex((q) => q.id === st.id)
  const delta = value - (st.d - (k > 0 ? list[k - 1].d : 0))
  const moved = new Set(list.slice(k).map((q) => q.id))
  panels.value = panels.value.map((q, j) =>
    j === i
      ? {
          ...q,
          length: q.length + delta,
          stations: q.stations.map((x) => (moved.has(x.id) ? { ...x, d: x.d + delta } : x)),
        }
      : q,
  )
}

const lastFilled = (p) => byDistance(p).filter((q) => Number.isFinite(q.d)).at(-1)?.d ?? 0
const tipDistance = (p) => (spacingMode(p) ? p.length - lastFilled(p) : p.length)
function setTipDistance(i, p, value) {
  if (value === null) return
  update(i, 'length', spacingMode(p) ? lastFilled(p) + value : value)
}

const REASONS = {
  incomplete: 'Fill in its distance and chord to use it',
  inner: "At or before the inner end, so it's ignored",
  'on-tip': "Sits on the tip, so it's ignored",
  beyond: "Beyond the tip, so it's ignored",
  chord: "Negative chord, so it's ignored",
  duplicate: "Same place as another station, so it's ignored",
}
const warnMsg = (field) => props.warnings.find((w) => w.field === field)?.message ?? ''
const ignoredReasons = (p) => new Map(checkStations(p).ignored.map((x) => [x.id, x.reason]))

// Enter moves to the next box in the stations table, like Tab (Shift+Enter goes back).
function onTableEnter(e) {
  if (e.target.tagName !== 'INPUT') return
  e.preventDefault()
  const boxes = [...e.currentTarget.querySelectorAll('input:not([disabled])')]
  const next = boxes[boxes.indexOf(e.target) + (e.shiftKey ? -1 : 1)]
  if (next) next.focus()
  else e.target.blur()
}

// Which line, if any, stays straight while stations set the chords.
const STRAIGHT_LINES = [
  { id: 'none', label: 'None' },
  { id: 'le', label: 'Leading edge' },
  { id: 'te', label: 'Trailing edge' },
  { id: 'chord', label: 'Chord line' },
]
function straightKind(p) {
  if (!Number.isFinite(p.straightLine)) return 'none'
  if (p.straightLine === 0) return 'le'
  if (p.straightLine === 1) return 'te'
  return 'chord'
}
function setStraightKind(i, kind) {
  const value = { none: null, le: 0, te: 1, chord: 0.25 }[kind]
  const p = panels.value[i]
  // Leaving straight-line mode: give each station the set-back it currently has, so the
  // outline doesn't jump.
  if (value === null && Number.isFinite(p.straightLine)) {
    const r0 = p.straightLine * (i === 0 ? rootChord.value : panels.value[i - 1].tipChord)
    const r1 = (p.sweep || 0) + p.straightLine * p.tipChord
    const stations = p.stations.map((st) => ({ ...st, le: r0 + ((r1 - r0) * st.d) / p.length - p.straightLine * st.chord }))
    panels.value = panels.value.map((q, j) => (j === i ? { ...q, straightLine: null, stations } : q))
    return
  }
  update(i, 'straightLine', value)
}

// Segment k runs from station k-1 (or the inner end) to station k (or the outer end).
function segmentStraight(p, k) {
  const list = byDistance(p)
  return k < list.length ? !!list[k].straightIn : !!p.straightToTip
}
function toggleSegment(i, k) {
  const p = panels.value[i]
  const list = byDistance(p)
  if (k < list.length) updateStation(i, list[k].id, 'straightIn', !list[k].straightIn)
  else update(i, 'straightToTip', !p.straightToTip)
}
function segmentLabel(p, k) {
  const n = byDistance(p).length
  const from = k === 0 ? 'Inner end' : `Station ${k}`
  const to = k === n ? 'outer end' : `station ${k + 1}`
  return `${from} to ${to}`
}

const shown = computed(() => panels.value.map((p, i) => ({ p, i })))
// Working in a panel's fields selects it; clicking its heading only folds it (opening it
// selects it, through its toggle), so a click to close doesn't reselect and reopen it
const focusPanel = (e, i) => {
  if (!e.target.closest('summary')) selected.value = i
}

function setTip(on) {
  tip.value = on ? { extension: Math.max(0.02, (panels.value.at(-1)?.tipChord || 0.1) * 0.5), peak: 0.4 } : null
}

// Dihedral is entered either as an angle or as the rise of each panel's outer end. A panel
// carries a `rise` key (m, null while the box is empty) in rise mode and `dihedral`
// (degrees) otherwise. The mode follows the key, not its value, so clearing a box to
// retype it doesn't flip the mode.
const dihedralBy = computed(() => (panels.value.some((p) => 'rise' in p) ? 'rise' : 'angle'))

function setDihedralBy(mode) {
  if (mode === dihedralBy.value) return
  panels.value = panels.value.map(({ rise, dihedral, ...p }) => {
    const rad = panelAngle({ ...p, rise, dihedral }) ?? 0
    if (mode === 'rise') return { ...p, rise: (p.length ?? 0) * Math.sin(rad) }
    return { ...p, dihedral: Math.round(((rad * 180) / Math.PI) * 10) / 10 }
  })
}

function angleHint(p) {
  const rad = panelAngle(p)
  return rad === null ? '' : `${((rad * 180) / Math.PI).toFixed(1)}° to the horizontal`
}

function riseHint(p) {
  const rad = panelAngle(p)
  if (rad === null || !(p.length > 0)) return ''
  return `Outer end ${format(p.length * Math.sin(rad), 'length', defaultUnit(props.system, 'length'))} above the inner end`
}

// Thickness each panel inherits at its outer end when its own box is blank.
const sections = computed(() => panelSections(panels.value, props.baseThickness))
const inheritedThickness = (i) => {
  const t = sections.value[i]?.inner.thickness
  return Number.isFinite(t) ? `${(t * 100).toFixed(1)} (same)` : 'same'
}

function update(i, key, value) {
  panels.value = panels.value.map((p, j) => (j === i ? { ...p, [key]: value } : p))
}

// Straight edge, or a gentle curve to start from (refined by dragging in the plan editor).
function setEdge(i, edge, curved) {
  const p = panels.value[i]
  const bulge = edge === 'le' ? -0.15 : 0.15
  update(i, edge, curved ? { u: 0.5, d: bulge * Math.max(p.tipChord || 0, 0.05) } : null)
}

function add() {
  panels.value = appendPanel(panels.value, rootChord.value)
  selected.value = panels.value.length - 1
}

function remove(i) {
  panels.value = removePanel(panels.value, i)
  if (selected.value === i) selected.value = null
  else if (selected.value > i) selected.value -= 1
}

function insertAfter(i) {
  panels.value = insertPanel(panels.value, i, rootChord.value)
  selected.value = i + 1
}

function move(i, dir) {
  const j = i + dir
  if (j < 0 || j >= panels.value.length) return
  panels.value = movePanel(panels.value, i, dir)
  selected.value = j
}

// One line per section, shown on its heading while it's closed
const len = (v) => (Number.isFinite(v) ? format(v, 'length', defaultUnit(props.system, 'length')) : '–')
const rootSummary = computed(() => `${len(rootChord.value)} chord${fuselageWidth.value > 0 ? `, fuselage ${len(fuselageWidth.value)}` : ''}`)
function panelSummary(p) {
  const rad = panelAngle(p)
  const parts = [`${len(p.length)}, tip ${len(p.tipChord)}`]
  if (rad) parts.push(`${((rad * 180) / Math.PI).toFixed(1).replace(/\.0$/, '')}°`)
  if (p.washout) parts.push(`${p.washout}° washout`)
  if (panelMode(p) !== 'straight') parts.push(panelMode(p) === 'curves' ? 'curved' : 'stations')
  return parts.join(', ')
}

function title(i) {
  const n = panels.value.length
  if (n === 1) return 'Each wing panel'
  if (i === 0) return 'Panel 1 (inner)'
  if (i === n - 1) return `Panel ${i + 1} (tip)`
  return `Panel ${i + 1}`
}
</script>

<template>
  <div ref="rootEl" class="wc-panels wc-inspector">
    <InspectorSection title="Root" :fold-key="`${idPrefix}:root`" :summary="rootSummary" open>
    <UnitInput
      :id="`${idPrefix}-fuselage`"
      v-model="fuselageWidth"
      quantity="length"
      :system="system"
      label="Fuselage width"
      hint="Where the wing meets the fuselage. Panels start at its sides; use 0 for a one-piece wing measured from the centreline."
    />
    <UnitInput :id="`${idPrefix}-root`" v-model="rootChord" quantity="length" :system="system" label="Root chord" />
    <div class="wc-field">
      <span class="wc-field__label">Enter dihedral as</span>
      <div class="wc-segmented wc-segmented--small" role="radiogroup" aria-label="Enter dihedral as">
        <button
          v-for="m in [
            { id: 'angle', label: 'Angle' },
            { id: 'rise', label: 'Rise at outer end' },
          ]"
          :key="m.id"
          type="button"
          role="radio"
          :aria-checked="dihedralBy === m.id"
          class="wc-segmented__btn"
          :class="{ 'wc-segmented__btn--active': dihedralBy === m.id }"
          @click="setDihedralBy(m.id)"
        >
          {{ m.label }}
        </button>
      </div>
    </div>
    </InspectorSection>
    <InspectorSection
      v-for="{ p, i } in shown"
      :key="p.id ?? i"
      :title="title(i)"
      :fold-key="`${idPrefix}:panel-${i}`"
      :summary="panelSummary(p)"
      :open="panels.length === 1"
      :open-when="selected === i"
      :class="{ 'wc-fold--selected': selected === i }"
      @focusin="focusPanel($event, i)"
      @toggle="(o) => o && (selected = i)"
    >
      <div class="wc-panelset__actions">
        <button
          type="button"
          class="wc-iconbtn"
          :disabled="i === 0"
          :aria-label="`Move panel ${i + 1} inward`"
          title="Move inward (towards the root)"
          @click="move(i, -1)"
        >
          ←
        </button>
        <button
          type="button"
          class="wc-iconbtn"
          :disabled="i === panels.length - 1"
          :aria-label="`Move panel ${i + 1} outward`"
          title="Move outward (towards the tip)"
          @click="move(i, 1)"
        >
          →
        </button>
        <button
          type="button"
          class="wc-iconbtn"
          :aria-label="`Insert a panel after panel ${i + 1}`"
          title="Insert a new panel outboard of this one"
          @click="insertAfter(i)"
        >
          +
        </button>
        <button
          v-if="panels.length > 1"
          type="button"
          class="wc-iconbtn wc-iconbtn--danger"
          :aria-label="`Delete panel ${i + 1}`"
          title="Delete this panel"
          @click="remove(i)"
        ><svg viewBox="0 0 24 24" aria-hidden="true"><path v-for="(d, k) in TRASH" :key="k" :d="d" /></svg></button>
      </div>
      <UnitInput
        :id="`${idPrefix}-panel-${i}-length`"
        :model-value="p.length"
        quantity="length"
        :system="system"
        :label="panels.length === 1 ? 'Length, root to tip' : 'Length along the panel'"
        :hint="i === 0 ? 'One side only, measured flat along the panel.' : ''"
        @update:model-value="update(i, 'length', $event)"
      />
      <UnitInput
        :id="`${idPrefix}-panel-${i}-chord`"
        :model-value="p.tipChord"
        quantity="length"
        :system="system"
        :label="i === panels.length - 1 ? 'Tip chord' : 'Chord at outer end'"
        :warn="warnMsg(`panel-${i}`)"
        @update:model-value="update(i, 'tipChord', $event)"
      />
      <UnitInput
        :id="`${idPrefix}-panel-${i}-sweep`"
        :model-value="p.sweep ?? 0"
        quantity="length"
        :system="system"
        label="Sweep (leading-edge offset)"
        :hint="i === 0 ? 'How far back the outer end of the leading edge sits from the inner end. Negative sweeps forward.' : ''"
        @update:model-value="update(i, 'sweep', $event ?? 0)"
      />
      <UnitInput
        v-if="dihedralBy === 'rise'"
        :id="`${idPrefix}-panel-${i}-rise`"
        :model-value="p.rise"
        quantity="length"
        :system="system"
        label="Rise at outer end"
        :warn="warnMsg(`panel-${i}-rise`)"
        :hint="
          (i === 0 ? 'Height of the outer end above the inner end, with the wing level. Negative for anhedral. ' : '') +
          angleHint(p)
        "
        @update:model-value="update(i, 'rise', $event)"
      />
      <ParamInput
        v-else
        :id="`${idPrefix}-panel-${i}-dihedral`"
        :model-value="p.dihedral ?? 0"
        label="Dihedral"
        suffix="°"
        :min="-10"
        :max="45"
        :step="0.5"
        :hint="
          (i === 0 ? 'Angle of the panel to the horizontal, seen from the front. Negative for anhedral. ' : '') +
          riseHint(p)
        "
        @update:model-value="update(i, 'dihedral', $event)"
      />
      <ParamInput
        :id="`${idPrefix}-panel-${i}-washout`"
        :model-value="p.washout ?? 0"
        label="Washout at outer end"
        suffix="°"
        :min="-3"
        :max="8"
        :step="0.25"
        :hint="
          i === 0
            ? 'Twist relative to the root, nose down, varying evenly across the panel. Each panel sets the total at its own outer end.'
            : ''
        "
        @update:model-value="update(i, 'washout', $event)"
      />
      <UnitInput
        :id="`${idPrefix}-panel-${i}-thickness`"
        :model-value="p.thickness"
        quantity="percent"
        :system="system"
        :label="i === panels.length - 1 ? 'Section thickness at tip' : 'Section thickness at outer end'"
        :placeholder="inheritedThickness(i)"
        :hint="
          i === 0
            ? 'Percent of chord. Leave blank to keep the thickness of the inner end; the camber is kept as it is.'
            : ''
        "
        @update:model-value="update(i, 'thickness', $event)"
      />
      <div class="wc-field">
        <span class="wc-field__label">Shape</span>
        <div class="wc-segmented wc-segmented--small" role="radiogroup" :aria-label="`Panel ${i + 1} shape`">
          <button
            v-for="m in EDGE_MODES"
            :key="m.id"
            type="button"
            role="radio"
            :aria-checked="panelMode(p) === m.id"
            class="wc-segmented__btn"
            :class="{ 'wc-segmented__btn--active': panelMode(p) === m.id }"
            @click="setMode(i, m.id)"
          >
            {{ m.label }}
          </button>
        </div>
      </div>
      <div v-if="panelMode(p) === 'curves'" class="wc-edges">
        <label class="wc-check">
          <input type="checkbox" :checked="!!p.le" @change="setEdge(i, 'le', $event.target.checked)" /> Curved leading
          edge
        </label>
        <label class="wc-check">
          <input type="checkbox" :checked="!!p.te" @change="setEdge(i, 'te', $event.target.checked)" /> Curved trailing
          edge
        </label>
      </div>
      <div v-else-if="panelMode(p) === 'stations'" class="wc-stations">
        <p class="wc-field__hint">
          Chords dimensioned along the panel; the edges run smoothly through them. The first row is the panel's inner
          end; the last is its tip, so its distance is the panel length. Set-back is how far a leading edge sits behind
          the panel's inner leading edge; leave it blank to follow the line through its neighbours. Enter moves to the
          next box.
        </p>
        <div class="wc-field">
          <span class="wc-field__label">Keep straight</span>
          <div class="wc-segmented wc-segmented--small" role="radiogroup" :aria-label="`Panel ${i + 1} straight line`">
            <button
              v-for="m in STRAIGHT_LINES"
              :key="m.id"
              type="button"
              role="radio"
              :aria-checked="straightKind(p) === m.id"
              class="wc-segmented__btn"
              :class="{ 'wc-segmented__btn--active': straightKind(p) === m.id }"
              @click="setStraightKind(i, m.id)"
            >
              {{ m.label }}
            </button>
          </div>
          <p v-if="straightKind(p) !== 'none'" class="wc-field__hint">
            Stations set only the chord; the edges sit either side of the straight line.
          </p>
        </div>
        <ParamInput
          v-if="straightKind(p) === 'chord'"
          :id="`${idPrefix}-p${i}-straightline`"
          :model-value="Math.round(p.straightLine * 100)"
          label="Straight line at"
          suffix="% chord"
          :min="1"
          :max="99"
          :step="1"
          hint="25% keeps the quarter-chord line straight, as on a classic elliptical wing."
          @update:model-value="update(i, 'straightLine', $event / 100)"
        />
        <div class="wc-field">
          <span class="wc-field__label">Distances</span>
          <div class="wc-segmented wc-segmented--small" role="radiogroup" :aria-label="`Panel ${i + 1} distances`">
            <button
              type="button"
              role="radio"
              :aria-checked="!spacingMode(p)"
              class="wc-segmented__btn"
              :class="{ 'wc-segmented__btn--active': !spacingMode(p) }"
              @click="update(i, 'distanceEntry', 'inner')"
            >
              From inner end
            </button>
            <button
              type="button"
              role="radio"
              :aria-checked="spacingMode(p)"
              class="wc-segmented__btn"
              :class="{ 'wc-segmented__btn--active': spacingMode(p) }"
              @click="update(i, 'distanceEntry', 'spacing')"
            >
              Spacing
            </button>
          </div>
          <p v-if="spacingMode(p)" class="wc-field__hint">
            Each distance is the gap from the row above. Changing one moves everything outboard of it, the tip included.
          </p>
        </div>
        <div
          class="wc-stations__grid"
          :class="{ 'wc-stations__grid--nosetback': straightKind(p) !== 'none' }"
          role="table"
          :aria-label="`Panel ${i + 1} chord stations`"
          @keydown.enter="onTableEnter"
        >
          <div class="wc-stations__row" role="row">
            <span class="wc-stations__head" role="columnheader">{{ spacingMode(p) ? 'Spacing' : 'Distance' }}</span>
            <span class="wc-stations__head" role="columnheader">Chord</span>
            <span v-if="straightKind(p) === 'none'" class="wc-stations__head" role="columnheader">LE set-back</span>
            <span />
          </div>
          <div class="wc-stations__row wc-stations__row--fixed" role="row" title="The panel's inner end, set by the panel inboard">
            <span class="wc-stations__fixed">Inner end</span>
            <span class="wc-stations__fixed">{{ format(innerChord(i), 'length', defaultUnit(system, 'length')) }}</span>
            <span v-if="straightKind(p) === 'none'" class="wc-stations__fixed">0</span>
            <span />
          </div>
          <template v-for="(st, k) in sortedStations(p)" :key="st.id">
            <button
              type="button"
              class="wc-segment"
              :class="{ 'wc-segment--straight': segmentStraight(p, k) }"
              :aria-pressed="segmentStraight(p, k)"
              :title="`${segmentLabel(p, k)}: click to make it ${segmentStraight(p, k) ? 'curved' : 'straight'}`"
              @click="toggleSegment(i, k)"
            >
              <span class="wc-segment__line" aria-hidden="true" />
              {{ segmentLabel(p, k) }}: {{ segmentStraight(p, k) ? 'straight' : 'curved' }}
            </button>
            <div
              class="wc-stations__row"
              :class="{ 'wc-stations__row--bad': ignoredReasons(p).has(st.id) && ignoredReasons(p).get(st.id) !== 'incomplete' }"
              role="row"
              @focusout="onRowFocusOut"
            >
              <UnitInput
                :id="`${idPrefix}-p${i}-st${st.id}-d`"
                :model-value="rowDistance(p, sortedStations(p), k)"
                quantity="length"
                :system="system"
                :label="`Station ${k + 1} ${spacingMode(p) ? 'spacing' : 'distance'}`"
                compact
                :warn="ignoredReasons(p).has(st.id) && ignoredReasons(p).get(st.id) !== 'incomplete'"
                @update:model-value="setDistance(i, p, st, $event)"
              />
              <UnitInput
                :id="`${idPrefix}-p${i}-st${st.id}-c`"
                :model-value="st.chord"
                quantity="length"
                :system="system"
                :label="`Station ${k + 1} chord`"
                compact
                @update:model-value="updateStation(i, st.id, 'chord', $event)"
              />
              <UnitInput
                v-if="straightKind(p) === 'none'"
                :id="`${idPrefix}-p${i}-st${st.id}-le`"
                :model-value="st.le"
                quantity="length"
                :system="system"
                :label="`Station ${k + 1} leading-edge set-back`"
                compact
                placeholder="auto"
                @update:model-value="updateStation(i, st.id, 'le', $event)"
              />
              <button
                type="button"
                class="wc-stations__remove"
                :aria-label="`Remove station ${k + 1}`"
                title="Remove this station"
                @click="removeStation(i, st.id)"
              ><svg viewBox="0 0 24 24" aria-hidden="true"><path v-for="(d, k) in TRASH" :key="k" :d="d" /></svg></button>
              <p
                v-if="ignoredReasons(p).has(st.id)"
                class="wc-stations__why"
                :class="{ 'wc-stations__why--todo': ignoredReasons(p).get(st.id) === 'incomplete' }"
              >
                {{ REASONS[ignoredReasons(p).get(st.id)] }}.
              </p>
            </div>
          </template>
          <button
            v-if="sortedStations(p).length"
            type="button"
            class="wc-segment"
            :class="{ 'wc-segment--straight': segmentStraight(p, sortedStations(p).length) }"
            :aria-pressed="segmentStraight(p, sortedStations(p).length)"
            @click="toggleSegment(i, sortedStations(p).length)"
          >
            <span class="wc-segment__line" aria-hidden="true" />
            {{ segmentLabel(p, sortedStations(p).length) }}:
            {{ segmentStraight(p, sortedStations(p).length) ? 'straight' : 'curved' }}
          </button>
          <div class="wc-stations__row wc-stations__row--tip" role="row">
            <UnitInput
              :id="`${idPrefix}-p${i}-tip-d`"
              :model-value="tipDistance(p)"
              quantity="length"
              :system="system"
              :label="`Tip ${spacingMode(p) ? 'spacing' : 'distance (panel length)'}`"
              compact
              @update:model-value="setTipDistance(i, p, $event)"
            />
            <UnitInput
              :id="`${idPrefix}-p${i}-tip-c`"
              :model-value="p.tipChord"
              quantity="length"
              :system="system"
              label="Tip chord"
              compact
              @update:model-value="update(i, 'tipChord', $event)"
            />
            <UnitInput
              v-if="straightKind(p) === 'none'"
              :id="`${idPrefix}-p${i}-tip-le`"
              :model-value="p.sweep ?? 0"
              quantity="length"
              :system="system"
              label="Tip leading-edge set-back (sweep)"
              compact
              @update:model-value="update(i, 'sweep', $event ?? 0)"
            />
            <span class="wc-stations__tiplabel">Tip</span>
          </div>
        </div>
        <button type="button" class="wc-button wc-button--small" @click="newStation(i)">Add station</button>
      </div>
    </InspectorSection>
    <div class="wc-panels__actions">
      <button type="button" class="wc-button" @click="add">Add panel</button>
    </div>
    <InspectorSection title="Wingtip" :fold-key="`${idPrefix}:tip`" :summary="tip ? `Rounded, ${len(tip.extension)}` : 'Square'" :open="!!tip">
      <label class="wc-check wc-tipcheck">
        <input type="checkbox" :checked="!!tip" @change="setTip($event.target.checked)" /> Rounded tip beyond the last
        panel
      </label>
      <template v-if="tip">
        <UnitInput
          :id="`${idPrefix}-tip-extension`"
          :model-value="tip.extension"
          quantity="length"
          :system="system"
          label="Tip extension"
          hint="How far the rounded tip reaches beyond the end of the last panel."
          @update:model-value="tip = { ...tip, extension: $event }"
        />
        <ParamInput
          :id="`${idPrefix}-tip-peak`"
          :model-value="Math.round((tip.peak ?? 0.4) * 100)"
          label="Furthest point along the chord"
          suffix="% chord"
          :min="0"
          :max="100"
          :step="1"
          hint="0% rakes the tip back from the leading edge, 100% forward from the trailing edge; 40% looks like a classic rounded tip."
          @update:model-value="tip = { ...tip, peak: $event / 100 }"
        />
      </template>
    </InspectorSection>
    <p class="wc-field__hint">
      Add panel puts a new one at the tip; + on a panel inserts one just outboard of it, and the arrows move a panel
      inward or outward. Shape curves by dragging their handles in the wing plan.
    </p>
  </div>
</template>
