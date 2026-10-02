import type { Check } from '../../types'

/** The CI state of a head commit, counted per state. */
export type Rollup = {
  pass: number
  fail: number
  pending: number
  skip: number
  /** Failing checks first, then pending, passing, skipped; by name within each. */
  ordered: Check[]
  /** `fail` over everything, `pending` while anything runs, `pass` when all green, `none` with no checks. */
  overall: 'fail' | 'pending' | 'pass' | 'none'
}

const RANK: Record<Check['state'], number> = {
  fail: 0,
  pending: 1,
  pass: 2,
  skip: 3,
}

export function rollupOf(checks: readonly Check[]): Rollup {
  const count = (state: Check['state']) =>
    checks.filter(check => check.state === state).length

  const pass = count('pass')
  const fail = count('fail')
  const pending = count('pending')

  return {
    pass,
    fail,
    pending,
    skip: count('skip'),
    ordered: [...checks].sort(
      (a, b) => RANK[a.state] - RANK[b.state] || a.name.localeCompare(b.name),
    ),
    overall:
      fail > 0
        ? 'fail'
        : pending > 0
          ? 'pending'
          : pass > 0
            ? 'pass'
            : 'none',
  }
}

/**
 * Whether this poll turned CI red: failing now, and the previous poll of the
 * same PR was not. The first poll of a session never counts.
 */
export function hasTurnedRed(
  previous: { prNumber: number; overall: Rollup['overall'] } | null,
  current: { prNumber: number; overall: Rollup['overall'] },
): boolean {
  return (
    previous !== null &&
    previous.prNumber === current.prNumber &&
    previous.overall !== 'fail' &&
    current.overall === 'fail'
  )
}
