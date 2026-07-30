import { useEffect } from 'react'

// Close a popup/modal/drawer when Escape is pressed. Pass the same onClose the component already uses.
export function useEscClose(onClose) {
  useEffect(() => {
    if (!onClose) return
    const onKey = (e) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
}
