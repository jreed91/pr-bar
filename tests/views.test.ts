import type { On } from 'claude-code'
import { describe, expect, test, type Engine } from 'claude-code/testing'

import { GIF, PNG_800x400 as PNG } from './description.test'
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

    expect((await pane.find({ type: 'Button', key: 'more:inline' }))?.text).toBe('2 more')
    expect((await pane.find({ type: 'Button', key: 'more:checks' }))?.text).toBe('2 more')
    expect(await pane.find({ type: 'Button', key: 'select:comment:RC0' })).toBeUndefined()
  })

  test('"N more" shows the rest of a list in place, and "show fewer" caps it again', async ($, on) => {
    const many = Array.from({ length: 12 }, (_, n) =>
      inlineComment({ id: `RC${n}`, createdAt: `2026-10-01T10:${String(n).padStart(2, '0')}:00Z` }),
    )
    const talk = Array.from({ length: 6 }, (_, n) => ({
      id: `IC${n}`,
      author: { login: 'bob' },
      body: `note ${n}`,
      createdAt: `2026-10-01T09:${String(n).padStart(2, '0')}:00Z`,
      url: `https://github.com/o/r/pull/7#c${n}`,
    }))
    const answer = prAnswer(
      { comments: { nodes: talk }, reviewThreads: { nodes: [{ isResolved: false, comments: { nodes: many } }] } },
      Array.from({ length: 12 }, (_, n) => failing(n)),
    )
    const { clock } = world(on, { http: () => json(answer) })
    await $.session.start(START)
    await clock.settle()
    const pane = await $.ui.mount(PANE)
    const rows = async (prefix: string) =>
      (await pane.findAll({ type: 'Button' })).filter(button => button.key?.startsWith(prefix)).length

    await pane.press({ key: 'more:inline' })
    await pane.redraw()
    expect(await rows('select:comment:RC')).toBe(12)
    expect((await pane.find({ type: 'Button', key: 'more:inline' }))?.text).toBe('show fewer')

    // A comment that was past the cap now opens under its own row.
    await pane.press({ key: 'select:comment:RC0' })
    await pane.redraw()
    const tree = JSON.stringify(await pane.drawn())
    expect(tree.indexOf('select:comment:RC0')).toBeLessThan(tree.indexOf('"key":"address"'))
    expect(tree.indexOf('"key":"address"')).toBeLessThan(tree.indexOf('more:inline'))

    await pane.press({ key: 'more:checks' })
    await pane.redraw()
    expect(await rows('select:check:')).toBe(12)

    await pane.press({ key: 'toggle-conversation' })
    await pane.redraw()
    expect(await rows('select:comment:IC')).toBe(4)
    expect((await pane.find({ type: 'Button', key: 'more:conversation' }))?.text).toBe('2 more')
    await pane.press({ key: 'more:conversation' })
    await pane.redraw()
    expect(await rows('select:comment:IC')).toBe(6)

    await pane.press({ key: 'more:inline' })
    await pane.redraw()
    expect(await rows('select:comment:RC')).toBe(10)
    expect((await pane.find({ type: 'Button', key: 'more:inline' }))?.text).toBe('2 more')
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

describe('closing the open row', () => {
  test('pressing the open comment or check closes it, and pressing again opens it', async ($, on) => {
    const { clock } = world(on, { http: () => json(prAnswer()) })
    await $.session.start(START)
    await clock.settle()
    const pane = await $.ui.mount(PANE)

    // It opens on the unread comment; pressing it closes it, and nothing takes its place.
    expect(await pane.find({ type: 'Button', key: 'address' })).toBeDefined()
    await pane.press({ key: 'select:comment:RC1' })
    await pane.redraw()
    expect(await pane.find({ type: 'Button', key: 'address' })).toBeUndefined()
    expect(await pane.find({ type: 'Button', key: 'fix-ci' })).toBeUndefined()
    expect(await pane.find({ type: 'Text', text: /Nothing failing/ })).toBeUndefined()

    await pane.press({ key: 'select:comment:RC1' })
    await pane.redraw()
    expect(await pane.find({ type: 'Button', key: 'address' })).toBeDefined()

    await pane.press({ key: 'select:check:CR1' })
    await pane.redraw()
    expect(await pane.find({ type: 'Button', key: 'fix-ci' })).toBeDefined()
    await pane.press({ key: 'select:check:CR1' })
    await pane.redraw()
    expect(await pane.find({ type: 'Button', key: 'fix-ci' })).toBeUndefined()
  })
})

describe('closing an open conversation comment', () => {
  test('works the same as an inline one, and the section folds with its own row', async ($, on) => {
    const talk = { id: 'IC1', author: { login: 'bob' }, body: 'Looks good overall', createdAt: '2026-10-01T11:30:00Z', url: 'https://github.com/o/r/pull/7#c1' }
    const { clock } = world(on, { http: () => json(prAnswer({ comments: { nodes: [talk] }, ...noComments })) })
    await $.session.start(START)
    await clock.settle()
    const pane = await $.ui.mount(PANE)
    await pane.press({ key: 'toggle-conversation' })
    await pane.redraw()

    // Shown, the unread conversation comment is the one open; pressing it closes it.
    expect(await pane.find({ type: 'Button', key: 'address' })).toBeDefined()
    await pane.press({ key: 'select:comment:IC1' })
    await pane.redraw()
    expect(await pane.find({ type: 'Button', key: 'address' })).toBeUndefined()
    await pane.press({ key: 'select:comment:IC1' })
    await pane.redraw()
    expect(await pane.find({ type: 'Button', key: 'address' })).toBeDefined()

    await pane.press({ key: 'toggle-conversation' })
    await pane.redraw()
    expect(await pane.find({ type: 'Button', key: 'select:comment:IC1' })).toBeUndefined()
  })
})

describe('resolved threads', () => {
  const threads = {
    reviewThreads: { nodes: [
      { isResolved: false, comments: { nodes: [inlineComment()] } },
      { isResolved: true, comments: { nodes: [inlineComment({ id: 'RC9', body: 'Settled', createdAt: '2026-10-01T12:00:00Z' })] } },
    ] },
  }

  test('fold into one row that lists them last, dimmed and never new', async ($, on) => {
    const pane = await drawn($, on, prAnswer(threads), PANE)

    expect(await pane.find({ type: 'Text', text: 'Review comments (1, 1 new)' })).toBeDefined()
    expect(await pane.find({ type: 'Button', key: 'select:comment:RC9' })).toBeUndefined()
    expect((await pane.find({ type: 'Button', key: 'toggle-resolved' }))?.text).toBe('1 resolved')

    await pane.press({ key: 'toggle-resolved' })
    await pane.redraw()
    expect(await pane.find({ type: 'Text', text: 'Review comments (2, 1 new)' })).toBeDefined()
    expect((await pane.find({ type: 'Button', key: 'toggle-resolved' }))?.text).toBe('hide 1 resolved')
    const keys = (await pane.findAll({ type: 'Button' })).map(button => button.key).filter(key => key?.startsWith('select:comment:'))
    expect(keys).toEqual(['select:comment:RC1', 'select:comment:RC9'])
    expect(await pane.find({ type: 'Text', text: /✓/ })).toBeDefined()

    await pane.press({ key: 'toggle-resolved' })
    await pane.redraw()
    expect(await pane.find({ type: 'Button', key: 'select:comment:RC9' })).toBeUndefined()
  })

  test('the setting lists them from the start', { options: { showResolved: true } }, async ($, on) => {
    const pane = await drawn($, on, prAnswer(threads), PANE)

    expect(await pane.find({ type: 'Button', key: 'select:comment:RC9' })).toBeDefined()
  })

  test('do not count in the bar', async ($, on) => {
    const resolvedOnly = { reviewThreads: { nodes: [threads.reviewThreads.nodes[1]] } }
    const bar = await drawn($, on, prAnswer(resolvedOnly), BAR)

    expect(await bar.find({ type: 'Text', text: /💬/ })).toBeUndefined()
  })
})

describe('description', () => {
  const asset = (n: number) => `https://github.com/user-attachments/assets/a${n}`
  const signed = (n: number) => `https://private-user-images.githubusercontent.com/${n}.png?jwt=t`
  const described = (count: number, html = count) => prAnswer({
    body: ['Fixes the retry loop.', ...Array.from({ length: count }, (_, n) => `![shot ${n}](${asset(n)})`)].join('\n\n'),
    bodyHTML: Array.from({ length: html }, (_, n) => `<img src="${signed(n)}" alt="shot ${n}">`).join(''),
    ...noComments,
  })
  /** curl writes each signed source to its file; `files` says what each holds. */
  const curl = (files: Record<string, string | null>) => (argv: readonly string[]) => {
    if (argv[0] === 'mktemp') return { exitCode: 0, stdout: '/tmp/prbar\n' }
    const holds = files[argv[argv.length - 1] as string]
    return { exitCode: holds === null ? 22 : 0 }
  }

  test('is one folded row that opens to its text and images, fetched once', async ($, on) => {
    const { clock, ran } = world(on, {
      http: () => json(described(2)),
      run: curl({ [signed(0)]: PNG, [signed(1)]: GIF }),
      bytes: { '/tmp/prbar/image-0.png': PNG, '/tmp/prbar/image-1.png': GIF },
    })
    await $.session.start(START)
    await clock.settle()
    const pane = await $.ui.mount(PANE)

    expect((await pane.find({ type: 'Button', key: 'toggle-description' }))?.text).toBe('Description')
    expect(await pane.find({ type: 'Markdown' })).toBeUndefined()
    expect(ran).toEqual([])

    await pane.press({ key: 'toggle-description' })
    await clock.settle()
    await pane.redraw()
    expect((await pane.find({ type: 'Button', key: 'toggle-description' }))?.text).toBe('hide description')
    expect((await pane.find({ type: 'Markdown' }))?.props).toMatchObject({ text: 'Fixes the retry loop.' })
    expect((await pane.find({ type: 'Image' }))?.props).toMatchObject({ source: { png: PNG }, alt: 'shot 0', columns: 75, rows: 19 })
    // Not a PNG: a link to it instead.
    expect((await pane.find({ type: 'Link', text: '[image: shot 1]' }))?.props).toMatchObject({ href: asset(1) })
    expect(ran.map(argv => argv[0])).toEqual(['mktemp', 'curl', 'curl'])

    // Folded and opened again, and polled again, nothing is fetched twice.
    await pane.press({ key: 'toggle-description' })
    await pane.press({ key: 'toggle-description' })
    await clock.advance(90_000)
    await clock.settle()
    expect(ran).toHaveLength(3)
  })

  test('shows links while fetching, and when a fetch fails', async ($, on) => {
    let release = () => {}
    const waiting = new Promise<void>(resolve => (release = resolve))
    const { clock } = world(on, {
      http: () => json(described(3)),
      run: async argv => {
        if (argv[0] === 'mktemp') return { exitCode: 0, stdout: '/tmp/prbar' }
        if (argv[argv.length - 1] === signed(0)) await waiting
        return { exitCode: argv[argv.length - 1] === signed(1) ? 22 : 0 }
      },
      // image-2 is missing, so reading it throws.
      bytes: { '/tmp/prbar/image-0.png': PNG },
    })
    await $.session.start(START)
    await clock.settle()
    const pane = await $.ui.mount(PANE)
    await pane.press({ key: 'toggle-description' })
    await pane.redraw()

    expect(await pane.find({ type: 'Text', text: / loading…/ })).toBeDefined()
    release()
    await clock.settle()
    await pane.redraw()
    expect(await pane.find({ type: 'Text', text: / loading…/ })).toBeUndefined()
    expect(await pane.findAll({ type: 'Image' })).toHaveLength(1)
    expect(await pane.find({ type: 'Link', text: '[image: shot 1]' })).toBeDefined()
    expect(await pane.find({ type: 'Link', text: '[image: shot 2]' })).toBeDefined()
  })

  test('links without fetching when the rendering does not line up, or past six images', async ($, on) => {
    const { clock, ran } = world(on, { http: () => json(described(7, 6)), run: curl({}) })
    await $.session.start(START)
    await clock.settle()
    const pane = await $.ui.mount(PANE)
    await pane.press({ key: 'toggle-description' })
    await clock.settle()
    await pane.redraw()

    expect(ran).toEqual([])
    expect(await pane.findAll({ type: 'Link', text: /^\[image: shot/ })).toHaveLength(7)
  })

  test('links when no folder can be made, or the source is not https', async ($, on) => {
    const answer = prAnswer({
      body: '![](https://github.com/user-attachments/assets/a0) <img alt="plain" src="http://example.com/b.png">',
      bodyHTML: `<img src="${signed(0)}"><img src="http://example.com/b.png">`,
      ...noComments,
    })
    const { clock, ran } = world(on, { http: () => json(answer), run: () => ({ exitCode: 1 }) })
    await $.session.start(START)
    await clock.settle()
    const pane = await $.ui.mount(PANE)
    await pane.press({ key: 'toggle-description' })
    await clock.settle()
    await pane.redraw()

    expect(ran.map(argv => argv[0])).toEqual(['mktemp'])
    expect(await pane.find({ type: 'Link', text: '[image: image]' })).toBeDefined()
    expect(await pane.find({ type: 'Text', text: '[image: plain]' })).toBeDefined()
  })

  test('outside the terminal an image is its link', async ($, on) => {
    const { clock } = world(on, {
      http: () => json(described(1)),
      run: curl({ [signed(0)]: PNG }),
      bytes: { '/tmp/prbar/image-0.png': PNG },
    })
    await $.session.start(START)
    await clock.settle()
    const pane = await $.ui.mount({ ...(PANE as object), surface: 'desktop' } as never)
    await pane.press({ key: 'toggle-description' })
    await clock.settle()
    await pane.redraw()

    expect(await pane.find({ type: 'Image' })).toBeUndefined()
    expect(await pane.find({ type: 'Link', text: '[image: shot 0]' })).toBeDefined()
  })
})
