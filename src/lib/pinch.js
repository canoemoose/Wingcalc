// Two fingers on a drawing: a pinch zooms about the point between them and moving both pans.
// Pure bookkeeping over pointer events ({ pointerId, pointerType, clientX, clientY }); the
// composable usePinch wires it to an element.
//
//   down(e)  true when this press is the second finger, so a pinch starts
//   move(e)  while two fingers are down: { k, x, y, dx, dy }, the zoom factor since the last
//            move, the point between the fingers (client px) and how far it has moved; else null
//   up(e)    a finger lifted (or was cancelled)
//   active() two fingers are down
export function pinchTracker() {
  const pts = new Map()
  let last = null
  const measure = () => {
    const [a, b] = [...pts.values()]
    return { dist: Math.max(1, Math.hypot(b.x - a.x, b.y - a.y)), x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }
  }
  return {
    down(e) {
      if (e.pointerType !== 'touch') return false
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY })
      // A third finger is ignored: the first two carry on
      if (pts.size > 2) pts.delete(e.pointerId)
      if (pts.size !== 2 || last) return false
      last = measure()
      return true
    },
    move(e) {
      if (!pts.has(e.pointerId)) return null
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY })
      if (pts.size !== 2 || !last) return null
      const m = measure()
      const out = { k: m.dist / last.dist, x: m.x, y: m.y, dx: m.x - last.x, dy: m.y - last.y }
      last = m
      return out
    },
    up(e) {
      if (pts.delete(e.pointerId)) last = null
    },
    active: () => pts.size === 2 && !!last,
  }
}
