import { canMove, cloneBoard, playMove, type Board, type Color, type GameStatus, type Move, type Pos } from './game'

export const REQUEST_MS = 10_000
export const other = (color: Color): Color => color === 'red' ? 'black' : 'red'
export type Position = { board: Board; turn: Color; status: GameStatus; moves: Move[] }
export type MatchRequest = { id: string; kind: 'undo' | 'draw'; by: Color; uid: string; version: number; createdAt: number }
export type Match = Position & {
  version: number
  gameId?: number
  history?: string[]
  request?: MatchRequest | null
  reason?: 'agreement' | 'resign' | null
  resolution?: { id: string; outcome: 'accepted' | 'rejected' | 'cancelled' | 'expired' } | null
}
export type MatchAction =
  | { type: 'request'; kind: 'undo' | 'draw'; id: string }
  | { type: 'accept' | 'reject' | 'cancel' | 'expire'; id: string }
  | { type: 'resign'; gameId: number }

export const activeRequest = (match: Match, now: number) => match.request && now < match.request.createdAt + REQUEST_MS ? match.request : null
export function savePosition(match: Position): Position {
  return { board: cloneBoard(match.board), turn: match.turn, status: match.status, moves: Object.values(match.moves || {}) }
}
export function moveMatch(match: Match, from: Pos, to: Pos, now: number): Match {
  if (activeRequest(match, now)) throw new Error('请先处理对局请求')
  const next = playMove(match.board, match.turn, match.status, from, to)
  return { ...match, board: next.board, turn: next.turn, status: next.status,
    moves: [...Object.values(match.moves || {}), next.move].slice(-80),
    history: [...Object.values(match.history || {}), JSON.stringify(savePosition(match))].slice(-80),
    version: match.version + 1, request: null, reason: null }
}
export function actMatch(match: Match, actor: Color, uid: string, action: MatchAction, now: number): Match {
  if (!canMove(match.status)) throw new Error('对局尚未开始或已经结束')
  const next = { ...match, version: match.version + 1 }
  const request = match.request
  if (action.type === 'resign') {
    if (action.gameId !== (match.gameId || 0)) throw new Error('对局已重开，请重新确认')
    return { ...next, status: other(actor) === 'red' ? 'red-won' : 'black-won', reason: 'resign', request: null }
  }
  if (action.type === 'request') {
    if (activeRequest(match, now)) throw new Error('已有请求等待回应')
    if (action.kind === 'undo' && (actor !== other(match.turn) || !Object.values(match.history || {}).length)) throw new Error('只能申请撤回自己刚走的一步')
    return { ...next, resolution: null, request: { id: action.id, kind: action.kind, by: actor, uid, version: next.version, createdAt: now } }
  }
  if (!request || request.id !== action.id || request.version !== match.version) throw new Error('请求已失效')
  if (action.type === 'expire') {
    if (activeRequest(match, now)) throw new Error('请求尚未到期')
    return { ...next, request: null, resolution: { id: request.id, outcome: 'expired' } }
  }
  if (!activeRequest(match, now)) throw new Error('请求已超时')
  if (action.type === 'cancel' ? actor !== request.by : actor === request.by) throw new Error('只能由对应玩家处理请求')
  const outcome = action.type === 'accept' ? 'accepted' : action.type === 'reject' ? 'rejected' : 'cancelled'
  const resolved: Match = { ...next, request: null, resolution: { id: request.id, outcome } }
  if (action.type !== 'accept') return resolved
  if (request.kind === 'draw') return { ...resolved, status: 'draw', reason: 'agreement' }
  const history = Object.values(match.history || {})
  const prior = history.at(-1)
  if (!prior) throw new Error('没有可恢复的历史局面')
  return { ...resolved, ...savePosition(JSON.parse(prior) as Position), history: history.slice(0, -1), reason: null }
}
