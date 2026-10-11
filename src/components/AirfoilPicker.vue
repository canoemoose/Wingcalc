<script setup>
// Aerofoil selection: browse the NACA, Eppler and other families (polar-backed sections
// first, then the rest of the UIUC catalogue), or define a custom section by parameters.
import { computed, ref, watch, nextTick } from 'vue'
import { FAMILIES, catalogueFor, entryCoords, findSection, findUiuc } from '../lib/airfoils.js'
import ParamInput from './ParamInput.vue'
import AirfoilThumb from './AirfoilThumb.vue'

const model = defineModel({ type: Object, required: true })
const props = defineProps({
  uiuc: { type: Object, default: null }, // the loaded UIUC catalogue, or null while loading
})

const PAGE = 120

const query = ref('')
const polarOnly = ref(false)
const thickness = ref('any')
const camber = ref('any')
const sortBy = ref('default')
const limit = ref(PAGE)
const active = ref(-1)
const listEl = ref(null)

const THICKNESS = {
  any: () => true,
  thin: (t) => t < 9,
  mid: (t) => t >= 9 && t <= 13,
  thick: (t) => t > 13,
}
const CAMBER = {
  any: () => true,
  sym: (c) => c < 0.5,
  low: (c) => c >= 0.5 && c <= 3,
  high: (c) => c > 3,
}

const all = computed(() => (model.value.source === 'custom' ? [] : catalogueFor(model.value.source, props.uiuc)))

const filtered = computed(() => {
  const q = query.value.trim().toLowerCase()
  const words = q.split(/\s+/).filter(Boolean)
  let list = all.value.filter((e) => {
    if (polarOnly.value && !e.hasPolar) return false
    if (!THICKNESS[thickness.value](e.thicknessPct)) return false
    if (!CAMBER[camber.value](e.camberPct)) return false
    if (!words.length) return true
    const hay = `${e.name} ${e.key} ${e.description ?? ''}`.toLowerCase().replace(/\s+/g, ' ')
    const compact = hay.replace(/[\s-]/g, '')
    return words.every((w) => hay.includes(w) || compact.includes(w.replace(/[\s-]/g, '')))
  })
  const cmp = {
    name: (a, b) => a.name.localeCompare(b.name, 'en', { numeric: true }),
    thickness: (a, b) => a.thicknessPct - b.thicknessPct,
    camber: (a, b) => a.camberPct - b.camberPct,
  }[sortBy.value]
  if (cmp) list = [...list].sort(cmp)
  return list
})

const shown = computed(() => filtered.value.slice(0, limit.value))

watch([query, polarOnly, thickness, camber, sortBy, () => model.value.source], () => {
  limit.value = PAGE
  active.value = -1
})

function setSource(source) {
  if (source === model.value.source) return
  const next = { ...model.value, source }
  if (source !== 'custom') {
    const list = catalogueFor(source, props.uiuc)
    if (!list.some((e) => e.key === next.id)) next.id = list[0]?.key ?? null
    next.lastLibraryId = next.id
  }
  model.value = next
}

function select(entry) {
  model.value = { ...model.value, id: entry.key, lastLibraryId: entry.key }
}

function onKey(e) {
  const n = shown.value.length
  if (!n) return
  if (e.key === 'ArrowDown') active.value = Math.min(n - 1, active.value + 1)
  else if (e.key === 'ArrowUp') active.value = Math.max(0, active.value - 1)
  else if (e.key === 'Enter' && active.value >= 0) select(shown.value[active.value])
  else return
  e.preventDefault()
  nextTick(() => listEl.value?.querySelector(`[data-index="${active.value}"]`)?.scrollIntoView({ block: 'nearest' }))
}

const selected = computed(() => all.value.find((e) => e.key === model.value.id) ?? null)

function setCustom(key, value) {
  model.value = { ...model.value, custom: { ...model.value.custom, [key]: value } }
}

// Seed the custom parameters from the last library section viewed.
const lastLibrary = computed(() => {
  const id = model.value.lastLibraryId
  const lib = findSection(id)
  return lib ?? findUiuc(props.uiuc, id) ?? null
})

function copyFromLibrary() {
  const s = lastLibrary.value
  if (!s) return
  const r1 = (v) => Math.round(v * 10) / 10
  model.value = {
    ...model.value,
    custom: {
      thicknessPct: Math.min(25, Math.max(4, r1(s.thicknessPct))),
      thicknessPosPct: Math.round(Math.min(60, Math.max(20, s.thicknessPosPct))),
      camberPct: Math.min(9, Math.max(0, r1(s.camberPct))),
      camberPosPct: Math.round(Math.min(70, Math.max(10, s.camberPosPct || 40))),
      leRadiusPct: Math.min(6, Math.max(0.1, Math.round((s.leRadiusPct ?? 1.5) * 100) / 100)),
    },
  }
}

const families = Object.entries(FAMILIES)
const total = computed(() => all.value.length.toLocaleString('en-GB'))
</script>

<template>
  <div class="wc-airfoil">
    <div class="wc-tabs" role="tablist" aria-label="Aerofoil family">
      <button
        v-for="[key, f] in families"
        :key="key"
        type="button"
        role="tab"
        class="wc-tab"
        :aria-selected="model.source === key"
        :class="{ 'wc-tab--active': model.source === key }"
        @click="setSource(key)"
      >
        {{ f.label }}
      </button>
    </div>

    <template v-if="model.source !== 'custom'">
      <div v-if="selected" class="wc-picked">
        <AirfoilThumb :coords="entryCoords(selected)" />
        <div class="wc-picked__text">
          <strong>{{ selected.name }}</strong>
          <span class="wc-muted">{{ selected.description }}</span>
          <span class="wc-picked__chips">
            <span class="wc-chip">{{ selected.thicknessPct.toFixed(1) }}% thick</span>
            <span class="wc-chip">{{ selected.camberPct.toFixed(1) }}% camber</span>
            <span v-if="selected.hasPolar" class="wc-chip wc-chip--polar">XFOIL polars</span>
            <span v-else class="wc-chip">Coordinates only</span>
          </span>
        </div>
      </div>
      <div class="wc-browse">
        <input
          v-model="query"
          class="wc-input wc-browse__search"
          type="search"
          :placeholder="`Search ${total} sections`"
          aria-label="Search sections"
          role="combobox"
          aria-controls="wc-airfoil-list"
          :aria-expanded="true"
          :aria-activedescendant="active >= 0 ? `wc-af-${active}` : undefined"
          @keydown="onKey"
        />
        <div class="wc-browse__filters">
          <label class="wc-check"><input v-model="polarOnly" type="checkbox" /> With polars</label>
          <select v-model="thickness" class="wc-select wc-select--small" aria-label="Thickness">
            <option value="any">Any thickness</option>
            <option value="thin">Thin (under 9%)</option>
            <option value="mid">9% to 13%</option>
            <option value="thick">Thick (over 13%)</option>
          </select>
          <select v-model="camber" class="wc-select wc-select--small" aria-label="Camber">
            <option value="any">Any camber</option>
            <option value="sym">Symmetrical</option>
            <option value="low">0.5% to 3%</option>
            <option value="high">Over 3%</option>
          </select>
          <select v-model="sortBy" class="wc-select wc-select--small" aria-label="Sort">
            <option value="default">Polars first</option>
            <option value="name">Name</option>
            <option value="thickness">Thickness</option>
            <option value="camber">Camber</option>
          </select>
        </div>
        <p class="wc-browse__count">
          {{ filtered.length.toLocaleString('en-GB') }} of {{ total }}
          <span v-if="!uiuc" class="wc-muted"> · loading full catalogue…</span>
        </p>
        <ul id="wc-airfoil-list" ref="listEl" class="wc-browse__list" role="listbox" aria-label="Sections">
          <li
            v-for="(e, i) in shown"
            :id="`wc-af-${i}`"
            :key="e.key"
            :data-index="i"
            role="option"
            :aria-selected="e.key === model.id"
            class="wc-af"
            :class="{ 'wc-af--selected': e.key === model.id, 'wc-af--active': i === active }"
            @click="select(e)"
          >
            <AirfoilThumb :coords="entryCoords(e)" />
            <span class="wc-af__name">{{ e.name }}</span>
            <span class="wc-af__meta">{{ e.thicknessPct.toFixed(1) }}% · {{ e.camberPct.toFixed(1) }}%</span>
            <span v-if="e.hasPolar" class="wc-chip wc-chip--polar" title="XFOIL polar data">polars</span>
            <span class="wc-af__desc">{{ e.description }}</span>
          </li>
        </ul>
        <button v-if="filtered.length > shown.length" type="button" class="wc-button wc-browse__more" @click="limit += PAGE">
          Show {{ Math.min(PAGE, filtered.length - shown.length) }} more
        </button>
        <p v-if="!filtered.length" class="wc-muted">No sections match.</p>
      </div>
    </template>

    <div v-else class="wc-custom">
      <ParamInput
        id="wc-thickness"
        :model-value="model.custom.thicknessPct"
        label="Thickness"
        suffix="% chord"
        :min="4"
        :max="25"
        :step="0.1"
        @update:model-value="setCustom('thicknessPct', $event)"
      />
      <ParamInput
        id="wc-thickness-pos"
        :model-value="model.custom.thicknessPosPct"
        label="Max thickness position"
        suffix="% chord"
        :min="20"
        :max="60"
        :step="1"
        @update:model-value="setCustom('thicknessPosPct', $event)"
      />
      <ParamInput
        id="wc-camber"
        :model-value="model.custom.camberPct"
        label="Camber"
        suffix="% chord"
        :min="0"
        :max="9"
        :step="0.1"
        @update:model-value="setCustom('camberPct', $event)"
      />
      <ParamInput
        id="wc-camber-pos"
        :model-value="model.custom.camberPosPct"
        label="Max camber position"
        suffix="% chord"
        :min="10"
        :max="70"
        :step="1"
        @update:model-value="setCustom('camberPosPct', $event)"
      />
      <ParamInput
        id="wc-le-radius"
        :model-value="model.custom.leRadiusPct"
        label="Leading-edge radius"
        suffix="% chord"
        :min="0.1"
        :max="6"
        :step="0.01"
        :hint="`A NACA section of this thickness has ${((1.1019 * model.custom.thicknessPct * model.custom.thicknessPct) / 100).toFixed(2)}%.`"
        @update:model-value="setCustom('leRadiusPct', $event)"
      />
      <button v-if="lastLibrary" type="button" class="wc-button" @click="copyFromLibrary">
        Copy values from {{ lastLibrary.name }}
      </button>
    </div>
  </div>
</template>
