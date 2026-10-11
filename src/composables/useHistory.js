// Undo/redo for a piece of reactive state. Changes are recorded after they settle (a short
// debounce), so a burst of typing becomes one step; callers can also commit explicitly,
// e.g. at the end of each drag.
import { ref, watch, computed } from 'vue'

const clone = (v) => JSON.parse(JSON.stringify(v))

export function useHistory(read, write, { delay = 400, limit = 100 } = {}) {
  const stack = ref([clone(read())])
  const index = ref(0)
  let timer = null
  let applying = false

  function record(now = JSON.stringify(read())) {
    clearTimeout(timer)
    if (now === JSON.stringify(stack.value[index.value])) return
    const next = stack.value.slice(0, index.value + 1)
    next.push(JSON.parse(now))
    if (next.length > limit) next.shift()
    stack.value = next
    index.value = next.length - 1
  }

  watch(
    () => JSON.stringify(read()),
    (now) => {
      if (applying) return
      clearTimeout(timer)
      timer = setTimeout(() => record(now), delay)
    },
  )

  function go(i) {
    clearTimeout(timer)
    applying = true
    index.value = i
    write(clone(stack.value[i]))
    // Let the watcher see the restored state before recording resumes.
    queueMicrotask(() => {
      applying = false
    })
  }

  return {
    // Record the current state now (e.g. at the end of a drag) rather than after the pause.
    commit: () => record(),
    // Start afresh from the current state (e.g. after opening a project).
    reset: () => {
      clearTimeout(timer)
      stack.value = [clone(read())]
      index.value = 0
    },
    canUndo: computed(() => index.value > 0),
    canRedo: computed(() => index.value < stack.value.length - 1),
    undo: () => index.value > 0 && go(index.value - 1),
    redo: () => index.value < stack.value.length - 1 && go(index.value + 1),
  }
}
