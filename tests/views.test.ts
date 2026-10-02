import type { On } from 'claude-code'
import { describe, expect, test, type Engine } from 'claude-code/testing'

import { BAR, checkRun, inlineComment, json, NO_PR, PANE, prAnswer, START, world } from './world'

const passing = (n: number) => checkRun({ id: `P${n}`, databaseId: 200 + n, name: `pass-${n}`, conclusion: 'SUCCESS' })
const failing = (n: number) => checkRun({ id: `F${n}`, databaseId: 300 + n, name: `fail-${String(n).padStart(2, '0')}` })
const running = checkRun({ id: 'R1', name: 'build', status: 'IN_PROGRESS', conclusion: null })
const noComments = { reviewThreads: { nodes: [] } }

/** Starts a session whose PR is `answer`, and mounts `target`. */
async function drawn($: Engine, on: On, answer: unknown, target: never) {
  const { clock } = world(on, { http: () => json(answer) })
  await $.session.start(START)
  await clock.settle()
  return $.ui.mount(target)
}

describe('compact bar', () => {
  test('running checks, a conflict, no review', async ($, on) => {
    const ui = await drawn($, on, prAnswer({ mergeable: 'CONFLICTING' }, [running, passing(1)]), BAR)

    expect(await ui.find({ type: 'Text', text: '◌ 1 running' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: '⚠ conflict' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /approved|changes|review/ })).toBeUndefined()
  })

  test('all green and approved', async ($, on) => {
    const ui = await drawn($, on, prAnswer({ reviewDecision: 'APPROVED' }, [passing(1)]), BAR)

    expect(await ui.find({ type: 'Text', text: '✓ CI' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: '✓ approved' })).toBeDefined()
  })

  test('a survey above the prompt keeps the bar out of its way', async ($, on) => {
    const { clock } = world(on)
    await $.session.start(START)
    await clock.settle()
    const ui = await $.ui.mount({ ...(BAR as object), props: { ...(BAR as { props: object }).props, hasSurvey: true } } as never)

    expect(await ui.find({ type: 'Text', text: 'drawn by the engine' })).toBeDefined()
  })
})

describe('full bar', () => {
  test('a draft with a conflict, running checks and no failures', { options: { barLayout: 'full' } }, async ($, on) => {
    const ui = await drawn($, on, prAnswer({ isDraft: true, mergeable: 'CONFLICTING', reviewDecision: 'REVIEW_REQUIRED' }, [running]), BAR)

    expect(await ui.find({ type: 'Text', text: /· draft/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /· ⚠ conflict/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /review required/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: '◌ 1' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: '✗ 0' })).toBeDefined()
  })

  test('no checks yet', { options: { barLayout: 'full' } }, async ($, on) => {
    const ui = await drawn($, on, prAnswer({}, []), BAR)

    expect(await ui.find({ type: 'Text', text: 'CI: no checks' })).toBeDefined()
  })

  test('names three failing checks and counts the rest', { options: { barLayout: 'full' } }, async ($, on) => {
    const ui = await drawn($, on, prAnswer({}, [1, 2, 3, 4, 5].map(failing)), BAR)

    expect(await ui.find({ type: 'Text', text: 'CI / fail-01, CI / fail-02, CI / fail-03 +2' })).toBeDefined()
  })

  test('Refresh asks GitHub again', { options: { barLayout: 'full' } }, async ($, on) => {
    const { clock, requests } = world(on)
    await $.session.start(START)
    await clock.settle()
    const ui = await $.ui.mount(BAR)

    await ui.press({ key: 'refresh' })
    await clock.advance(0)
    expect(requests).toHaveLength(2)
  })
})

describe('pane', () => {
  test('a branch with no PR', async ($, on) => {
    const pane = await drawn($, on, NO_PR, PANE)

    expect(await pane.find({ type: 'Text', text: 'No open PR for feat/bar in o/r.' })).toBeDefined()
  })

  test('nothing failing and nothing unread: nothing selected, nothing listed', async ($, on) => {
    const pane = await drawn($, on, prAnswer({ isDraft: true, mergeable: 'CONFLICTING', ...noComments }, []), PANE)

    expect(await pane.find({ type: 'Text', text: /main ← feat\/bar · draft · conflict/ })).toBeDefined()
    expect(await pane.find({ type: 'Text', text: /none reported/ })).toBeDefined()
    expect(await pane.find({ type: 'Text', text: /^ *none$/ })).toBeDefined()
    expect(await pane.find({ type: 'Text', text: /Nothing failing and nothing unread/ })).toBeDefined()
  })

  test('with nothing unread it opens on the first failing check', async ($, on) => {
    const pane = await drawn($, on, prAnswer(noComments, [passing(1), failing(1)]), PANE)

    expect(await pane.find({ type: 'Button', key: 'fix-ci' })).toBeDefined()
  })

  test('long lists stop at ten rows; a pick past them opens at the foot', async ($, on) => {
    const many = Array.from({ length: 12 }, (_, n) =>
      inlineComment({ id: `RC${n}`, createdAt: `2026-10-01T10:${String(n).padStart(2, '0')}:00Z` }),
    )
    const answer = prAnswer(
      { reviewThreads: { nodes: [{ isResolved: false, comments: { nodes: many } }] } },
      Array.from({ length: 12 }, (_, n) => failing(n)),
    )
    const { clock } = world(on, { http: () => json(answer) })
    await $.session.start(START)
    await clock.settle()
    const pane = await $.ui.mount(PANE)

    expect(await pane.findAll({ type: 'Text', text: /\+2 more/ })).toHaveLength(2)

  })

  test('a picked check pushed past the tenth row opens at the foot', async ($, on) => {
    let checks = Array.from({ length: 10 }, (_, n) => failing(n + 1))
    const { clock } = world(on, { http: () => json(prAnswer(noComments, checks)) })
    await $.session.start(START)
    await clock.settle()
    const pane = await $.ui.mount(PANE)
    await pane.press({ key: 'select:check:F10' })
    await pane.redraw()

    checks = [failing(0), ...checks]
    await pane.press({ key: 'refresh' })
    await clock.advance(0)
    await clock.settle()
    await pane.redraw()
    expect(await pane.find({ type: 'Button', key: 'select:check:F10' })).toBeUndefined()
    expect(await pane.find({ type: 'Text', text: /fail-10/ })).toBeDefined()
    expect(await pane.find({ type: 'Button', key: 'fix-ci' })).toBeDefined()
  })

  test('a conversation comment picked while the conversation is folded opens at the foot', async ($, on) => {
    const answer = prAnswer({
      ...noComments,
      comments: { nodes: [{ id: 'IC1', author: { login: 'bob' }, body: 'Looks fine', createdAt: '2026-10-01T11:30:00Z', url: 'https://github.com/o/r/pull/7#c1' }] },
      reviews: { nodes: [{ id: 'RV1', author: { login: 'carol' }, body: '', state: 'CHANGES_REQUESTED', submittedAt: '2026-10-01T11:40:00Z', url: 'https://github.com/o/r/pull/7#v1' }] },
    }, [])
    const pane = await drawn($, on, answer, PANE)

    await pane.press({ key: 'toggle-conversation' })
    await pane.redraw()
    await pane.press({ key: 'select:comment:IC1' })
    await pane.redraw()
    expect(await pane.find({ type: 'Text', text: /^comment$/ })).toBeDefined()

    await pane.press({ key: 'select:comment:RV1' })
    await pane.redraw()
    await pane.press({ key: 'toggle-conversation' })
    await pane.redraw()
    // Folded away, the picked review still shows, at the foot.
    expect(await pane.find({ type: 'Button', key: 'select:comment:RV1' })).toBeUndefined()
    expect(await pane.find({ type: 'Text', text: /review · changes_requested/ })).toBeDefined()
    expect(await pane.find({ type: 'Markdown', text: '_(no text)_' })).toBeDefined()
    expect(await pane.find({ type: 'Button', key: 'toggle-conversation' })).toBeDefined()
  })

  test('a comment on a file rather than a line names the file alone', async ($, on) => {
    const answer = prAnswer({ reviewThreads: { nodes: [{ isResolved: false, comments: { nodes: [inlineComment({ line: null })] } }] } }, [])
    const pane = await drawn($, on, answer, PANE)

    expect(await pane.find({ type: 'Text', text: /^inline · src\/app\.ts$/ })).toBeDefined()
  })
})
