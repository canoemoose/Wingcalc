// The section editor's trace image, for this session only: never saved with the project. It lives at module level so
// it survives closing and reopening the editor, until it's removed, replaced or the page is reloaded.
//
// trace.value: null, or {
//   url, w, h        the rendered crop (an object URL) and its size in pixels
//   place            where it sits in the drawing (traceImage.js placeTrace)
//   source           what the dialogue needs to adjust it again: { url, w, h, deg, crop, le, te } (the original
//                    picture's object URL and size, the rotation, crop and markers)
// }
// opacity and visible are kept apart so they outlast a replaced image.
import { ref, shallowRef } from 'vue'

export const trace = shallowRef(null)
export const traceOpacity = ref(0.5)
export const traceVisible = ref(true)

const revoke = (u) => {
  if (u && typeof URL !== 'undefined' && URL.revokeObjectURL) URL.revokeObjectURL(u)
}

// Puts a new trace in place, freeing the old one's URLs (the source picture's too, unless the new one still uses it)
export function setTrace(next) {
  const old = trace.value
  if (old) {
    if (old.url !== next?.url) revoke(old.url)
    if (old.source?.url !== next?.source?.url) revoke(old.source?.url)
  }
  trace.value = next
  if (next) traceVisible.value = true
}

export const clearTrace = () => setTrace(null)
