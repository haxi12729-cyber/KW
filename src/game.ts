import { Xiangqi, type EnginePiece } from './vendor/xiangqi/xiangqi.js'
export type Color = 'red' | 'black'
export type Kind = 'general' | 'advisor' | 'elephant' | 'horse' | 'rook' | 'cannon' | 'soldier'
export type Piece = { color: Color; kind: Kind }
export type Cell = Piece | null
export type Board = Cell[][]
export type Pos = { row: number; col: number }
export type Move = { from: Pos; to: Pos; captured?: Piece; label: string }
export type GameStatus = 'waiting' | 'playing' | 'check' | 'red-won' | 'black-won' | 'draw'
const kinds: Record<string, Kind> = { k: 'general', a: 'advisor', b: 'elephant', n: 'horse', r: 'rook', c: 'cannon', p: 'soldier' }
const codes: Record<Kind, string> = { general: 'k', advisor: 'a', elephant: 'b', horse: 'n', rook: 'r', cannon: 'c', soldier: 'p' }
const names: Record<Color, Record<Kind, string>> = {
  red: { general: '帥', advisor: '仕', elephant: '相', horse: '傌', rook: '俥', cannon: '炮', soldier: '兵' },
  black: { general: '將', advisor: '士', elephant: '象', horse: '馬', rook: '車', cannon: '砲', soldier: '卒' },
}
export const posKey = (p: Pos) => p.row + ',' + p.col
const inside = (p: Pos) => Number.isInteger(p.row) && Number.isInteger(p.col) && p.row >= 0 && p.row < 10 && p.col >= 0 && p.col < 9
export function toSquare(p: Pos): string {
  if (!inside(p)) throw new Error('坐标超出棋盘')
  return String.fromCharCode(97 + p.col) + (9 - p.row)
}
export function fromSquare(square: string): Pos {
  if (!/^[a-i][0-9]$/.test(square)) throw new Error('无效棋盘坐标')
  return { row: 9 - Number(square[1]), col: square.charCodeAt(0) - 97 }
}
export function normalizeBoard(value: unknown): Board {
  const rows = value as Record<number, Record<number, Piece | null> | undefined> | null
  return Array.from({ length: 10 }, (_, row) => Array.from({ length: 9 }, (_, col) => {
    const piece = rows?.[row]?.[col]
    if (!piece) return null
    if (!(piece.kind in codes) || !['red', 'black'].includes(piece.color)) throw new Error('无效棋子数据')
    return { kind: piece.kind, color: piece.color }
  }))
}
export function cloneBoard(board: Board): Board { return normalizeBoard(board) }
function fromEngine(board: (EnginePiece | null)[][]): Board {
  return board.map(row => row.map(piece => piece ? { kind: kinds[piece.type], color: piece.color === 'r' ? 'red' : 'black' } : null))
}
export function boardToFen(board: Board, turn: Color): string {
  const placement = normalizeBoard(board).map(row => {
    let output = ''; let empty = 0
    for (const piece of row) {
      if (!piece) { empty++; continue }
      if (empty) { output += empty; empty = 0 }
      const code = codes[piece.kind]; output += piece.color === 'red' ? code.toUpperCase() : code
    }
    return output + (empty || '')
  }).join('/')
  return placement + ' ' + (turn === 'red' ? 'r' : 'b') + ' - - 0 1'
}
function engine(board: Board, turn: Color) {
  const game = new Xiangqi()
  if (!game.load(boardToFen(board, turn))) throw new Error('无效象棋局面')
  return game
}
export function boardFromFen(fen: string): Board {
  const game = new Xiangqi()
  if (!game.load(fen)) throw new Error('无效 FEN')
  return fromEngine(game.board())
}
export function initialBoard(): Board { return fromEngine(new Xiangqi().board()) }
export function pieceName(piece: Piece) { return names[piece.color][piece.kind] }
export function moveLabel(board: Board, from: Pos, to: Pos) { return pieceName(board[from.row][from.col]!) + ' ' + toSquare(from) + '→' + toSquare(to) }
export function legalMoves(board: Board, from: Pos): Pos[] {
  if (!inside(from)) return []
  const piece = board[from.row]?.[from.col]
  if (!piece) return []
  return engine(board, piece.color).moves({ square: toSquare(from), verbose: true })
    .map(move => fromSquare(move.to)).filter(to => board[to.row]?.[to.col]?.kind !== 'general')
}
export function applyMove(board: Board, from: Pos, to: Pos): Board {
  const piece = board[from.row]?.[from.col]
  if (!piece || !inside(from) || !inside(to) || !legalMoves(board, from).some(p => posKey(p) === posKey(to))) throw new Error('非法走棋')
  const game = engine(board, piece.color)
  if (!game.move({ from: toSquare(from), to: toSquare(to) })) throw new Error('非法走棋')
  return fromEngine(game.board())
}
export function isInCheck(board: Board, color: Color) { return engine(board, color).in_check() }
function recordMove(board: Board, from: Pos, to: Pos): Move {
  const captured = board[to.row][to.col]
  return { from: { ...from }, to: { ...to }, label: moveLabel(board, from, to), ...(captured ? { captured: { ...captured } } : {}) }
}
export function allLegalMoves(board: Board, color: Color): Move[] {
  return engine(board, color).moves({ verbose: true }).map(move => ({ from: fromSquare(move.from), to: fromSquare(move.to) }))
    .filter(move => board[move.to.row]?.[move.to.col]?.kind !== 'general').map(move => recordMove(board, move.from, move.to))
}
export function resultAfterMove(board: Board, turn: Color): GameStatus {
  if (!allLegalMoves(board, turn).length) return turn === 'red' ? 'black-won' : 'red-won'
  return isInCheck(board, turn) ? 'check' : 'playing'
}
export function canMove(status: GameStatus) { return status === 'playing' || status === 'check' }
export function playMove(board: Board, turn: Color, status: GameStatus, from: Pos, to: Pos) {
  if (!canMove(status) || board[from.row]?.[from.col]?.color !== turn) throw new Error('尚未轮到你或对局已结束')
  const next = applyMove(board, from, to)
  const nextTurn: Color = turn === 'red' ? 'black' : 'red'
  return { board: next, turn: nextTurn, status: resultAfterMove(next, nextTurn), move: recordMove(board, from, to) }
}
