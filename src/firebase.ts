import { initializeApp } from 'firebase/app'
import { getAuth, signInAnonymously, type User } from 'firebase/auth'
import { get, getDatabase, onDisconnect, onValue, ref, runTransaction, serverTimestamp, update, type Unsubscribe } from 'firebase/database'
import { initialBoardFor, normalizeBoard, normalizeVariant, type Color, type GameVariant, type Move } from './game'
import { actMatch, moveMatch, type Match, type MatchAction } from './match'

export type Room = Match & {
  redUid?: string
  blackUid?: string
  ownerUid?: string
  ownerSeat?: Color
  operation?: { type: string; uid: string }
  createdAt: number
  updatedAt: number
  presence: Record<Color, { online: boolean; lastSeen: number }>
}

const config = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  databaseURL: import.meta.env.VITE_FIREBASE_DATABASE_URL,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
}
export const firebaseReady = Boolean(config.apiKey && config.databaseURL && config.projectId)
const app = firebaseReady ? initializeApp(config) : null
const auth = app ? getAuth(app) : null
// Firebase uses WebSocket when available and automatically falls back to a
// compatible transport, giving ordinary mobile connections lower move latency.
const db = app ? getDatabase(app) : null
export const FIREBASE_TIMEOUT_MS = 15_000

export class FirebaseTimeoutError extends Error {
  constructor() { super('连接 Firebase 超时，请检查网络后重试。'); this.name = 'FirebaseTimeoutError' }
}

export function withFirebaseTimeout<T>(task: Promise<T>, timeoutMs = FIREBASE_TIMEOUT_MS): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new FirebaseTimeoutError()), timeoutMs)
    task.then(value => { clearTimeout(timer); resolve(value) }, error => { clearTimeout(timer); reject(error) })
  })
}

export function firebaseErrorMessage(error: unknown, fallback = '操作未完成，请重试。') {
  if (error instanceof FirebaseTimeoutError) return error.message
  const code = error && typeof error === 'object' && 'code' in error ? String(error.code) : ''
  if (code.includes('permission-denied')) return '没有操作此房间的权限，请确认房间号或重新加入。'
  if (code.includes('network') || code.includes('unavailable')) return 'Firebase 网络连接失败，请检查网络后重试。'
  return error instanceof Error && error.message ? error.message : fallback
}
let serverOffset = 0
export const serverNow = () => Date.now() + serverOffset
if (db) onValue(ref(db, '.info/serverTimeOffset'), snap => { serverOffset = Number(snap.val()) || 0 })

export async function getPlayer(): Promise<User> {
  if (!auth) throw new Error('尚未配置 Firebase')
  return withFirebaseTimeout((async () => {
    await auth.authStateReady()
    if (auth.currentUser) return auth.currentUser
    return (await signInAnonymously(auth)).user
  })())
}
const makeCode = () => String(Math.floor(100000 + Math.random() * 900000))
const timestamp = serverNow
const randomColor = (): Color => {
  const value = new Uint32Array(1)
  crypto.getRandomValues(value)
  return value[0] % 2 === 0 ? 'red' : 'black'
}
const ownerSeatFor = (room: Room): Color => room.ownerSeat === 'black' ? 'black' : 'red'
const opponentSeatFor = (room: Room): Color => ownerSeatFor(room) === 'red' ? 'black' : 'red'
const normalizeRoom = (room: Room): Room => ({
  ...room,
  variant: normalizeVariant(room.variant),
  board: normalizeBoard(room.board),
  moves: Object.values(room.moves || {}),
  history: Object.values(room.history || {}),
})
export const isRoomOwner = (room: Room, uid: string) => (room.ownerUid || room.redUid) === uid
export type JoinRoomResult =
  | { kind: 'joined'; room: Room; color: Color }
  | { kind: 'not-found' }
  | { kind: 'full' }
  | { kind: 'reserved'; color: Color; remainingMs: number }

function joinFailure(room: Room | null, uid: string): Exclude<JoinRoomResult, { kind: 'joined' }> | null {
  if (!room) return { kind: 'not-found' }
  if (roleFor(room, uid)) return null
  const color = opponentSeatFor(room)
  const occupiedUid = color === 'red' ? room.redUid : room.blackUid
  if (!occupiedUid) return null
  const presence = room.presence?.[color]
  const elapsed = timestamp() - (presence?.lastSeen || 0)
  if (presence?.online || elapsed <= 120000) return presence?.online
    ? { kind: 'full' }
    : { kind: 'reserved', color, remainingMs: Math.max(0, 120000 - elapsed) }
  return null
}
export function joinFailureMessage(result: Exclude<JoinRoomResult, { kind: 'joined' }>) {
  if (result.kind === 'not-found') return '房间不存在，请核对 6 位房间号。'
  if (result.kind === 'full') return '该房间已有两位玩家，暂不支持观战。'
  return `${result.color === 'red' ? '红方' : '黑方'}席位仍在保留中，请在 ${Math.max(1, Math.ceil(result.remainingMs / 1000))} 秒后重试。`
}

export async function createRoom(uid: string, variant: GameVariant = 'standard'): Promise<string> {
  if (!db) throw new Error('尚未配置 Firebase')
  for (let attempt = 0; attempt < 8; attempt++) {
    const code = makeCode(); const roomRef = ref(db, `rooms/${code}`)
    const ownerSeat = randomColor()
    const result = await withFirebaseTimeout(runTransaction(roomRef, current => current ?? ({
      ...(ownerSeat === 'red' ? { redUid: uid } : { blackUid: uid }),
      ownerUid: uid, ownerSeat, board: initialBoardFor(variant), variant, turn: 'red', version: 0, gameId: 0, status: 'waiting', moves: [],
      createdAt: timestamp(), updatedAt: timestamp(),
      presence: {
        red: { online: ownerSeat === 'red', lastSeen: ownerSeat === 'red' ? timestamp() : 0 },
        black: { online: ownerSeat === 'black', lastSeen: ownerSeat === 'black' ? timestamp() : 0 },
      } satisfies Room['presence'],
    }), { applyLocally: false }))
    if (result.committed && isRoomOwner(result.snapshot.val() as Room, uid)) return code
  }
  throw new Error('暂时无法生成房间号，请重试')
}

export async function joinRoom(code: string, uid: string): Promise<JoinRoomResult> {
  if (!db) throw new Error('尚未配置 Firebase')
  const roomRef = ref(db, `rooms/${code}`)
  const before = (await withFirebaseTimeout(get(roomRef))).val() as Room | null
  const initialRoom = before && normalizeRoom(before)
  if (initialRoom && roleFor(initialRoom, uid)) return { kind: 'joined', room: initialRoom, color: roleFor(initialRoom, uid)! }
  const initialFailure = joinFailure(initialRoom, uid)
  if (initialFailure) return initialFailure
  const result = await withFirebaseTimeout(runTransaction(roomRef, (current: Room | null) => {
    // RTDB transactions may call this updater before the local cache has the
    // result of the preceding read. Use that read as a proposal only; the
    // server still retries this transaction against its latest room state.
    const room = current || initialRoom
    if (!room) return
    if (roleFor(room, uid)) return room
    if (joinFailure(room, uid)) return
    const color = opponentSeatFor(room)
    return {
      ...room,
      variant: normalizeVariant(room.variant),
      ...(color === 'red' ? { redUid: uid } : { blackUid: uid }),
      status: room.status === 'waiting' ? 'playing' : room.status,
      request: null, history: [], gameId: (room.gameId || 0) + 1, version: room.version + 1,
      operation: { type: 'join', uid },
      presence: { ...room.presence, [color]: { online: true, lastSeen: timestamp() } },
      updatedAt: timestamp(),
    }
  }, { applyLocally: false }))
  const room = result.snapshot.val() as Room | null
  if (result.committed && room) {
    const normalized = normalizeRoom(room)
    const color = roleFor(normalized, uid)
    if (color) return { kind: 'joined', room: normalized, color }
  }
  return joinFailure(room && normalizeRoom(room), uid) || { kind: 'full' }
}

export function subscribeRoom(code: string, listener: (room: Room | null) => void, onError?: (error: Error) => void): Unsubscribe {
  if (!db) throw new Error('尚未配置 Firebase')
  let receivedInitial = false
  const timeout = setTimeout(() => { if (!receivedInitial) onError?.(new FirebaseTimeoutError()) }, FIREBASE_TIMEOUT_MS)
  const unsubscribe = onValue(ref(db, `rooms/${code}`), snap => {
    receivedInitial = true; clearTimeout(timeout)
    const room = snap.val() as Room | null
    listener(room ? normalizeRoom(room) : null)
  }, error => { clearTimeout(timeout); onError?.(error) })
  return () => { clearTimeout(timeout); unsubscribe() }
}
export function roleFor(room: Room, uid: string): Color | null { return room.redUid === uid ? 'red' : room.blackUid === uid ? 'black' : null }

export async function setPresence(code: string, color: Color, online: boolean) {
  if (!db) return
  const presenceRef = ref(db, `rooms/${code}/presence/${color}`)
  await withFirebaseTimeout(update(presenceRef, { online, lastSeen: serverTimestamp() }))
  if (online) await withFirebaseTimeout(onDisconnect(presenceRef).update({ online: false, lastSeen: serverTimestamp() }))
}

export function transitionRoom(current: Room | null, uid: string, from: Move['from'], to: Move['to'], expectedVersion: number): Room | undefined {
  if (!current || current.version !== expectedVersion || !current.blackUid || roleFor(current, uid) !== current.turn) return
  try {
    const next = moveMatch({ ...current, variant: normalizeVariant(current.variant), board: normalizeBoard(current.board) }, from, to, timestamp())
    return { ...current, ...next, operation: { type: 'move', uid }, updatedAt: timestamp() }
  } catch { return }
}

export async function submitMove(code: string, uid: string, from: Move['from'], to: Move['to'], expectedVersion: number) {
  if (!db) throw new Error('尚未配置 Firebase')
  const result = await withFirebaseTimeout(runTransaction(ref(db, `rooms/${code}`), (current: Room | null) => {
    return transitionRoom(current, uid, from, to, expectedVersion)
  }))
  if (!result.committed) throw new Error('走棋未提交：局面已变化或尚未轮到你')
}

export async function restartRoom(code: string, uid: string) {
  if (!db) return
  const result = await withFirebaseTimeout(runTransaction(ref(db, `rooms/${code}`), (current: Room | null) => {
    if (!current || !isRoomOwner(current, uid)) return
    const variant = normalizeVariant(current.variant)
    return { ...current, variant, board: initialBoardFor(variant), turn: 'red', status: current.blackUid ? 'playing' : 'waiting', moves: [], history: [], request: null, reason: null, resolution: null, gameId: (current.gameId || 0) + 1, operation: { type: 'restart', uid }, version: current.version + 1, updatedAt: timestamp() }
  }, { applyLocally: false }))
  if (!result.committed) throw new Error('只有房主可以重新开始')
}

export async function submitAction(code: string, uid: string, action: MatchAction, expectedVersion: number) {
  if (!db) throw new Error('尚未配置 Firebase')
  const result = await withFirebaseTimeout(runTransaction(ref(db, `rooms/${code}`), (current: Room | null) => {
    if (!current || !current.blackUid) return
    const actor = roleFor(current, uid)
    if (!actor || (action.type !== 'resign' && action.type !== 'expire' && current.version !== expectedVersion)) return
    try {
      const next = actMatch(current, actor, uid, action, timestamp())
      if (action.type === 'request' && next.request) next.request.createdAt = serverTimestamp() as unknown as number
      return { ...current, ...next, operation: { type: action.type, uid }, updatedAt: timestamp() }
    } catch { return }
  }, { applyLocally: false }))
  if (!result.committed) throw new Error('操作未提交：请求已失效、超时或局面已变化')
}
