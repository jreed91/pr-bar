import { describe, expect, test, type Engine } from 'claude-code/testing'

import { BAR, checkRun, inlineComment, json, NO_PR, PANE, prAnswer, START, world } from './world'

const LOG = 'https://api.github.com/repos/o/r/actions/jobs/99/logs'

/** GitHub answering the PR query with `answer` and the job log with `log`. */
const github = (log: () => ReturnType<typeof json>, answer = prAnswer()) => (url: string) =>
  url === LOG ? log() : json(answer)

const logOf = (text: string) => ({ status: 200, ok: true, headers: {}, text })

/** The pane with the failing check selected (it opens on the unread comment). */
const paneOnCheck = async ($: Engine) => {
  const pane = await $.ui.mount(PANE)
  await pane.press({ key: 'select:check:CR1' })
  await pane.redraw()
  return pane
}

describe('Fix CI', () => {
  test('loads the log once, and attaches it with the check', async ($, on) => {
    const { clock, requests, toasts } = world(on, { http: github(() => logOf('2026-10-01T12:00:00Z boom')) })
    const submitted: (readonly string[] | undefined)[] = []
    on('prompt.submit', (_$, e) => {
      submitted.push(e.context)
      return { text: e.text, context: e.context }
    })
    await $.session.start(START)
    await clock.settle()
    const pane = await paneOnCheck($)

    expect((await pane.find({ type: 'Button', key: 'load-log' }))?.text).toBe('Load log')
    await pane.press({ key: 'load-log' })
    await clock.settle()
    await pane.redraw()
    expect((await pane.find({ type: 'Code' }))?.text).toBe('boom')
    expect(await pane.find({ type: 'Button', key: 'load-log' })).toBeUndefined()

    await pane.press({ key: 'fix-ci' })
    await clock.settle()
    await pane.redraw()
    expect((await pane.find({ type: 'Button', key: 'fix-ci' }))?.text).toBe('Fix CI (attached)')
    expect(requests.filter(url => url === LOG)).toHaveLength(1)
    expect(toasts).toEqual(['Attached CI / test to your next prompt'])

    await $.prompt.submit({ text: 'fix this', context: ['already here'] } as never)
    expect(submitted[0]?.[0]).toBe('already here')
    expect(submitted[0]?.[1]).toContain('boom')
  })

  test('a log that will not load is a toast, and Fix CI goes without it', async ($, on) => {
    const { clock, toasts } = world(on, { http: github(() => json({}, 500)) })
    await $.session.start(START)
    await clock.settle()
    const pane = await paneOnCheck($)

    await pane.press({ key: 'fix-ci' })
    await clock.settle()
    expect(toasts).toEqual([
      'Could not fetch the log for CI / test: the log answered 500',
      'Attached CI / test to your next prompt',
    ])
  })

  test('an empty log shows as such', async ($, on) => {
    const { clock } = world(on, { http: github(() => logOf('')) })
    await $.session.start(START)
    await clock.settle()
    const pane = await paneOnCheck($)

    await pane.press({ key: 'load-log' })
    await clock.settle()
    await pane.redraw()
    expect((await pane.find({ type: 'Code' }))?.text).toBe('(empty log)')
  })

  test('a check that is not an Actions job has no log to load', async ($, on) => {
    const answer = prAnswer({}, [checkRun({ checkSuite: { app: { slug: 'circleci' } }, detailsUrl: null, title: '3 tests failed' })])
    const { clock, requests } = world(on, { http: github(() => logOf('never'), answer) })
    await $.session.start(START)
    await clock.settle()
    const pane = await paneOnCheck($)

    expect(await pane.find({ type: 'Text', text: /not fetchable here/ })).toBeDefined()
    expect(await pane.find({ type: 'Text', text: '3 tests failed' })).toBeDefined()
    expect(await pane.find({ type: 'Link', text: 'Open' })).toBeUndefined()
    await pane.press({ key: 'fix-ci' })
    await clock.settle()
    expect(requests).not.toContain(LOG)
  })

  test('once the token is rejected, Fix CI attaches the check without its log', async ($, on) => {
    let status = 200
    const { clock, requests, toasts } = world(on, { http: url => (status === 200 ? github(() => logOf('x'))(url) : json({}, status)) })
    await $.session.start(START)
    await clock.settle()
    const pane = await paneOnCheck($)

    status = 401
    await pane.press({ key: 'refresh' })
    await clock.advance(0)
    await clock.settle()
    await pane.redraw()
    await pane.press({ key: 'fix-ci' })
    await clock.settle()
    expect(requests).not.toContain(LOG)
    expect(toasts).toEqual(['Attached CI / test to your next prompt'])
  })
})

describe('attachments', () => {
  test('one that does not fit the prompt is dropped, with a toast', async ($, on) => {
    const { clock, toasts } = world(on)
    const submitted: (readonly string[] | undefined)[] = []
    on('prompt.submit', (_$, e) => {
      submitted.push(e.context)
      return { text: e.text, context: e.context }
    })
    await $.session.start(START)
    await clock.settle()
    const pane = await $.ui.mount(PANE)
    await pane.press({ key: 'address' })
    await clock.settle()

    await $.prompt.submit({ text: 'go', context: ['x'.repeat(39_900)] } as never)
    expect(submitted[0]).toHaveLength(1)
    expect(toasts.at(-1)).toBe('1 attachment(s) did not fit the prompt and were dropped')
  })

  const twoComments = prAnswer({
    reviewThreads: { nodes: [{ isResolved: false, comments: { nodes: [
      inlineComment(),
      inlineComment({ id: 'RC2', path: null, line: null, body: '', author: { login: 'bob' }, createdAt: '2026-10-01T11:30:00Z' }),
    ] } }] },
  })

  /** Attaches both comments from the pane. */
  const addressBoth = async ($: Engine, clock: { settle: () => Promise<void> }) => {
    const pane = await $.ui.mount(PANE)
    for (const id of ['RC1', 'RC2']) {
      await pane.press({ key: `select:comment:${id}` })
      await pane.redraw()
      await pane.press({ key: 'address' })
      await clock.settle()
    }
    await pane.redraw()
    expect((await pane.find({ type: 'Button', key: 'address' }))?.text).toBe('Address (attached)')
    await pane.unmount()
  }

  test('the compact bar counts them and lets them all go', async ($, on) => {
    const { clock } = world(on, { http: () => json(twoComments) })
    await $.session.start(START)
    await clock.settle()
    await addressBoth($, clock)

    const bar = await $.ui.mount(BAR)
    expect((await bar.find({ type: 'Button', key: 'disarm-all' }))?.text).toBe('📎 2 ✕')
    await bar.press({ key: 'disarm-all' })
    await bar.redraw()
    expect(await bar.find({ type: 'Button', key: 'disarm-all' })).toBeUndefined()
  })

  test('the full bar names each and lets one go', { options: { barLayout: 'full' } }, async ($, on) => {
    const { clock } = world(on, { http: () => json(twoComments) })
    await $.session.start(START)
    await clock.settle()
    await addressBoth($, clock)

    const bar = await $.ui.mount(BAR)
    expect((await bar.find({ type: 'Button', key: 'disarm:comment:RC1' }))?.text).toBe('📎 app.ts:3 ✕')
    expect((await bar.find({ type: 'Button', key: 'disarm:comment:RC2' }))?.text).toBe('📎 @bob ✕')
    await bar.press({ key: 'disarm:comment:RC1' })
    await bar.redraw()
    expect(await bar.find({ type: 'Button', key: 'disarm:comment:RC1' })).toBeUndefined()
    expect(await bar.find({ type: 'Button', key: 'disarm:comment:RC2' })).toBeDefined()
  })
})

describe('Mark read and refresh from the pane', () => {
  test('marks the comments read and asks GitHub again', async ($, on) => {
    const { clock, requests, store } = world(on)
    await $.session.start(START)
    await clock.settle()
    const pane = await $.ui.mount(PANE)
    expect(await pane.find({ type: 'Text', text: /Review comments \(1, 1 new\)/ })).toBeDefined()

    await pane.press({ key: 'mark-read' })
    await clock.settle()
    await pane.redraw()
    expect(store['lastRead:o/r#7']).toBeDefined()
    expect(await pane.find({ type: 'Text', text: /Review comments \(1\)/ })).toBeDefined()

    await pane.press({ key: 'refresh' })
    await clock.advance(0)
    expect(requests).toHaveLength(2)
  })

  test('with no PR left, a pressed action does nothing', async ($, on) => {
    let answer: unknown = prAnswer()
    const { clock, store, toasts } = world(on, { http: () => json(answer) })
    await $.session.start(START)
    await clock.settle()
    const pane = await $.ui.mount(PANE)

    answer = NO_PR
    await pane.press({ key: 'refresh' })
    await clock.advance(0)
    await clock.settle()
    // The drawing still holds the PR's buttons until it redraws.
    await pane.press({ key: 'mark-read' })
    await pane.press({ key: 'address' })
    await clock.settle()
    expect(store['lastRead:o/r#7']).toBeUndefined()
    expect(toasts).toHaveLength(0)
  })
})

describe('loading', () => {
  test('Load log says so while the log is on its way', async ($, on) => {
    let release = () => {}
    const gate = new Promise<void>(resolve => {
      release = resolve
    })
    const { clock } = world(on, {
      http: async url => {
        if (url !== LOG) return json(prAnswer())
        await gate
        return logOf('done')
      },
    })
    await $.session.start(START)
    await clock.settle()
    const pane = await paneOnCheck($)

    await pane.press({ key: 'load-log' })
    await pane.redraw()
    expect((await pane.find({ type: 'Button', key: 'load-log' }))?.text).toBe('Loading log…')

    release()
    await clock.settle()
    await pane.redraw()
    expect((await pane.find({ type: 'Code' }))?.text).toBe('done')
  })
})
