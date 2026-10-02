import type { PluginOptions, Register, Timer } from 'claude-code'

import type { Check, Comment, DescriptionImage, PullRequest, RepoRef } from '../types'
import { locateCheckout, readRepoRef, type Checkout } from './git/locate'
import { fetchJobLogTail, fetchPullRequest, messageOf } from './github/client'
import { resolveToken } from './github/token'
import type { Host, View } from './host'
import { DESCRIPTION_IMAGES, descriptionPartsOf, pngSizeOf } from './model/description'
import { armCheck, armComment, ARMED_MAX_CHARS, contextOf, withArmed } from './model/armed'
import { HEAD_POLL_MS, isPrMovingCommand, nextPollMs, rateLimitWaitMs } from './model/cadence'
import { hasTurnedRed, rollupOf, type Rollup } from './model/rollup'
import { lastReadKey, openedKey } from './model/unread'
import { barView } from './views/bar'
import { paneView } from './views/pane'

/** The detail pane's id. */
const PANE = 'pr-bar'
/** Prompts that enter on their own, not sent by the person: they carry no attachments. */
const NOT_THE_PERSON = new Set(['task-notification', 'scheduled-trigger', 'peer'])
/** The largest description image fetched: what `Image` draws from bytes. */
const IMAGE_MAX_BYTES = 2 * 1024 * 1024

/** Everything the bar and pane draw from, the toggles seeded from the settings. */
function initialView(options: PluginOptions): View {
  return {
    showPassing: options['showPassingChecks'] === true,
    showConversation: options['showConversation'] === true,
    showResolved: options['showResolved'] === true,
    repo: null,
    snapshot: null,
    problem: null,
    lastRead: 0,
    armed: [],
    selection: null,
    logs: {},
    expanded: [],
    showDescription: false,
    images: {},
  }
}

const sameRepo = (a: RepoRef | null, b: RepoRef | null): boolean =>
  a?.owner === b?.owner && a?.name === b?.name && a?.branch === b?.branch

/**
 * The PR / CI bar: a bar above the prompt with the branch's PR, its CI
 * rollup and unread comments, polled from GitHub's GraphQL API through
 * `$.http`; `/pr` and the bar's Details toggle a pane listing checks and
 * comments, whose Attach to prompt buttons add context to the next prompt.
 */
export const register: Register = (on, options) => {
  let host: Host | null = null
  let checkout: Checkout | null = null
  let token: string | null = null
  let pollTimer: Timer | null = null
  let headTimer: Timer | null = null
  let isPolling = false
  let isPollQueued = false
  let previous: { prNumber: number; overall: Rollup['overall'] } | null = null
  let loadingLog: string | null = null
  /** The branch the last poll found no PR for: a PR showing up on it was just opened. */
  let branchWithoutPr: string | null = null
  const opensOnNewPr = options['openOnNewPr'] !== false
  let view: View = initialView(options)
  /** Whether the folder has been read for a github.com branch yet. */
  let hasLookedForRepo = false
  const layout = options['barLayout'] === 'full' ? 'full' : 'compact'

  /** Changes what the bar and pane draw, and redraws them. */
  function setView(engine: Host, patch: Partial<View>): void {
    view = { ...view, ...patch }
    engine.invalidate()
  }

  function schedule(engine: Host, ms: number): void {
    pollTimer?.cancel()
    pollTimer = engine.after(ms, () => void poll(engine))
  }

  /** Reads HEAD; on a new branch, clears what belonged to the old one. */
  async function syncRepo(engine: Host): Promise<RepoRef | null> {
    if (!checkout) {
      return null
    }

    const next = await readRepoRef(engine, checkout)

    hasLookedForRepo = true

    if (!sameRepo(view.repo, next)) {
      setView(engine, { repo: next, snapshot: null, selection: null, logs: {} })
      previous = null
    }

    return next
  }

  async function poll(engine: Host): Promise<void> {
    if (isPolling) {
      isPollQueued = true

      return
    }

    isPolling = true

    try {
      await pollOnce(engine)
    } catch (error) {
      // Whatever broke, say so and try again later rather than stall.
      setView(engine, {
        problem: {
          kind: 'offline',
          detail: String(error).replace(/^Error: /, ''),
        },
      })
      schedule(engine, nextPollMs('failed'))
    } finally {
      isPolling = false

      if (isPollQueued) {
        isPollQueued = false
        schedule(engine, 0)
      }
    }
  }

  async function pollOnce(engine: Host): Promise<void> {
    const repo = await syncRepo(engine)

    if (!repo) {
      return
    }

    token ??= await resolveToken(engine, options)

    if (!token) {
      setView(engine, { problem: { kind: 'no-token' } })
      schedule(engine, nextPollMs('failed'))

      return
    }

    const outcome = await fetchPullRequest(engine, token, repo)

    if (outcome.kind !== 'ok') {
      if (outcome.kind === 'token-rejected') {
        token = null
      }

      const waitMs =
        outcome.kind === 'rate-limited'
          ? rateLimitWaitMs(outcome.retryAfterMs)
          : nextPollMs('failed')
      const problem: View['problem'] =
        outcome.kind === 'rate-limited'
          ? { kind: 'rate-limited', waitMs }
          : outcome.kind === 'token-rejected'
            ? { kind: 'token-rejected' }
            : { kind: 'offline', detail: outcome.detail }

      // The last answer stays on screen, marked stale, until GitHub answers again.
      setView(engine, { problem })
      schedule(engine, waitMs)

      return
    }

    // The branch moved while the request was out: ask again for the new one.
    if (!sameRepo(view.repo, repo)) {
      isPollQueued = true

      return
    }

    const { pr, viewer } = outcome
    const fetchedAt = await engine.now()

    const stored = pr ? await engine.storeGet(lastReadKey(repo, pr.number)) : 0

    setView(engine, {
      snapshot: { repo, viewer, pr, fetchedAt },
      problem: null,
      lastRead: typeof stored === 'number' ? stored : 0,
    })
    void loadImages(engine)

    if (!pr) {
      previous = null
      branchWithoutPr = repo.branch
      schedule(engine, nextPollMs('settled'))

      return
    }

    if (branchWithoutPr === repo.branch) {
      branchWithoutPr = null
      await openOnNewPr(engine, repo, pr)
    }

    const rollup = rollupOf(pr.checks)
    const current = { prNumber: pr.number, overall: rollup.overall }

    if (hasTurnedRed(previous, current)) {
      const names = rollup.ordered
        .filter(check => check.state === 'fail')
        .map(check => check.name)

      engine.toast(`CI failed on #${pr.number}: ${names.slice(0, 2).join(', ')}`, {
        timeoutMs: 8000,
      })
    }

    previous = current
    schedule(engine, nextPollMs(rollup.pending > 0 ? 'pending' : 'settled'))
  }

  async function start(engine: Host): Promise<void> {
    checkout = await locateCheckout(engine)

    if (!checkout) {
      hasLookedForRepo = true
      setView(engine, { repo: null })

      return
    }

    let lastBranch: string | null = null

    headTimer?.cancel()
    headTimer = engine.every(HEAD_POLL_MS, () => {
      void (async () => {
        const repo = checkout ? await readRepoRef(engine, checkout) : null
        const branch = repo?.branch ?? ''

        if (lastBranch !== null && branch !== lastBranch) {
          schedule(engine, 0)
        }

        lastBranch = branch
      })()
    })

    await poll(engine)
  }

  async function currentPr(): Promise<PullRequest | null> {
    return view.snapshot?.pr ?? null
  }

  async function togglePane(engine: Host): Promise<boolean> {
    if ((await engine.panes()).some(pane => pane.id === PANE)) {
      await engine.closePane({ id: PANE })

      return false
    }

    await engine.openPane({ id: PANE, title: 'Pull request', focus: true, closeOnEscape: true })

    return true
  }

  /**
   * Opens the pane once for a PR opened while the session watched its
   * branch, as by `gh pr create`; never for one that was already open.
   */
  async function openOnNewPr(engine: Host, repo: RepoRef, pr: PullRequest): Promise<void> {
    const key = openedKey(repo, pr.number)

    if (!opensOnNewPr || (await engine.storeGet(key)) === true) {
      return
    }

    await engine.storeSet(key, true)

    if (!(await engine.panes()).some(pane => pane.id === PANE)) {
      await engine.openPane({ id: PANE, title: 'Pull request', closeOnEscape: true })
    }
  }

  async function markRead(engine: Host): Promise<void> {
    const snapshot = view.snapshot

    if (!snapshot?.pr) {
      return
    }

    const now = await engine.now()
    await engine.storeSet(lastReadKey(snapshot.repo, snapshot.pr.number), now)
    setView(engine, { lastRead: now })
  }

  async function logFor(engine: Host, check: Check): Promise<string | null> {
    const known = view.logs[check.id]
    const repo = view.repo

    if (known !== undefined) {
      return known
    }

    if (check.jobId === null || !token || !repo) {
      return null
    }

    loadingLog = check.id
    engine.invalidate()

    try {
      const tail = await fetchJobLogTail(engine, token, repo, check.jobId)
      setView(engine, { logs: { ...view.logs, [check.id]: tail } })

      return tail
    } catch (error) {
      engine.toast(`Could not fetch the log for ${check.name}: ${messageOf(error, 'unknown error')}`)

      return null
    } finally {
      loadingLog = null
      engine.invalidate()
    }
  }

  /** A folder of this session's for fetched images, made on first use. */
  let imageFolder: Promise<string> | null = null
  let imageCount = 0

  /** Fetches one description image to a file and reads it back: a PNG to draw, else a link. */
  async function imageOf(engine: Host, src: string): Promise<DescriptionImage> {
    const link: DescriptionImage = { kind: 'link' }

    if (!src.startsWith('https://')) {
      return link
    }

    try {
      imageFolder ??= engine.run(['mktemp', '-d']).then(made => {
        if (made.exitCode !== 0) {
          throw new Error(made.stderr)
        }

        return made.stdout.trim()
      })
      const path = `${await imageFolder}/image-${imageCount++}.png`
      // GitHub's rendered sources are signed for a few minutes and need no token.
      const got = await engine.run(
        ['curl', '-sSfL', '--max-time', '20', '--max-filesize', String(IMAGE_MAX_BYTES), '-o', path, src],
        { timeoutMs: 30_000 },
      )

      if (got.exitCode !== 0) {
        return link
      }

      const { base64 } = await engine.readBytes(path)
      const size = pngSizeOf(base64)

      return size ? { kind: 'png', base64, ...size } : link
    } catch {
      return link
    }
  }

  /** Fetches the open description's first images, one at a time, each once a session. */
  async function loadImages(engine: Host): Promise<void> {
    const pr = view.snapshot?.pr

    if (!pr || !view.showDescription) {
      return
    }

    const images = descriptionPartsOf(pr.body).flatMap(part => (part.kind === 'image' ? [part] : []))
    // GitHub's rendering is matched to the markdown by order, so only when they agree.
    const isMatched = images.length === pr.imageSrcs.length

    for (const [index, image] of images.slice(0, DESCRIPTION_IMAGES).entries()) {
      const fetchSrc = isMatched ? pr.imageSrcs[index] : undefined

      if (view.images[image.src]) {
        continue
      }

      if (fetchSrc === undefined) {
        setView(engine, { images: { ...view.images, [image.src]: { kind: 'link' } } })
        continue
      }

      setView(engine, { images: { ...view.images, [image.src]: { kind: 'loading' } } })
      const got = await imageOf(engine, fetchSrc)
      setView(engine, { images: { ...view.images, [image.src]: got } })
    }
  }

  async function fixCi(engine: Host, check: Check): Promise<void> {
    const pr = await currentPr()

    if (!pr) {
      return
    }

    const item = armCheck(pr, check, await logFor(engine, check))
    setView(engine, { armed: withArmed(view.armed, item) })
    engine.toast(`Attached ${item.label} to your next prompt`)
  }

  async function address(engine: Host, comment: Comment): Promise<void> {
    const pr = await currentPr()

    if (!pr) {
      return
    }

    const item = armComment(pr, comment)
    setView(engine, { armed: withArmed(view.armed, item) })
    engine.toast(`Attached ${item.label} to your next prompt`)
  }

  /**
   * Attaches `comments` (every unread one, oldest first) whole: one that would
   * take the attachments past what a prompt carries is left out and counted.
   */
  async function attachAll(engine: Host, comments: readonly Comment[]): Promise<void> {
    const pr = await currentPr()

    if (!pr) {
      return
    }

    let armed = view.armed
    let added = 0
    let left = 0

    for (const comment of comments) {
      const next = withArmed(armed, armComment(pr, comment))

      if (next.reduce((sum, item) => sum + item.text.length, 0) > ARMED_MAX_CHARS) {
        left += 1
        continue
      }

      added += next.length - armed.length
      armed = next
    }

    setView(engine, { armed })
    engine.toast(
      `Attached ${added} unread comment${added === 1 ? '' : 's'} to your next prompt` +
        (left > 0 ? `; ${left} did not fit and ${left === 1 ? 'was' : 'were'} left out` : ''),
    )
  }

  on('session.start', async ($, e, next) => {
    host = {
      now: () => $.clock.now(),
      after: (ms, fn) => $.clock.after(ms, fn),
      every: (ms, fn) => $.clock.every(ms, fn),
      cwd: () => $.session.cwd(),
      repo: () => $.session.repo(),
      exists: path => $.fs.exists(path),
      stat: path => $.fs.stat(path),
      readFile: path => $.fs.read(path),
      readBytes: path => $.fs.read(path, { as: 'bytes' }),
      envGet: name =>
        name === 'GH_TOKEN' ? $.env.get('GH_TOKEN') : $.env.get('GITHUB_TOKEN'),
      run: (argv, init) => $.process.run(argv, init),
      fetch: (url, init) => $.http.fetch(url, init),
      storeGet: key => $.store.get(key),
      storeSet: (key, value) => $.store.set(key, value),
      toast: (text, toastOptions) => $.ui.toast(text, toastOptions),
      invalidate: () => $.ui.invalidate('ui.render'),
      panes: () => $.ui.panes(),
      openPane: pane => $.ui.open(pane),
      closePane: pane => $.ui.close(pane),
    }

    await $.command.register({
      name: 'pr',
      description: "Toggle the pane with this branch's PR checks and review comments",
      immediate: true,
    })

    void start(host)

    return next(e)
  })

  on('command.run', { command: 'pr' }, async () => {
    if (!host) {
      return { text: 'PrBar has not started yet' }
    }

    return { text: (await togglePane(host)) ? 'PR pane opened' : 'PR pane closed' }
  })

  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    const ran = await next(e)

    if (host && ran.deny === undefined && isPrMovingCommand(e.command)) {
      schedule(host, 1500)
    }

    return ran
  })

  on('prompt.submit', async ($, e, next) => {
    const armed = view.armed
    // Only a prompt the person sent carries what they attached, not a background task's or another session's.
    const origin: string | undefined = (e.origin as { kind: string } | undefined)?.kind

    if (armed.length === 0 || !host || (origin !== undefined && NOT_THE_PERSON.has(origin))) {
      return next(e)
    }

    const existing = (e.context ?? []).reduce((sum, block) => sum + block.length, 0)
    const { blocks, dropped } = contextOf(armed, ARMED_MAX_CHARS - existing)

    setView(host, { armed: [] })

    if (dropped.length > 0) {
      $.ui.toast(`${dropped.length} attachment(s) did not fit the prompt and were dropped`)
    }

    const entered = await next({ ...e, context: [...(e.context ?? []), ...blocks] })

    if (entered.drop !== undefined) {
      // The prompt never entered: keep the attachments for the next one.
      setView(host, { armed })

      return entered
    }

    const sent = armed.filter(item => !dropped.includes(item))

    if (sent.length > 0) {
      $.ui.log(`📎 Attached to this prompt: ${sent.map(item => item.label).join(', ')}`)
    }

    return entered
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const repo = view.repo
    const engine = host

    if (e.props.hasSurvey || !repo || !engine) {
      return next(e)
    }

    const tree = barView(
      $.ui.resolve(e),
      {
        repo,
        snapshot: view.snapshot,
        problem: view.problem,
        lastRead: view.lastRead,
        armed: view.armed,
        now: await $.clock.now(),
        layout,
        showConversation: view.showConversation,
      },
      {
        details: () => void togglePane(engine),
        markRead: () => void markRead(engine),
        refresh: () => schedule(engine, 0),
        disarm: id =>
          setView(engine, { armed: view.armed.filter(item => item.id !== id) }),
        disarmAll: () => setView(engine, { armed: [] }),
      },
    )

    return tree ?? next(e)
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Text } = $.ui.resolve(e)
    const engine = host

    if (!engine) {
      return <Text dimColor>Starting…</Text>
    }

    return paneView(
      $.ui.resolve(e),
      {
        snapshot: view.snapshot,
        problem: view.problem,
        // Until the folder has been read, the pane asks rather than says there is no branch.
        hasRepo: view.repo !== null || !hasLookedForRepo,
        lastRead: view.lastRead,
        selection: view.selection,
        logs: view.logs,
        armedIds: view.armed.map(item => item.id),
        loadingLog,
        columns: e.props.bodyColumns,
        showPassing: view.showPassing,
        showConversation: view.showConversation,
        showResolved: view.showResolved,
        expanded: view.expanded,
        showDescription: view.showDescription,
        canDrawImages: e.surface === 'terminal',
        images: view.images,
      },
      {
        select: selection => setView(engine, { selection }),
        loadLog: check => void logFor(engine, check),
        fixCi: check => void fixCi(engine, check),
        address: comment => void address(engine, comment),
        attachUnread: comments => void attachAll(engine, comments),
        markRead: () => void markRead(engine),
        refresh: () => schedule(engine, 0),
        togglePassing: () => setView(engine, { showPassing: !view.showPassing }),
        toggleConversation: () =>
          setView(engine, { showConversation: !view.showConversation }),
        toggleResolved: () => setView(engine, { showResolved: !view.showResolved }),
        toggleDescription: () => {
          setView(engine, { showDescription: !view.showDescription })
          void loadImages(engine)
        },
        toggleMore: list =>
          setView(engine, {
            expanded: view.expanded.includes(list)
              ? view.expanded.filter(open => open !== list)
              : [...view.expanded, list],
          }),
      },
    )
  })
}
