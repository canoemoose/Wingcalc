<script setup>
// Full-window editor (the wing editor, the structure editor): a results strip across the
// top, fields on the left (the same side as the inputs column on the page) and the drawing
// filling the rest. Rendered next
// to the calculator rather than inside it, so fixed positioning doesn't depend on how a
// browser treats it inside a container-query element, and it works in the shadow-DOM embed.
import { ref, watch, nextTick, onBeforeUnmount } from 'vue'

const open = defineModel('open', { type: Boolean, default: false })
defineProps({
  theme: { type: String, default: 'auto' },
  title: { type: String, default: 'Wing editor' },
})

const dialogEl = ref(null)
let opener = null
let savedOverflow = ''

function lock(on) {
  const body = document.body
  if (on) {
    savedOverflow = body.style.overflow
    body.style.overflow = 'hidden'
  } else body.style.overflow = savedOverflow
}

watch(open, async (isOpen) => {
  if (isOpen) {
    opener = document.activeElement
    lock(true)
    await nextTick()
    dialogEl.value?.focus({ preventScroll: true })
  } else {
    lock(false)
    opener?.focus?.({ preventScroll: true })
  }
})

onBeforeUnmount(() => {
  if (open.value) lock(false)
})

// Esc closes, unless something inside (the plan editor cancelling a measurement, say)
// already handled it.
function onKey(e) {
  if (e.key === 'Escape' && !e.defaultPrevented) {
    e.preventDefault()
    open.value = false
  }
}
</script>

<template>
  <div
    v-if="open"
    ref="dialogEl"
    class="wingcalc wc-workspace"
    :data-theme="theme"
    role="dialog"
    aria-modal="true"
    :aria-label="title"
    tabindex="-1"
    @keydown="onKey"
  >
    <header class="wc-workspace__bar">
      <h2 class="wc-workspace__title">{{ title }}</h2>
      <div class="wc-workspace__stats">
        <slot name="stats" />
      </div>
      <button type="button" class="wc-button wc-button--primary" @click="open = false">Done</button>
    </header>
    <div class="wc-workspace__body">
      <aside class="wc-workspace__side" aria-label="Wing and panel settings">
        <slot name="side" />
      </aside>
      <main class="wc-workspace__main">
        <slot name="main" />
      </main>
    </div>
  </div>
</template>
