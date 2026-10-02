/** How often GitHub is asked while any check is still running. */
export const PENDING_POLL_MS = 20_000
/** How often otherwise. */
export const IDLE_POLL_MS = 90_000
/** How long to back off after a rate limit or a network failure. */
export const BACKOFF_MS = 300_000
/** How often `.git/HEAD` is read for a branch switch; local, so cheap. */
export const HEAD_POLL_MS = 2_000

/** The wait before the next GitHub poll, from what the last one came to. */
export function nextPollMs(last: 'pending' | 'settled' | 'failed'): number {
  return last === 'pending'
    ? PENDING_POLL_MS
    : last === 'failed'
      ? BACKOFF_MS
      : IDLE_POLL_MS
}

/** Whether a Bash command can have changed the PR or the branch. */
export function isPrMovingCommand(command: string): boolean {
  return /\bgit\s+(?:[^|;&]*\s)?(?:push|checkout|switch)\b|\bgh\s+pr\b/.test(command)
}

/** A short age for the stale tag: `40s`, `4m`, `2h`. */
export function ageOf(ms: number): string {
  const seconds = Math.max(0, Math.round(ms / 1000))

  return seconds < 60
    ? `${seconds}s`
    : seconds < 3600
      ? `${Math.round(seconds / 60)}m`
      : `${Math.round(seconds / 3600)}h`
}
