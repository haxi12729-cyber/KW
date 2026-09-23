import { describe, expect, it } from 'vitest'
import { FirebaseTimeoutError, firebaseErrorMessage, isRoomOwner, joinFailureMessage, type Room, withFirebaseTimeout } from './firebase'

describe('Firebase connection feedback', () => {
  it('rejects requests that exceed the configured timeout', async () => {
    await expect(withFirebaseTimeout(new Promise<void>(() => {}), 1)).rejects.toBeInstanceOf(FirebaseTimeoutError)
  })

  it('maps Firebase connection and permission failures to actionable messages', () => {
    expect(firebaseErrorMessage({ code: 'database/permission-denied' })).toContain('权限')
    expect(firebaseErrorMessage({ code: 'auth/network-request-failed' })).toContain('网络')
    expect(firebaseErrorMessage(new FirebaseTimeoutError())).toContain('超时')
  })

  it('explains each failed room-join state without a generic fallback', () => {
    expect(joinFailureMessage({ kind: 'not-found' })).toContain('不存在')
    expect(joinFailureMessage({ kind: 'full' })).toContain('两位玩家')
    expect(joinFailureMessage({ kind: 'reserved', color: 'red', remainingMs: 61000 })).toContain('61 秒')
  })

  it('keeps room ownership independent from the red and black seats', () => {
    expect(isRoomOwner({ ownerUid: 'black-host', ownerSeat: 'black' } as Room, 'black-host')).toBe(true)
    expect(isRoomOwner({ ownerUid: 'black-host', ownerSeat: 'black' } as Room, 'red-guest')).toBe(false)
    expect(isRoomOwner({ redUid: 'legacy-red-host' } as Room, 'legacy-red-host')).toBe(true)
  })
})
