import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { reactive, nextTick } from 'vue'
import { useHistory } from '../src/composables/useHistory.js'

describe('undo history', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  const setup = () => {
    const state = reactive({ a: 1 })
    const h = useHistory(
      () => ({ a: state.a }),
      (v) => Object.assign(state, v),
    )
    return { state, h }
  }

  it('records a step once changes settle', async () => {
    const { state, h } = setup()
    state.a = 2
    await nextTick()
    state.a = 3
    await nextTick()
    expect(h.canUndo.value).toBe(false)
    vi.advanceTimersByTime(500)
    expect(h.canUndo.value).toBe(true)
    h.undo()
    expect(state.a).toBe(1)
    h.redo()
    expect(state.a).toBe(3)
  })

  it('records immediately on commit, so quick edits stay separate', async () => {
    const { state, h } = setup()
    state.a = 2
    h.commit()
    state.a = 3
    h.commit()
    h.undo()
    expect(state.a).toBe(2)
    h.undo()
    expect(state.a).toBe(1)
    expect(h.canUndo.value).toBe(false)
  })

  it('does not record the undo itself as a new step', async () => {
    const { state, h } = setup()
    state.a = 2
    h.commit()
    h.undo()
    await nextTick()
    vi.advanceTimersByTime(500)
    expect(h.canRedo.value).toBe(true)
  })

  it('drops the redo branch after a new edit', async () => {
    const { state, h } = setup()
    state.a = 2
    h.commit()
    h.undo()
    await nextTick()
    state.a = 5
    h.commit()
    expect(h.canRedo.value).toBe(false)
  })
})
