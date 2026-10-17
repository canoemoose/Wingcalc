// Runs XFOIL polars in a Web Worker and keeps the results in memory for the page's
// lifetime. One polar runs at a time and only the latest request matters: a request is a
// list of polars in order of priority (the clean wing's first, then flapped ones), solved one
// after another, and asking for a list without the polar that's running terminates the worker
// (respawning costs a few tens of milliseconds) rather than queueing behind work nobody wants
// any more. A polar that runs past the time limit (degenerate shapes can make XFOIL grind) is
// recorded as failed.
import { shallowRef } from 'vue'

export const SOLVER_TIMEOUT_MS = 20000
const CACHE_LIMIT = 300

// No Worker in Node (server-side render, tests): null, so the solve is recorded as failed
// and the app carries on with its table-based estimates.
function defaultWorker() {
  if (typeof Worker === 'undefined') return null
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
  let wanted = []
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
      if (!worker) {
        store(job.key, { ok: false, error: 'no worker available' })
        pump()
        return
      }
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
    worker.postMessage({ id: current.id, coords: job.coords, re: job.re, settings: job.settings, flap: job.flap ?? null })
    deadline = setTimeout(() => {
      const key = current?.key
      stopWorker()
      if (key) store(key, { ok: false, error: 'timed out' })
      pump()
    }, timeoutMs)
  }

  const outstanding = () => wanted.filter((j) => !cache.has(j.key))

  function pump() {
    const next = outstanding()[0]
    if (!next) return
    if (current) {
      if (wanted.some((j) => j.key === current.key)) return // carries on; pump runs again after it
      stopWorker()
    }
    start(next)
  }

  // Ask for polars: a job { key, coords, re, settings, flap? } or a list of them, most wanted
  // first, or null when nothing is needed. Requests settle for debounceMs first, so rapid
  // edits don't each start a solve.
  function want(jobs) {
    wanted = (Array.isArray(jobs) ? jobs : [jobs]).filter(Boolean)
    clearTimeout(debounce)
    if (!outstanding().length) return
    if (current && wanted.some((j) => j.key === current.key)) return
    debounce = setTimeout(pump, debounceMs)
  }

  function dispose() {
    clearTimeout(debounce)
    stopWorker()
    wanted = []
  }

  return { lookup, want, running, dispose }
}
