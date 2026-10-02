import type { On } from 'claude-code'
import { describe, expect, test, type Engine } from 'claude-code/testing'

import { parseResponse, stackEntryOf } from '../hooks/github/query'
import { positionOf, stackOf } from '../hooks/model/stack'
import type { StackEntry } from '../types'
import { BAR, checkRun, json, PANE, prAnswer, START, world } from './world'

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

  test('the pane lists the stack top first, linking the others', async ($, on) => {
    const pane = await drawn($, on, stacked(), PANE)

    expect(await pane.find({ type: 'Text', text: 'Stack (2/3)' })).toBeDefined()
    expect((await pane.find({ type: 'Link', text: '#9 Step 9 · draft' }))?.props).toMatchObject({ href: 'https://github.com/o/r/pull/9' })
    expect(await pane.find({ type: 'Text', text: '#7 Add the bar' })).toBeDefined()
    expect(await pane.find({ type: 'Link', text: '#5 Step 5' })).toBeDefined()
    expect(await pane.find({ type: 'Text', text: '    main' })).toBeDefined()
    expect(await pane.find({ type: 'Text', text: '  ✗' })).toBeDefined()
    expect(await pane.find({ type: 'Text', text: '❯ ✓' })).toBeDefined()
  })

  test('a PR with no stack has no Stack section', async ($, on) => {
    const pane = await drawn($, on, prAnswer(), PANE)

    expect(await pane.find({ type: 'Text', text: /^Stack/ })).toBeUndefined()
  })
})
