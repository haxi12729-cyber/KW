import { initializeApp } from 'firebase/app'
import { getAuth, signInAnonymously, type User } from 'firebase/auth'
import { getDatabase, onDisconnect, onValue, ref, runTransaction, serverTimestamp, update, type Unsubscribe } from 'firebase/database'
import { initialBoard, normalizeBoard, type Color, type Move } from './game'
import { actMatch, moveMatch, type Match, type MatchAction } from './match'

export type Room = Match & {
  redUid: string
  blackUid?: string
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
const db = app ? getDatabase(app) : null
let serverOffset = 0
export const serverNow = () => Date.now() + serverOffset
if (db) onValue(ref(db, '.info/serverTimeOffset'), snap => { serverOffset = Number(snap.val()) || 0 })

export async function getPlayer(): Promise<User> {
  if (!auth) throw new Error('尚未配置 Firebase')
  await auth.authStateReady()
  if (auth.currentUser) return auth.currentUser
  return (await signInAnonymously(auth)).user
}
const makeCode = () => String(Math.floor(100000 + Math.random() * 900000))
const timestamp = serverNow

export async function createRoom(uid: string): Promise<string> {
  if (!db) throw new Error('尚未配置 Firebase')
  for (let attempt = 0; attempt < 8; attempt++) {
    const code = makeCode(); const roomRef = ref(db, `rooms/${code}`)
    const result = await runTransaction(roomRef, current => current ?? ({ redUid: uid, board: initialBoard(), turn: 'red', version: 0, gameId: 0, status: 'waiting', moves: [], createdAt: timestamp(), updatedAt: timestamp(), presence: { red: { online: true, lastSeen: timestamp() }, black: { online: false, lastSeen: 0 } } satisfies Room['presence'] }), { applyLocally: false })
    if (result.committed && result.snapshot.val()?.redUid === uid) return code
  }
  throw new Error('暂时无法生成房间号，请重试')
}

export async function joinRoom(code: string, uid: string): Promise<Room> {
  if (!db) throw new Error('尚未配置 Firebase')
  const roomRef = ref(db, `rooms/${code}`)
  const result = await runTransaction(roomRef, (current: Room | null) => {
    if (!current) return
    if (current.redUid === uid || current.blackUid === uid) return current
    const black = current.presence?.black
    const releasable = current.blackUid && !black?.online && timestamp() - (black.lastSeen || 0) > 120000
    if (!current.blackUid || releasable) return { ...current, blackUid: uid, status: current.status === 'waiting' ? 'playing' : current.status, request: null, history: [], gameId: (current.gameId || 0) + 1, version: current.version + 1, operation: { type: 'join', uid }, presence: { ...current.presence, black: { online: true, lastSeen: timestamp() } }, updatedAt: timestamp() }
  }, { applyLocally: false })
  if (!result.committed) throw new Error('房间不存在、已满员或对手席位仍在保留中')
  return result.snapshot.val() as Room
}

export function subscribeRoom(code: string, listener: (room: Room | null) => void, onError?: (error: Error) => void): Unsubscribe {
  if (!db) throw new Error('尚未配置 Firebase')
  return onValue(ref(db, `rooms/${code}`), snap => {
    const room = snap.val() as Room | null
    listener(room ? { ...room, board: normalizeBoard(room.board), moves: Object.values(room.moves || {}), history: Object.values(room.history || {}) } : null)
  }, onError)
}
export function roleFor(room: Room, uid: string): Color | null { return room.redUid === uid ? 'red' : room.blackUid === uid ? 'black' : null }

export async function setPresence(code: string, color: Color, online: boolean) {
  if (!db) return
  const presenceRef = ref(db, `rooms/${code}/presence/${color}`)
  await update(presenceRef, { online, lastSeen: serverTimestamp() })
  if (online) await onDisconnect(presenceRef).update({ online: false, lastSeen: serverTimestamp() })
}

export function transitionRoom(current: Room | null, uid: string, from: Move['from'], to: Move['to'], expectedVersion: number): Room | undefined {
  if (!current || current.version !== expectedVersion || !current.blackUid || roleFor(current, uid) !== current.turn) return
  try {
    const next = moveMatch({ ...current, board: normalizeBoard(current.board) }, from, to, timestamp())
    return { ...current, ...next, operation: { type: 'move', uid }, updatedAt: timestamp() }
  } catch { return }
}

export async function submitMove(code: string, uid: string, from: Move['from'], to: Move['to'], expectedVersion: number) {
  if (!db) throw new Error('尚未配置 Firebase')
  const result = await runTransaction(ref(db, `rooms/${code}`), (current: Room | null) => {
    return transitionRoom(current, uid, from, to, expectedVersion)
  }, { applyLocally: false })
  if (!result.committed) throw new Error('走棋未提交：局面已变化或尚未轮到你')
}

export async function restartRoom(code: string, uid: string) {
  if (!db) return
  const result = await runTransaction(ref(db, `rooms/${code}`), (current: Room | null) => {
    if (!current || current.redUid !== uid) return
    return { ...current, board: initialBoard(), turn: 'red', status: current.blackUid ? 'playing' : 'waiting', moves: [], history: [], request: null, reason: null, resolution: null, gameId: (current.gameId || 0) + 1, operation: { type: 'restart', uid }, version: current.version + 1, updatedAt: timestamp() }
  }, { applyLocally: false })
  if (!result.committed) throw new Error('只有红方房主可以重新开始')
}

export async function submitAction(code: string, uid: string, action: MatchAction, expectedVersion: number) {
  if (!db) throw new Error('尚未配置 Firebase')
  const result = await runTransaction(ref(db, `rooms/${code}`), (current: Room | null) => {
    if (!current || !current.blackUid) return
    const actor = roleFor(current, uid)
    if (!actor || (action.type !== 'resign' && action.type !== 'expire' && current.version !== expectedVersion)) return
    try {
      const next = actMatch(current, actor, uid, action, timestamp())
      if (action.type === 'request' && next.request) next.request.createdAt = serverTimestamp() as unknown as number
      return { ...current, ...next, operation: { type: action.type, uid }, updatedAt: timestamp() }
    } catch { return }
  }, { applyLocally: false })
  if (!result.committed) throw new Error('操作未提交：请求已失效、超时或局面已变化')
}
