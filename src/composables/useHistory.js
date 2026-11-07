// Undo/redo for a piece of reactive state. Changes are recorded after they settle (a short
// debounce), so a burst of typing becomes one step; callers can also commit explicitly,
// e.g. at the end of each drag. While held (pause/resume, e.g. during a drag) nothing is
// recorded, and resume records the whole hold as one step.
import { ref, watch, computed } from 'vue'

const clone = (v) => JSON.parse(JSON.stringify(v))

export function useHistory(read, write, { delay = 400, limit = 100 } = {}) {
  const stack = ref([clone(read())])
  const index = ref(0)
  let timer = null
  let applying = false
  let held = false
  // A change is waiting for the debounce (or for resume), so undo must record it first.
  const pending = ref(false)

  function record(now = JSON.stringify(read())) {
    clearTimeout(timer)
    timer = null
    pending.value = false
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
      timer = null
      pending.value = true
      if (!held) timer = setTimeout(() => record(now), delay)
    },
  )

  // Record a change still waiting on the debounce, so undo steps back from it, not past it.
  function flush() {
    if (pending.value && !held) record()
  }

  function go(i) {
    clearTimeout(timer)
    timer = null
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
    // Hold recording (e.g. while a drag is under way, however long it pauses), then record
    // the whole hold as one step on resume.
    pause: () => {
      if (held) return
      flush()
      held = true
    },
    resume: () => {
      if (!held) return
      held = false
      if (pending.value) record()
    },
    reset: () => {
      clearTimeout(timer)
      timer = null
      pending.value = false
      held = false
      stack.value = [clone(read())]
      index.value = 0
    },
    canUndo: computed(() => index.value > 0 || pending.value),
    canRedo: computed(() => !pending.value && index.value < stack.value.length - 1),
    undo: () => {
      flush()
      if (index.value > 0) go(index.value - 1)
    },
    redo: () => {
      flush()
      if (index.value < stack.value.length - 1) go(index.value + 1)
    },
  }
}
