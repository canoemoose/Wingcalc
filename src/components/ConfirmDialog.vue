<script setup>
// An in-app confirmation, in place of the browser's own confirm(): a question, what it'll do,
// and two buttons. Esc or a click outside cancels. A destructive action gets a red button and
// focus starts on Cancel, so Enter can't do harm by accident.
import { ref, watch, nextTick, useId } from 'vue'

const props = defineProps({
  // { title, message, confirm (the button's label), danger } or null when closed
  request: { type: Object, default: null },
})
const emit = defineEmits(['answer'])

const id = useId()
const cancelEl = ref(null)
const confirmEl = ref(null)
let opener = null

watch(
  () => props.request,
  (r, old) => {
    if (r && !old) opener = document.activeElement
    if (r) nextTick(() => (r.danger ? cancelEl : confirmEl).value?.focus())
    else opener?.focus?.()
  },
)

// Keep Tab between the two buttons while it's open
function onKey(e) {
  if (e.key === 'Escape') {
    e.preventDefault()
    e.stopPropagation()
    emit('answer', false)
  } else if (e.key === 'Tab') {
    e.preventDefault()
    ;(document.activeElement === cancelEl.value ? confirmEl : cancelEl).value?.focus()
  }
}
</script>

<template>
  <div v-if="request" class="wc-confirm__backdrop" @pointerdown.self="emit('answer', false)">
    <div
      class="wc-confirm"
      role="alertdialog"
      aria-modal="true"
      :aria-labelledby="`${id}-title`"
      :aria-describedby="request.message ? `${id}-msg` : undefined"
      @keydown="onKey"
    >
      <h3 :id="`${id}-title`" class="wc-confirm__title">{{ request.title }}</h3>
      <p v-if="request.message" :id="`${id}-msg`" class="wc-confirm__message">{{ request.message }}</p>
      <div class="wc-confirm__actions">
        <button ref="cancelEl" type="button" class="wc-button" @click="emit('answer', false)">Cancel</button>
        <button
          ref="confirmEl"
          type="button"
          class="wc-button"
          :class="request.danger ? 'wc-button--danger' : 'wc-button--primary'"
          @click="emit('answer', true)"
        >
          {{ request.confirm }}
        </button>
      </div>
    </div>
  </div>
</template>
