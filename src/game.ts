import { Xiangqi, type EnginePiece } from './vendor/xiangqi/xiangqi.js'

export type Color = 'red' | 'black'
export type Kind = 'general' | 'advisor' | 'elephant' | 'horse' | 'rook' | 'cannon' | 'soldier'
export type GameVariant = 'standard' | 'jieqi-mixed'
export type Cover = { color: Color; kind: Exclude<Kind, 'general'> }
export type Piece = { color: Color; kind: Kind; cover?: Cover }
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
export const otherColor = (color: Color): Color => color === 'red' ? 'black' : 'red'
export const effectiveColor = (piece: Piece): Color => piece.cover?.color ?? piece.color
export const effectiveKind = (piece: Piece): Kind => piece.cover?.kind ?? piece.kind
const inside = (p: Pos) => Number.isInteger(p.row) && Number.isInteger(p.col) && p.row >= 0 && p.row < 10 && p.col >= 0 && p.col < 9
const validColor = (value: unknown): value is Color => value === 'red' || value === 'black'
const validKind = (value: unknown): value is Kind => typeof value === 'string' && value in codes

export function toSquare(p: Pos): string {
  if (!inside(p)) throw new Error('坐标超出棋盘')
  return String.fromCharCode(97 + p.col) + (9 - p.row)
}

export function fromSquare(square: string): Pos {
  if (!/^[a-i][0-9]$/.test(square)) throw new Error('无效棋盘坐标')
  return { row: 9 - Number(square[1]), col: square.charCodeAt(0) - 97 }
}

export function normalizeVariant(value: unknown): GameVariant { return value === 'jieqi-mixed' ? value : 'standard' }

export function normalizeBoard(value: unknown): Board {
  const rows = value as Record<number, Record<number, Piece | null> | undefined> | null
  return Array.from({ length: 10 }, (_, row) => Array.from({ length: 9 }, (_, col) => {
    const piece = rows?.[row]?.[col]
    if (!piece) return null
    if (!validKind(piece.kind) || !validColor(piece.color)) throw new Error('无效棋子数据')
    const normalized: Piece = { kind: piece.kind, color: piece.color }
    if (piece.cover) {
      if (!validColor(piece.cover.color) || !validKind(piece.cover.kind) || (piece.cover as { kind: unknown }).kind === 'general') throw new Error('无效暗子数据')
      normalized.cover = { color: piece.cover.color, kind: piece.cover.kind }
    }
    return normalized
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

function secureRandom() {
  const values = new Uint32Array(1)
  globalThis.crypto.getRandomValues(values)
  return values[0] / 0x1_0000_0000
}

export function initialBoardFor(variant: GameVariant, random: () => number = secureRandom): Board {
  const board = initialBoard()
  if (variant === 'standard') return board
  const pool = board.flat().filter((piece): piece is Piece => Boolean(piece && piece.kind !== 'general')).map(piece => ({ ...piece }))
  for (let index = pool.length - 1; index > 0; index--) {
    const swap = Math.floor(random() * (index + 1))
    ;[pool[index], pool[swap]] = [pool[swap], pool[index]]
  }
  let index = 0
  return board.map(row => row.map(shell => {
    if (!shell || shell.kind === 'general') return shell ? { ...shell } : null
    const actual = pool[index++]
    return { ...actual, cover: { color: shell.color, kind: shell.kind as Cover['kind'] } }
  }))
}

export function pieceName(piece: Pick<Piece, 'color' | 'kind'>) { return names[piece.color][piece.kind] }
export function visiblePieceName(piece: Piece) { return piece.cover ? '暗' + pieceName(piece.cover) : pieceName(piece) }

function moveLabel(board: Board, from: Pos, to: Pos, variant: GameVariant) {
  const piece = board[from.row][from.col]!
  if (variant === 'jieqi-mixed' && piece.cover) {
    const side = piece.cover.color === 'red' ? '红方' : '黑方'
    const revealed = piece.color === 'red' ? '红' : '黑'
    return `${side}暗${pieceName(piece.cover)} ${toSquare(from)}→${toSquare(to)}（揭${revealed}${pieceName(piece)}）`
  }
  return pieceName(piece) + ' ' + toSquare(from) + '→' + toSquare(to)
}

function standardLegalMoves(board: Board, from: Pos): Pos[] {
  const piece = board[from.row]?.[from.col]
  if (!piece) return []
  return engine(board, piece.color).moves({ square: toSquare(from), verbose: true })
    .map(move => fromSquare(move.to)).filter(to => board[to.row]?.[to.col]?.kind !== 'general')
}

const orthogonal = [[-1, 0], [1, 0], [0, -1], [0, 1]] as const
const diagonal = [[-1, -1], [-1, 1], [1, -1], [1, 1]] as const

function targetAllowed(board: Board, actor: Color, target: Pos) {
  return inside(target) && (!board[target.row][target.col] || effectiveColor(board[target.row][target.col]!) !== actor)
}

function rayMoves(board: Board, from: Pos, actor: Color, cannon: boolean) {
  const moves: Pos[] = []
  for (const [dr, dc] of orthogonal) {
    let screened = false
    for (let step = 1; ; step++) {
      const target = { row: from.row + dr * step, col: from.col + dc * step }
      if (!inside(target)) break
      const occupant = board[target.row][target.col]
      if (!cannon) {
        if (!occupant) moves.push(target)
        else { if (effectiveColor(occupant) !== actor) moves.push(target); break }
      } else if (!screened) {
        if (!occupant) moves.push(target)
        else screened = true
      } else if (occupant) {
        if (effectiveColor(occupant) !== actor) moves.push(target)
        break
      }
    }
  }
  return moves
}

function jieqiPseudoMoves(board: Board, from: Pos): Pos[] {
  if (!inside(from)) return []
  const piece = board[from.row][from.col]
  if (!piece) return []
  const actor = effectiveColor(piece)
  const kind = effectiveKind(piece)
  if (kind === 'rook' || kind === 'cannon') return rayMoves(board, from, actor, kind === 'cannon')
  if (kind === 'horse') {
    const patterns = [[-2, -1, -1, 0], [-2, 1, -1, 0], [2, -1, 1, 0], [2, 1, 1, 0], [-1, -2, 0, -1], [1, -2, 0, -1], [-1, 2, 0, 1], [1, 2, 0, 1]]
    return patterns.filter(([, , lr, lc]) => !board[from.row + lr]?.[from.col + lc])
      .map(([dr, dc]) => ({ row: from.row + dr, col: from.col + dc })).filter(target => targetAllowed(board, actor, target))
  }
  if (kind === 'elephant') {
    return diagonal.filter(([dr, dc]) => !board[from.row + dr]?.[from.col + dc])
      .map(([dr, dc]) => ({ row: from.row + dr * 2, col: from.col + dc * 2 }))
      .filter(target => targetAllowed(board, actor, target))
      .filter(target => !piece.cover || (actor === 'red' ? target.row >= 5 : target.row <= 4))
  }
  if (kind === 'advisor') {
    return diagonal.map(([dr, dc]) => ({ row: from.row + dr, col: from.col + dc }))
      .filter(target => targetAllowed(board, actor, target))
      .filter(target => !piece.cover || (target.col >= 3 && target.col <= 5 && (actor === 'red' ? target.row >= 7 : target.row <= 2)))
  }
  if (kind === 'soldier') {
    const forward = actor === 'red' ? -1 : 1
    const crossed = actor === 'red' ? from.row <= 4 : from.row >= 5
    const steps: number[][] = [[forward, 0], ...(crossed ? [[0, -1], [0, 1]] : [])]
    return steps.map(([dr, dc]) => ({ row: from.row + dr, col: from.col + dc })).filter(target => targetAllowed(board, actor, target))
  }
  const moves = orthogonal.map(([dr, dc]) => ({ row: from.row + dr, col: from.col + dc }))
    .filter(target => targetAllowed(board, actor, target))
    .filter(target => target.col >= 3 && target.col <= 5 && (actor === 'red' ? target.row >= 7 : target.row <= 2))
  const enemyGeneral = board.findIndex(row => row[from.col]?.kind === 'general' && row[from.col]?.color !== actor)
  if (enemyGeneral >= 0) {
    const start = Math.min(from.row, enemyGeneral) + 1; const end = Math.max(from.row, enemyGeneral)
    if (Array.from({ length: end - start }, (_, offset) => board[start + offset][from.col]).every(cell => !cell)) moves.push({ row: enemyGeneral, col: from.col })
  }
  return moves
}

function visibleMove(board: Board, from: Pos, to: Pos): Board {
  const next = cloneBoard(board)
  const piece = board[from.row][from.col]!
  next[to.row][to.col] = piece.cover
    ? { color: piece.color, kind: piece.kind, cover: { ...piece.cover } }
    : { color: piece.color, kind: piece.kind }
  next[from.row][from.col] = null
  return next
}

function jieqiInCheck(board: Board, color: Color) {
  let general: Pos | null = null
  for (let row = 0; row < 10; row++) for (let col = 0; col < 9; col++) {
    const piece = board[row][col]
    if (piece?.kind === 'general' && piece.color === color) general = { row, col }
  }
  if (!general) return false
  const opponent = otherColor(color)
  return board.some((row, rowIndex) => row.some((piece, colIndex) =>
    Boolean(piece && effectiveColor(piece) === opponent && jieqiPseudoMoves(board, { row: rowIndex, col: colIndex })
      .some(target => posKey(target) === posKey(general!)))))
}

function jieqiLegalMoves(board: Board, from: Pos): Pos[] {
  const piece = board[from.row]?.[from.col]
  if (!piece) return []
  const actor = effectiveColor(piece)
  return jieqiPseudoMoves(board, from).filter(to => !jieqiInCheck(visibleMove(board, from, to), actor))
}

export function legalMoves(board: Board, from: Pos, variant: GameVariant = 'standard'): Pos[] {
  if (!inside(from) || !board[from.row]?.[from.col]) return []
  return variant === 'jieqi-mixed' ? jieqiLegalMoves(board, from) : standardLegalMoves(board, from)
}

export function applyMove(board: Board, from: Pos, to: Pos, variant: GameVariant = 'standard'): Board {
  const piece = board[from.row]?.[from.col]
  if (!piece || !inside(from) || !inside(to) || !legalMoves(board, from, variant).some(p => posKey(p) === posKey(to))) throw new Error('非法走棋')
  if (variant === 'standard') {
    const game = engine(board, piece.color)
    if (!game.move({ from: toSquare(from), to: toSquare(to) })) throw new Error('非法走棋')
    return fromEngine(game.board())
  }
  const next = cloneBoard(board)
  next[to.row][to.col] = { color: piece.color, kind: piece.kind }
  next[from.row][from.col] = null
  return next
}

export function isInCheck(board: Board, color: Color, variant: GameVariant = 'standard') {
  return variant === 'standard' ? engine(board, color).in_check() : jieqiInCheck(board, color)
}

function copyPiece(piece: Piece): Piece { return piece.cover ? { color: piece.color, kind: piece.kind, cover: { ...piece.cover } } : { color: piece.color, kind: piece.kind } }

function recordMove(board: Board, from: Pos, to: Pos, variant: GameVariant): Move {
  const captured = board[to.row][to.col]
  return { from: { ...from }, to: { ...to }, label: moveLabel(board, from, to, variant), ...(captured ? { captured: copyPiece(captured) } : {}) }
}

export function allLegalMoves(board: Board, color: Color, variant: GameVariant = 'standard'): Move[] {
  if (variant === 'standard') {
    return engine(board, color).moves({ verbose: true }).map(move => ({ from: fromSquare(move.from), to: fromSquare(move.to) }))
      .filter(move => board[move.to.row]?.[move.to.col]?.kind !== 'general').map(move => recordMove(board, move.from, move.to, variant))
  }
  return board.flatMap((row, rowIndex) => row.flatMap((piece, colIndex) => {
    if (!piece || effectiveColor(piece) !== color) return []
    const from = { row: rowIndex, col: colIndex }
    return jieqiLegalMoves(board, from).map(to => recordMove(board, from, to, variant))
  }))
}

export function resultAfterMove(board: Board, turn: Color, variant: GameVariant = 'standard'): GameStatus {
  if (variant === 'jieqi-mixed') {
    const generals = board.flat().filter((piece): piece is Piece => piece?.kind === 'general')
    if (!generals.some(piece => piece.color === 'red')) return 'black-won'
    if (!generals.some(piece => piece.color === 'black')) return 'red-won'
    if (!allLegalMoves(board, turn, variant).length) return turn === 'red' ? 'black-won' : 'red-won'
    return isInCheck(board, turn, variant) ? 'check' : 'playing'
  }
  if (!allLegalMoves(board, turn).length) return turn === 'red' ? 'black-won' : 'red-won'
  return isInCheck(board, turn) ? 'check' : 'playing'
}

export function canMove(status: GameStatus) { return status === 'playing' || status === 'check' }

export function playMove(board: Board, turn: Color, status: GameStatus, from: Pos, to: Pos, variant: GameVariant = 'standard') {
  const piece = board[from.row]?.[from.col]
  if (!canMove(status) || !piece || effectiveColor(piece) !== turn) throw new Error('尚未轮到你或对局已结束')
  const move = recordMove(board, from, to, variant)
  const next = applyMove(board, from, to, variant)
  const nextTurn = otherColor(turn)
  return { board: next, turn: nextTurn, status: resultAfterMove(next, nextTurn, variant), move }
}
