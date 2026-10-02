import type { HttpInit } from 'claude-code'
import { describe, expect, test } from 'claude-code/testing'

import { fetchJobLogTail, fetchPullRequest } from '../hooks/github/client'
import { resolveToken } from '../hooks/github/token'
import { hostOf, responseOf } from './host'

const REPO = { owner: 'o', name: 'r', branch: 'feat/band' }
/** The request timeout's timer: never fires, since these answers come at once. */
const idleTimer = { after: () => ({ cancel: () => {} }) } as unknown as Partial<Parameters<typeof hostOf>[0]>
const EMPTY_PR = JSON.stringify({ data: { viewer: { login: 'me' }, repository: { pullRequests: { nodes: [] } } } })

describe('fetchPullRequest', () => {
  const answering = (response: ReturnType<typeof responseOf>) => {
    const sent: { url: string; init?: HttpInit }[] = []
    const host = hostOf({
      ...idleTimer,
      fetch: async (url, init) => {
        sent.push({ url, init })
        return response
      },
    })
    return { host, sent }
  }

  test('posts the query with the token and reads the answer', async () => {
    const { host, sent } = answering(responseOf(200, EMPTY_PR))

    expect(await fetchPullRequest(host, 'tok', REPO)).toEqual({ kind: 'ok', viewer: 'me', pr: null })
    expect(sent[0]?.url).toBe('https://api.github.com/graphql')
    expect(sent[0]?.init?.headers).toMatchObject({ authorization: 'Bearer tok' })
  })

  test('folds HTTP failures into outcomes', async () => {
    const outcome = async (response: ReturnType<typeof responseOf>) =>
      fetchPullRequest(answering(response).host, 'tok', REPO)

    expect(await outcome(responseOf(401))).toEqual({ kind: 'token-rejected' })
    expect(await outcome(responseOf(429))).toEqual({ kind: 'rate-limited' })
    expect(await outcome(responseOf(403, '', { 'x-ratelimit-remaining': '0' }))).toEqual({ kind: 'rate-limited' })
    expect(await outcome(responseOf(403, '', { 'x-ratelimit-remaining': '12' }))).toEqual({ kind: 'offline', detail: 'GitHub answered 403' })
    expect(await outcome(responseOf(502))).toEqual({ kind: 'offline', detail: 'GitHub answered 502' })
  })

  test('is offline when the request throws', async () => {
    const throwing = (error: unknown) =>
      hostOf({
        ...idleTimer,
        fetch: async () => {
          throw error
        },
      })

    expect(await fetchPullRequest(throwing(new Error('ECONNRESET')), 'tok', REPO)).toEqual({ kind: 'offline', detail: 'ECONNRESET' })
    expect(await fetchPullRequest(throwing('boom'), 'tok', REPO)).toEqual({ kind: 'offline', detail: 'network error' })
  })
})

describe('fetchJobLogTail', () => {
  test('follows the redirect to log storage without the token', async () => {
    const sent: { url: string; init?: HttpInit }[] = []
    const host = hostOf({
      fetch: async (url, init) => {
        sent.push({ url, init })
        return url.startsWith('https://api.github.com')
          ? responseOf(302, '', { location: 'https://logs.example/job/9' })
          : responseOf(200, '2026-10-01T12:00:00.000Z one\n2026-10-01T12:00:01.000Z two\n')
      },
    })

    expect(await fetchJobLogTail(host, 'tok', REPO, 9)).toBe('one\ntwo')
    expect(sent.map(request => request.url)).toEqual([
      'https://api.github.com/repos/o/r/actions/jobs/9/logs',
      'https://logs.example/job/9',
    ])
    expect(sent[1]?.init).toBeUndefined()
  })

  test('reads a log served directly, and throws on a failed answer', async () => {
    const direct = hostOf({ fetch: async () => responseOf(200, 'only line') })
    expect(await fetchJobLogTail(direct, 'tok', REPO, 9)).toBe('only line')

    const redirectWithoutLocation = hostOf({ fetch: async () => responseOf(302) })
    await expect(fetchJobLogTail(redirectWithoutLocation, 'tok', REPO, 9)).rejects.toThrow('the log answered 302')

    const gone = hostOf({ fetch: async () => responseOf(410) })
    await expect(fetchJobLogTail(gone, 'tok', REPO, 9)).rejects.toThrow('the log answered 410')
  })
})

describe('resolveToken', () => {
  const sources = ({
    env = {},
    gh,
  }: {
    env?: Record<string, string>
    gh?: { exitCode: number; stdout: string } | Error
  }) =>
    hostOf({
      envGet: async name => env[name],
      run: async () => {
        if (!gh || gh instanceof Error) throw gh ?? new Error('no gh')
        return { ...gh, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } as never
      },
    })

  test('takes GH_TOKEN, then GITHUB_TOKEN, trimmed', async () => {
    expect(await resolveToken(sources({ env: { GH_TOKEN: ' a ', GITHUB_TOKEN: 'b' } }), {})).toBe('a')
    expect(await resolveToken(sources({ env: { GH_TOKEN: '  ', GITHUB_TOKEN: ' b\n' } }), {})).toBe('b')
  })

  test('then `gh auth token`, then the setting', async () => {
    expect(await resolveToken(sources({ gh: { exitCode: 0, stdout: 'gho_x\n' } }), { githubToken: 's' })).toBe('gho_x')
    expect(await resolveToken(sources({ gh: { exitCode: 0, stdout: '\n' } }), { githubToken: ' s ' })).toBe('s')
    expect(await resolveToken(sources({ gh: { exitCode: 1, stdout: 'gho_x' } }), { githubToken: 's' })).toBe('s')
    expect(await resolveToken(sources({ gh: new Error('ENOENT') }), { githubToken: 's' })).toBe('s')
  })

  test('is null when nothing has one', async () => {
    expect(await resolveToken(sources({}), {})).toBeNull()
    expect(await resolveToken(sources({}), { githubToken: '   ' })).toBeNull()
    expect(await resolveToken(sources({}), { githubToken: 42 } as never)).toBeNull()
  })
})
