import { describe, expect, it } from 'vitest'
import { applyMove, effectiveColor, initialBoardFor, isInCheck, legalMoves, normalizeBoard, playMove, resultAfterMove, type Board, type Piece } from './game'

const emptyBoard = (): Board => Array.from({ length: 10 }, () => Array(9).fill(null))
const piece = (color: Piece['color'], kind: Piece['kind'], cover?: Piece['cover']): Piece => ({ color, kind, ...(cover ? { cover } : {}) })
const withGenerals = () => {
  const board = emptyBoard()
  board[0][4] = piece('black', 'general')
  board[9][4] = piece('red', 'general')
  board[5][4] = piece('red', 'soldier')
  return board
}

describe('mixed-color jieqi', () => {
  it('mixes all 30 non-general pieces while preserving shells and visible generals', () => {
    const board = initialBoardFor('jieqi-mixed', () => 0)
    const pieces = board.flat().filter((value): value is Piece => Boolean(value))
    expect(pieces).toHaveLength(32)
    expect(pieces.filter(value => value.kind === 'general' && !value.cover)).toHaveLength(2)
    expect(pieces.filter(value => value.cover)).toHaveLength(30)
    expect(pieces.filter(value => value.kind !== 'general' && value.color === 'red')).toHaveLength(15)
    expect(pieces.filter(value => value.kind !== 'general' && value.color === 'black')).toHaveLength(15)
    expect(board[9][0]?.cover).toEqual({ color: 'red', kind: 'rook' })
    expect(board[0][0]?.cover).toEqual({ color: 'black', kind: 'rook' })
    expect(pieces.some(value => value.cover?.color !== value.color)).toBe(true)
  })

  it('uses the shell owner and movement before revealing, then changes to the real owner', () => {
    const board = withGenerals()
    board[6][0] = piece('black', 'rook', { color: 'red', kind: 'soldier' })
    expect(effectiveColor(board[6][0]!)).toBe('red')
    expect(legalMoves(board, { row: 6, col: 0 }, 'jieqi-mixed')).toEqual([{ row: 5, col: 0 }])
    const moved = playMove(board, 'red', 'playing', { row: 6, col: 0 }, { row: 5, col: 0 }, 'jieqi-mixed')
    expect(moved.turn).toBe('black')
    expect(moved.board[5][0]).toEqual(piece('black', 'rook'))
    expect(moved.move.label).toContain('红方暗兵')
    expect(moved.move.label).toContain('揭黑車')
    expect(legalMoves(moved.board, { row: 5, col: 0 }, 'jieqi-mixed')).toContainEqual({ row: 5, col: 4 })
  })

  it('implements horse legs, cannon screens and concealed soldier direction', () => {
    const board = withGenerals()
    board[9][1] = piece('red', 'rook', { color: 'red', kind: 'horse' })
    board[8][1] = piece('red', 'soldier')
    board[9][2] = piece('red', 'soldier')
    expect(legalMoves(board, { row: 9, col: 1 }, 'jieqi-mixed')).toEqual([])
    board[7][1] = piece('red', 'soldier', { color: 'red', kind: 'cannon' })
    board[5][1] = piece('red', 'soldier')
    board[3][1] = piece('black', 'horse')
    expect(legalMoves(board, { row: 7, col: 1 }, 'jieqi-mixed')).toContainEqual({ row: 3, col: 1 })
    expect(legalMoves(board, { row: 7, col: 1 }, 'jieqi-mixed')).not.toContainEqual({ row: 4, col: 1 })
  })

  it('keeps covered advisors in the palace but lets revealed advisors and elephants roam', () => {
    const covered = withGenerals()
    covered[9][3] = piece('black', 'rook', { color: 'red', kind: 'advisor' })
    expect(legalMoves(covered, { row: 9, col: 3 }, 'jieqi-mixed')).not.toContainEqual({ row: 8, col: 2 })
    const revealed = withGenerals()
    revealed[6][3] = piece('red', 'advisor')
    revealed[6][6] = piece('red', 'elephant')
    expect(legalMoves(revealed, { row: 6, col: 3 }, 'jieqi-mixed')).toContainEqual({ row: 5, col: 2 })
    expect(legalMoves(revealed, { row: 6, col: 6 }, 'jieqi-mixed')).toContainEqual({ row: 4, col: 4 })
    revealed[5][5] = piece('red', 'soldier')
    expect(legalMoves(revealed, { row: 6, col: 6 }, 'jieqi-mixed')).not.toContainEqual({ row: 4, col: 4 })
  })

  it('allows direct general capture and flying-general capture', () => {
    const board = withGenerals()
    board[1][4] = piece('red', 'rook')
    const captured = applyMove(board, { row: 1, col: 4 }, { row: 0, col: 4 }, 'jieqi-mixed')
    expect(resultAfterMove(captured, 'black', 'jieqi-mixed')).toBe('red-won')
    const faceToFace = emptyBoard()
    faceToFace[0][4] = piece('black', 'general')
    faceToFace[9][4] = piece('red', 'general')
    expect(legalMoves(faceToFace, { row: 9, col: 4 }, 'jieqi-mixed')).toContainEqual({ row: 0, col: 4 })
  })

  it('reports the checked side and only permits moves that answer a visible check', () => {
    const board = withGenerals()
    board[2][4] = piece('red', 'rook')
    board[0][0] = piece('black', 'rook')
    const checked = playMove(board, 'red', 'playing', { row: 2, col: 4 }, { row: 1, col: 4 }, 'jieqi-mixed')
    expect(checked.status).toBe('check')
    expect(checked.turn).toBe('black')
    expect(isInCheck(checked.board, 'black', 'jieqi-mixed')).toBe(true)
    expect(legalMoves(checked.board, { row: 0, col: 0 }, 'jieqi-mixed')).toEqual([])
    expect(legalMoves(checked.board, { row: 0, col: 4 }, 'jieqi-mixed')).toContainEqual({ row: 1, col: 4 })
  })

  it('uses a dark piece shell for check detection and supports revealed advisor attacks', () => {
    const covered = withGenerals()
    covered[2][4] = piece('black', 'horse', { color: 'red', kind: 'rook' })
    expect(isInCheck(covered, 'black', 'jieqi-mixed')).toBe(true)
    const advisor = withGenerals()
    advisor[1][3] = piece('red', 'advisor')
    expect(isInCheck(advisor, 'black', 'jieqi-mixed')).toBe(true)
  })

  it('does not leak a reveal-created check through dark-piece legal targets', () => {
    const board = emptyBoard()
    board[0][4] = piece('black', 'general')
    board[9][4] = piece('red', 'general')
    board[6][4] = piece('black', 'rook', { color: 'red', kind: 'soldier' })
    expect(legalMoves(board, { row: 6, col: 4 }, 'jieqi-mixed')).toContainEqual({ row: 5, col: 4 })
    const revealed = playMove(board, 'red', 'playing', { row: 6, col: 4 }, { row: 5, col: 4 }, 'jieqi-mixed')
    expect(revealed.status).toBe('playing')
    const reply = playMove(revealed.board, 'black', 'playing', { row: 0, col: 4 }, { row: 0, col: 3 }, 'jieqi-mixed')
    expect(reply.status).toBe('check')
    expect(reply.turn).toBe('red')
  })

  it('preserves cover metadata and does not name a captured dark piece in notation', () => {
    const board = withGenerals()
    board[5][0] = piece('black', 'horse', { color: 'black', kind: 'soldier' })
    board[9][0] = piece('red', 'soldier', { color: 'red', kind: 'rook' })
    expect(normalizeBoard(board)).toEqual(board)
    const move = playMove(board, 'red', 'playing', { row: 9, col: 0 }, { row: 5, col: 0 }, 'jieqi-mixed').move
    expect(move.captured?.cover).toEqual({ color: 'black', kind: 'soldier' })
    expect(move.label).not.toContain('馬')
  })
})
