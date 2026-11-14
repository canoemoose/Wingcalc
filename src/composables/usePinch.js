// Pinch to zoom on a touch screen, for a drawing that pans with one finger. Listens on elRef's
// element in the capture phase, so it sees presses on handles that stop them going further, and
// while two fingers are down keeps their moves from the drawing's own handlers.
//
//   start()                       a pinch begins: drop whatever one finger was doing
//   change({ k, x, y, dx, dy })   zoom by k about client point (x, y), and move by (dx, dy) px
//
// The element (and what's in it) needs touch-action: none, or the browser zooms the page instead.
import { onMounted, onBeforeUnmount } from 'vue'
import { pinchTracker } from '../lib/pinch.js'

export function usePinch(elRef, { start, change }) {
  const pinch = pinchTracker()
  let el = null
  const onDown = (e) => {
    if (!pinch.down(e)) return
    e.stopPropagation()
    e.preventDefault()
    start?.()
  }
  const onMove = (e) => {
    const was = pinch.active()
    const m = pinch.move(e)
    if (!was) return
    e.stopPropagation()
    if (m) change(m)
  }
  const onUp = (e) => pinch.up(e)
  onMounted(() => {
    el = elRef.value
    if (!el) return
    el.addEventListener('pointerdown', onDown, true)
    el.addEventListener('pointermove', onMove, true)
    el.addEventListener('pointerup', onUp, true)
    el.addEventListener('pointercancel', onUp, true)
  })
  onBeforeUnmount(() => {
    if (!el) return
    el.removeEventListener('pointerdown', onDown, true)
    el.removeEventListener('pointermove', onMove, true)
    el.removeEventListener('pointerup', onUp, true)
    el.removeEventListener('pointercancel', onUp, true)
  })
}
