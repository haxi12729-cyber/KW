import { describe, expect, it } from 'vitest'
import { actMatch, activeRequest, moveMatch, type Match } from './match'
import { initialBoard, fromSquare, boardFromFen, isInCheck } from './game'

const fresh = (): Match => ({ board: initialBoard(), turn: 'red', status: 'playing', moves: [], version: 0, gameId: 1 })
const moved = () => moveMatch(fresh(), fromSquare('a3'), fromSquare('a4'), 0)
const ask = (match = moved(), kind: 'undo' | 'draw' = 'undo') => actMatch(match, 'red', 'r', { type: 'request', kind, id: 'request-1' }, 1000)
describe('timed match actions', () => {
  it('requires opponent consent and restores exactly one move', () => {
    const game = ask()
    expect(() => actMatch(game, 'red', 'r', { type: 'accept', id: 'request-1' }, 2000)).toThrow()
    expect(game.board).toEqual(moved().board)
    const next = actMatch(game, 'black', 'b', { type: 'accept', id: 'request-1' }, 2000)
    expect(next.board).toEqual(initialBoard()); expect(next.moves).toEqual([])
    expect(next.turn).toBe('red'); expect(next.history).toEqual([])
  })
  it.each(['reject', 'cancel', 'expire'] as const)('%s leaves position unchanged', type => {
    const game = ask()
    const next = actMatch(game, type === 'cancel' ? 'red' : 'black', 'u', { type, id: 'request-1' }, type === 'expire' ? 11000 : 2000)
    expect(next.board).toEqual(game.board); expect(next.moves).toEqual(game.moves)
    expect(next.history).toEqual(game.history); expect(next.request).toBeNull()
  })
  it('accepts before deadline, rejects at and after deadline including after reload', () => {
    const game = JSON.parse(JSON.stringify(ask())) as Match
    expect(actMatch(game, 'black', 'b', { type: 'accept', id: 'request-1' }, 10999).turn).toBe('red')
    for (const now of [11000, 11001, 900000]) {
      expect(activeRequest(game, now)).toBeNull()
      expect(() => actMatch(game, 'black', 'b', { type: 'accept', id: 'request-1' }, now)).toThrow()
    }
  })
  it('blocks moves and overlapping requests until expiration', () => {
    const game = ask()
    expect(() => moveMatch(game, fromSquare('a6'), fromSquare('a5'), 2000)).toThrow()
    expect(() => ask(game, 'draw')).toThrow()
    expect(moveMatch(game, fromSquare('a6'), fromSquare('a5'), 11000).request).toBeNull()
    expect(actMatch(game, 'black', 'b', { type: 'request', kind: 'draw', id: 'new' }, 11000).request?.id).toBe('new')
  })
  it('rejects missing history, wrong last mover, stale IDs and stale request versions', () => {
    expect(() => ask(fresh())).toThrow()
    expect(() => actMatch(moved(), 'black', 'b', { type: 'request', kind: 'undo', id: 'bad' }, 0)).toThrow()
    const game = ask()
    expect(() => actMatch(game, 'black', 'b', { type: 'accept', id: 'old' }, 2000)).toThrow()
    expect(() => actMatch({ ...game, version: game.version + 1 }, 'black', 'b', { type: 'accept', id: 'request-1' }, 2000)).toThrow()
  })
  it('restores captured pieces and only removes the last move', () => {
    const capture = moveMatch(fresh(), fromSquare('b2'), fromSquare('b9'), 0)
    const reply = moveMatch(capture, fromSquare('a6'), fromSquare('a5'), 10)
    const request = actMatch(reply, 'black', 'b', { type: 'request', kind: 'undo', id: 'b' }, 100)
    const restored = actMatch(request, 'red', 'r', { type: 'accept', id: 'b' }, 200)
    expect(restored.board).toEqual(capture.board); expect(restored.moves).toHaveLength(1)
    const undoCapture = actMatch(ask(restored), 'black', 'b', { type: 'accept', id: 'request-1' }, 2000)
    expect(undoCapture.board).toEqual(initialBoard())
  })
  it('restores a checked position after undoing an escape', () => {
    const board = boardFromFen('4k4/9/9/9/4p4/9/9/9/4r4/4K4 r - - 0 1')
    expect(isInCheck(board, 'red')).toBe(true)
    const escaped = moveMatch({ ...fresh(), board, status: 'check' }, fromSquare('e0'), fromSquare('d0'), 0)
    const restored = actMatch(ask(escaped), 'black', 'b', { type: 'accept', id: 'request-1' }, 2000)
    expect(restored.status).toBe('check'); expect(restored.board).toEqual(board)
  })
  it('ends an agreed draw and rejects any later action or move', () => {
    const draw = actMatch(ask(fresh(), 'draw'), 'black', 'b', { type: 'accept', id: 'request-1' }, 2000)
    expect(draw.status).toBe('draw'); expect(draw.reason).toBe('agreement')
    expect(() => moveMatch(draw, fromSquare('a3'), fromSquare('a4'), 3000)).toThrow()
    expect(() => actMatch(draw, 'red', 'r', { type: 'resign', gameId: 1 }, 3000)).toThrow()
  })
  it.each(['red', 'black'] as const)('%s resigns and clears pending request', actor => {
    const result = actMatch(ask(), actor, actor, { type: 'resign', gameId: 1 }, 2000)
    expect(result.status).toBe(actor === 'red' ? 'black-won' : 'red-won')
    expect(result.reason).toBe('resign'); expect(result.request).toBeNull()
  })
  it('allows resign after an opponent move but not after restart', () => {
    expect(actMatch(moved(), 'red', 'r', { type: 'resign', gameId: 1 }, 2000).status).toBe('black-won')
    expect(() => actMatch({ ...moved(), gameId: 2 }, 'red', 'r', { type: 'resign', gameId: 1 }, 2000)).toThrow()
  })
})
