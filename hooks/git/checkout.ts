import { messageOf } from '../github/client'
import type { Host } from '../host'

/** What checking out a branch came to. */
export type CheckoutOutcome =
  /** On the branch; `hasDiverged` when the local one has commits origin lacks, so it was not fast-forwarded. */
  | { kind: 'ok'; hasDiverged: boolean }
  /** Tracked files have changes, so nothing was touched. */
  | { kind: 'dirty' }
  | { kind: 'failed'; detail: string }

/** The first line git said, for a toast. */
const firstLineOf = (text: string): string =>
  text
    .split('\n')
    .map(line => line.trim())
    .find(Boolean) ?? ''

/**
 * Checks out `branch` from origin in the session's folder, as `gh pr
 * checkout` would: refuses when tracked files have changes, fetches the
 * branch (force-pushed stacks included), switches to it, creating it to
 * track origin's when there is no local one, then fast-forwards a local one
 * that is behind. A local branch that has diverged is left as it is.
 * Branch names come from GitHub, and git refuses any starting with `-`.
 */
export async function checkoutBranch(host: Host, branch: string): Promise<CheckoutOutcome> {
  const step = async (argv: readonly string[], timeoutMs = 30_000) => {
    const ran = await host.run(argv, { timeoutMs })

    return { ...ran, detail: firstLineOf(ran.stderr) || firstLineOf(ran.stdout) || `${argv.slice(0, 2).join(' ')} failed` }
  }

  try {
    const status = await step(['git', 'status', '--porcelain', '--untracked-files=no'])

    if (status.exitCode !== 0) {
      return { kind: 'failed', detail: status.detail }
    }

    if (status.stdout.trim()) {
      return { kind: 'dirty' }
    }

    const fetched = await step(
      ['git', 'fetch', '--quiet', 'origin', `+refs/heads/${branch}:refs/remotes/origin/${branch}`],
      120_000,
    )

    if (fetched.exitCode !== 0) {
      return { kind: 'failed', detail: fetched.detail }
    }

    const switched = await step(['git', 'checkout', '--quiet', branch])

    if (switched.exitCode !== 0) {
      return { kind: 'failed', detail: switched.detail }
    }

    const forwarded = await step(['git', 'merge', '--ff-only', '--quiet', `origin/${branch}`])

    return { kind: 'ok', hasDiverged: forwarded.exitCode !== 0 }
  } catch (error) {
    return { kind: 'failed', detail: messageOf(error, 'could not run git') }
  }
}
