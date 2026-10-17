<script setup>
// Numeric entry for the wing's structure: how it's built (built-up or a foam core), design
// loads, spar, covering, edges, stringers, ribs, gussets, dihedral braces and control-surface
// hinges. A foam wing shows its core, skins and spar caps instead of the spar, covering,
// stringers, ribs and gussets (which are kept, for switching back). Every change replaces the
// whole structure object, so undo/redo and autosave see it.
import { TRASH } from '../lib/icons.js'
import { computed } from 'vue'
import UnitInput from './UnitInput.vue'
import ParamInput from './ParamInput.vue'
import SelectField from './SelectField.vue'
import SegmentedField from './SegmentedField.vue'
import InspectorSection from './InspectorSection.vue'
import EdgeFit from './EdgeFit.vue'
import EdgeStockPicker from './EdgeStockPicker.vue'
import { format, defaultUnit } from '../lib/units.js'
import { MATERIALS, gussetLayer, FINISHES, finishOf } from '../lib/structure.js'
import { FOAMS, SKIN_MATERIALS, FOAM_CAP_MATERIALS, SKIN_SHEETS, defaultFoam } from '../lib/foam.js'
import { LE_STOCK, TE_STOCK, KIND_LABELS, LE_TYPES, isRound, roundDiameter, customLe } from '../lib/edgeStock.js'

const props = defineProps({
  system: { type: [String, Object], required: true }, // a units setting (units.js normaliseUnits) or system name
  // The spar position the aerofoil suggests (its thickest point), shown as the placeholder
  autoSpar: { type: Number, default: null },
  // Brace thicknesses the loads call for, in metres, shown as placeholders
  braceNeeds: { type: Array, default: () => [] },
  // Where the ribs are now (distances from the root rib), to start manual spacing from
  ribDistances: { type: Array, default: () => [] },
  // The edge stock the analysis resolved (structure.js analyseStructure().edges), for Auto
  edges: { type: Object, default: null },
  // Room for the corner gussets at each edge (wing3d.js gussetFit), to offer only what fits
  gussetFit: { type: Object, default: null },
  // What the covering weighs on this wing, kg (ribs.js estimateWeight), for its hint
  coveringMass: { type: Number, default: null },
  idPrefix: { type: String, default: 'wcs' },
})
const structure = defineModel('structure', { type: Object, required: true })

// Replace the value at a dotted path, copying each object on the way down.
function set(path, value) {
  const keys = path.split('.')
  const copy = (obj, i) => {
    const out = Array.isArray(obj) ? [...obj] : { ...obj }
    out[keys[i]] = i === keys.length - 1 ? value : copy(obj[keys[i]], i + 1)
    return out
  }
  structure.value = copy(structure.value, 0)
}
const st = computed(() => structure.value)
const id = (k) => `${props.idPrefix}-${k}`

// Short names fit the inspector's value column; the full description is the option's tooltip
const materials = (ids) =>
  ids.map((k) => ({ value: k, label: MATERIALS[k].short.replace(/^./, (c) => c.toUpperCase()), title: MATERIALS[k].label }))
const WOOD = materials(['balsa-light', 'balsa-medium', 'balsa-hard', 'spruce', 'basswood', 'ply-lite', 'ply-birch'])
const CAPS = materials(['spruce', 'basswood', 'balsa-hard', 'balsa-medium', 'carbon'])
const SHEET = materials(['balsa-light', 'balsa-medium', 'balsa-hard', 'ply-lite', 'ply-birch'])
const PLY = materials(['ply-birch', 'ply-lite', 'balsa-hard'])
const TUBE = materials(['carbon-tube'])
const FOAM_OPTIONS = FOAMS.map((k) => ({ value: k, label: MATERIALS[k].label, title: `${(MATERIALS[k].E / 1e6).toFixed(1)} MPa modulus, ${Math.round(MATERIALS[k].shear / 1000)} kPa shear strength` }))
const SKINS = materials(SKIN_MATERIALS)
const FOAM_CAPS = materials(FOAM_CAP_MATERIALS)

const CONSTRUCTIONS = [
  { value: 'built-up', label: 'Built-up', title: 'Ribs, a spar and covering' },
  { value: 'foam', label: 'Foam core', title: 'A hot-wire cut foam core, skinned with veneer or balsa' },
]
const foam = computed(() => st.value.construction === 'foam')
// The foam settings, filled in for a structure saved before them
const fm = computed(() => st.value.foam ?? defaultFoam())
const sheetSize = computed(() => SKIN_SHEETS[fm.value.skin.material] ?? SKIN_SHEETS.default)
const lengthText = (v) => format(v, 'length', defaultUnit(props.system, 'length'))

const SPAR_TYPES = [
  { value: 'caps', label: 'Caps and web' },
  { value: 'box', label: 'Box' },
  { value: 'tube', label: 'Tube' },
  { value: 'solid', label: 'Solid' },
]
const COVERINGS = [
  { value: 'open', label: 'Open', title: 'Ribs only, covered over the open bays' },
  { value: 'dbox', label: 'D-box', title: 'Sheeted from the leading edge back to the spar' },
  { value: 'sheeted', label: 'Fully sheeted' },
]
const FINISH_OPTIONS = Object.entries(FINISHES).map(([value, f]) => ({ value, label: f.label, group: f.group, title: f.examples }))
// What the strength check and the weight assume about the covering, in a sentence or two
const finishHint = computed(() => {
  const cov = st.value.covering
  const f = finishOf(cov)
  const g = (kgm2) => `${Math.round(kgm2 * 1000)} g/m²`
  const total = Number.isFinite(props.coveringMass) ? ` About ${format(props.coveringMass, 'mass', defaultUnit(props.system, 'mass'))} on this wing, both surfaces.` : ''
  if (foam.value) {
    if (f.laminate) return `Over the skins, ${g(f.mass)}.${total} The check counts it as a ${(f.laminate.t * 1000).toFixed(2)} mm skin at ${f.laminate.E / 1e9} GPa on the veneer or balsa: it shares the bending and stiffens the skin against wrinkling.`
    return `About ${g(f.mass)} with its adhesive.${total} Counted as weight only.`
  }
  if (f.laminate) {
    if (cov.type === 'open') return `Goes over sheeting only, and there's none here, so it's weighed as lightweight film.${total}`
    return `Over the sheeting, ${g(f.mass)}${cov.type === 'dbox' ? ', with lightweight film over the open bays behind the spar' : ''}.${total} The check counts it as a ${(f.laminate.t * 1000).toFixed(2)} mm skin at ${f.laminate.E / 1e9} GPa on the sheeting: it shares the bending and stiffens the sheet panels between ribs.`
  }
  return `About ${g(f.mass)} with its adhesive or dope.${total} Counted as weight only: the check gives the covering no strength, which errs on the safe side.`
})

const SPACINGS = [
  { value: 'suggested', label: 'From loads', title: 'As close as the structure needs, no wider than the maximum' },
  { value: 'uniform', label: 'Even' },
  { value: 'tapered', label: 'Tapered' },
  { value: 'manual', label: 'Manual' },
]

const nextId = (list) => list.reduce((m, x) => Math.max(m, x.id ?? 0), 0) + 1
function addTo(path, item) {
  const list = path.split('.').reduce((o, k) => o[k], st.value) ?? []
  set(path, [...list, { id: nextId(list), ...item }])
}
function updateIn(path, itemId, key, value) {
  const list = path.split('.').reduce((o, k) => o[k], st.value)
  set(
    path,
    list.map((x) => (x.id === itemId ? { ...x, [key]: value } : x)),
  )
}
function removeFrom(path, itemId) {
  const list = path.split('.').reduce((o, k) => o[k], st.value)
  set(
    path,
    list.filter((x) => x.id !== itemId),
  )
}
// Switching to manual starts from the ribs on screen, so the layout is adjusted rather than
// built up from nothing (or from manual ribs left over from some earlier layout)
function setSpacing(mode) {
  if (mode === 'manual' && st.value.ribs.spacing !== 'manual') {
    structure.value = {
      ...structure.value,
      ribs: { ...structure.value.ribs, spacing: mode, manual: props.ribDistances.map((d, i) => ({ id: i + 1, d: Math.round(d * 2000) / 2000 })) },
    }
  } else set('ribs.spacing', mode)
}
const byDistance = (list) => [...(list ?? [])].sort((a, b) => (a.d ?? Infinity) - (b.d ?? Infinity))

// What each section holds, one line, shown on its heading while it's closed
// Sizes without trailing zeros, the unit once: "6 × 3 mm", "1.5 mm"
const num = (v) => {
  const u = defaultUnit(props.system, 'thin')
  const n = u === 'mm' ? v * 1000 : v / 0.0254
  return String(Number(n.toFixed(u === 'mm' ? 1 : 3)))
}
const unit = () => (defaultUnit(props.system, 'thin') === 'mm' ? 'mm' : 'in')
const mm = (v) => (Number.isFinite(v) ? `${num(v)} ${unit()}` : '–')
const size = (a, b) => (Number.isFinite(a) && Number.isFinite(b) ? `${num(a)} × ${num(b)} ${unit()}` : '–')
const len = (v) => (Number.isFinite(v) ? format(v, 'length', defaultUnit(props.system, 'length')) : '–')
const mat = (id) => MATERIALS[id]?.short ?? id
const SPACING_SUMS = { suggested: 'from loads', uniform: 'even', tapered: 'tapered', manual: 'manual' }
const LAYER_SUMS = { top: 'top', bottom: 'bottom', both: 'top and bottom' }

// Gusset placements at one edge, those without the depth for them turned off (the current
// one stays clickable so it can be seen; the warnings say it doesn't fit)
function layerOptions(edge) {
  const fit = props.gussetFit?.[edge]
  const room = fit ? format(fit.room, 'thin', defaultUnit(props.system, 'thin')) : ''
  return [
    { value: 'top', label: 'Top' },
    { value: 'bottom', label: 'Bottom' },
    { value: 'both', label: 'Top and bottom' },
  ].map((o) => {
    const off = fit && !fit.fits[o.value] && gussetLayer(st.value.gussets, edge) !== o.value
    return { ...o, disabled: off, title: off ? `Needs more depth than the ${room} there` : '' }
  })
}
const summaries = computed(() => {
  const x = st.value
  const sp = x.spar
  const cov = x.covering
  const r = x.ribs
  const g = x.gussets
  const spar =
    sp.type === 'tube'
      ? `Tube ${mm(sp.tubeDiameter)}, ${mm(sp.tubeWall)} wall`
      : sp.type === 'solid'
        ? `Solid ${size(sp.solidWidth, sp.solidDepth)} ${mat(sp.solidMaterial)}`
        : `${sp.type === 'box' ? 'Box' : 'Caps and web'}, ${size(sp.capWidth, sp.capThickness)} ${mat(sp.capMaterial)}`
  const covering = `${
    cov.type === 'open'
      ? `Open${cov.capStrips ? ', cap strips' : ''}`
      : `${cov.type === 'dbox' ? 'D-box' : 'Fully sheeted'}, ${mm(cov.sheetThickness)} ${mat(cov.sheetMaterial)}`
  }, ${finishOf(cov).short}`
  const spacing = r.spacing === 'manual' ? `manual, ${(r.manual ?? []).length} ribs` : SPACING_SUMS[r.spacing]
  const gussets = !(g.le || g.te)
    ? 'None'
    : `${[g.le && 'LE', g.te && 'TE'].filter(Boolean).join(' and ')}, ${g.where === 'all' ? 'every rib' : 'ends'}, ${[...new Set(
        ['le', 'te'].filter((e) => g[e]).map((e) => LAYER_SUMS[gussetLayer(g, e)]),
      )].join(' / ')}`
  const f = x.foam ?? defaultFoam()
  return {
    construction: x.construction === 'foam' ? 'Foam core' : 'Built-up',
    core: `${MATERIALS[f.core]?.short ?? f.core}, ${mm(f.skin.thickness)} ${mat(f.skin.material)} skins`,
    caps: `${size(f.caps.width, f.caps.thickness)} ${mat(f.caps.material)}${f.web.enabled ? ', web' : ''}`,
    finish: finishOf(cov).short.replace(/^./, (c) => c.toUpperCase()),
    loads: `${x.loads.designG} g, −${x.loads.negativeG} g, ×${x.loads.safetyFactor}`,
    spar,
    covering,
    edges: `LE ${edgeName('le')}, TE ${edgeName('te')}`,
    stringers: (x.stringers ?? []).length ? `${x.stringers.length} stringer${x.stringers.length === 1 ? '' : 's'}` : 'None',
    ribs: `${mm(r.thickness)} ${mat(r.material)}, ${spacing}${r.orientation === 'perpendicular' ? ', square to spar' : ''}`,
    gussets,
    braces: !x.braces.enabled ? 'Off' : `${mat(x.braces.material)}, ${len(x.braces.length)} each side`,
    hinges: `Mylar tabs, ${size(x.hinges.tabWidth, x.hinges.tabLength)}, ${len(x.hinges.tabSpacing)} apart at most`,
  }
})

// Edge stock: the standard sizes in the current units (SLEC's own metric or imperial
// figures), plus Auto (picked to suit; shown with its pick) and Custom
// Sizes as SLEC lists them: the square profiles by side, strip and triangular stock as
// depth × height (strip) or thickness × width (triangular)
const stockSize = (it) => {
  if (it.kind === 'symmetrical') return unit() === 'mm' ? `${num(it.width)} mm` : it.inch.split(' × ')[0]
  if (unit() !== 'mm') return it.inch
  return it.kind === 'triangular' ? `${num(it.height)} × ${num(it.width)} mm` : `${num(it.width)} × ${num(it.height)} mm`
}
const stockName = (it) => `${it.code}, ${stockSize(it)}`
const LE_GROUPS = { symmetrical: 'Symmetrical profile', strip: 'Strip, on edge (depth × height)' }
const LE_OPTIONS = computed(() => [
  { value: 'auto', label: props.edges ? `Auto (${stockName(props.edges.le.auto)} ${KIND_LABELS[props.edges.le.auto.kind]})` : 'Auto', title: 'The stock that carves to the section with the least wood removed' },
  ...LE_STOCK.map((it) => ({ value: it.id, label: stockName(it), group: LE_GROUPS[it.kind] })),
  { value: 'custom', label: 'Custom' },
])
// Cross-sections for the pickers' thumbnails (Auto shows what it picks; a custom leading edge its own size)
const LE_ITEMS = computed(() => ({ auto: props.edges?.le.auto ?? null, ...Object.fromEntries(LE_STOCK.map((it) => [it.id, it])), custom: customLe(st.value.le) }))
const TE_ITEMS = computed(() => ({ auto: props.edges?.te.auto ?? null, ...Object.fromEntries(TE_STOCK.map((it) => [it.id, it])), custom: null }))
const TE_OPTIONS = computed(() => [
  { value: 'auto', label: props.edges ? `Auto (${stockName(props.edges.te.auto)})` : 'Auto', title: 'The stock that carves to the section with the least wood removed, at least 5% of the root chord deep' },
  ...TE_STOCK.map((it) => ({ value: it.id, label: stockName(it), group: 'Triangular (thickness × width)' })),
  { value: 'custom', label: 'Custom' },
])
// Going to Custom starts from the width in use, so nothing moves until it's edited
function setStock(k, v) {
  const e = st.value[k]
  const from = props.edges?.[k]
  const next = { ...e, stock: v }
  if (v === 'custom' && e.stock !== 'custom' && from?.width > 0) {
    next.width = from.width
    if (k === 'te') next.type = 'triangular'
  }
  set(k, next)
}
function edgeName(k) {
  const e = st.value[k]
  if (k === 'le' && e.type === 'none') return 'none'
  if (k === 'le' && isRound(e)) return `${mm(roundDiameter(e))} ${LE_TYPES[e.type].short}`
  const it = e.stock === 'custom' ? null : e.stock === 'auto' ? props.edges?.[k].auto : (k === 'le' ? LE_STOCK : TE_STOCK).find((x) => x.id === e.stock)
  if (it) return `${it.code} ${KIND_LABELS[it.kind]}`
  return k === 'le' ? mm(e.width) : `${e.type} ${mm(e.width)}`
}

// The leading edge's type, and a rod or dowel's size from its standard range
const LE_TYPE_OPTIONS = Object.entries(LE_TYPES).map(([value, t]) => ({ value, label: t.label }))
const roundOptions = computed(() => {
  const t = LE_TYPES[st.value.le.type]
  return (t?.sizes ?? []).map((d) => ({ value: String(d), label: mm(d) }))
})
// A size from the other type's range carries over only if this one sells it too
function setLeType(v) {
  const e = st.value.le
  const sizes = LE_TYPES[v]?.sizes ?? []
  const keep = sizes.some((d) => Math.abs(d - e.diameter) < 1e-9)
  set('le', { ...e, type: v, diameter: keep ? e.diameter : null })
}
const roundHint = computed(() => {
  const e = props.edges?.le
  const t = LE_TYPES[st.value.le.type]
  if (!e?.round || !t) return ''
  const best = e.roundFits ? `The largest that fits this wing is ${mm(e.roundFits)}.` : "Even the smallest doesn't fit this wing's nose."
  return `Sits in a half-round notch at the front of each rib, the sheeting or covering meeting it at its centre line. It can't be carved, so it has to fit inside the section at every rib. ${best}`
})

const halvesHint = computed(() =>
  st.value.ribs.rootJoint === 'two-piece' ? "Each half starts at the fuselage side and plugs in; the joiner itself isn't designed here." : 'Joined at the centreline.',
)
const webHint = computed(() =>
  fm.value.web.enabled
    ? "Grain vertical, in a slot cut through the core along the caps' front face before skinning. It carries the shear instead of the foam."
    : 'Without a web, the foam between the caps carries the shear.',
)
const autoSparText = computed(() => (Number.isFinite(props.autoSpar) ? `${(props.autoSpar * 100).toFixed(1)} (thickest point)` : 'auto'))
const braceHint = computed(() => {
  const n = props.braceNeeds.filter(Number.isFinite)
  if (!n.length) return 'No dihedral breaks to brace.'
  const needs = n.map((v, i) => `B${i + 1} needs at least ${(v * 1000).toFixed(1)} mm at the material strength with the safety factor`)
  return `Thickness needed: ${needs.join('; ')}. Leave blank to use the next standard ply above that.`
})
</script>

<template>
  <div class="wc-structure-editor wc-inspector">
    <InspectorSection title="Construction" fold-key="structure:construction" :summary="summaries.construction" open>
      <SegmentedField :model-value="st.construction ?? 'built-up'" label="Built as" :options="CONSTRUCTIONS" @update:model-value="set('construction', $event)" />
      <p class="wc-field__hint">
        {{
          foam
            ? 'A hot-wire cut foam core for each panel, skinned top and bottom, with spar caps let in under the skins and no ribs. The built-up settings are kept for switching back.'
            : 'Ribs on a spar, with sheeting, cap strips and covering as set below.'
        }}
      </p>
    </InspectorSection>

    <template v-if="foam">
      <InspectorSection title="Foam core and skins" fold-key="structure:foamcore" :summary="summaries.core">
        <SelectField
          :id="id('fcore')"
          :model-value="fm.core"
          label="Foam"
          :options="FOAM_OPTIONS"
          hint="Denser foam resists the skin wrinkling and the core shear better, and weighs more."
          @update:model-value="set('foam.core', $event)"
        />
        <SelectField :id="id('fskm')" :model-value="fm.skin.material" label="Skin" :options="SKINS" @update:model-value="set('foam.skin.material', $event)" />
        <UnitInput
          :id="id('fskt')"
          :model-value="fm.skin.thickness"
          quantity="thin"
          :system="system"
          label="Skin thickness"
          hint="Obechi veneer is usually 0.6 mm; balsa sheet 1, 1.5 or 2 mm."
          @update:model-value="set('foam.skin.thickness', $event)"
        />
        <div class="wc-structure-editor__pair">
          <UnitInput
            :id="id('fshw')"
            :model-value="fm.skin.sheetWidth"
            quantity="length"
            :system="system"
            label="Sheet width"
            :placeholder="lengthText(sheetSize.width)"
            @update:model-value="set('foam.skin.sheetWidth', $event)"
          />
          <UnitInput
            :id="id('fshl')"
            :model-value="fm.skin.sheetLength"
            quantity="length"
            :system="system"
            label="Sheet length"
            :placeholder="lengthText(sheetSize.length)"
            @update:model-value="set('foam.skin.sheetLength', $event)"
          />
        </div>
        <p class="wc-field__hint">The sheets the skins are cut from, for the cut list. Blank for the usual size of the material.</p>
        <ParamInput
          :id="id('fglue')"
          :model-value="Math.round((fm.glue ?? 0.1) * 1000)"
          label="Glue for the skins"
          suffix="g/m²"
          :min="0"
          :max="400"
          :step="10"
          hint="Epoxy bonding the skins to the core, per square metre of skin, for the weight. 100 g/m² is typical of a vacuum-bagged lay-up."
          @update:model-value="set('foam.glue', $event / 1000)"
        />
        <SegmentedField
          :model-value="st.ribs.rootJoint"
          label="Wing halves"
          :options="[
            { value: 'one-piece', label: 'One piece' },
            { value: 'two-piece', label: 'Two pieces' },
          ]"
          :hint="halvesHint"
          @update:model-value="set('ribs.rootJoint', $event)"
        />
      </InspectorSection>

      <InspectorSection title="Spar caps" fold-key="structure:foamcaps" :summary="summaries.caps">
        <UnitInput
          :id="id('fsparpos')"
          :model-value="st.spar.position"
          quantity="percent"
          :system="system"
          label="Position along the chord"
          :placeholder="autoSparText"
          hint="Kept at this fraction of the chord at every panel end, and straight between them. Blank puts it at the section's thickest point."
          @update:model-value="set('spar.position', $event)"
        />
        <div class="wc-structure-editor__pair">
          <UnitInput :id="id('fcapw')" :model-value="fm.caps.width" quantity="thin" :system="system" label="Cap width" @update:model-value="set('foam.caps.width', $event)" />
          <UnitInput :id="id('fcapt')" :model-value="fm.caps.thickness" quantity="thin" :system="system" label="Cap thickness" @update:model-value="set('foam.caps.thickness', $event)" />
        </div>
        <SelectField :id="id('fcapm')" :model-value="fm.caps.material" label="Cap material" :options="FOAM_CAPS" @update:model-value="set('foam.caps.material', $event)" />
        <p class="wc-field__hint">One under each skin, let into a slot in the core so it's flush with the core's surface.</p>
        <label class="wc-check wc-structure-editor__check">
          <input type="checkbox" :checked="fm.web.enabled" @change="set('foam.web.enabled', $event.target.checked)" />
          Shear web between the caps
        </label>
        <template v-if="fm.web.enabled">
          <UnitInput :id="id('fwebt')" :model-value="fm.web.thickness" quantity="thin" :system="system" label="Web thickness" @update:model-value="set('foam.web.thickness', $event)" />
          <SelectField :id="id('fwebm')" :model-value="fm.web.material" label="Web material" :options="SHEET" @update:model-value="set('foam.web.material', $event)" />
        </template>
        <p class="wc-field__hint">{{ webHint }}</p>
      </InspectorSection>

      <InspectorSection title="Finish" fold-key="structure:finish" :summary="summaries.finish">
        <SelectField
          :id="id('ffinish')"
          :model-value="st.covering.finish ?? 'film'"
          label="Covered with"
          :options="FINISH_OPTIONS"
          :hint="finishHint"
          @update:model-value="set('covering.finish', $event)"
        />
      </InspectorSection>
    </template>

    <InspectorSection title="Design loads" fold-key="structure:loads" :summary="summaries.loads">
      <ParamInput
        :id="id('g')"
        :model-value="st.loads.designG"
        label="Load factor"
        suffix="g"
        :min="2"
        :max="20"
        :step="0.5"
        hint="The most the wing should carry in a pull-up. Around 6 for sport flying, 10 or more for aerobatics or hard launches."
        @update:model-value="set('loads.designG', $event)"
      />
      <ParamInput
        :id="id('gneg')"
        :model-value="st.loads.negativeG"
        label="Negative load factor"
        suffix="g"
        :min="0"
        :max="20"
        :step="0.5"
        hint="Pushed or inverted flight. Half the positive figure is usual for sport models."
        @update:model-value="set('loads.negativeG', $event)"
      />
      <ParamInput
        :id="id('sf')"
        :model-value="st.loads.safetyFactor"
        label="Safety factor"
        suffix="×"
        :min="1"
        :max="3"
        :step="0.1"
        hint="Applied on top of the load factor. 1.5 is the aircraft standard."
        @update:model-value="set('loads.safetyFactor', $event)"
      />
    </InspectorSection>

    <InspectorSection v-if="!foam" title="Spar" fold-key="structure:spar" :summary="summaries.spar">
      <SegmentedField :model-value="st.spar.type" label="Type" :options="SPAR_TYPES" @update:model-value="set('spar.type', $event)" />
      <UnitInput
        :id="id('sparpos')"
        :model-value="st.spar.position"
        quantity="percent"
        :system="system"
        label="Position along the chord"
        :placeholder="autoSparText"
        hint="Kept at this fraction of the chord at every panel end, and straight between them. Blank puts it at the section's thickest point."
        @update:model-value="set('spar.position', $event)"
      />
      <template v-if="st.spar.type === 'caps' || st.spar.type === 'box'">
        <UnitInput :id="id('capw')" :model-value="st.spar.capWidth" quantity="thin" :system="system" label="Cap width" @update:model-value="set('spar.capWidth', $event)" />
        <UnitInput
          :id="id('capt')"
          :model-value="st.spar.capThickness"
          quantity="thin"
          :system="system"
          label="Cap thickness"
          @update:model-value="set('spar.capThickness', $event)"
        />
        <SelectField :id="id('capm')" :model-value="st.spar.capMaterial" label="Cap material" :options="CAPS" @update:model-value="set('spar.capMaterial', $event)" />
        <UnitInput
          :id="id('webt')"
          :model-value="st.spar.webThickness"
          quantity="thin"
          :system="system"
          label="Shear web thickness"
          :hint="
            st.spar.type === 'box'
              ? 'Two webs between the caps, flush with their front and rear faces, fitted between the ribs, grain vertical.'
              : 'One web between the caps, flush with their front face, fitted between the ribs, grain vertical.'
          "
          @update:model-value="set('spar.webThickness', $event)"
        />
        <SelectField :id="id('webm')" :model-value="st.spar.webMaterial" label="Web material" :options="SHEET" @update:model-value="set('spar.webMaterial', $event)" />
      </template>
      <template v-else-if="st.spar.type === 'tube'">
        <UnitInput :id="id('tubed')" :model-value="st.spar.tubeDiameter" quantity="thin" :system="system" label="Outside diameter" @update:model-value="set('spar.tubeDiameter', $event)" />
        <UnitInput :id="id('tubew')" :model-value="st.spar.tubeWall" quantity="thin" :system="system" label="Wall thickness" @update:model-value="set('spar.tubeWall', $event)" />
        <UnitInput
          :id="id('tubel')"
          :model-value="st.spar.tubeLength"
          quantity="length"
          :system="system"
          label="Length from the root rib"
          placeholder="to the tip"
          hint="A tube usually stops where the wing gets too thin for it; beyond that, ribs get no hole."
          @update:model-value="set('spar.tubeLength', $event)"
        />
        <SelectField :id="id('tubem')" :model-value="st.spar.tubeMaterial" label="Material" :options="TUBE" @update:model-value="set('spar.tubeMaterial', $event)" />
      </template>
      <template v-else>
        <UnitInput :id="id('solw')" :model-value="st.spar.solidWidth" quantity="thin" :system="system" label="Width" @update:model-value="set('spar.solidWidth', $event)" />
        <UnitInput :id="id('sold')" :model-value="st.spar.solidDepth" quantity="thin" :system="system" label="Depth" @update:model-value="set('spar.solidDepth', $event)" />
        <SelectField :id="id('solm')" :model-value="st.spar.solidMaterial" label="Material" :options="CAPS" @update:model-value="set('spar.solidMaterial', $event)" />
        <SegmentedField
          :model-value="st.spar.solidMount"
          label="Through the ribs"
          :options="[
            { value: 'through', label: 'Slot' },
            { value: 'top', label: 'Top notch' },
            { value: 'bottom', label: 'Bottom notch' },
          ]"
          @update:model-value="set('spar.solidMount', $event)"
        />
      </template>
    </InspectorSection>

    <InspectorSection v-if="!foam" title="Covering" fold-key="structure:covering" :summary="summaries.covering">
      <SegmentedField :model-value="st.covering.type" label="Structure" :options="COVERINGS" @update:model-value="set('covering.type', $event)" />
      <SelectField
        :id="id('finish')"
        :model-value="st.covering.finish ?? 'film'"
        label="Covered with"
        :options="FINISH_OPTIONS"
        :hint="finishHint"
        @update:model-value="set('covering.finish', $event)"
      />
      <template v-if="st.covering.type !== 'open'">
        <UnitInput
          :id="id('sheett')"
          :model-value="st.covering.sheetThickness"
          quantity="thin"
          :system="system"
          label="Sheeting thickness"
          @update:model-value="set('covering.sheetThickness', $event)"
        />
        <SelectField
          :id="id('sheetm')"
          :model-value="st.covering.sheetMaterial"
          label="Sheeting material"
          :options="SHEET"
          @update:model-value="set('covering.sheetMaterial', $event)"
        />
      </template>
      <template v-if="st.covering.type !== 'sheeted'">
        <label class="wc-check wc-structure-editor__check">
          <input type="checkbox" :checked="st.covering.capStrips" @change="set('covering.capStrips', $event.target.checked)" />
          Cap strips on the ribs{{ st.covering.type === 'dbox' ? ' behind the spar' : '' }}
        </label>
        <template v-if="st.covering.capStrips">
          <UnitInput
            :id="id('csw')"
            :model-value="st.covering.capStripWidth"
            quantity="thin"
            :system="system"
            label="Cap strip width"
            @update:model-value="set('covering.capStripWidth', $event)"
          />
          <UnitInput
            :id="id('cst')"
            :model-value="st.covering.capStripThickness"
            quantity="thin"
            :system="system"
            label="Cap strip thickness"
            @update:model-value="set('covering.capStripThickness', $event)"
          />
        </template>
      </template>
    </InspectorSection>

    <InspectorSection title="Leading and trailing edges" fold-key="structure:edges" :summary="summaries.edges">
      <SelectField :id="id('let')" :model-value="st.le.type ?? 'balsa'" label="Leading edge" :options="LE_TYPE_OPTIONS" @update:model-value="setLeType" />
      <template v-if="(st.le.type ?? 'balsa') === 'balsa'">
        <EdgeStockPicker
          :id="id('les')"
          :model-value="st.le.stock"
          label="Leading edge stock"
          :options="LE_OPTIONS"
          :items="LE_ITEMS"
          :hint="st.le.stock === 'custom' ? '' : `Standard balsa sections (SLEC sizes, 915 mm lengths), carved to the section once glued on. The ${foam ? 'core is' : 'ribs are'} cut back by its depth.`"
          @update:model-value="setStock('le', $event)"
        />
        <UnitInput
          v-if="st.le.stock === 'custom'"
          :id="id('lew')"
          :model-value="st.le.width"
          quantity="thin"
          :system="system"
          label="Leading edge stock, depth along the chord"
          :hint="`The ${foam ? 'core is' : 'ribs are'} cut back by this much; the stock is glued on and carved to shape.`"
          @update:model-value="set('le.width', $event)"
        />
        <UnitInput
          v-if="st.le.stock === 'custom'"
          :id="id('leh')"
          :model-value="st.le.height ?? st.le.width"
          quantity="thin"
          :system="system"
          label="Leading edge stock, height at the rib face"
          hint="Checked as the symmetrical profile at this depth and height."
          @update:model-value="set('le.height', $event)"
        />
        <SelectField :id="id('lem')" :model-value="st.le.material" label="Leading edge material" :options="WOOD" @update:model-value="set('le.material', $event)" />
      </template>
      <SelectField
        v-else-if="isRound(st.le)"
        :id="id('led')"
        :model-value="String(roundDiameter(st.le))"
        label="Diameter"
        :options="roundOptions"
        :hint="roundHint"
        @update:model-value="set('le.diameter', Number($event))"
      />
      <EdgeFit v-if="edges?.le.drawing" :drawing="edges.le.drawing" name="Leading edge" :round="!!edges.le.round" :system="system" />
      <p v-if="st.le.type === 'none'" class="wc-field__hint">
        The ribs run forward to the nose and the sheeting is bent round it, so there's no separate stock. Needs a D-box
        or fully sheeted wing.
      </p>
      <EdgeStockPicker
        :id="id('tes')"
        :model-value="st.te.stock"
        label="Trailing edge stock"
        :options="TE_OPTIONS"
        :items="TE_ITEMS"
        :hint="st.te.stock === 'custom' ? '' : 'Triangular balsa, thickness × width (SLEC sizes, 915 mm lengths).'"
        @update:model-value="setStock('te', $event)"
      />
      <template v-if="st.te.stock === 'custom'">
        <SegmentedField
          :model-value="st.te.type"
          label="Trailing edge section"
          :options="[
            { value: 'triangular', label: 'Triangular' },
            { value: 'flat', label: 'Flat strip' },
          ]"
          @update:model-value="set('te.type', $event)"
        />
        <UnitInput
          :id="id('tew')"
          :model-value="st.te.width"
          quantity="thin"
          :system="system"
          label="Trailing edge stock, depth along the chord"
          @update:model-value="set('te.width', $event)"
        />
      </template>
      <SelectField :id="id('tem')" :model-value="st.te.material" label="Trailing edge material" :options="WOOD" @update:model-value="set('te.material', $event)" />
      <EdgeFit v-if="edges?.te.drawing" :drawing="edges.te.drawing" name="Trailing edge" :system="system" />
    </InspectorSection>

    <InspectorSection v-if="!foam" title="Stringers and turbulator spars" fold-key="structure:stringers" :summary="summaries.stringers">
      <div v-for="(s, k) in st.stringers" :key="s.id" class="wc-structure-editor__item">
        <div class="wc-structure-editor__itemhead">
          <span>Stringer {{ k + 1 }}</span>
          <button type="button" class="wc-stations__remove" :aria-label="`Remove stringer ${k + 1}`" @click="removeFrom('stringers', s.id)"><svg viewBox="0 0 24 24" aria-hidden="true"><path v-for="(d, k) in TRASH" :key="k" :d="d" /></svg></button>
        </div>
        <UnitInput
          :id="id(`str${s.id}p`)"
          :model-value="s.position"
          quantity="percent"
          :system="system"
          label="Position along the chord"
          @update:model-value="updateIn('stringers', s.id, 'position', $event)"
        />
        <SegmentedField
          :model-value="s.surface"
          label="Surface"
          :options="[
            { value: 'upper', label: 'Top' },
            { value: 'lower', label: 'Bottom' },
            { value: 'both', label: 'Both' },
          ]"
          @update:model-value="updateIn('stringers', s.id, 'surface', $event)"
        />
        <div class="wc-structure-editor__pair">
          <UnitInput :id="id(`str${s.id}w`)" :model-value="s.width" quantity="thin" :system="system" label="Width" @update:model-value="updateIn('stringers', s.id, 'width', $event)" />
          <UnitInput :id="id(`str${s.id}h`)" :model-value="s.height" quantity="thin" :system="system" label="Height" @update:model-value="updateIn('stringers', s.id, 'height', $event)" />
        </div>
        <SelectField :id="id(`str${s.id}m`)" :model-value="s.material" label="Material" :options="CAPS" @update:model-value="updateIn('stringers', s.id, 'material', $event)" />
      </div>
      <p v-if="!st.stringers.length" class="wc-field__hint">
        None. A stringer on the top surface just behind the leading edge works as a turbulator spar, and stiffens D-box
        sheeting.
      </p>
      <button
        type="button"
        class="wc-button wc-button--small wc-structure-editor__add"
        @click="addTo('stringers', { position: 0.12, surface: 'upper', width: 0.003, height: 0.003, material: 'balsa-hard' })"
      >
        Add stringer
      </button>
    </InspectorSection>

    <InspectorSection v-if="!foam" title="Ribs" fold-key="structure:ribs" :summary="summaries.ribs">
      <UnitInput :id="id('ribt')" :model-value="st.ribs.thickness" quantity="thin" :system="system" label="Rib thickness" @update:model-value="set('ribs.thickness', $event)" />
      <SelectField :id="id('ribm')" :model-value="st.ribs.material" label="Rib material" :options="WOOD" @update:model-value="set('ribs.material', $event)" />
      <SegmentedField
        :model-value="st.ribs.orientation"
        label="Rib direction"
        :options="[
          { value: 'streamwise', label: 'Streamwise' },
          { value: 'perpendicular', label: 'Square to the spar' },
        ]"
        :hint="
          st.ribs.orientation === 'perpendicular'
            ? 'The root, panel-break and tip ribs stay streamwise so the panels and fuselage meet cleanly.'
            : ''
        "
        @update:model-value="set('ribs.orientation', $event)"
      />
      <SegmentedField
        :model-value="st.ribs.rootJoint"
        label="Wing halves"
        :options="[
          { value: 'one-piece', label: 'One piece' },
          { value: 'two-piece', label: 'Two pieces' },
        ]"
        :hint="
          st.ribs.rootJoint === 'two-piece'
            ? 'Each half starts with a root rib at the fuselage side and plugs in; the joiner itself isn\'t designed here.'
            : 'Continuous through the centreline, with a centre rib shared by both halves.'
        "
        @update:model-value="set('ribs.rootJoint', $event)"
      />
      <SegmentedField :model-value="st.ribs.spacing" label="Spacing" :options="SPACINGS" @update:model-value="setSpacing" />
      <UnitInput
        v-if="st.ribs.spacing === 'suggested' || st.ribs.spacing === 'uniform'"
        :id="id('pitch')"
        :model-value="st.ribs.pitch"
        quantity="length"
        :system="system"
        :label="st.ribs.spacing === 'suggested' ? 'Most the ribs may be apart' : 'Rib spacing'"
        :hint="
          st.ribs.spacing === 'suggested'
            ? 'For the covering: film sags between ribs much over 75 mm. Closer where the loads need it.'
            : 'Each panel gets the fewest equal bays no wider than this.'
        "
        @update:model-value="set('ribs.pitch', $event)"
      />
      <div v-else-if="st.ribs.spacing === 'tapered'" class="wc-structure-editor__pair">
        <UnitInput :id="id('rootp')" :model-value="st.ribs.rootPitch" quantity="length" :system="system" label="At the root" @update:model-value="set('ribs.rootPitch', $event)" />
        <UnitInput :id="id('tipp')" :model-value="st.ribs.tipPitch" quantity="length" :system="system" label="At the tip" @update:model-value="set('ribs.tipPitch', $event)" />
      </div>
      <template v-else-if="st.ribs.spacing === 'manual'">
        <p class="wc-field__hint">
          Distances from the root rib. The root, panel ends, tip and hard points always get a rib. You can also drag ribs
          in the plan, double-click it to add one, and press Delete to remove the selected one.
        </p>
        <div v-for="(m, k) in byDistance(st.ribs.manual)" :key="m.id" class="wc-structure-editor__row">
          <UnitInput
            :id="id(`man${m.id}`)"
            :model-value="m.d"
            quantity="length"
            :system="system"
            :label="`Rib ${k + 1}`"
            @update:model-value="updateIn('ribs.manual', m.id, 'd', $event)"
          />
          <button type="button" class="wc-stations__remove" :aria-label="`Remove rib ${k + 1}`" @click="removeFrom('ribs.manual', m.id)"><svg viewBox="0 0 24 24" aria-hidden="true"><path v-for="(d, k) in TRASH" :key="k" :d="d" /></svg></button>
        </div>
        <button type="button" class="wc-button wc-button--small wc-structure-editor__add" @click="addTo('ribs.manual', { d: null })">Add rib</button>
      </template>

      <div class="wc-structure-editor__sub">
        <span class="wc-field__label">Hard points</span>
        <p class="wc-field__hint">Ribs that must be at a set distance from the root rib: servo bays, aileron ends, undercarriage.</p>
        <div v-for="h in byDistance(st.ribs.hardPoints)" :key="h.id" class="wc-structure-editor__row">
          <UnitInput
            :id="id(`hp${h.id}d`)"
            :model-value="h.d"
            quantity="length"
            :system="system"
            label="Distance"
            @update:model-value="updateIn('ribs.hardPoints', h.id, 'd', $event)"
          />
          <div class="wc-field">
            <label :for="id(`hp${h.id}l`)" class="wc-field__label">What</label>
            <input
              :id="id(`hp${h.id}l`)"
              class="wc-input"
              type="text"
              :value="h.label"
              placeholder="e.g. Servo bay"
              @change="updateIn('ribs.hardPoints', h.id, 'label', $event.target.value)"
            />
          </div>
          <button type="button" class="wc-stations__remove" aria-label="Remove hard point" @click="removeFrom('ribs.hardPoints', h.id)"><svg viewBox="0 0 24 24" aria-hidden="true"><path v-for="(d, k) in TRASH" :key="k" :d="d" /></svg></button>
        </div>
        <button type="button" class="wc-button wc-button--small wc-structure-editor__add" @click="addTo('ribs.hardPoints', { d: null, label: '' })">
          Add hard point
        </button>
      </div>

      <label class="wc-check wc-structure-editor__check">
        <input type="checkbox" :checked="st.ribs.lightening" @change="set('ribs.lightening', $event.target.checked)" />
        Lightening holes (not in the root, break or tip ribs)
      </label>
      <UnitInput
        v-if="st.ribs.lightening"
        :id="id('lhm')"
        :model-value="st.ribs.lighteningMargin"
        quantity="thin"
        :system="system"
        label="Material left around each hole"
        @update:model-value="set('ribs.lighteningMargin', $event)"
      />
      <label class="wc-check wc-structure-editor__check">
        <input type="checkbox" :checked="st.ribs.jigTabs" @change="set('ribs.jigTabs', $event.target.checked)" />
        Jig tabs to build on a flat board
      </label>
      <template v-if="st.ribs.jigTabs">
        <p class="wc-field__hint">
          Every rib in a panel gets feet down to one flat line, so the washout builds itself in. Cut them off once the
          panel is together.
        </p>
        <div class="wc-structure-editor__pair">
          <UnitInput :id="id('tabw')" :model-value="st.ribs.tabWidth" quantity="thin" :system="system" label="Tab width" @update:model-value="set('ribs.tabWidth', $event)" />
          <UnitInput
            :id="id('tabc')"
            :model-value="st.ribs.tabClearance"
            quantity="thin"
            :system="system"
            label="Least height"
            @update:model-value="set('ribs.tabClearance', $event)"
          />
        </div>
      </template>
    </InspectorSection>

    <InspectorSection v-if="!foam" title="Corner gussets" fold-key="structure:gussets" :summary="summaries.gussets">
      <label class="wc-check wc-structure-editor__check">
        <input type="checkbox" :checked="st.gussets.le" @change="set('gussets.le', $event.target.checked)" /> Where ribs meet the leading edge
      </label>
      <label class="wc-check wc-structure-editor__check">
        <input type="checkbox" :checked="st.gussets.te" @change="set('gussets.te', $event.target.checked)" /> Where ribs meet the trailing edge
      </label>
      <template v-if="st.gussets.le || st.gussets.te">
        <SegmentedField
          :model-value="st.gussets.where"
          label="On"
          :options="[
            { value: 'ends', label: 'Root, breaks and tip' },
            { value: 'all', label: 'Every rib' },
          ]"
          @update:model-value="set('gussets.where', $event)"
        />
        <SegmentedField
          v-for="e in ['le', 'te'].filter((k) => st.gussets[k])"
          :key="e"
          :model-value="gussetLayer(st.gussets, e)"
          :label="`${e === 'le' ? 'At the leading edge' : 'At the trailing edge'}, flush with the rib's`"
          :options="layerOptions(e)"
          @update:model-value="set(e === 'le' ? 'gussets.layer' : 'gussets.teLayer', $event)"
        />
        <p class="wc-field__hint">
          Laid flat in the corner between the rib and the stock, under any sheeting, cap strip or covering. Top and
          bottom needs twice the gusset's thickness of depth there, which a thin trailing edge seldom has.
        </p>
        <SegmentedField
          :model-value="st.gussets.sides"
          label="Sides of each rib"
          :options="[
            { value: 'both', label: 'Both' },
            { value: 'one', label: 'Outboard only' },
          ]"
          @update:model-value="set('gussets.sides', $event)"
        />
        <div class="wc-structure-editor__pair">
          <UnitInput :id="id('gsz')" :model-value="st.gussets.size" quantity="thin" :system="system" label="Leg length" @update:model-value="set('gussets.size', $event)" />
          <UnitInput :id="id('gt')" :model-value="st.gussets.thickness" quantity="thin" :system="system" label="Thickness" @update:model-value="set('gussets.thickness', $event)" />
        </div>
        <SelectField :id="id('gm')" :model-value="st.gussets.material" label="Material" :options="SHEET" @update:model-value="set('gussets.material', $event)" />
      </template>
    </InspectorSection>

    <InspectorSection title="Control surface hinges" fold-key="structure:hinges" :summary="summaries.hinges">
      <p v-if="foam" class="wc-field__hint">
        For the ailerons and flaps set in the wing editor. The core is cut and skinned whole, then each surface is sawn off
        along its hinge line, and both cut faces are capped with a hinge spar: the surface's bevelled to a point at the
        centre line so it can swing through its throws. Mylar tabs are slotted into both at the centre line.
      </p>
      <p v-else class="wc-field__hint">
        For the ailerons and flaps set in the wing editor. A hinge spar each side of the hinge line: the fixed part's ribs
        stop at the front of one, and the surface's own ribs start at the back of the other, which is bevelled to a point
        at the centre line so the surface can swing through its throws. Mylar tabs are slotted into both at the centre
        line.
      </p>
      <div class="wc-structure-editor__pair">
        <UnitInput :id="id('hfw')" :model-value="st.hinges.fixedWidth" quantity="thin" :system="system" label="Fixed hinge spar" @update:model-value="set('hinges.fixedWidth', $event)" />
        <UnitInput :id="id('hmw')" :model-value="st.hinges.movingWidth" quantity="thin" :system="system" label="Surface hinge spar" @update:model-value="set('hinges.movingWidth', $event)" />
      </div>
      <p class="wc-field__hint">Widths across the hinge line; the depth follows the section.</p>
      <SelectField :id="id('hm')" :model-value="st.hinges.material" label="Hinge spar material" :options="WOOD" @update:model-value="set('hinges.material', $event)" />
      <div class="wc-structure-editor__pair">
        <UnitInput :id="id('htw')" :model-value="st.hinges.tabWidth" quantity="thin" :system="system" label="Tab width" @update:model-value="set('hinges.tabWidth', $event)" />
        <UnitInput :id="id('htl')" :model-value="st.hinges.tabLength" quantity="thin" :system="system" label="Tab length" @update:model-value="set('hinges.tabLength', $event)" />
      </div>
      <p class="wc-field__hint">Width along the hinge, length across it: half of it (less half the gap) goes into each spar.</p>
      <UnitInput :id="id('htt')" :model-value="st.hinges.tabThickness" quantity="thin" :system="system" label="Mylar thickness" @update:model-value="set('hinges.tabThickness', $event)" />
      <div class="wc-structure-editor__pair">
        <UnitInput :id="id('hts')" :model-value="st.hinges.tabSpacing" quantity="length" :system="system" label="Most apart" @update:model-value="set('hinges.tabSpacing', $event)" />
        <UnitInput :id="id('hti')" :model-value="st.hinges.tabInset" quantity="length" :system="system" label="In from the ends" @update:model-value="set('hinges.tabInset', $event)" />
      </div>
      <p class="wc-field__hint">Tabs are spaced evenly along each hinge, the end ones this far in from the surface's ends.</p>
    </InspectorSection>

    <InspectorSection title="Dihedral braces" fold-key="structure:braces" :summary="summaries.braces">
      <label class="wc-check wc-structure-editor__check">
        <input type="checkbox" :checked="st.braces.enabled" @change="set('braces.enabled', $event.target.checked)" />
        Brace plates on the spar at each dihedral break
      </label>
      <template v-if="st.braces.enabled">
        <p v-if="st.spar.type === 'tube'" class="wc-field__hint">A tube spar joins with a bent joiner or sleeve instead, so no plates are drawn.</p>
        <SelectField :id="id('bm')" :model-value="st.braces.material" label="Material" :options="PLY" @update:model-value="set('braces.material', $event)" />
        <UnitInput
          :id="id('bt')"
          :model-value="st.braces.thickness"
          quantity="thin"
          :system="system"
          label="Thickness"
          placeholder="auto"
          :hint="braceHint"
          @update:model-value="set('braces.thickness', $event)"
        />
        <UnitInput
          :id="id('bl')"
          :model-value="st.braces.length"
          quantity="length"
          :system="system"
          label="Length each side of the break"
          @update:model-value="set('braces.length', $event)"
        />
      </template>
    </InspectorSection>
  </div>
</template>
