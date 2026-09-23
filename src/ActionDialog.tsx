import { useEffect, useRef, type ReactNode, type KeyboardEvent } from 'react'

export function trapDialogTab(event: KeyboardEvent<HTMLDialogElement>) {
  if (event.key !== 'Tab') return
  const buttons = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled), [href], input:not(:disabled), [tabindex="0"]'))
  const first = buttons[0], last = buttons.at(-1)
  if (!first) { event.preventDefault(); event.currentTarget.focus(); return }
  if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus() }
  else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus() }
}

export default function ActionDialog({ title, children, onClose, pending }: { title: string; children: ReactNode; onClose: () => void; pending: boolean }) {
  const ref = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const dialog = ref.current!
    dialog.showModal()
    return () => {
      dialog.close()
      const target = previous?.isConnected && !previous.matches(':disabled') ? previous : document.getElementById('game-status')
      target?.focus({ preventScroll: true })
    }
  }, [])
  return <dialog ref={ref} className="result-dialog" aria-labelledby="action-title" onKeyDown={trapDialogTab} onCancel={e => { e.preventDefault(); if (!pending) onClose() }}>
    <h2 id="action-title">{title}</h2>{children}
  </dialog>
}
