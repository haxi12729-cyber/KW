import { describe, expect, it } from 'vitest'
import { allLegalMoves, applyMove, boardFromFen, initialBoard, isInCheck, legalMoves, playMove } from './game'

describe('xiangqi rules', () => {
  it('blocks a horse when its leg is occupied', () => { const b = initialBoard(); b[8][1] = b[7][1]; b[7][1] = null; expect(legalMoves(b, { row: 9, col: 1 })).toEqual([]) })
  it('allows a cannon to move before its screen', () => { const b = initialBoard(); expect(legalMoves(b, { row: 7, col: 1 })).toContainEqual({ row: 6, col: 1 }) })
  it('does not let an elephant cross the river', () => { const b = initialBoard(); const after = applyMove(b, { row: 9, col: 2 }, { row: 7, col: 4 }); expect(legalMoves(after, { row: 7, col: 4 }).some(p => p.row < 5)).toBe(false) })
  it('starts with legal moves for both sides', () => { const b = initialBoard(); expect(allLegalMoves(b, 'red').length).toBeGreaterThan(0); expect(allLegalMoves(b, 'black').length).toBeGreaterThan(0); expect(isInCheck(b, 'red')).toBe(false) })
  it('marks the side to move as checked after a normal check', () => {
    const board = boardFromFen('4k4/9/9/9/9/9/9/9/3R5/4K4 r - - 0 1')
    const checked = playMove(board, 'red', 'playing', { row: 8, col: 3 }, { row: 8, col: 4 })
    expect(checked.status).toBe('check')
    expect(checked.turn).toBe('black')
  })
})
