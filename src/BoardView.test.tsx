import { expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import BoardView from './BoardView'
import type { Board } from './game'

it('does not expose a covered piece real color or kind in rendered markup', () => {
  const board: Board = Array.from({ length: 10 }, () => Array(9).fill(null))
  board[6][0] = { color: 'black', kind: 'horse', cover: { color: 'red', kind: 'soldier' } }
  const html = renderToStaticMarkup(<BoardView board={board} variant="jieqi-mixed" onCell={() => {}} />)
  expect(html).toContain('a3红方暗兵位置')
  expect(html).toContain('piece red covered')
  expect(html).not.toContain('馬')
  expect(html).not.toContain('piece black covered')
})
