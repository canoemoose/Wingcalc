// Close a <details> drop-down menu on a click anywhere outside it, or on Esc (focus goes back
// to its summary). Returns close() for the menu's own commands.
import { onMounted, onBeforeUnmount } from 'vue'

export function useMenuDismiss(menuRef) {
  const close = () => menuRef.value?.removeAttribute('open')
  function onOutside(e) {
    if (menuRef.value?.open && !menuRef.value.contains(e.target)) close()
  }
  function onKey(e) {
    if (e.key === 'Escape' && menuRef.value?.open) {
      close()
      menuRef.value.querySelector('summary')?.focus()
    }
  }
  onMounted(() => {
    document.addEventListener('pointerdown', onOutside)
    document.addEventListener('keydown', onKey)
  })
  onBeforeUnmount(() => {
    document.removeEventListener('pointerdown', onOutside)
    document.removeEventListener('keydown', onKey)
  })
  return { close }
}
