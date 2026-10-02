import type { Check, Comment, PullRequest } from '../types'

export const checkOf = (overrides: Partial<Check> = {}): Check => ({
  id: 'c1',
  name: 'ci / test',
  state: 'pass',
  url: 'https://github.com/o/r/actions/runs/1/job/11',
  jobId: 11,
  description: null,
  ...overrides,
})

export const commentOf = (overrides: Partial<Comment> = {}): Comment => ({
  id: 'm1',
  kind: 'review-comment',
  author: 'reviewer',
  body: 'Please rename this.',
  createdAt: 1_000,
  url: 'https://github.com/o/r/pull/7#discussion_r1',
  path: 'src/app.ts',
  line: 12,
  diffHunk: '@@ -10,3 +10,3 @@\n-const a = 1\n+const b = 1',
  reviewState: null,
  isResolved: false,
  ...overrides,
})

export const prOf = (overrides: Partial<PullRequest> = {}): PullRequest => ({
  number: 7,
  title: 'Add the bar',
  url: 'https://github.com/o/r/pull/7',
  isDraft: false,
  reviewDecision: null,
  hasConflict: false,
  baseRef: 'main',
  headRef: 'feat/bar',
  headSha: 'abcdef1234567',
  checks: [],
  comments: [],
  body: '',
  imageSrcs: [],
  ...overrides,
})
