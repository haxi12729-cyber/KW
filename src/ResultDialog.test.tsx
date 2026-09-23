import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import ResultDialog from './ResultDialog'

const defaults = { winner: 'red' as const, online: false, playerColor: null, pending: false, error: '', onRestart: () => {} }

describe('result dialog', () => {
  it('shows a draw without winner copy', () => {
    const html = renderToStaticMarkup(<ResultDialog {...defaults} winner={null} reason="agreement" online playerColor="red" />)
    expect(html).toContain('双方和棋'); expect(html).not.toContain('恭喜获胜')
  })
  it('explains a resignation', () => {
    expect(renderToStaticMarkup(<ResultDialog {...defaults} reason="resign" />)).toContain('黑方认输')
  })
  it.each(['red', 'black'] as const)('announces %s winner and offers local restart', winner => {
    const html = renderToStaticMarkup(<ResultDialog {...defaults} winner={winner} />)
    expect(html).toContain(winner === 'red' ? '红方胜出' : '黑方胜出')
    expect(html).toContain('查看棋盘')
    expect(html).toContain('再来一局')
    expect(html).toContain('aria-labelledby="result-title"')
  })
  it.each(['red', 'black'] as const)('shows identity-specific copy for %s', playerColor => {
    const html = renderToStaticMarkup(<ResultDialog {...defaults} online playerColor={playerColor} />)
    expect(html).toContain(playerColor === 'red' ? '恭喜获胜' : '本局惜败')
    if (playerColor === 'red') expect(html).toContain('再来一局')
    else { expect(html).not.toContain('再来一局'); expect(html).toContain('等待房主重新开始') }
  })
  it('recognizes black victory for the guest', () => {
    const html = renderToStaticMarkup(<ResultDialog {...defaults} winner="black" online playerColor="black" />)
    expect(html).toContain('恭喜获胜')
    expect(html).not.toContain('再来一局')
  })
  it('disables both actions while submitting', () => {
    const html = renderToStaticMarkup(<ResultDialog {...defaults} pending />)
    expect(html.match(/disabled=""/g)).toHaveLength(2)
    expect(html).toContain('重新开始中…')
  })
  it('displays restart errors while leaving retry available', () => {
    const html = renderToStaticMarkup(<ResultDialog {...defaults} error="网络连接失败" />)
    expect(html).toContain('role="alert">网络连接失败')
    expect(html).not.toContain('disabled=""')
  })
})
