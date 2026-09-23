import { it, expect } from 'vitest'
import { initializeApp, deleteApp } from 'firebase/app'
import { connectDatabaseEmulator, getDatabase, ref, set, get, runTransaction, onValue, goOffline, serverTimestamp } from 'firebase/database'
import { initialBoard, fromSquare, normalizeBoard } from '../src/game'
import { transitionRoom, type Room } from '../src/firebase'
import { actMatch, type MatchAction } from '../src/match'

const host = process.env.FIREBASE_DATABASE_EMULATOR_HOST
it.skipIf(!host)('synchronizes two authenticated clients and rejects stale/illegal moves', async () => {
  const project = 'demo-xiangqi'
  const apps = ['red', 'black'].map(side => initializeApp({ projectId: project, databaseURL: 'https://' + project + '-default-rtdb.firebaseio.com' }, side + Date.now()))
  const dbs = apps.map((app, i) => {
    const db = getDatabase(app)
    const [hostname, port] = host!.split(':')
    connectDatabaseEmulator(db, hostname, Number(port), { mockUserToken: { sub: i === 0 ? 'red' : 'black' } })
    return db
  })
  const path = 'rooms/' + Math.floor(100000 + Math.random() * 900000)
  const red = ref(dbs[0], path); const black = ref(dbs[1], path)
  let stop = () => {}
  try {
    await set(red, { redUid: 'red', board: initialBoard(), turn: 'red', version: 0, status: 'waiting', moves: [], createdAt: 1, updatedAt: 1, presence: { red: { online: true, lastSeen: 1 }, black: { online: false, lastSeen: 0 } } })
    await get(black)
    const joined = await runTransaction(black, room => room ? { ...room, blackUid: 'black', status: 'playing', version: 1, gameId: 1, operation: { type: 'join', uid: 'black' } } : room)
    expect(joined.committed).toBe(true)
    const observed = new Promise<Room>((resolve, reject) => {
      stop = onValue(black, snapshot => { if (snapshot.val()?.version === 2) resolve(snapshot.val()) }, reject)
    })
    await get(red)
    const first = await runTransaction(red, room => transitionRoom(room, 'red', fromSquare('a3'), fromSquare('a4'), 1))
    expect(first.committed).toBe(true)
    const remote = await observed
    expect(normalizeBoard(remote.board)[5][0]?.kind).toBe('soldier')
    expect(remote.moves[0]).not.toHaveProperty('captured')
    const stale = await runTransaction(black, room => transitionRoom(room, 'black', fromSquare('a6'), fromSquare('a5'), 0))
    expect(stale.committed).toBe(false)
    const illegal = await runTransaction(black, room => transitionRoom(room, 'black', fromSquare('a6'), fromSquare('a7'), 2))
    expect(illegal.committed).toBe(false)
    const reply = await runTransaction(black, room => transitionRoom(room, 'black', fromSquare('a6'), fromSquare('a5'), 2))
    expect(reply.committed).toBe(true)
    expect((await get(red)).val().version).toBe(3)
    const apply = async (side: 'red' | 'black', action: MatchAction) => {
      const target = side === 'red' ? red : black
      await get(target)
      return runTransaction(target, room => {
        if (!room) return
        const next = actMatch(room, side, side, action, Date.now())
        if (action.type === 'request' && next.request) next.request.createdAt = serverTimestamp() as unknown as number
        return { ...next, operation: { type: action.type, uid: side } }
      }, { applyLocally: false })
    }
    await apply('black', { type: 'request', kind: 'undo', id: 'undo-1' })
    const requested = (await get(red)).val()
    const mutatedRequest = structuredClone(requested)
    mutatedRequest.board[0][0] = null
    mutatedRequest.request.id = 'mutated'
    mutatedRequest.request.createdAt = serverTimestamp()
    mutatedRequest.version++
    mutatedRequest.request.version++
    await expect(set(black, mutatedRequest)).rejects.toThrow()
    const forged = actMatch(requested, 'red', 'red', { type: 'accept', id: 'undo-1' }, Date.now())
    await expect(set(black, { ...forged, operation: { type: 'accept', uid: 'black' } })).rejects.toThrow()
    await apply('red', { type: 'reject', id: 'undo-1' })
    expect(Object.values((await get(black)).val().moves)).toHaveLength(2)
    await apply('black', { type: 'request', kind: 'undo', id: 'undo-2' })
    await apply('red', { type: 'accept', id: 'undo-2' })
    expect(Object.values((await get(black)).val().moves)).toHaveLength(1)
    await apply('red', { type: 'request', kind: 'draw', id: 'draw-timeout' })
    const beforeDeadline = (await get(black)).val()
    const lateAccept = actMatch(beforeDeadline, 'black', 'black', { type: 'accept', id: 'draw-timeout' }, Date.now())
    await new Promise(resolve => setTimeout(resolve, 10100))
    // Deliberately bypass client deadline checking; server rules must still deny.
    await expect(set(black, { ...lateAccept, operation: { type: 'accept', uid: 'black' } })).rejects.toThrow()
    const restoredClientRequest = (await get(red)).val().request
    expect(restoredClientRequest.createdAt).toBe(beforeDeadline.request.createdAt)
    await apply('black', { type: 'expire', id: 'draw-timeout' })
    await apply('red', { type: 'request', kind: 'draw', id: 'draw-ok' })
    await apply('black', { type: 'accept', id: 'draw-ok' })
    expect((await get(red)).val().status).toBe('draw')
    await expect(set(black, { ...((await get(black)).val()), status: 'playing', version: 999 })).rejects.toThrow()
    const ended = (await get(red)).val()
    await set(red, { ...ended, board: initialBoard(), status: 'playing', turn: 'red', version: ended.version + 1, gameId: 2, history: null, moves: null, request: null, reason: null, resolution: null, operation: { type: 'restart', uid: 'red' } })
    const restarted = (await get(red)).val()
    await expect(set(red, { ...restarted, version: restarted.version + 1, status: 'red-won', reason: 'resign', operation: { type: 'resign', uid: 'red' } })).rejects.toThrow()
    await apply('red', { type: 'resign', gameId: 2 })
    expect((await get(black)).val().status).toBe('black-won')
  } finally {
    stop()
    // Emulator-only admin cleanup; production rules intentionally disallow room deletion.
    await fetch(`http://${host}/${path}.json?ns=${project}-default-rtdb`, { method: 'DELETE', headers: { Authorization: 'Bearer owner' } })
    dbs.forEach(goOffline)
    await Promise.all(apps.map(deleteApp))
  }
}, 40000)
