import type { On } from 'claude-code'
import { describe, expect, test, type Engine } from 'claude-code/testing'

import { checkoutBranch } from '../hooks/git/checkout'
import { parseResponse, stackEntryOf } from '../hooks/github/query'
import { positionOf, stackOf } from '../hooks/model/stack'
import type { StackEntry } from '../types'
import { hostOf } from './host'
import { BAR, checkRun, json, PANE, prAnswer, START, world, type WorldOptions } from './world'

const entryOf = (number: number, baseRef: string, headRef: string, overrides: Partial<StackEntry> = {}): StackEntry => ({
  number,
  title: `PR ${number}`,
  url: `https://github.com/o/r/pull/${number}`,
  isDraft: false,
  baseRef,
  headRef,
  ci: 'pass',
  ...overrides,
})

/** An open PR as the `open` list answers it. */
const openNode = (number: number, baseRefName: string, headRefName: string, state: string | null, overrides: Record<string, unknown> = {}) => ({
  number,
  title: `Step ${number}`,
  url: `https://github.com/o/r/pull/${number}`,
  isDraft: false,
  baseRefName,
  headRefName,
  isCrossRepository: false,
  commits: { nodes: [{ commit: { statusCheckRollup: state ? { state } : null } }] },
  ...overrides,
})

/** PR #7 on feat/bar, based on #5's feat/api, with #9 on feat/ui based on it. */
const stacked = () => {
  const answer = prAnswer({ baseRefName: 'feat/api' }, [checkRun({ conclusion: 'SUCCESS' })])
  const repository = answer.data.repository as Record<string, unknown>
  repository['open'] = { nodes: [
    openNode(9, 'feat/bar', 'feat/ui', 'FAILURE', { isDraft: true }),
    openNode(12, 'main', 'feat/api', 'SUCCESS', { isCrossRepository: true }),
    openNode(7, 'feat/api', 'feat/bar', 'PENDING'),
    openNode(5, 'main', 'feat/api', 'SUCCESS'),
    openNode(3, 'main', 'feat/other', null),
  ] }
  return answer
}

async function drawn($: Engine, on: On, answer: unknown, target: never) {
  const { clock } = world(on, { http: () => json(answer) })
  await $.session.start(START)
  await clock.settle()
  return $.ui.mount(target)
}

describe('stackOf', () => {
  test('follows parents down to the trunk and children up', async () => {
    const current = entryOf(7, 'feat/b', 'feat/c')
    const open = [
      entryOf(9, 'feat/c', 'feat/d'),
      entryOf(4, 'main', 'feat/a'),
      entryOf(6, 'feat/a', 'feat/b'),
      entryOf(7, 'feat/b', 'feat/c'),
      entryOf(8, 'main', 'feat/x'),
    ]

    expect(stackOf(current, open).map(pr => pr.number)).toEqual([4, 6, 7, 9])
  })

  test('a PR on its own is no stack', async () => {
    expect(stackOf(entryOf(7, 'main', 'feat/c'), [entryOf(8, 'main', 'feat/x')])).toEqual([])
  })

  test('two children: the first listed, the most recently updated, is followed', async () => {
    const open = [entryOf(11, 'feat/c', 'feat/e'), entryOf(10, 'feat/c', 'feat/d')]

    expect(stackOf(entryOf(7, 'main', 'feat/c'), open).map(pr => pr.number)).toEqual([7, 11])
  })

  test('branches based on each other in a loop end the walk', async () => {
    const open = [entryOf(1, 'feat/c', 'feat/b'), entryOf(2, 'feat/b', 'feat/c')]

    expect(stackOf(entryOf(7, 'feat/b', 'feat/c'), open).map(pr => pr.number)).toEqual([2, 1, 7])
  })

  test('position counts from the bottom', async () => {
    const stack = [entryOf(4, 'main', 'a'), entryOf(6, 'a', 'b'), entryOf(7, 'b', 'c')]

    expect(positionOf(stack, 6)).toBe('2/3')
    expect(positionOf(stack, 99)).toBeNull()
    expect(positionOf([], 7)).toBeNull()
  })
})

describe('stackEntryOf', () => {
  test('folds the rollup state, and leaves out forks and nodes without a number', async () => {
    const ci = (state: string | null) => stackEntryOf(openNode(1, 'main', 'a', state))?.ci

    expect([ci('SUCCESS'), ci('FAILURE'), ci('ERROR'), ci('PENDING'), ci('EXPECTED'), ci(null), ci('NEW')]).toEqual([
      'pass', 'fail', 'fail', 'pending', 'pending', 'none', 'none',
    ])
    expect(stackEntryOf(openNode(1, 'main', 'a', null, { isCrossRepository: true }))).toBeNull()
    expect(stackEntryOf({})).toBeNull()
    expect(stackEntryOf({ number: 2 })).toEqual({
      number: 2, title: '', url: '', isDraft: false, baseRef: '', headRef: '', ci: 'none',
    })
  })
})

describe('parseResponse', () => {
  test('reads the stack, the current PR with its own checks', async () => {
    const outcome = parseResponse(JSON.stringify(stacked()))
    if (outcome.kind !== 'ok' || !outcome.pr) throw new Error('no pr')

    expect(outcome.pr.stack.map(pr => [pr.number, pr.ci])).toEqual([[5, 'pass'], [7, 'pass'], [9, 'fail']])
  })

  test('no open list is no stack', async () => {
    const outcome = parseResponse(JSON.stringify(prAnswer()))

    expect(outcome.kind === 'ok' && outcome.pr?.stack).toEqual([])
  })
})

describe('stack in the bar and pane', () => {
  test('the compact bar shows the position', async ($, on) => {
    const ui = await drawn($, on, stacked(), BAR)

    expect(await ui.find({ type: 'Text', text: 'stack 2/3' })).toBeDefined()
  })

  test('the full bar shows the position', { options: { barLayout: 'full' } }, async ($, on) => {
    const ui = await drawn($, on, stacked(), BAR)

    expect(await ui.find({ type: 'Text', text: ' · stack 2/3' })).toBeDefined()
  })

  test('no stack, no position', async ($, on) => {
    const ui = await drawn($, on, prAnswer(), BAR)

    expect(await ui.find({ type: 'Text', text: /stack/ })).toBeUndefined()
  })

  test('the pane lists the stack top first, the others to check out or open', async ($, on) => {
    const pane = await drawn($, on, stacked(), PANE)

    expect(await pane.find({ type: 'Text', text: 'Stack (2/3)' })).toBeDefined()
    expect((await pane.find({ type: 'Button', key: 'checkout:9' }))?.props).toMatchObject({ label: '#9 Step 9 · draft' })
    expect(await pane.find({ type: 'Text', text: '#7 Add the bar' })).toBeDefined()
    expect((await pane.find({ type: 'Button', key: 'checkout:5' }))?.props).toMatchObject({ label: '#5 Step 5' })
    expect((await pane.findAll({ type: 'Link', text: '↗' })).map(link => link.props['href'])).toEqual([
      'https://github.com/o/r/pull/9',
      'https://github.com/o/r/pull/5',
    ])
    expect(await pane.find({ type: 'Text', text: '    main' })).toBeDefined()
    expect(await pane.find({ type: 'Text', text: '  ✗' })).toBeDefined()
    expect(await pane.find({ type: 'Text', text: '❯ ✓' })).toBeDefined()
  })

  test('a PR with no stack has no Stack section', async ($, on) => {
    const pane = await drawn($, on, prAnswer(), PANE)

    expect(await pane.find({ type: 'Text', text: /^Stack/ })).toBeUndefined()
  })
})

/** A run answering each git step by its subcommand; any step left out succeeds. */
const git =
  (answers: Record<string, { exitCode: number; stdout?: string; stderr?: string }> = {}) =>
  async (argv: readonly string[]) => ({ stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false, exitCode: 0, ...answers[argv[1] ?? ''] })

describe('checkoutBranch', () => {
  test('fetches the branch, switches to it and fast-forwards it', async () => {
    const ran: string[][] = []
    const host = hostOf({
      run: async argv => {
        ran.push([...argv])
        return git()(argv)
      },
    })

    expect(await checkoutBranch(host, 'feat/ui')).toEqual({ kind: 'ok', hasDiverged: false })
    expect(ran).toEqual([
      ['git', 'status', '--porcelain', '--untracked-files=no'],
      ['git', 'fetch', '--quiet', 'origin', '+refs/heads/feat/ui:refs/remotes/origin/feat/ui'],
      ['git', 'checkout', '--quiet', 'feat/ui'],
      ['git', 'merge', '--ff-only', '--quiet', 'origin/feat/ui'],
    ])
  })

  test('a local branch that has diverged is left as is', async () => {
    const host = hostOf({ run: git({ merge: { exitCode: 128 } }) })

    expect(await checkoutBranch(host, 'feat/ui')).toEqual({ kind: 'ok', hasDiverged: true })
  })

  test('changed tracked files stop it before anything moves', async () => {
    const ran: string[] = []
    const host = hostOf({
      run: async argv => {
        ran.push(argv[1] ?? '')
        return git({ status: { exitCode: 0, stdout: ' M src/app.ts\n' } })(argv)
      },
    })

    expect(await checkoutBranch(host, 'feat/ui')).toEqual({ kind: 'dirty' })
    expect(ran).toEqual(['status'])
  })

  test("a failing step says git's first line, else what failed", async () => {
    const failing = (step: string, answer: { stdout?: string; stderr?: string }) =>
      checkoutBranch(hostOf({ run: git({ [step]: { exitCode: 1, ...answer } }) }), 'feat/ui')

    expect(await failing('status', { stderr: '\nfatal: not a git repository\nmore' })).toEqual({
      kind: 'failed',
      detail: 'fatal: not a git repository',
    })
    expect(await failing('fetch', { stdout: 'no route' })).toEqual({ kind: 'failed', detail: 'no route' })
    expect(await failing('checkout', {})).toEqual({ kind: 'failed', detail: 'git checkout failed' })
  })

  test('a run that throws is a failure', async () => {
    const thrown = (error: unknown) =>
      checkoutBranch(hostOf({ run: async () => { throw error } }), 'feat/ui')

    expect(await thrown(new Error('no process here'))).toEqual({ kind: 'failed', detail: 'no process here' })
    expect(await thrown('odd')).toEqual({ kind: 'failed', detail: 'could not run git' })
  })
})

describe('checking out from the pane', () => {
  async function paneWith($: Engine, on: On, run: WorldOptions['run']) {
    const w = world(on, { http: () => json(stacked()), run })
    await $.session.start(START)
    await w.clock.settle()
    return { ...w, pane: await $.ui.mount(PANE) }
  }

  test('pressing a stacked PR checks out its branch and asks GitHub again', async ($, on) => {
    let head = (_branch: string) => {}
    const w = await paneWith($, on, async argv => {
      if (argv[1] === 'checkout') head(argv[3] ?? '')
      return { exitCode: 0 }
    })
    head = branch => {
      w.state.head = `ref: refs/heads/${branch}\n`
    }
    const asked = w.requests.length

    await w.pane.press({ key: 'checkout:9' })
    await w.clock.settle()

    expect(w.ran.map(argv => argv[1])).toEqual(['status', 'fetch', 'checkout', 'merge'])
    expect(w.toasts).toContain('Checked out feat/ui')
    expect(w.state.head).toBe('ref: refs/heads/feat/ui\n')
    expect(w.requests.length).toBeGreaterThan(asked)
  })

  test('a diverged local branch is said so', async ($, on) => {
    const w = await paneWith($, on, async argv => ({ exitCode: argv[1] === 'merge' ? 128 : 0 }))

    await w.pane.press({ key: 'checkout:5' })
    await w.clock.settle()

    expect(w.toasts).toContain('Checked out feat/api; it has commits origin lacks, so it was not updated')
  })

  test('changed files refuse, and a failing step says why', async ($, on) => {
    let status = { exitCode: 0, stdout: ' M a.ts' }
    const w = await paneWith($, on, async argv => (argv[1] === 'status' ? status : { exitCode: 1, stdout: 'fatal: no such branch' }))

    await w.pane.press({ key: 'checkout:9' })
    await w.clock.settle()
    expect(w.toasts).toContain('Commit or stash your changes before checking out feat/ui')

    status = { exitCode: 0, stdout: '' }
    await w.pane.press({ key: 'checkout:9' })
    await w.clock.settle()
    expect(w.toasts).toContain('Could not check out feat/ui: fatal: no such branch')
  })

  test('the row says it is checking out, and a second press waits for the first', async ($, on) => {
    let release = () => {}
    const fetched = new Promise<void>(resolve => {
      release = resolve
    })
    const w = await paneWith($, on, async argv => {
      if (argv[1] === 'fetch') await fetched
      return { exitCode: 0 }
    })

    await w.pane.press({ key: 'checkout:9' })
    await w.pane.redraw()

    expect((await w.pane.find({ type: 'Button', key: 'checkout:9' }))?.props).toMatchObject({ label: 'checking out feat/ui…' })

    await w.pane.press({ key: 'checkout:5' })
    release()
    await w.clock.settle()
    await w.pane.redraw()

    expect(w.ran.filter(argv => argv[1] === 'status')).toHaveLength(1)
    expect((await w.pane.find({ type: 'Button', key: 'checkout:9' }))?.props).toMatchObject({ label: '#9 Step 9 · draft' })
  })
})
