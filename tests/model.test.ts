import { describe, expect, test } from 'claude-code/testing'

import { retryAfterMsOf } from '../hooks/github/client'
import { armCheck, armComment, contextOf, withArmed } from '../hooks/model/armed'
import { ageOf, BACKOFF_MS, isPrMovingCommand, nextPollMs, rateLimitWaitMs } from '../hooks/model/cadence'
import { hasTurnedRed, rollupOf } from '../hooks/model/rollup'
import { orderedComments, unreadOf } from '../hooks/model/unread'
import { checkOf, commentOf, prOf } from './fixtures'

describe('rollup', () => {
  test('counts and orders failing first', async () => {
    const rollup = rollupOf([
      checkOf({ id: 'a', name: 'b-pass', state: 'pass' }),
      checkOf({ id: 'b', name: 'z-fail', state: 'fail' }),
      checkOf({ id: 'c', name: 'a-pending', state: 'pending' }),
      checkOf({ id: 'd', name: 'a-fail', state: 'fail' }),
    ])

    expect([rollup.pass, rollup.fail, rollup.pending, rollup.overall]).toEqual([1, 2, 1, 'fail'])
    expect(rollup.ordered.map(check => check.name)).toEqual(['a-fail', 'z-fail', 'a-pending', 'b-pass'])
    expect(rollupOf([]).overall).toBe('none')
    expect(rollupOf([checkOf({ state: 'pending' })]).overall).toBe('pending')
  })

  test('turns red only on a change within one PR, never on the first poll', async () => {
    expect(hasTurnedRed(null, { prNumber: 7, overall: 'fail' })).toBe(false)
    expect(hasTurnedRed({ prNumber: 7, overall: 'pending' }, { prNumber: 7, overall: 'fail' })).toBe(true)
    expect(hasTurnedRed({ prNumber: 7, overall: 'fail' }, { prNumber: 7, overall: 'fail' })).toBe(false)
    expect(hasTurnedRed({ prNumber: 6, overall: 'pass' }, { prNumber: 7, overall: 'fail' })).toBe(false)
  })
})

describe('unread', () => {
  const comments = [
    commentOf({ id: 'old', createdAt: 100 }),
    commentOf({ id: 'mine', author: 'JReed91', createdAt: 500 }),
    commentOf({ id: 'bot', author: 'coderabbitai[bot]', createdAt: 600 }),
    commentOf({ id: 'new', createdAt: 700 }),
  ]

  test("is newer than Mark read and not the viewer's own; bots count", async () => {
    expect(unreadOf(comments, 200, 'jreed91').map(c => c.id)).toEqual(['bot', 'new'])
    expect(unreadOf(comments, 0, 'jreed91')).toHaveLength(3)
  })

  test('orders unread first, newest first', async () => {
    expect(orderedComments(comments, 200, 'jreed91').map(row => [row.comment.id, row.isUnread])).toEqual([
      ['new', true],
      ['bot', true],
      ['mine', false],
      ['old', false],
    ])
  })
})

describe('armed context', () => {
  test('a failing check carries its log tail', async () => {
    const item = armCheck(prOf(), checkOf({ state: 'fail', description: '2 failed' }), 'Error: boom')

    expect(item.id).toBe('check:c1')
    expect(item.text).toContain('PR #7')
    expect(item.text).toContain('Error: boom')
    expect(armCheck(prOf(), checkOf(), null).text).toContain('could not be fetched')
  })

  test('a comment carries its file, line, hunk and body', async () => {
    const item = armComment(prOf(), commentOf())

    expect(item.label).toBe('app.ts:12')
    expect(item.text).toContain('src/app.ts:12')
    expect(item.text).toContain('```diff')
    expect(item.text).toContain('Please rename this.')
  })

  test('arming twice keeps one', async () => {
    const item = armComment(prOf(), commentOf())
    expect(withArmed(withArmed([], item), item)).toHaveLength(1)
  })

  test('fits the room, cutting then dropping', async () => {
    const big = { id: 'a', label: 'a', text: 'x'.repeat(1000) }
    const small = { id: 'b', label: 'b', text: 'y'.repeat(100) }

    expect(contextOf([big, small], 5000).blocks).toEqual([big.text, small.text])

    const cut = contextOf([big, small], 600)
    expect(cut.blocks).toHaveLength(1)
    expect(cut.blocks[0]).toContain('cut to fit')
    expect(cut.dropped.map(item => item.id)).toEqual(['b'])
  })
})

describe('cadence', () => {
  test('polls faster while checks run, backs off on failure', async () => {
    expect(nextPollMs('pending')).toBe(20_000)
    expect(nextPollMs('settled')).toBe(90_000)
    expect(nextPollMs('failed')).toBe(300_000)
  })

  test('spots commands that move the PR or branch', async () => {
    expect(isPrMovingCommand('git push -u origin feat')).toBe(true)
    expect(isPrMovingCommand('git -C repo checkout main')).toBe(true)
    expect(isPrMovingCommand('npm test && git switch -c x')).toBe(true)
    expect(isPrMovingCommand('gh pr create --fill')).toBe(true)
    expect(isPrMovingCommand('git status')).toBe(false)
    expect(isPrMovingCommand('ls')).toBe(false)
  })

  test('ages', async () => {
    expect([ageOf(30_000), ageOf(240_000), ageOf(7_200_000)]).toEqual(['30s', '4m', '2h'])
  })
})

describe('rate limit wait', () => {
  test('reads retry-after, else the reset when the budget is spent', async () => {
    expect(retryAfterMsOf({ 'retry-after': '60' }, 0)).toBe(60_000)
    expect(retryAfterMsOf({ 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': '1000' }, 400_000)).toBe(600_000)
    expect(retryAfterMsOf({ 'x-ratelimit-remaining': '12', 'x-ratelimit-reset': '1000' }, 0)).toBeNull()
    expect(rateLimitWaitMs(null)).toBe(BACKOFF_MS)
    expect(rateLimitWaitMs(5_000)).toBe(30_000)
    expect(rateLimitWaitMs(600_000)).toBe(601_000)
    expect(rateLimitWaitMs(10 * 3_600_000)).toBe(3_600_000)
  })
})
