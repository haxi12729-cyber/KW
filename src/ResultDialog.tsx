import { useEffect, useRef, useState } from 'react'
import type { Color } from './game'
import { trapDialogTab } from './ActionDialog'

type Props = {
  winner: Color | null
  reason?: 'agreement' | 'resign' | null
  online: boolean
  playerColor: Color | null
  pending: boolean
  error: string
  onRestart: () => void
}

export default function ResultDialog({ winner, reason, online, playerColor, pending, error, onRestart }: Props) {
  const dialog = useRef<HTMLDialogElement>(null)
  const [dismissed, setDismissed] = useState(false)
  useEffect(() => {
    if (dismissed) return
    const element = dialog.current!
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null
    element.showModal()
    return () => {
      element.close()
      // The last move's square is disabled after a win; use the game heading as fallback.
      const target = previous?.isConnected && !previous.matches(':disabled')
        ? previous : document.getElementById('game-status')
      target?.focus({ preventScroll: true })
    }
  }, [dismissed])

  return <dialog ref={dialog} className="result-dialog" aria-labelledby="result-title" aria-describedby="result-description" onKeyDown={trapDialogTab}
    onCancel={event => { event.preventDefault(); if (!pending) setDismissed(true) }}>
    <p className="eyebrow">本局结束</p>
    <div className={'result-seal ' + (winner || '')} aria-hidden="true">{winner === 'red' ? '帥' : winner === 'black' ? '將' : '和'}</div>
    <h2 id="result-title" className={winner || ''}>{winner === 'red' ? '红方胜出' : winner === 'black' ? '黑方胜出' : '双方和棋'}</h2>
    <p id="result-description">{!winner ? '双方同意和棋，本局结束。' : online && playerColor ? winner === playerColor ? '恭喜获胜' : '本局惜败' : '胜负已定，感谢双方精彩对弈。'}</p>
    {reason === 'resign' && <p>{winner === 'red' ? '黑方' : '红方'}认输</p>}
    {error && <p className="error" role="alert">{error}</p>}
    <div className="result-actions" aria-busy={pending}>
      <button className="button secondary" autoFocus disabled={pending} onClick={() => setDismissed(true)}>查看棋盘</button>
      {(!online || playerColor === 'red') && <button className="button primary" disabled={pending} onClick={onRestart}>{pending ? '重新开始中…' : '再来一局'}</button>}
    </div>
    {online && playerColor !== 'red' && <p className="result-waiting">等待房主重新开始</p>}
  </dialog>
}
