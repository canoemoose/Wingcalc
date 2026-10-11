import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { usePolarSolver } from '../src/composables/usePolarSolver.js'

// Fake worker: records messages; tests answer them by hand.
function fakeWorkers() {
  const made = []
  const createWorker = () => {
    const w = {
      sent: [],
      terminated: false,
      postMessage(m) { this.sent.push(m) },
      terminate() { this.terminated = true },
      reply(data) { this.onmessage?.({ data }) },
    }
    made.push(w)
    return w
  }
  return { made, createWorker }
}

const job = (key, re = 1e5) => ({ key, coords: [[1, 0]], re, settings: {} })
const polar = { re: 1e5, alpha: [0], cl: [0.3] }

beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

describe('polar solver', () => {
  it('debounces, runs a request in the worker and caches the result', () => {
    const { made, createWorker } = fakeWorkers()
    const s = usePolarSolver({ createWorker, debounceMs: 300 })
    s.want(job('a'))
    expect(made).toHaveLength(0)
    vi.advanceTimersByTime(300)
    expect(made[0].sent[0]).toMatchObject({ re: 1e5 })
    expect(s.running.value).toBe('a')
    made[0].reply({ id: made[0].sent[0].id, ok: true, polar })
    expect(s.lookup('a')).toMatchObject({ ok: true, polar })
    expect(s.running.value).toBeNull()
    s.want(job('a'))
    vi.advanceTimersByTime(1000)
    expect(made[0].sent).toHaveLength(1) // served from the cache
  })

  it('abandons a running polar when a different one is wanted', () => {
    const { made, createWorker } = fakeWorkers()
    const s = usePolarSolver({ createWorker, debounceMs: 0 })
    s.want(job('a'))
    vi.advanceTimersByTime(0)
    s.want(job('b'))
    vi.advanceTimersByTime(0)
    expect(made[0].terminated).toBe(true)
    expect(made[1].sent[0]).toBeDefined()
    made[0].reply({ id: made[0].sent[0].id, ok: true, polar }) // late reply from the old worker
    expect(s.lookup('a')).toBeNull()
    made[1].reply({ id: made[1].sent[0].id, ok: true, polar })
    expect(s.lookup('b')).not.toBeNull()
  })

  it('records a timeout as a failure and moves on', () => {
    const { made, createWorker } = fakeWorkers()
    const s = usePolarSolver({ createWorker, debounceMs: 0, timeoutMs: 5000 })
    s.want(job('slow'))
    vi.advanceTimersByTime(5000)
    expect(made[0].terminated).toBe(true)
    expect(s.lookup('slow')).toMatchObject({ ok: false, error: 'timed out' })
  })

  it('records a worker error as a failure', () => {
    const { made, createWorker } = fakeWorkers()
    const s = usePolarSolver({ createWorker, debounceMs: 0 })
    s.want(job('x'))
    vi.advanceTimersByTime(0)
    made[0].reply({ id: made[0].sent[0].id, ok: false, error: 'boom' })
    expect(s.lookup('x')).toMatchObject({ ok: false, error: 'boom' })
  })

  it('stops everything on dispose', () => {
    const { made, createWorker } = fakeWorkers()
    const s = usePolarSolver({ createWorker, debounceMs: 0 })
    s.want(job('a'))
    vi.advanceTimersByTime(0)
    s.dispose()
    expect(made[0].terminated).toBe(true)
    expect(s.running.value).toBeNull()
  })
})
