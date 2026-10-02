import type { RepoRef } from '../../types'
import type { Host } from '../host'
import { parseResponse, queryBody, type QueryOutcome } from './query'

const API = 'https://api.github.com'

const headersOf = (token: string): Record<string, string> => ({
  authorization: `Bearer ${token}`,
  accept: 'application/vnd.github+json',
  'user-agent': 'pr-band-claude-code-mod',
  'x-github-api-version': '2022-11-28',
})

/** How long a request to GitHub may take before the poll gives up on it. */
export const FETCH_TIMEOUT_MS = 20_000

/** `work`, or a rejection once `ms` pass without an answer. */
export function withTimeout<T>(host: Host, work: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = host.after(ms, () =>
      reject(new Error(`no answer from GitHub in ${Math.round(ms / 1000)}s`)),
    )

    work.then(
      value => {
        timer.cancel()
        resolve(value)
      },
      (error: unknown) => {
        timer.cancel()
        reject(error)
      },
    )
  })
}

/** What one poll came to, the HTTP failures folded in. */
export type FetchOutcome =
  | QueryOutcome
  | { kind: 'token-rejected' }
  | { kind: 'offline'; detail: string }

/** Runs the PR query for `repo` and folds the HTTP status into an outcome. */
export async function fetchPullRequest(
  host: Host,
  token: string,
  repo: RepoRef,
): Promise<FetchOutcome> {
  try {
    const response = await withTimeout(
      host,
      host.fetch(`${API}/graphql`, {
        method: 'POST',
        headers: { ...headersOf(token), 'content-type': 'application/json' },
        body: queryBody(repo),
      }),
      FETCH_TIMEOUT_MS,
    )

    if (response.status === 401) {
      return { kind: 'token-rejected' }
    }

    if (
      response.status === 429 ||
      (response.status === 403 && response.headers['x-ratelimit-remaining'] === '0')
    ) {
      return { kind: 'rate-limited' }
    }

    if (!response.ok) {
      return { kind: 'offline', detail: `GitHub answered ${response.status}` }
    }

    return parseResponse(response.text)
  } catch (error) {
    return { kind: 'offline', detail: messageOf(error, 'network error') }
  }
}

/** What went wrong, as the error says it, else `fallback`. */
export function messageOf(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback
}

/** How many lines of a failing job's log ride along. */
export const LOG_TAIL_LINES = 120

/**
 * The last lines of an Actions job's log, timestamps stripped. The logs
 * endpoint redirects to signed storage, which takes no GitHub credential.
 */
export async function fetchJobLogTail(
  host: Host,
  token: string,
  repo: RepoRef,
  jobId: number,
): Promise<string> {
  const url = `${API}/repos/${repo.owner}/${repo.name}/actions/jobs/${jobId}/logs`
  let response = await host.fetch(url, { headers: headersOf(token) })
  const location = response.headers['location']

  if (response.status >= 300 && response.status < 400 && location) {
    response = await host.fetch(location)
  }

  if (!response.ok) {
    throw new Error(`the log answered ${response.status}`)
  }

  return tailOf(response.text, LOG_TAIL_LINES)
}

/** The last `count` lines of a log, each line's leading ISO timestamp dropped. */
export function tailOf(log: string, count: number): string {
  return log
    .replace(/\r/g, '')
    .split('\n')
    .map(line => line.replace(/^\uFEFF?\d{4}-\d\d-\d\dT[\d:.]+Z\s?/, ''))
    .filter((line, index, lines) => index < lines.length - 1 || line !== '')
    .slice(-count)
    .join('\n')
}
