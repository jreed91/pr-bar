import type { On } from 'claude-code'
import { describe, expect, mock, test } from 'claude-code/testing'

const NOW = Date.parse('2026-10-01T12:00:00Z')

const graphql = (overrides: Record<string, unknown> = {}) => ({
  data: {
    viewer: { login: 'jreed91' },
    repository: { pullRequests: { nodes: [{
      number: 7,
      title: 'Add the bar',
      url: 'https://github.com/o/r/pull/7',
      isDraft: false,
      reviewDecision: 'CHANGES_REQUESTED',
      mergeable: 'MERGEABLE',
      baseRefName: 'main',
      headRefName: 'feat/bar',
      commits: { nodes: [{ commit: { oid: 'abc123', statusCheckRollup: { contexts: { nodes: [
        { __typename: 'CheckRun', id: 'CR1', databaseId: 99, name: 'test', status: 'COMPLETED', conclusion: 'FAILURE', detailsUrl: 'https://github.com/o/r/actions/runs/1/job/99', title: null, checkSuite: { app: { slug: 'github-actions' }, workflowRun: { workflow: { name: 'CI' } } } },
        { __typename: 'CheckRun', id: 'CR2', databaseId: 100, name: 'lint', status: 'COMPLETED', conclusion: 'SUCCESS', detailsUrl: null, title: null, checkSuite: { app: { slug: 'github-actions' }, workflowRun: { workflow: { name: 'CI' } } } },
      ] } } } }] },
      comments: { nodes: [] },
      reviews: { nodes: [] },
      reviewThreads: { nodes: [{ isResolved: false, comments: { nodes: [
        { id: 'RC1', author: { login: 'alice' }, body: 'Rename this', createdAt: '2026-10-01T11:00:00Z', url: 'https://github.com/o/r/pull/7#r1', path: 'src/app.ts', line: 3, diffHunk: '@@ -1,3 +1,3 @@\n-a\n+b' },
      ] } } ] },
      ...overrides,
    }] } },
  },
})

/** A checkout of o/r on feat/bar, a token in the env, GitHub answering `body`. */
function world(on: On, body: unknown, store: Record<string, unknown> = {}, env: Record<string, string> = { GH_TOKEN: 'test-token' }, remote = 'git@github.com:o/r.git') {
  const clock = mock.clock(on, { now: NOW })
  on('store.get', (_$, e) => ({ value: store[e.key] }))
  on('store.set', (_$, e) => {
    store[e.key] = e.value
    return { value: undefined }
  })
  mock.env(on, env)
  on('session.repo', () => ({ value: { root: '/repo', remote, internal: false, name: null } }))
  on('session.cwd', () => ({ value: '/repo' }))
  on('fs.exists', (_$, e) => ({ value: e.path === '/repo/.git' }))
  on('fs.stat', () => ({ value: { kind: 'dir' as const, size: 0, mtimeMs: 0, isLink: false } }))
  on('fs.read', (_$, e) => ({ value: e.path === '/repo/.git/HEAD' ? 'ref: refs/heads/feat/bar\n' : '' }))
  on('session.start', (_$, e) => ({ cwd: e.cwd }) as never)
  on('command.register', (_$, e) => ({ value: { command: e.name } }))
  on('ui.invalidate', () => ({ value: undefined }))
  const toasts: string[] = []
  on('ui.toast', (_$, e) => {
    toasts.push(e.text)
    return { value: undefined }
  })
  on('ui.panes', () => ({ value: [] }))
  const opened: string[] = []
  on('ui.open', (_$, e) => {
    opened.push(e.id)
    return { value: { isPlaced: true as const } }
  })
  on('ui.render', () => null as never)
  const requests: string[] = []
  const answer = { body, status: 200, hangs: false, headers: {} as Record<string, string> }
  on('http.fetch', (_$, e) => {
    requests.push(e.url)
    if (answer.hangs) {
      return new Promise<never>(() => {})
    }
    return { value: { status: answer.status, ok: answer.status < 300, headers: answer.headers, text: JSON.stringify(answer.body) } }
  })
  return { requests, clock, toasts, answer, opened }
}

const BAR = { component: 'AbovePrompt' as const, props: { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns: 120, scroll: { offset: 0, bodyRows: 10 } } }

describe('bar', () => {
  test('compact by default: one line with the PR, red CI, review and unread count', async ($, on) => {
    const { requests, clock } = world(on, graphql())
    await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true } as never)
    await clock.settle()

    expect(requests).toEqual(['https://api.github.com/graphql'])

    for (const surface of ['terminal', 'desktop'] as const) {
      const ui = await $.ui.mount({ plugin: 'pr-bar', surface, ...BAR } as never)

      expect(await ui.find({ type: 'Link', text: '#7' })).toBeDefined()
      expect(await ui.find({ type: 'Text', text: '✗ 1 failing' })).toBeDefined()
      expect(await ui.find({ type: 'Text', text: '⚑ changes' })).toBeDefined()
      expect(await ui.find({ type: 'Text', text: '💬 1' })).toBeDefined()
      expect(await ui.find({ type: 'Text', text: /CI \/ test/ })).toBeUndefined()
      expect(await ui.find({ type: 'Button', key: 'mark-read' })).toBeUndefined()
      expect(await ui.find({ type: 'Button', key: 'details' })).toBeDefined()

      await ui.unmount()
    }
  })

  test('full layout: title, failing check names and buttons', { options: { barLayout: 'full' } }, async ($, on) => {
    const { clock } = world(on, graphql())
    await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true } as never)
    await clock.settle()

    for (const surface of ['terminal', 'desktop'] as const) {
      const ui = await $.ui.mount({ plugin: 'pr-bar', surface, ...BAR } as never)

      expect(await ui.find({ type: 'Link', text: '#7' })).toBeDefined()
      expect(await ui.find({ type: 'Text', text: /Add the bar/ })).toBeDefined()
      expect(await ui.find({ type: 'Text', text: /changes requested/ })).toBeDefined()
      expect(await ui.find({ type: 'Text', text: /CI \/ test/ })).toBeDefined()
      expect(await ui.find({ type: 'Text', text: '💬 1 new' })).toBeDefined()

      await ui.unmount()
    }
  })

  test('Mark read clears the count and is kept per PR', { options: { barLayout: 'full' } }, async ($, on) => {
    const store: Record<string, unknown> = {}
    const { clock } = world(on, graphql(), store)
    await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true } as never)
    await clock.settle()
    const ui = await $.ui.mount({ plugin: 'pr-bar', surface: 'terminal', ...BAR } as never)

    await ui.press({ key: 'mark-read' })
    await ui.redraw()

    expect(await ui.find({ type: 'Text', text: '💬 0 new' })).toBeDefined()
    expect(store['lastRead:o/r#7']).toBe(NOW)
  })

  test('a branch with no PR offers the compare page', async ($, on) => {
    const { clock } = world(on, { data: { viewer: { login: 'jreed91' }, repository: { pullRequests: { nodes: [] } } } })
    await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true } as never)
    await clock.settle()
    const ui = await $.ui.mount({ plugin: 'pr-bar', surface: 'terminal', ...BAR } as never)

    expect(await ui.find({ type: 'Text', text: /no PR for feat\/bar/ })).toBeDefined()
    expect(await ui.find({ type: 'Link', text: 'Open compare' })).toBeDefined()
  })
})

describe('hand-off', () => {
  test('Address attaches the comment to the next prompt, once', async ($, on) => {
    const { clock } = world(on, graphql())
    const submitted: (readonly string[] | undefined)[] = []
    on('prompt.submit', (_$, e) => {
      submitted.push(e.context)
      return { text: e.text, context: e.context }
    })
    await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true } as never)
    await clock.settle()

    const pane = await $.ui.mount({
      plugin: 'pr-bar',
      surface: 'terminal',
      component: 'Pane',
      requestId: 'pr-bar',
      props: { title: 'Pull request', isFocused: true, bodyColumns: 80, placement: 'dock', scroll: { offset: 0, bodyRows: 40 } },
    } as never)

    await pane.press({ key: 'select:comment:RC1' })
    await pane.redraw()
    await pane.press({ key: 'address' })

    await $.prompt.submit({ text: 'fix this' } as never)
    await $.prompt.submit({ text: 'and again' } as never)

    expect(submitted[0]?.[0]).toContain('Rename this')
    expect(submitted[0]?.[0]).toContain('src/app.ts:3')
    expect(submitted[1] ?? []).toHaveLength(0)
  })
})

describe('alerts', () => {
  const pending = { __typename: 'CheckRun', id: 'CR1', databaseId: 99, name: 'test', status: 'IN_PROGRESS', conclusion: null, detailsUrl: null, title: null, checkSuite: { app: { slug: 'github-actions' }, workflowRun: { workflow: { name: 'CI' } } } }
  const failed = { ...pending, status: 'COMPLETED', conclusion: 'FAILURE' }
  const withChecks = (node: unknown) =>
    graphql({ commits: { nodes: [{ commit: { oid: 'abc', statusCheckRollup: { contexts: { nodes: [node] } } } }] } })

  test('toasts once when CI turns red, polling every 20s while pending', async ($, on) => {
    const { clock, toasts, answer, requests } = world(on, withChecks(pending))
    await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true } as never)
    await clock.settle()
    expect(toasts).toHaveLength(0)

    answer.body = withChecks(failed)
    await clock.advance(20_000)
    await clock.settle()

    expect(requests).toHaveLength(2)
    expect(toasts).toEqual(['CI failed on #7: CI / test'])

    await clock.advance(90_000)
    await clock.settle()
    expect(toasts).toHaveLength(1)
  })

  test('says so when no token can be found', async ($, on) => {
    const { clock } = world(on, graphql(), {}, {})
    on('process.run', () => ({ value: { exitCode: 1, stdout: '', stderr: 'not logged in', isStdoutTruncated: false, isStderrTruncated: false } }))
    await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true } as never)
    await clock.settle()
    const ui = await $.ui.mount({ plugin: 'pr-bar', surface: 'terminal', ...BAR } as never)

    expect(await ui.find({ type: 'Text', text: /no GitHub token/ })).toBeDefined()
  })
})

describe('pane comments', () => {
  test('one fitted line per comment, inline apart from bot conversation', async ($, on) => {
    const long = 'This documented default contradicts the config note, which says the retry limit is five attempts and nothing more.'
    const body = graphql({
      comments: { nodes: [
        { id: 'IC1', author: { login: 'github-actions' }, body: '<h2>Coverage Report for apps/webhooks</h2>\n<details><summary>x</summary>\n| a | b |\n</details>', createdAt: '2026-10-01T11:30:00Z', url: 'https://github.com/o/r/pull/7#c1' },
      ] },
      reviews: { nodes: [
        { id: 'R1', author: { login: 'copilot-pull-request-reviewer' }, body: '<!-- ccr-overview-v2 -->\n## Pull request overview\nAdds webhook retries.', state: 'COMMENTED', submittedAt: '2026-10-01T11:10:00Z', url: 'https://github.com/o/r/pull/7#r1' },
      ] },
      reviewThreads: { nodes: [1, 2, 3].map(n => ({ isResolved: false, comments: { nodes: [
        { id: `RC${n}`, author: { login: 'copilot-pull-request-reviewer' }, body: long, createdAt: `2026-10-01T11:0${n}:00Z`, url: `https://github.com/o/r/pull/7#d${n}`, path: `docs/deeply/nested/folder/NOTES-${n}.md`, line: 240 + n, diffHunk: '@@' },
      ] } })) },
    })
    const { clock } = world(on, body)
    await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true } as never)
    await clock.settle()

    const pane = await $.ui.mount({
      plugin: 'pr-bar',
      surface: 'terminal',
      component: 'Pane',
      requestId: 'pr-bar',
      props: { title: 'Pull request', isFocused: true, bodyColumns: 60, placement: 'dock', scroll: { offset: 0, bodyRows: 40 } },
    } as never)

    expect(await pane.find({ type: 'Text', text: /Review comments \(3, 3 new\)/ })).toBeDefined()
    expect(await pane.find({ type: 'Text', text: /Conversation/ })).toBeUndefined()
    expect((await pane.find({ type: 'Button', key: 'toggle-conversation' }))?.text).toBe(
      '2 conversation comments and review summaries',
    )
    expect(
      (await pane.findAll({ type: 'Button' })).filter(row => row.key?.startsWith('select:comment:')),
    ).toHaveLength(3)

    await pane.press({ key: 'toggle-conversation' })
    await pane.redraw()
    expect(await pane.find({ type: 'Text', text: /Conversation \(2, 2 new\)/ })).toBeDefined()

    const rows = (await pane.findAll({ type: 'Button' })).filter(row => row.key?.startsWith('select:comment:'))
    expect(rows).toHaveLength(5)
    for (const row of rows) {
      expect([...row.text].length).toBeLessThanOrEqual(55)
      expect(row.text).not.toMatch(/[<>]/)
    }
    expect(rows.map(row => row.text)).toContainEqual(expect.stringMatching(/^copilot  NOTES-3\.md:243  This documented/))
    expect(rows.map(row => row.text)).toContainEqual(expect.stringMatching(/^actions  comment  Coverage Report for apps\/webhooks$/))
    expect(rows.map(row => row.text)).toContainEqual(expect.stringMatching(/^copilot  review  Pull request overview Adds/))
  })
})

describe('quiet by default', () => {
  test('passing checks fold into one line until asked', async ($, on) => {
    const { clock } = world(on, graphql())
    await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true } as never)
    await clock.settle()
    const pane = await $.ui.mount({
      plugin: 'pr-bar',
      surface: 'terminal',
      component: 'Pane',
      requestId: 'pr-bar',
      props: { title: 'Pull request', isFocused: true, bodyColumns: 80, placement: 'dock', scroll: { offset: 0, bodyRows: 40 } },
    } as never)

    expect(await pane.find({ type: 'Button', key: 'select:check:CR1' })).toBeDefined()
    expect(await pane.find({ type: 'Button', key: 'select:check:CR2' })).toBeUndefined()
    expect((await pane.find({ type: 'Button', key: 'toggle-passing' }))?.text).toBe('1 passing')

    await pane.press({ key: 'toggle-passing' })
    await pane.redraw()
    expect(await pane.find({ type: 'Button', key: 'select:check:CR2' })).toBeDefined()
  })

  test('the conversation setting counts bot comments in the bar', { options: { showConversation: true } }, async ($, on) => {
    const { clock } = world(on, graphql({ comments: { nodes: [
      { id: 'IC1', author: { login: 'github-actions' }, body: 'Coverage 87%', createdAt: '2026-10-01T11:30:00Z', url: 'https://github.com/o/r/pull/7#c1' },
    ] } }))
    await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true } as never)
    await clock.settle()
    const ui = await $.ui.mount({ plugin: 'pr-bar', surface: 'terminal', ...BAR } as never)

    expect(await ui.find({ type: 'Text', text: '💬 2' })).toBeDefined()
  })
})

describe('comments first', () => {
  test('the pane lists comments above checks and opens on the first unread comment', async ($, on) => {
    const { clock } = world(on, graphql())
    await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true } as never)
    await clock.settle()
    const pane = await $.ui.mount({
      plugin: 'pr-bar',
      surface: 'terminal',
      component: 'Pane',
      requestId: 'pr-bar',
      props: { title: 'Pull request', isFocused: true, bodyColumns: 80, placement: 'dock', scroll: { offset: 0, bodyRows: 40 } },
    } as never)

    const keys = (await pane.findAll({ type: 'Button' })).map(button => button.key ?? '')
    expect(keys.indexOf('select:comment:RC1')).toBeLessThan(keys.indexOf('select:check:CR1'))
    expect(await pane.find({ type: 'Button', key: 'address' })).toBeDefined()
  })
})

describe('inline code', () => {
  test('an inline comment opens under its row with the commented lines as a diff', async ($, on) => {
    const lines = Array.from({ length: 240 }, (_, n) => `+line ${n + 1}`)
    const body = graphql({
      reviewThreads: { nodes: [{ isResolved: false, comments: { nodes: [
        { id: 'RC9', author: { login: 'copilot-pull-request-reviewer' }, body: 'This contradicts the note.', createdAt: '2026-10-01T11:00:00Z', url: 'https://github.com/o/r/pull/7#d9', path: 'docs/PLAN.md', line: 240, diffHunk: `@@ -0,0 +1,300 @@\n${lines.join('\n')}` },
      ] } }] },
    })
    const { clock } = world(on, body)
    await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true } as never)
    await clock.settle()

    const pane = await $.ui.mount({
      plugin: 'pr-bar',
      surface: 'terminal',
      component: 'Pane',
      requestId: 'pr-bar',
      props: { title: 'Pull request', isFocused: true, bodyColumns: 80, placement: 'dock', scroll: { offset: 0, bodyRows: 40 } },
    } as never)

    const code = await pane.find({ type: 'Code' })
    expect(code?.props).toMatchObject({ format: 'diff' })
    expect(code?.text.startsWith('@@ -0,0 +235,6 @@')).toBe(true)
    expect(code?.text.endsWith('+line 240')).toBe(true)

    // The detail sits right under its row, above the checks.
    const tree = JSON.stringify(await pane.drawn())
    expect(tree.indexOf('select:comment:RC9')).toBeLessThan(tree.indexOf('"format":"diff"'))
    expect(tree.indexOf('"format":"diff"')).toBeLessThan(tree.indexOf('Checks ('))
  })
})

describe('new PR', () => {
  const noPr = { data: { viewer: { login: 'jreed91' }, repository: { pullRequests: { nodes: [] } } } }

  test('opens the pane once when a PR is opened for the branch', async ($, on) => {
    const store: Record<string, unknown> = {}
    const { clock, answer, opened } = world(on, noPr, store)
    await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true } as never)
    await clock.settle()
    expect(opened).toHaveLength(0)

    answer.body = graphql()
    await clock.advance(90_000)
    expect(opened).toEqual(['pr-bar'])
    expect(store['opened:o/r#7']).toBe(true)

    await clock.advance(90_000)
    expect(opened).toHaveLength(1)
  })

  test('leaves a PR that was already open alone', async ($, on) => {
    const { clock, opened } = world(on, graphql())
    await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true } as never)
    await clock.settle()
    await clock.advance(90_000)
    expect(opened).toHaveLength(0)
  })

  test('the setting turns it off', { options: { openOnNewPr: false } }, async ($, on) => {
    const { clock, answer, opened } = world(on, noPr)
    await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true } as never)
    await clock.settle()
    answer.body = graphql()
    await clock.advance(90_000)
    expect(opened).toHaveLength(0)
  })
})

describe('when GitHub cannot be asked', () => {
  const PANE = {
    plugin: 'pr-bar',
    surface: 'terminal',
    component: 'Pane',
    requestId: 'pr-bar',
    props: { title: 'Pull request', isFocused: true, bodyColumns: 80, placement: 'dock', scroll: { offset: 0, bodyRows: 40 } },
  }

  test('an error answer shows in the pane and the bar, not "Asking GitHub…"', async ($, on) => {
    const { clock, answer } = world(on, graphql())
    answer.status = 502
    await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true } as never)
    await clock.settle()

    const pane = await $.ui.mount(PANE as never)
    expect(await pane.find({ type: 'Text', text: /Asking GitHub/ })).toBeUndefined()
    expect(await pane.find({ type: 'Text', text: /Could not reach GitHub: GitHub answered 502/ })).toBeDefined()
    expect(await pane.find({ type: 'Button', key: 'refresh' })).toBeDefined()

    const bar = await $.ui.mount({ plugin: 'pr-bar', surface: 'terminal', ...BAR } as never)
    expect(await bar.find({ type: 'Text', text: /PrBar: Could not reach GitHub/ })).toBeDefined()

    answer.status = 200
    await pane.press({ key: 'refresh' })
    await clock.settle()
    await pane.redraw()
    expect(await pane.find({ type: 'Link', text: '#7' })).toBeDefined()
  })

  test('a request with no answer gives up after 20 seconds', async ($, on) => {
    const { clock, answer } = world(on, graphql())
    answer.hangs = true
    await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true } as never)
    await clock.settle()

    const pane = await $.ui.mount(PANE as never)
    expect(await pane.find({ type: 'Text', text: /Asking GitHub/ })).toBeDefined()

    await clock.advance(20_000)
    await pane.redraw()
    expect(await pane.find({ type: 'Text', text: /no answer from GitHub in 20s/ })).toBeDefined()
  })

  test('a folder whose origin is not on github.com says so', async ($, on) => {
    const { clock } = world(on, graphql(), {}, { GH_TOKEN: 'test-token' }, 'git@gitlab.com:o/r.git')
    await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true } as never)
    await clock.settle()

    const pane = await $.ui.mount(PANE as never)
    expect(await pane.find({ type: 'Text', text: /No GitHub branch here/ })).toBeDefined()
  })
})

describe('rate limits', () => {
  test('keeps the last answer, marks it stale and waits for GitHub\'s reset', async ($, on) => {
    const { clock, answer, requests } = world(on, graphql())
    await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true } as never)
    await clock.settle()

    answer.status = 403
    answer.headers = { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': String(Math.round((NOW + 90_000 + 20 * 60_000) / 1000)) }
    await clock.advance(90_000)
    const asked = requests.length

    const bar = await $.ui.mount({ plugin: 'pr-bar', surface: 'terminal', ...BAR } as never)
    expect(await bar.find({ type: 'Link', text: '#7' })).toBeDefined()
    expect(await bar.find({ type: 'Text', text: /stale/ })).toBeDefined()

    const pane = await $.ui.mount({
      plugin: 'pr-bar',
      surface: 'terminal',
      component: 'Pane',
      requestId: 'pr-bar',
      props: { title: 'Pull request', isFocused: true, bodyColumns: 80, placement: 'dock', scroll: { offset: 0, bodyRows: 40 } },
    } as never)
    expect(await pane.find({ type: 'Text', text: /rate-limited the requests\. It is asked again in 20m/ })).toBeDefined()
    expect(await pane.find({ type: 'Link', text: '#7' })).toBeDefined()

    // Nothing is asked until the reset, then polling picks up again.
    await clock.advance(19 * 60_000)
    expect(requests.length).toBe(asked)
    answer.status = 200
    answer.headers = {}
    await clock.advance(2 * 60_000)
    expect(requests.length).toBe(asked + 1)
  })
})
