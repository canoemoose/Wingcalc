<script setup>
// Aerofoil selection: NACA or Eppler library, or a custom section defined by parameters.
import { computed } from 'vue'
import { FAMILIES, sectionsIn, findSection, sectionClMaxAt } from '../lib/airfoils.js'
import ParamInput from './ParamInput.vue'

const model = defineModel({ type: Object, required: true })

const options = computed(() => (model.value.source === 'custom' ? [] : sectionsIn(model.value.source)))

function setSource(source) {
  if (source === model.value.source) return
  const next = { ...model.value, source }
  if (source !== 'custom') {
    const list = sectionsIn(source)
    if (!list.some((s) => s.id === next.id)) next.id = list[0]?.id ?? null
    next.lastLibraryId = next.id
  }
  model.value = next
}

function setId(id) {
  model.value = { ...model.value, id, lastLibraryId: id }
}

function setCustom(key, value) {
  model.value = { ...model.value, custom: { ...model.value.custom, [key]: value } }
}

const lastLibrary = computed(() => findSection(model.value.lastLibraryId))

// Seed the custom parameters from the last library section viewed.
function copyFromLibrary() {
  const s = lastLibrary.value
  if (!s) return
  const r1 = (v) => Math.round(v * 10) / 10
  model.value = {
    ...model.value,
    custom: {
      clMax: Math.round(sectionClMaxAt(s, 200000) * 100) / 100,
      thicknessPct: r1(s.thicknessPct),
      thicknessPosPct: Math.round(Math.min(60, Math.max(20, s.thicknessPosPct))),
      camberPct: r1(s.camberPct),
      camberPosPct: Math.round(Math.min(70, Math.max(10, s.camberPosPct || 40))),
      leRadiusPct: Math.round(s.leRadiusPct * 100) / 100,
    },
  }
}

const families = Object.entries(FAMILIES)
</script>

<template>
  <div class="wc-airfoil">
    <div class="wc-tabs" role="tablist" aria-label="Aerofoil source">
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

    <div v-if="model.source !== 'custom'" class="wc-field">
      <label for="wc-airfoil-select" class="wc-field__label">Section</label>
      <select id="wc-airfoil-select" class="wc-select" :value="model.id" @change="setId($event.target.value)">
        <option v-for="s in options" :key="s.id" :value="s.id">
          {{ s.name }} ({{ s.thicknessPct }}% thick, {{ s.camberPct }}% camber)
        </option>
      </select>
      <p v-if="!options.length" class="wc-field__hint wc-text-warn">
        No sections bundled for this family. Run <code>npm run fetch-airfoils</code>.
      </p>
    </div>

    <div v-else class="wc-custom">
      <ParamInput
        id="wc-clmax"
        :model-value="model.custom.clMax"
        label="Max lift coefficient (section Clmax)"
        :min="0.6"
        :max="2.2"
        :step="0.01"
        hint="Typically 1.0 to 1.2 for symmetrical sections, 1.2 to 1.6 for cambered RC sections at model Reynolds numbers."
        @update:model-value="setCustom('clMax', $event)"
      />
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
        :hint="`A NACA section of this thickness has ${(1.1019 * model.custom.thicknessPct * model.custom.thicknessPct / 100).toFixed(2)}%.`"
        @update:model-value="setCustom('leRadiusPct', $event)"
      />
      <button v-if="lastLibrary" type="button" class="wc-button" @click="copyFromLibrary">
        Copy values from {{ lastLibrary.name }}
      </button>
    </div>
  </div>
</template>
