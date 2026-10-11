<script setup>
// Project controls: name, save, open (with delete), new, and export/import as a file.
// Storage itself lives in WingCalc; this only presents it.
import { ref } from 'vue'

const name = defineModel('name', { type: String, default: '' })
const props = defineProps({
  projects: { type: Array, default: () => [] }, // [{ id, name, savedAt }]
  currentId: { type: String, default: null },
  dirty: { type: Boolean, default: false },
  storageOk: { type: Boolean, default: true },
  status: { type: String, default: '' },
})
const emit = defineEmits(['save', 'save-copy', 'open', 'delete', 'new', 'export', 'import'])

const openMenu = ref(null)
const fileInput = ref(null)

const when = (iso) => {
  if (!iso) return ''
  const d = new Date(iso)
  return d.toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
}

function choose(id) {
  openMenu.value?.removeAttribute('open')
  emit('open', id)
}

function onFile(e) {
  const file = e.target.files?.[0]
  e.target.value = ''
  if (!file) return
  file.text().then((text) => emit('import', text))
}
</script>

<template>
  <div class="wc-project" role="group" aria-label="Project">
    <div class="wc-project__namebox">
      <label for="wc-project-name" class="wc-sr-only">Project name</label>
      <input
        id="wc-project-name"
        v-model="name"
        class="wc-input wc-project__name"
        type="text"
        placeholder="Untitled project"
        autocomplete="off"
      />
      <span v-if="dirty" class="wc-project__dirty" title="Unsaved changes" />
      <span v-if="dirty" class="wc-sr-only">Unsaved changes</span>
    </div>
    <button type="button" class="wc-button wc-button--primary" :disabled="!storageOk" @click="emit('save')">Save</button>
    <button type="button" class="wc-button" @click="emit('new')">New</button>
    <details ref="openMenu" class="wc-project__menu">
      <summary class="wc-button">Open</summary>
      <div class="wc-project__popover">
        <p v-if="!storageOk" class="wc-muted">This browser isn't allowing local storage, so projects can't be saved here. Use Export instead.</p>
        <p v-else-if="!projects.length" class="wc-muted">No saved projects yet.</p>
        <ul v-else class="wc-project__list">
          <li v-for="p in projects" :key="p.id" :class="{ 'wc-project__item--current': p.id === currentId }">
            <button type="button" class="wc-project__open" @click="choose(p.id)">
              <strong>{{ p.name }}</strong>
              <span class="wc-muted">{{ when(p.savedAt) }}</span>
            </button>
            <button type="button" class="wc-project__delete" :aria-label="`Delete ${p.name}`" title="Delete" @click="emit('delete', p.id)">
              ×
            </button>
          </li>
        </ul>
        <div class="wc-project__more">
          <button type="button" class="wc-button wc-button--small" :disabled="!storageOk" @click="emit('save-copy')">
            Save as copy
          </button>
          <button type="button" class="wc-button wc-button--small" @click="emit('export')">Export file</button>
          <button type="button" class="wc-button wc-button--small" @click="fileInput?.click()">Import file</button>
          <input ref="fileInput" type="file" accept=".json,application/json" class="wc-sr-only" tabindex="-1" @change="onFile" />
        </div>
      </div>
    </details>
    <span class="wc-project__status" aria-live="polite">{{ status }}</span>
  </div>
</template>
