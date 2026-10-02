import type { On } from 'claude-code'
import { mock } from 'claude-code/testing'

export const NOW = Date.parse('2026-10-01T12:00:00Z')

type Http = { status: number; ok: boolean; headers: Record<string, string>; text: string }

export const json = (body: unknown, status = 200): Http => ({
  status,
  ok: status >= 200 && status < 300,
  headers: {},
  text: JSON.stringify(body),
})

export const checkRun = (overrides: Record<string, unknown> = {}) => ({
  __typename: 'CheckRun',
  id: 'CR1',
  databaseId: 99,
  name: 'test',
  status: 'COMPLETED',
  conclusion: 'FAILURE',
  detailsUrl: 'https://github.com/o/r/actions/runs/1/job/99',
  title: null,
  checkSuite: { app: { slug: 'github-actions' }, workflowRun: { workflow: { name: 'CI' } } },
  ...overrides,
})

export const inlineComment = (overrides: Record<string, unknown> = {}) => ({
  id: 'RC1',
  author: { login: 'alice' },
  body: 'Rename this',
  createdAt: '2026-10-01T11:00:00Z',
  url: 'https://github.com/o/r/pull/7#r1',
  path: 'src/app.ts',
  line: 3,
  diffHunk: '@@ -1,3 +1,3 @@\n-a\n+b',
  ...overrides,
})

/** A GraphQL answer with PR #7 on feat/bar; `pr` overrides its fields, `checks` its check nodes. */
export const prAnswer = (pr: Record<string, unknown> = {}, checks: unknown[] = [checkRun()]) => ({
  data: {
    viewer: { login: 'me' },
    repository: { pullRequests: { nodes: [{
      number: 7,
      title: 'Add the bar',
      url: 'https://github.com/o/r/pull/7',
      isDraft: false,
      reviewDecision: null,
      mergeable: 'MERGEABLE',
      baseRefName: 'main',
      headRefName: 'feat/bar',
      commits: { nodes: [{ commit: { oid: 'abc1234', statusCheckRollup: { contexts: { nodes: checks } } } }] },
      comments: { nodes: [] },
      reviews: { nodes: [] },
      reviewThreads: { nodes: [{ isResolved: false, comments: { nodes: [inlineComment()] } }] },
      ...pr,
    }] } },
  },
})

export const NO_PR = { data: { viewer: { login: 'me' }, repository: { pullRequests: { nodes: [] } } } }

export type WorldOptions = {
  /** What GitHub answers a request to `url`; may wait. */
  http?: (url: string) => Http | Promise<Http>
  store?: Record<string, unknown>
  env?: Record<string, string>
  remote?: string | null
  /** What a command the mod runs comes to; absent, the test expects none. */
  run?: (argv: readonly string[]) => { exitCode: number; stdout?: string } | Promise<{ exitCode: number; stdout?: string }>
  /** Files read as bytes, base64 by path; any other throws. */
  bytes?: Record<string, string>
}

/**
 * A checkout of o/r at /repo on feat/bar, a token in the env, and GitHub
 * answering through `http`. Everything it records, and the HEAD and pane
 * list it serves, can be read and changed by the test.
 */
export function world(on: On, options: WorldOptions = {}) {
  const state = {
    head: 'ref: refs/heads/feat/bar\n',
    remote: options.remote === undefined ? 'git@github.com:o/r.git' : options.remote,
    http: options.http ?? (() => json(prAnswer())),
    panes: [] as { id: string }[],
    /** Set to deny the next Bash calls. */
    deny: undefined as string | undefined,
  }
  const store = options.store ?? {}
  const requests: string[] = []
  const toasts: string[] = []
  const logs: string[] = []
  const opened: string[] = []
  const closed: string[] = []

  const clock = mock.clock(on, { now: NOW })
  mock.env(on, options.env ?? { GH_TOKEN: 'test-token' })
  on('store.get', (_$, e) => ({ value: store[e.key] }))
  on('store.set', (_$, e) => {
    store[e.key] = e.value
    return { value: undefined }
  })
  on('session.repo', () => ({ value: state.remote === null ? null : { root: '/repo', remote: state.remote, internal: false, name: null } }))
  on('session.cwd', () => ({ value: '/repo' }))
  on('fs.exists', (_$, e) => ({ value: e.path === '/repo/.git' }))
  on('fs.stat', () => ({ value: { kind: 'dir' as const, size: 0, mtimeMs: 0, isLink: false } }))
  on('fs.read', (_$, e) => {
    if (e.as === 'bytes') {
      const base64 = options.bytes?.[e.path]

      if (base64 === undefined) {
        throw new Error(`no file ${e.path}`)
      }

      return { value: { base64 } }
    }

    return { value: e.path === '/repo/.git/HEAD' ? state.head : '' }
  })
  const ran: string[][] = []
  const run = options.run

  if (run) {
    on('process.run', async (_$, e) => {
      ran.push([...e.argv])
      const result = await run(e.argv)
      return { value: { stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false, ...result } }
    })
  }
  on('session.start', (_$, e) => ({ cwd: e.cwd }) as never)
  on('command.register', (_$, e) => ({ value: { command: e.name } }))
  on('ui.invalidate', () => ({ value: undefined }))
  on('ui.log', (_$, e) => {
    logs.push(e.text)
    return { value: undefined }
  })
  on('ui.toast', (_$, e) => {
    toasts.push(e.text)
    return { value: undefined }
  })
  on('ui.panes', () => ({ value: state.panes }) as never)
  on('ui.open', (_$, e) => {
    opened.push(e.id)
    return { value: { isPlaced: true as const } }
  })
  on('ui.close', (_$, e) => {
    closed.push(e.id)
    return { value: undefined }
  })
  // What the engine draws when the plugin passes: a marker to look for.
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e as never) as { Text: never }
    return h(Text, {}, 'drawn by the engine') as never
  })
  on('tool.call', () => (state.deny === undefined ? { result: { stdout: '', stderr: '' } } : { deny: state.deny }) as never)
  on('http.fetch', async (_$, e) => {
    requests.push(e.url)
    return { value: await state.http(e.url) }
  })

  return { state, store, requests, toasts, opened, closed, clock, ran, logs }
}

export const START = { cwd: '/repo', surface: 'terminal', isInteractive: true } as never

export const BAR = {
  plugin: 'pr-bar',
  surface: 'terminal',
  component: 'AbovePrompt',
  props: { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns: 120, scroll: { offset: 0, bodyRows: 10 } },
} as never

export const PANE = {
  plugin: 'pr-bar',
  surface: 'terminal',
  component: 'Pane',
  requestId: 'pr-bar',
  props: { title: 'Pull request', isFocused: true, bodyColumns: 80, placement: 'dock', scroll: { offset: 0, bodyRows: 60 } },
} as never
