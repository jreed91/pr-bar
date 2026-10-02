import type { Check, Comment, PullRequest, RepoRef } from '../../types'

/**
 * One GraphQL request for everything the bar and pane draw: the viewer,
 * the branch's newest open PR, its head commit's check rollup, and the three
 * kinds of comment.
 */
export const PR_QUERY = `query PrBar($owner: String!, $name: String!, $branch: String!) {
  viewer { login }
  repository(owner: $owner, name: $name) {
    pullRequests(headRefName: $branch, states: [OPEN], first: 1, orderBy: { field: UPDATED_AT, direction: DESC }) {
      nodes {
        number title url isDraft reviewDecision mergeable baseRefName headRefName
        commits(last: 1) { nodes { commit { oid statusCheckRollup { contexts(first: 100) { nodes {
          __typename
          ... on CheckRun { id databaseId name status conclusion detailsUrl title
            checkSuite { app { slug } workflowRun { workflow { name } } } }
          ... on StatusContext { id context state targetUrl description }
        } } } } } }
        comments(last: 50) { nodes { id author { login } body createdAt url } }
        reviews(last: 30) { nodes { id author { login } body state submittedAt url } }
        reviewThreads(last: 50) { nodes { isResolved comments(first: 20) { nodes {
          id author { login } body createdAt url path line originalLine diffHunk
        } } } }
      }
    }
  }
}`

/** The request body for one repo and branch. */
export function queryBody(repo: RepoRef): string {
  return JSON.stringify({
    query: PR_QUERY,
    variables: { owner: repo.owner, name: repo.name, branch: repo.branch },
  })
}

type Json = Record<string, unknown>

const recordOf = (value: unknown): Json =>
  value !== null && typeof value === 'object' ? (value as Json) : {}

const listOf = (value: unknown): Json[] =>
  Array.isArray(recordOf(value)['nodes'])
    ? (recordOf(value)['nodes'] as unknown[]).map(recordOf)
    : []

const stringOf = (value: unknown): string | null =>
  typeof value === 'string' ? value : null

const loginOf = (value: unknown): string =>
  stringOf(recordOf(value)['login']) ?? 'ghost'

const timeOf = (value: unknown): number => {
  const ms = Date.parse(stringOf(value) ?? '')

  return Number.isNaN(ms) ? 0 : ms
}

const FAILING = new Set([
  'FAILURE',
  'TIMED_OUT',
  'CANCELLED',
  'ACTION_REQUIRED',
  'STARTUP_FAILURE',
  'STALE',
  'ERROR',
])

/** Folds a CheckRun or StatusContext node into a Check. */
export function checkOf(node: Json): Check {
  if (node['__typename'] === 'StatusContext') {
    const state = stringOf(node['state']) ?? ''

    return {
      id: stringOf(node['id']) ?? stringOf(node['context']) ?? '',
      name: stringOf(node['context']) ?? 'status',
      state:
        state === 'SUCCESS' ? 'pass' : FAILING.has(state) ? 'fail' : 'pending',
      url: stringOf(node['targetUrl']),
      jobId: null,
      description: stringOf(node['description']),
    }
  }

  const status = stringOf(node['status'])
  const conclusion = stringOf(node['conclusion']) ?? ''
  const suite = recordOf(node['checkSuite'])
  const workflow = stringOf(
    recordOf(recordOf(suite['workflowRun'])['workflow'])['name'],
  )
  const name = stringOf(node['name']) ?? 'check'
  const isActions = stringOf(recordOf(suite['app'])['slug']) === 'github-actions'
  const databaseId = node['databaseId']

  return {
    id: stringOf(node['id']) ?? name,
    name: workflow ? `${workflow} / ${name}` : name,
    state:
      status !== 'COMPLETED'
        ? 'pending'
        : conclusion === 'SUCCESS'
          ? 'pass'
          : FAILING.has(conclusion)
            ? 'fail'
            : 'skip',
    url: stringOf(node['detailsUrl']),
    jobId: isActions && typeof databaseId === 'number' ? databaseId : null,
    description: stringOf(node['title']),
  }
}

/** Flattens the PR's conversation comments, review summaries and inline threads. */
export function commentsOf(pr: Json): Comment[] {
  const conversation = listOf(pr['comments']).map(
    (node): Comment => ({
      id: stringOf(node['id']) ?? '',
      kind: 'conversation',
      author: loginOf(node['author']),
      body: stringOf(node['body']) ?? '',
      createdAt: timeOf(node['createdAt']),
      url: stringOf(node['url']) ?? '',
      path: null,
      line: null,
      diffHunk: null,
      reviewState: null,
      isResolved: false,
    }),
  )

  const reviews = listOf(pr['reviews'])
    .filter(
      node =>
        (stringOf(node['body']) ?? '').trim() !== '' ||
        node['state'] === 'CHANGES_REQUESTED' ||
        node['state'] === 'APPROVED',
    )
    .map(
      (node): Comment => ({
        id: stringOf(node['id']) ?? '',
        kind: 'review',
        author: loginOf(node['author']),
        body: stringOf(node['body']) ?? '',
        createdAt: timeOf(node['submittedAt']),
        url: stringOf(node['url']) ?? '',
        path: null,
        line: null,
        diffHunk: null,
        reviewState: stringOf(node['state']),
        isResolved: false,
      }),
    )

  const inline = listOf(pr['reviewThreads']).flatMap(thread =>
    listOf(thread['comments']).map(
      (node): Comment => ({
        id: stringOf(node['id']) ?? '',
        kind: 'review-comment',
        author: loginOf(node['author']),
        body: stringOf(node['body']) ?? '',
        createdAt: timeOf(node['createdAt']),
        url: stringOf(node['url']) ?? '',
        path: stringOf(node['path']),
        line:
          typeof node['line'] === 'number'
            ? node['line']
            : typeof node['originalLine'] === 'number'
              ? node['originalLine']
              : null,
        diffHunk: stringOf(node['diffHunk']),
        reviewState: null,
        isResolved: thread['isResolved'] === true,
      }),
    ),
  )

  return [...conversation, ...reviews, ...inline].sort(
    (a, b) => a.createdAt - b.createdAt,
  )
}

/** What one GraphQL answer came to. */
export type QueryOutcome =
  | { kind: 'ok'; viewer: string; pr: PullRequest | null }
  | { kind: 'rate-limited' }
  | { kind: 'error'; detail: string }

/** Reads a GraphQL response body into the PR the bar draws. */
export function parseResponse(text: string): QueryOutcome {
  let json: Json

  try {
    json = recordOf(JSON.parse(text))
  } catch {
    return { kind: 'error', detail: 'GitHub sent a body that is not JSON' }
  }

  const errors = Array.isArray(json['errors'])
    ? (json['errors'] as unknown[]).map(recordOf)
    : []

  if (errors.some(error => error['type'] === 'RATE_LIMITED')) {
    return { kind: 'rate-limited' }
  }

  const data = recordOf(json['data'])

  if (errors.length > 0 && !data['repository']) {
    return {
      kind: 'error',
      detail: stringOf(errors[0]?.['message']) ?? 'GitHub returned an error',
    }
  }

  const viewer = loginOf(data['viewer'])
  const node = listOf(recordOf(data['repository'])['pullRequests'])[0]

  if (!node) {
    return { kind: 'ok', viewer, pr: null }
  }

  const commit = recordOf(listOf(node['commits'])[0]?.['commit'])
  const contexts = listOf(
    recordOf(recordOf(commit['statusCheckRollup'])['contexts']),
  )
  const decision = stringOf(node['reviewDecision'])

  return {
    kind: 'ok',
    viewer,
    pr: {
      number: typeof node['number'] === 'number' ? node['number'] : 0,
      title: stringOf(node['title']) ?? '',
      url: stringOf(node['url']) ?? '',
      isDraft: node['isDraft'] === true,
      reviewDecision:
        decision === 'APPROVED' ||
        decision === 'CHANGES_REQUESTED' ||
        decision === 'REVIEW_REQUIRED'
          ? decision
          : null,
      hasConflict: node['mergeable'] === 'CONFLICTING',
      baseRef: stringOf(node['baseRefName']) ?? '',
      headRef: stringOf(node['headRefName']) ?? '',
      headSha: stringOf(commit['oid']) ?? '',
      checks: contexts.map(checkOf),
      comments: commentsOf(node),
    },
  }
}
