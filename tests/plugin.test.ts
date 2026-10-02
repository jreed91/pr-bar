import { describe, expect, test } from 'claude-code/testing'

import { BAR, json, NO_PR, PANE, prAnswer, START, world } from './world'

describe('outside a checkout', () => {
  test('the bar stays hidden and a PR-moving command polls nothing', async ($, on) => {
    const { clock, requests } = world(on, { remote: null })
    await $.session.start(START)
    await clock.settle()
    await $.tool.call({ tool: 'Bash', command: 'git push' } as never)
    await clock.advance(2_000)

    expect(requests).toHaveLength(0)
    const ui = await $.ui.mount(BAR)
    expect(await ui.find({ type: 'Text', text: 'drawn by the engine' })).toBeDefined()
  })

  test('before the session starts, /pr says so and the pane waits', async ($, on) => {
    world(on)

    expect(await $.command.run({ command: 'pr', args: '' } as never)).toMatchObject({ text: 'PrBar has not started yet' })
    const pane = await $.ui.mount(PANE)
    expect(await pane.find({ type: 'Text', text: 'Starting…' })).toBeDefined()
  })
})

describe('/pr', () => {
  test('opens the pane, and closes it when it is open', async ($, on) => {
    const { clock, state, opened, closed } = world(on)
    await $.session.start(START)
    await clock.settle()

    expect(await $.command.run({ command: 'pr', args: '' } as never)).toMatchObject({ text: 'PR pane opened' })
    expect(opened).toEqual(['pr-bar'])

    state.panes = [{ id: 'pr-bar' }]
    expect(await $.command.run({ command: 'pr', args: '' } as never)).toMatchObject({ text: 'PR pane closed' })
    expect(closed).toEqual(['pr-bar'])
  })

  test("the bar's details button toggles it too", async ($, on) => {
    const { clock, opened } = world(on)
    await $.session.start(START)
    await clock.settle()
    const ui = await $.ui.mount(BAR)

    await ui.press({ key: 'details' })
    await clock.settle()
    expect(opened).toEqual(['pr-bar'])
  })
})

describe('polling', () => {
  test('a Bash command that moves the PR refreshes soon; a denied or unrelated one does not', async ($, on) => {
    const { clock, requests, state } = world(on)
    await $.session.start(START)
    await clock.settle()

    await $.tool.call({ tool: 'Bash', command: 'ls' } as never)
    state.deny = 'not allowed'
    await $.tool.call({ tool: 'Bash', command: 'git push' } as never)
    await clock.advance(1_500)
    expect(requests).toHaveLength(1)

    state.deny = undefined
    await $.tool.call({ tool: 'Bash', command: 'git push' } as never)
    await clock.advance(1_500)
    expect(requests).toHaveLength(2)
  })

  test('a poll asked for while one is out runs once that one ends', async ($, on) => {
    let release = () => {}
    const gate = new Promise<void>(resolve => {
      release = resolve
    })
    const { clock, requests } = world(on, {
      http: async () => {
        await gate
        return json(prAnswer())
      },
    })
    await $.session.start(START)
    const pane = await $.ui.mount(PANE)
    expect(await pane.find({ type: 'Text', text: 'Asking GitHub…' })).toBeDefined()
    const bar = await $.ui.mount(BAR)
    expect(await bar.find({ type: 'Text', text: 'drawn by the engine' })).toBeDefined()

    await $.tool.call({ tool: 'Bash', command: 'git push' } as never)
    await clock.advance(1_500)
    expect(requests).toHaveLength(1)

    release()
    await clock.settle()
    await clock.advance(0)
    await clock.settle()
    expect(requests).toHaveLength(2)
  })

  test('switching branches polls the new one; detached HEAD hides the bar', async ($, on) => {
    const { clock, state, requests } = world(on, { http: url => json(url && state.head.includes('other') ? NO_PR : prAnswer()) })
    await $.session.start(START)
    await clock.settle()
    await clock.advance(2_000)

    state.head = 'ref: refs/heads/other\n'
    await clock.advance(2_000)
    await clock.settle()
    expect(requests).toHaveLength(2)
    const ui = await $.ui.mount(BAR)
    expect(await ui.find({ type: 'Text', text: /no PR for other/ })).toBeDefined()

    state.head = '3f2a9c0d1e\n'
    await clock.advance(2_000)
    await clock.settle()
    await ui.redraw()
    expect(await ui.find({ type: 'Text', text: 'drawn by the engine' })).toBeDefined()
  })
})

describe('problems', () => {
  test('a rejected token says so and is asked for again', async ($, on) => {
    const { clock, requests } = world(on, { http: () => json({}, 401) })
    await $.session.start(START)
    await clock.settle()
    const ui = await $.ui.mount(BAR)

    expect(await ui.find({ type: 'Text', text: /rejected the token/ })).toBeDefined()
    await clock.advance(5 * 60_000)
    expect(requests).toHaveLength(2)
  })

  test('a rate limit or an outage keeps the last PR, marked stale', async ($, on) => {
    let status = 200
    const { clock } = world(on, { http: () => (status === 200 ? json(prAnswer()) : json({}, status)) })
    await $.session.start(START)
    await clock.settle()
    const ui = await $.ui.mount(BAR)
    expect(await ui.find({ type: 'Text', text: /stale/ })).toBeUndefined()

    status = 429
    await $.tool.call({ tool: 'Bash', command: 'gh pr view' } as never)
    await clock.advance(1_500)
    await ui.redraw()
    expect(await ui.find({ type: 'Text', text: /stale/ })).toBeDefined()

    status = 500
    await clock.advance(5 * 60_000)
    await ui.redraw()
    expect(await ui.find({ type: 'Text', text: /stale/ })).toBeDefined()
  })
})

describe('session restarts', () => {
  test('a restart outside the checkout hides the bar and leaves the last PR be', async ($, on) => {
    const { clock, state, requests } = world(on)
    await $.session.start(START)
    await clock.settle()
    await clock.advance(2_000)

    state.remote = null
    await $.session.start(START)
    await clock.settle()
    await clock.advance(4_000)
    const ui = await $.ui.mount(BAR)

    expect(await ui.find({ type: 'Text', text: 'drawn by the engine' })).toBeDefined()
    expect(requests).toHaveLength(1)
  })
})

describe('a checkout that changes under a poll', () => {
  test("an answer for a checkout the session has left is dropped", async ($, on) => {
    let release = () => {}
    const gate = new Promise<void>(resolve => {
      release = resolve
    })
    const { clock, state, requests } = world(on, {
      http: async () => {
        await gate
        return json(prAnswer())
      },
    })
    await $.session.start(START)
    for (let tries = 0; requests.length === 0 && tries < 100; tries++) await clock.advance(0)
    expect(requests).toHaveLength(1)

    state.remote = null
    await $.session.start(START)
    release()
    await clock.settle()
    await clock.advance(0)
    await clock.settle()

    const pane = await $.ui.mount(PANE)
    expect(await pane.find({ type: 'Text', text: /No GitHub branch here/ })).toBeDefined()
    expect(await pane.find({ type: 'Link', text: '#7' })).toBeUndefined()
    expect(requests).toHaveLength(1)
  })
})

describe('a new PR', () => {
  test('leaves the pane be when it is already open', async ($, on) => {
    let answer: unknown = NO_PR
    const { clock, state, opened, store } = world(on, { http: () => json(answer) })
    await $.session.start(START)
    await clock.settle()

    state.panes = [{ id: 'pr-bar' }]
    answer = prAnswer()
    await clock.advance(90_000)
    await clock.settle()
    expect(opened).toHaveLength(0)
    expect(store['opened:o/r#7']).toBe(true)
  })
})

describe('stale buttons', () => {
  test('Fix CI pressed after the PR went away does nothing', async ($, on) => {
    let answer: unknown = prAnswer()
    const { clock, toasts } = world(on, { http: () => json(answer) })
    await $.session.start(START)
    await clock.settle()
    const pane = await $.ui.mount(PANE)
    await pane.press({ key: 'select:check:CR1' })
    await pane.redraw()

    answer = NO_PR
    await pane.press({ key: 'refresh' })
    await clock.advance(0)
    await clock.settle()
    await pane.press({ key: 'fix-ci' })
    await clock.settle()
    expect(toasts).toHaveLength(0)
  })

  test('a log request that throws is a toast', async ($, on) => {
    const { clock, toasts } = world(on, {
      http: url => {
        if (url.endsWith('/logs')) throw 'connection reset'
        return json(prAnswer())
      },
    })
    await $.session.start(START)
    await clock.settle()
    const pane = await $.ui.mount(PANE)
    await pane.press({ key: 'select:check:CR1' })
    await pane.redraw()

    await pane.press({ key: 'load-log' })
    await clock.settle()
    expect(toasts[0]).toMatch(/^Could not fetch the log for CI \/ test: /)
  })
})

describe('a pane with no answer yet', () => {
  test('says why: a rejected token', async ($, on) => {
    const { clock } = world(on, { http: () => json({}, 401) })
    await $.session.start(START)
    await clock.settle()
    const pane = await $.ui.mount(PANE)
    expect(await pane.find({ type: 'Text', text: /GitHub rejected the token \(401\)/ })).toBeDefined()
  })

  test('says why: a rate limit', async ($, on) => {
    const { clock } = world(on, { http: () => json({}, 429) })
    await $.session.start(START)
    await clock.settle()
    const pane = await $.ui.mount(PANE)
    expect(await pane.find({ type: 'Text', text: /GitHub rate-limited the requests/ })).toBeDefined()
  })

  test('says so when no token can be found', async ($, on) => {
    const { clock } = world(on, { env: {} })
    await $.session.start(START)
    await clock.settle()
    const pane = await $.ui.mount(PANE)
    expect(await pane.find({ type: 'Text', text: /No GitHub token/ })).toBeDefined()
  })

  test('a poll that throws is shown and tried again, never left to stall', async ($, on) => {
    let broken = true
    const store = new Proxy({} as Record<string, unknown>, {
      get: () => {
        if (broken) throw new Error('store unavailable')
        return undefined
      },
    })
    const { clock, requests } = world(on, { http: () => json(prAnswer()), store })
    await $.session.start(START)
    await clock.settle()
    const pane = await $.ui.mount(PANE)
    expect(await pane.find({ type: 'Text', text: /Could not reach GitHub: / })).toBeDefined()

    broken = false
    await clock.advance(5 * 60_000)
    await pane.redraw()
    expect(requests).toHaveLength(2)
    expect(await pane.find({ type: 'Link', text: '#7' })).toBeDefined()
  })
})
