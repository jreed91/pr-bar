/** A GitHub repository and the branch checked out in it. */
export type RepoRef = { owner: string; name: string; branch: string }

/** One CI check, folded to the four states the bar draws. */
export type Check = {
  id: string
  name: string
  state: 'pass' | 'fail' | 'pending' | 'skip'
  url: string | null
  /** The Actions job id, when the check is a GitHub Actions job: its log is fetchable. */
  jobId: number | null
  description: string | null
}

/** One comment of any of the three kinds, flattened. */
export type Comment = {
  id: string
  kind: 'review-comment' | 'conversation' | 'review'
  author: string
  body: string
  createdAt: number
  url: string
  path: string | null
  line: number | null
  diffHunk: string | null
  /** For a review summary, its verdict (APPROVED, CHANGES_REQUESTED, COMMENTED). */
  reviewState: string | null
  /** An inline comment on a thread marked resolved. */
  isResolved: boolean
}

/** One open PR in a stack, as the band and pane list it. */
export type StackEntry = {
  number: number
  title: string
  url: string
  isDraft: boolean
  baseRef: string
  headRef: string
  /** Its head commit's CI, folded like the current PR's rollup. */
  ci: 'pass' | 'fail' | 'pending' | 'none'
}

export type PullRequest = {
  number: number
  title: string
  url: string
  isDraft: boolean
  reviewDecision: 'APPROVED' | 'CHANGES_REQUESTED' | 'REVIEW_REQUIRED' | null
  hasConflict: boolean
  baseRef: string
  headRef: string
  headSha: string
  checks: Check[]
  comments: Comment[]
  /** The description as written (markdown). */
  body: string
  /** The description's image sources as GitHub renders them, in order. */
  imageSrcs: string[]
  /**
   * The stack this PR sits in, bottom (based on the trunk) first and this PR
   * included; empty when no open PR is based on it and it is based on no
   * open PR's branch.
   */
  stack: StackEntry[]
}

/** A description image as fetched: drawn from its PNG bytes, or shown as a link. */
export type DescriptionImage =
  | { kind: 'loading' }
  | { kind: 'png'; base64: string; width: number; height: number }
  | { kind: 'link' }

/** What the last poll came to. */
export type Snapshot = {
  repo: RepoRef
  viewer: string
  pr: PullRequest | null
  fetchedAt: number
}

/** Why the bar is not showing fresh data. */
export type Problem =
  | { kind: 'no-token' }
  | { kind: 'token-rejected' }
  | { kind: 'rate-limited'; waitMs: number }
  | { kind: 'offline'; detail: string }

/** Context waiting to ride the next prompt. */
export type Armed = { id: string; label: string; text: string }

/** The pane's selected item, by list key. */
/** The pane's open row: a pick, `none` once the person closed the open one, or null for the default. */
export type Selection = { kind: 'check' | 'comment'; id: string } | { kind: 'none' } | null
