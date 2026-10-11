// Runs XFOIL polars in a Web Worker and keeps the results in memory for the page's
// lifetime. One polar runs at a time and only the latest request matters: asking for a
// different polar while one is running terminates the worker (respawning costs a few tens
// of milliseconds) rather than queueing behind work nobody wants any more. A polar that
// runs past the time limit (degenerate shapes can make XFOIL grind) is recorded as failed.
import { shallowRef } from 'vue'

export const SOLVER_TIMEOUT_MS = 20000
const CACHE_LIMIT = 300

function defaultWorker() {
  return new Worker(new URL('../workers/xfoil.worker.js', import.meta.url), { type: 'module' })
}

// Cache entries: { ok: true, polar } or { ok: false, error }.
export function usePolarSolver({ createWorker = defaultWorker, timeoutMs = SOLVER_TIMEOUT_MS, debounceMs = 300 } = {}) {
  const cache = new Map()
  // Bumped whenever the cache changes, so computeds that read through lookup() update.
  const version = shallowRef(0)
  const running = shallowRef(null) // key of the polar being computed, or null

  let worker = null
  let current = null
  let wanted = null
  let seq = 0
  let debounce = null
  let deadline = null

  function lookup(key) {
    void version.value
    return cache.get(key) ?? null
  }

  function store(key, entry) {
    cache.set(key, entry)
    if (cache.size > CACHE_LIMIT) cache.delete(cache.keys().next().value)
    version.value++
  }

  function stopWorker() {
    clearTimeout(deadline)
    worker?.terminate()
    worker = null
    current = null
    running.value = null
  }

  function finish(entry) {
    clearTimeout(deadline)
    const { key } = current
    current = null
    running.value = null
    store(key, entry)
    pump()
  }

  function onMessage(event) {
    const msg = event.data
    if (!current || msg.id !== current.id) return
    finish(msg.ok ? { ok: true, polar: msg.polar, ms: msg.ms } : { ok: false, error: msg.error })
  }

  function start(job) {
    if (!worker) {
      worker = createWorker()
      worker.onmessage = onMessage
      worker.onerror = (e) => {
        if (!current) return
        const key = current.key
        stopWorker()
        store(key, { ok: false, error: e?.message ?? 'worker error' })
        pump()
      }
    }
    current = { ...job, id: ++seq }
    running.value = job.key
    worker.postMessage({ id: current.id, coords: job.coords, re: job.re, settings: job.settings })
    deadline = setTimeout(() => {
      const key = current?.key
      stopWorker()
      if (key) store(key, { ok: false, error: 'timed out' })
      pump()
    }, timeoutMs)
  }

  function pump() {
    if (!wanted || cache.has(wanted.key)) return
    if (current) {
      if (current.key === wanted.key) return
      stopWorker()
    }
    start(wanted)
  }

  // Ask for a polar: job { key, coords, re, settings }, or null when nothing is needed.
  // Requests settle for debounceMs first, so rapid edits don't each start a solve.
  function want(job) {
    wanted = job
    clearTimeout(debounce)
    if (!job || cache.has(job.key)) return
    if (current?.key === job.key) return
    debounce = setTimeout(pump, debounceMs)
  }

  function dispose() {
    clearTimeout(debounce)
    stopWorker()
    wanted = null
  }

  return { lookup, want, running, dispose }
}
