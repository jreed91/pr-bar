import { describe, expect, test } from 'claude-code/testing'

import { tailOf } from '../hooks/github/client'
import { parseResponse } from '../hooks/github/query'

const response = (pr: unknown) =>
  JSON.stringify({
    data: {
      viewer: { login: 'jreed91' },
      repository: { pullRequests: { nodes: pr ? [pr] : [] } },
    },
  })

const PR_NODE = {
  number: 7,
  title: 'Add the bar',
  url: 'https://github.com/o/r/pull/7',
  isDraft: true,
  reviewDecision: 'CHANGES_REQUESTED',
  mergeable: 'CONFLICTING',
  baseRefName: 'main',
  headRefName: 'feat/bar',
  commits: { nodes: [{ commit: { oid: 'abc123', statusCheckRollup: { contexts: { nodes: [
    { __typename: 'CheckRun', id: 'CR1', databaseId: 99, name: 'test', status: 'COMPLETED', conclusion: 'FAILURE', detailsUrl: 'https://x', title: '2 tests failed', checkSuite: { app: { slug: 'github-actions' }, workflowRun: { workflow: { name: 'CI' } } } },
    { __typename: 'CheckRun', id: 'CR2', databaseId: 100, name: 'lint', status: 'IN_PROGRESS', conclusion: null, detailsUrl: null, title: null, checkSuite: { app: { slug: 'github-actions' }, workflowRun: { workflow: { name: 'CI' } } } },
    { __typename: 'CheckRun', id: 'CR3', databaseId: 101, name: 'docs', status: 'COMPLETED', conclusion: 'SKIPPED', detailsUrl: null, title: null, checkSuite: { app: { slug: 'other-app' }, workflowRun: null } },
    { __typename: 'StatusContext', id: 'SC1', context: 'vercel', state: 'SUCCESS', targetUrl: 'https://v', description: 'Deployed' },
  ] } } } }] },
  comments: { nodes: [{ id: 'IC1', author: { login: 'bot[bot]' }, body: 'Coverage down', createdAt: '2026-10-01T10:00:00Z', url: 'u1' }] },
  reviews: { nodes: [
    { id: 'R1', author: { login: 'alice' }, body: '', state: 'COMMENTED', submittedAt: '2026-10-01T09:00:00Z', url: 'u2' },
    { id: 'R2', author: { login: 'alice' }, body: '', state: 'CHANGES_REQUESTED', submittedAt: '2026-10-01T11:00:00Z', url: 'u3' },
  ] },
  reviewThreads: { nodes: [
    { isResolved: false, comments: { nodes: [{ id: 'RC1', author: { login: 'alice' }, body: 'rename', createdAt: '2026-10-01T09:00:00Z', url: 'u4', path: 'a.ts', line: null, originalLine: 4, diffHunk: '@@' }] } },
    { isResolved: true, comments: { nodes: [{ id: 'RC2', author: { login: 'alice' }, body: 'old', createdAt: '2026-10-01T08:00:00Z', url: 'u5', path: 'b.ts', line: 1, diffHunk: '@@' }] } },
  ] },
}

describe('parseResponse', () => {
  test('reads the PR, its checks and its comments', async () => {
    const outcome = parseResponse(response(PR_NODE))

    expect(outcome.kind).toBe('ok')
    if (outcome.kind !== 'ok' || !outcome.pr) throw new Error('no pr')

    const { pr } = outcome
    expect(outcome.viewer).toBe('jreed91')
    expect(pr).toMatchObject({ number: 7, isDraft: true, reviewDecision: 'CHANGES_REQUESTED', hasConflict: true, headSha: 'abc123' })
    expect(pr.checks.map(check => [check.name, check.state, check.jobId])).toEqual([
      ['CI / test', 'fail', 99],
      ['CI / lint', 'pending', 100],
      ['docs', 'skip', null],
      ['vercel', 'pass', null],
    ])
    // The empty COMMENTED review and the resolved thread are left out.
    expect(pr.comments.map(comment => comment.id)).toEqual(['RC1', 'IC1', 'R2'])
    expect(pr.comments[0]).toMatchObject({ kind: 'review-comment', path: 'a.ts', line: 4 })
  })

  test('no open PR for the branch', async () => {
    expect(parseResponse(response(null))).toEqual({ kind: 'ok', viewer: 'jreed91', pr: null })
  })

  test('rate limits and errors', async () => {
    expect(parseResponse(JSON.stringify({ errors: [{ type: 'RATE_LIMITED', message: 'slow down' }] }))).toEqual({ kind: 'rate-limited' })
    expect(parseResponse(JSON.stringify({ errors: [{ message: 'Could not resolve' }], data: { repository: null } }))).toEqual({ kind: 'error', detail: 'Could not resolve' })
    expect(parseResponse('<html>')).toMatchObject({ kind: 'error' })
  })
})

describe('tailOf', () => {
  test('keeps the last lines without timestamps', async () => {
    const log = '2026-10-01T10:00:00.1234567Z one\r\n2026-10-01T10:00:01.0000000Z two\n2026-10-01T10:00:02.0000000Z three\n'
    expect(tailOf(log, 2)).toBe('two\nthree')
  })
})
