import { describe, expect, test } from 'claude-code/testing'

import { armCheck, armComment, contextOf } from '../hooks/model/armed'
import { hasTurnedRed, rollupOf } from '../hooks/model/rollup'
import { checkOf, commentOf, prOf } from './fixtures'

describe('armed edges', () => {
  test('a log holding a fence is fenced with four ticks; no url, no link', async () => {
    const item = armCheck(prOf(), checkOf({ url: null }), 'before\n```\ninside\n```')

    expect(item.text).toContain('Check: ci / test\n')
    expect(item.text).toContain('````\nbefore\n```\ninside\n```\n````')
  })

  test('a review summary: its verdict, no file, no hunk, no text', async () => {
    const item = armComment(prOf(), commentOf({ kind: 'review', author: 'alice', path: null, line: null, diffHunk: null, body: '  ', reviewState: 'APPROVED' }))

    expect(item.label).toBe('@alice')
    expect(item.text).toContain('@alice (approved): ')
    expect(item.text).not.toContain('```diff')
    expect(item.text.endsWith('(no text)')).toBe(true)
  })

  test('a file comment with no line names the file alone', async () => {
    const item = armComment(prOf(), commentOf({ path: 'src/app.ts', line: null }))

    expect(item.label).toBe('app.ts')
    expect(item.text).toContain(' on src/app.ts: ')
  })

  test('the room defaults to the cap', async () => {
    const item = armCheck(prOf(), checkOf(), 'log')

    expect(contextOf([item])).toEqual({ blocks: [item.text], dropped: [] })
  })
})

describe('rollup edges', () => {
  test('all green passes; skipped alone is none', async () => {
    expect(rollupOf([checkOf({ state: 'pass' }), checkOf({ id: 'c2', state: 'skip' })]).overall).toBe('pass')
    expect(rollupOf([checkOf({ state: 'skip' })]).overall).toBe('none')
    expect(hasTurnedRed({ prNumber: 7, overall: 'pass' }, { prNumber: 7, overall: 'pass' })).toBe(false)
  })
})
