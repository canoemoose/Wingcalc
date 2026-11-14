// Where a drawing's command bar (.wc-cmd) sits: centred along the top, unless there it would run
// into the controls in the top corners, when it drops to the bottom instead. Returns a ref that's
// true for the bottom; the component puts `wc-cmd--bottom` on its bar from it.
//
// rootEl: a ref to an element the bar is somewhere inside. Measured on mount, on every update
// (the bar's contents follow the selection), and when the drawing or the window changes size.
import { ref, onMounted, onUpdated, onBeforeUnmount } from 'vue'

const GAP = 12 // px kept clear between the bar and a corner's controls

// The bar's width on one line, whichever way it's laid out now: its items never wrap inside
// themselves, so their widths plus the gaps and padding are it
function naturalWidth(bar) {
  const cs = getComputedStyle(bar)
  const gap = parseFloat(cs.columnGap) || 0
  const pad = (parseFloat(cs.paddingLeft) || 0) + (parseFloat(cs.paddingRight) || 0) + (parseFloat(cs.borderLeftWidth) || 0) + (parseFloat(cs.borderRightWidth) || 0)
  const items = [...bar.children]
  return items.reduce((w, c) => w + c.offsetWidth + (parseFloat(getComputedStyle(c).marginLeft) || 0) + (parseFloat(getComputedStyle(c).marginRight) || 0), 0) + gap * Math.max(0, items.length - 1) + pad
}

// Pure: does a bar this wide, centred in a stage this wide, reach into either top corner's
// controls (their widths in from each side, 0 for none)?
export function cmdCollides(stageWidth, barWidth, leftReach, rightReach, gap = GAP) {
  const side = (stageWidth - barWidth) / 2
  return side < Math.max(leftReach, rightReach) + gap
}

export function useCmdDock(rootEl) {
  const bottom = ref(false)
  let ro = null
  function measure() {
    const bar = rootEl.value?.querySelector('.wc-cmd')
    const stage = bar?.offsetParent
    if (!stage || !(stage.clientWidth > 0)) return
    const box = stage.getBoundingClientRect()
    const reach = (sel, edge) => {
      let r = 0
      for (const c of stage.querySelectorAll(sel)) {
        const b = c.getBoundingClientRect()
        if (b.width > 0) r = Math.max(r, edge === 'left' ? b.right - box.left : box.right - b.left)
      }
      return r
    }
    bottom.value = cmdCollides(box.width, naturalWidth(bar), reach('.wc-stage__corner--tl', 'left'), reach('.wc-stage__corner--tr', 'right'))
  }
  onMounted(() => {
    measure()
    if (typeof ResizeObserver !== 'undefined' && rootEl.value) {
      ro = new ResizeObserver(measure)
      ro.observe(rootEl.value)
    }
    window.addEventListener('resize', measure)
  })
  onUpdated(measure)
  onBeforeUnmount(() => {
    ro?.disconnect()
    if (typeof window !== 'undefined') window.removeEventListener('resize', measure)
  })
  return bottom
}
