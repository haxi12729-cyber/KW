import { expect, it } from 'vitest'
import { statusText } from './App'

it.each([
  ['red', '将军！红方被将军，请应将'],
  ['black', '将军！黑方被将军，请应将'],
] as const)('names the checked %s side', (color, expected) => {
  expect(statusText('check', color)).toBe(expected)
})
