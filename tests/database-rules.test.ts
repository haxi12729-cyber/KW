import { expect, it } from 'vitest'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'

it('ships the exact generated security rules', () => {
  const generated = JSON.parse(execFileSync(process.execPath, ['scripts/database-rules.mjs'], { encoding: 'utf8' }))
  const shipped = JSON.parse(readFileSync('database.rules.json', 'utf8'))
  expect(shipped).toEqual(generated)
  expect(shipped.rules.rooms.$roomId['.write']).toContain("now >= data.child('request/createdAt').val() + 10000")
})
