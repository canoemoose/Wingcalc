<script setup>
// Project controls: a File menu (new, open with delete, save as copy, export and import as a
// file), then the name and Save. Storage itself lives in WingCalc; this only presents it.
import { ref } from 'vue'
import { useMenuDismiss } from '../composables/useMenuDismiss.js'

const name = defineModel('name', { type: String, default: '' })
defineProps({
  projects: { type: Array, default: () => [] }, // [{ id, name, savedAt }]
  currentId: { type: String, default: null },
  dirty: { type: Boolean, default: false },
  storageOk: { type: Boolean, default: true },
  status: { type: String, default: '' },
})
const emit = defineEmits(['save', 'save-copy', 'open', 'delete', 'new', 'export', 'import'])

const menu = ref(null)
const fileInput = ref(null)

const when = (iso) => {
  if (!iso) return ''
  const d = new Date(iso)
  return d.toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
}

const { close } = useMenuDismiss(menu)
function act(event, arg) {
  close()
  emit(event, arg)
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
    <details ref="menu" class="wc-project__menu">
      <summary class="wc-button">File <span class="wc-project__caret" aria-hidden="true">▾</span></summary>
      <div class="wc-project__popover">
        <div class="wc-project__actions">
          <button type="button" class="wc-project__item" @click="act('new')">New project</button>
          <button type="button" class="wc-project__item" :disabled="!storageOk" @click="act('save-copy')">Save as copy</button>
        </div>
        <h4 class="wc-project__head">Open</h4>
        <p v-if="!storageOk" class="wc-muted wc-project__note">
          This browser isn't allowing local storage, so projects can't be saved here. Use Export to file instead.
        </p>
        <p v-else-if="!projects.length" class="wc-muted wc-project__note">No saved projects yet.</p>
        <ul v-else class="wc-project__list">
          <li v-for="p in projects" :key="p.id" :class="{ 'wc-project__item--current': p.id === currentId }">
            <button type="button" class="wc-project__open" @click="act('open', p.id)">
              <strong>{{ p.name }}</strong>
              <span class="wc-muted">{{ when(p.savedAt) }}</span>
            </button>
            <button type="button" class="wc-project__delete" :aria-label="`Delete ${p.name}`" title="Delete" @click="emit('delete', p.id)">
              ×
            </button>
          </li>
        </ul>
        <div class="wc-project__actions wc-project__actions--foot">
          <button type="button" class="wc-project__item" @click="act('export')">Export to file</button>
          <button type="button" class="wc-project__item" @click="close(), fileInput?.click()">Import from file</button>
        </div>
        <input ref="fileInput" type="file" accept=".json,application/json" class="wc-sr-only" tabindex="-1" @change="onFile" />
      </div>
    </details>
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
    <span class="wc-project__status" aria-live="polite">{{ status }}</span>
  </div>
</template>
