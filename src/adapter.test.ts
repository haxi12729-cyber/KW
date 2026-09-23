import { describe, it, expect } from 'vitest'
import { initialBoard, boardToFen, boardFromFen, toSquare, fromSquare, playMove, legalMoves, resultAfterMove, isInCheck, normalizeBoard, cloneBoard } from './game'
import { transitionRoom, type Room } from './firebase'

describe('upstream adapter', () => {
  it('round trips all 90 coordinates and initial FEN', () => {
    for (let row = 0; row < 10; row++) for (let col = 0; col < 9; col++) expect(fromSquare(toSquare({ row, col }))).toEqual({ row, col })
    expect(toSquare({ row: 9, col: 0 })).toBe('a0')
    expect(boardFromFen(boardToFen(initialBoard(), 'red'))).toEqual(initialBoard())
  })
  it('validates all seven kinds at the opening', () => {
    const b = initialBoard()
    for (const [from, to] of [['a0','a1'], ['b0','c2'], ['c0','e2'], ['d0','e1'], ['e0','e1'], ['b2','b1'], ['a3','a4']]) {
      expect(legalMoves(b, fromSquare(from))).toContainEqual(fromSquare(to))
    }
  })
  it('rejects backward soldiers, diagonal rooks and occupied elephant eyes', () => {
    const b = initialBoard()
    expect(legalMoves(b, fromSquare('a3'))).not.toContainEqual(fromSquare('a2'))
    expect(legalMoves(b, fromSquare('a0'))).not.toContainEqual(fromSquare('b1'))
    b[8][3] = b[7][1]; b[7][1] = null
    expect(legalMoves(b, fromSquare('c0'))).not.toContainEqual(fromSquare('e2'))
  })
  it('requires a screen for cannon capture', () => {
    const b = initialBoard()
    expect(legalMoves(b, fromSquare('b2'))).toContainEqual(fromSquare('b9'))
    b[2][1] = null
    expect(legalMoves(b, fromSquare('b2'))).not.toContainEqual(fromSquare('b9'))
  })
  it('permits sideways soldiers only after crossing', () => {
    const b = boardFromFen('4k4/9/9/9/P8/4p4/9/9/9/4K4 r - - 0 1')
    expect(legalMoves(b, fromSquare('a5'))).toContainEqual(fromSquare('b5'))
    expect(legalMoves(initialBoard(), fromSquare('a3'))).not.toContainEqual(fromSquare('b3'))
  })
  it('keeps generals inside the palace and prevents exposing facing generals', () => {
    const b = boardFromFen('4k4/9/9/9/9/4R4/9/9/9/4K4 r - - 0 1')
    expect(legalMoves(b, fromSquare('e4'))).not.toContainEqual(fromSquare('d4'))
    expect(legalMoves(b, fromSquare('e0'))).not.toContainEqual(fromSquare('e2'))
  })
  it.each([
    ['4k4/9/9/9/9/9/9/9/4Ar3/2r1K4 r - - 0 7', true],
    ['4k4/4a4/9/9/9/9/9/9/3r1r3/4K4 r - - 0 2', false],
  ])('adjudicates checkmate and stalemate as loss: %s', (fen, check) => {
    const b = boardFromFen(fen)
    expect(isInCheck(b, 'red')).toBe(check)
    expect(resultAfterMove(b, 'red')).toBe('black-won')
  })
  it('does not mutate input; snapshots restore captures; restart is independent', () => {
    const b = initialBoard(); const saved = cloneBoard(b)
    const next = playMove(b, 'red', 'playing', fromSquare('b2'), fromSquare('b9'))
    expect(next.move.captured?.kind).toBe('horse')
    expect(b).toEqual(saved)
    expect(initialBoard()).toEqual(saved)
    expect(next.board).not.toEqual(saved)
  })
  it('rejects illegal moves and terminal/waiting states', () => {
    const b = initialBoard()
    expect(() => playMove(b, 'red', 'playing', fromSquare('a3'), fromSquare('a2'))).toThrow()
    for (const status of ['waiting', 'red-won', 'black-won'] as const) expect(() => playMove(b, 'red', status, fromSquare('a3'), fromSquare('a4'))).toThrow()
    expect(b).toEqual(initialBoard())
  })
})

describe('room transition', () => {
  const room = (): Room => ({ redUid: 'r', blackUid: 'b', board: initialBoard(), turn: 'red', version: 0, status: 'playing', moves: [], createdAt: 1, updatedAt: 1, presence: { red: { online: true, lastSeen: 1 }, black: { online: true, lastSeen: 1 } } })
  it('normalizes database holes to exactly 90 cells', () => {
    const b = normalizeBoard({ 0: { 4: { kind: 'general', color: 'black' } } })
    expect(b.flat()).toHaveLength(90)
    expect(b[9][8]).toBeNull()
  })
  it('serializes ordinary moves without undefined and preserves both turns', () => {
    const first = transitionRoom(room(), 'r', fromSquare('a3'), fromSquare('a4'), 0)!
    expect(first.version).toBe(1)
    expect(first.moves[0]).not.toHaveProperty('captured')
    const second = transitionRoom(first, 'b', fromSquare('a6'), fromSquare('a5'), 1)!
    expect(second.turn).toBe('red')
    expect(JSON.parse(JSON.stringify(second))).toEqual(second)
  })
  it('rejects stale versions, wrong seats and illegal moves', () => {
    expect(transitionRoom(room(), 'r', fromSquare('a3'), fromSquare('a4'), 2)).toBeUndefined()
    expect(transitionRoom(room(), 'b', fromSquare('a3'), fromSquare('a4'), 0)).toBeUndefined()
    expect(transitionRoom(room(), 'r', fromSquare('a3'), fromSquare('a2'), 0)).toBeUndefined()
  })
})
