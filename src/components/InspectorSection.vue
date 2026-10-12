<script setup>
// A foldable section of an inspector column (after Screenvision's properties panel): click
// the heading to open or close it. Closed, it shows its key values on the heading line, so a
// column of closed sections still says what's set. Which sections are open is remembered in
// this browser (it's how you like to see things, not part of the project).
import { ref, watch } from 'vue'

const props = defineProps({
  title: { type: String, required: true },
  foldKey: { type: String, required: true },
  summary: { type: String, default: '' },
  open: { type: Boolean, default: false }, // the default before anything is remembered
  // Opens the section whenever this becomes true (e.g. its panel was selected elsewhere)
  openWhen: { type: Boolean, default: false },
})
const emit = defineEmits(['toggle'])

const KEY = 'wingcalc.folds'
function readFolds() {
  try {
    const v = JSON.parse(globalThis.localStorage?.getItem(KEY) ?? '{}')
    return v && typeof v === 'object' ? v : {}
  } catch {
    return {}
  }
}
// Until you've opened or closed it yourself, a section that's asked to be open (its panel
// selected) starts open
const isOpen = ref(readFolds()[props.foldKey] ?? (props.open || props.openWhen))
watch(
  () => props.openWhen,
  (v) => {
    if (v) isOpen.value = true
  },
)
function toggled(e) {
  if (e.target.open === isOpen.value) return
  isOpen.value = e.target.open
  emit('toggle', isOpen.value)
  try {
    const folds = readFolds()
    folds[props.foldKey] = isOpen.value
    globalThis.localStorage?.setItem(KEY, JSON.stringify(folds))
  } catch {
    // not remembered; fine
  }
}
</script>

<template>
  <details class="wc-fold" :open="isOpen" @toggle="toggled">
    <summary class="wc-fold__head">
      <span class="wc-fold__title">{{ title }}</span>
      <span v-if="!isOpen && summary" class="wc-fold__sum">{{ summary }}</span>
    </summary>
    <div class="wc-fold__body"><slot /></div>
  </details>
</template>
