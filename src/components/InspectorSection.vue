<script>
// Module level, shared by every section: one ref per parent element holding the foldKey of the
// group's open section, or null
import { ref as moduleRef } from 'vue'
const groups = new WeakMap()
function groupOf(parent) {
  let g = groups.get(parent)
  if (!g) {
    g = moduleRef(null)
    groups.set(parent, g)
  }
  return g
}
</script>

<script setup>
// A foldable section of an inspector column (after Screenvision's properties panel): click
// the heading to open or close it. Closed, it shows its key values on the heading line, so a
// column of closed sections still says what's set. Which sections are open is remembered in
// this browser (it's how you like to see things, not part of the project).
//
// Accordion: sections that share a parent element form a group, and only one is open at a
// time. Opening one closes the others in its group. Nested sections are their own group, since
// their parent is the outer section's body. Until anything in a group has been opened or closed
// in this browser, the group's first section (in document order) opens, whatever its open prop
// says. After that, the last one opened stays open on reload. Closing the last open section
// remembers the whole group as closed, so a reload doesn't reopen the first one. On a reload, if
// a remembered-open section comes after an open sibling in the document, it starts closed (first
// open in document order wins), and the closed state is written back so a reload matches what
// you saw.
import { onMounted, onUnmounted, ref, watch } from 'vue'

const props = defineProps({
  title: { type: String, required: true },
  foldKey: { type: String, required: true },
  summary: { type: String, default: '' },
  open: { type: Boolean, default: false }, // the default before anything is remembered
  // Opens the section whenever this becomes true (e.g. its panel was selected elsewhere)
  openWhen: { type: Boolean, default: false },
  // Warnings about this section's settings ({ id, message }): listed at the top of its body,
  // and counted on its heading so a closed section still shows it needs attention
  warnings: { type: Array, default: () => [] },
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
function writeFold(open, keys = [props.foldKey]) {
  try {
    const folds = readFolds()
    for (const k of keys) folds[k] = open
    globalThis.localStorage?.setItem(KEY, JSON.stringify(folds))
  } catch {
    // not remembered; fine
  }
}

// The fold sections directly inside a parent, in document order
function foldsIn(parent) {
  return [...parent.children].filter((el) => el.classList.contains('wc-fold') && el.dataset.foldKey)
}
// Nothing in this group is remembered yet, and this section is its first
function isFirstDefault(parent) {
  const folds = readFolds()
  const sections = foldsIn(parent)
  return sections[0] === root.value && sections.every((el) => typeof folds[el.dataset.foldKey] !== 'boolean')
}

const root = ref(null)
let group = null
let stopGroupWatch = null

// Until you've opened or closed it yourself, a section that's asked to be open (its panel
// selected) starts open
const isOpen = ref(readFolds()[props.foldKey] ?? (props.open || props.openWhen))

function claim() {
  if (group) group.value = props.foldKey
}
function release() {
  if (group && group.value === props.foldKey) group.value = null
}
// A sibling claimed the group: close this one if it's open. Not emitted as a toggle (like the
// open-when path, it's the accordion, not the user). The native toggle event that follows is
// ignored by toggled(), since e.target.open then matches isOpen.
function closeIfNotMine(key) {
  if (key != null && key !== props.foldKey && isOpen.value) {
    isOpen.value = false
    writeFold(false)
  }
}

watch(
  () => props.openWhen,
  (v) => {
    if (v) {
      isOpen.value = true
      claim()
    }
  },
)

onMounted(() => {
  const parent = root.value?.parentElement
  if (!parent) return
  group = groupOf(parent)
  if (isFirstDefault(parent)) {
    // nothing remembered for this group yet: its first section opens, and is remembered as such
    isOpen.value = true
    writeFold(true)
  }
  if (isOpen.value) {
    if (group.value == null) {
      group.value = props.foldKey
    } else if (group.value !== props.foldKey) {
      // an earlier sibling in document order is already open
      isOpen.value = false
      writeFold(false)
    }
  }
  stopGroupWatch = watch(group, closeIfNotMine)
})

onUnmounted(() => {
  stopGroupWatch?.()
  release()
})

function toggled(e) {
  if (e.target.open === isOpen.value) return
  isOpen.value = e.target.open
  if (isOpen.value) {
    claim()
    writeFold(true)
  } else {
    release()
    // The group is now all closed: remember every section in it, so a reload doesn't reopen the first
    const parent = root.value?.parentElement
    const keys = group?.value == null && parent ? foldsIn(parent).map((el) => el.dataset.foldKey) : [props.foldKey]
    writeFold(false, keys)
  }
  emit('toggle', isOpen.value)
}
</script>

<template>
  <details ref="root" class="wc-fold" :data-fold-key="foldKey" :open="isOpen" @toggle="toggled">
    <summary class="wc-fold__head">
      <span class="wc-fold__title">{{ title }}</span>
      <span v-if="!isOpen && summary" class="wc-fold__sum">{{ summary }}</span>
      <span v-if="warnings.length" class="wc-fold__warn" :title="`${warnings.length} warning${warnings.length > 1 ? 's' : ''}`">
        {{ warnings.length }}
      </span>
    </summary>
    <div class="wc-fold__body">
      <ul v-if="warnings.length" class="wc-warnings wc-fold__warnings">
        <li v-for="w in warnings" :key="w.id">{{ w.message }}</li>
      </ul>
      <slot />
    </div>
  </details>
</template>
