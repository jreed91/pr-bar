import type { Comment, RepoRef } from '../../types'

/**
 * The comments the viewer has not read: newer than the PR's "Mark read"
 * time, not their own and not on a resolved thread. Bots count.
 */
export function unreadOf(
  comments: readonly Comment[],
  lastRead: number,
  viewer: string,
): Comment[] {
  return comments.filter(
    comment =>
      comment.createdAt > lastRead &&
      !comment.isResolved &&
      comment.author.toLowerCase() !== viewer.toLowerCase(),
  )
}

/** Unread first (newest first), then the rest newest first. */
export function orderedComments(
  comments: readonly Comment[],
  lastRead: number,
  viewer: string,
): { comment: Comment; isUnread: boolean }[] {
  const unread = new Set(unreadOf(comments, lastRead, viewer).map(c => c.id))

  return [...comments]
    .sort(
      (a, b) =>
        Number(unread.has(b.id)) - Number(unread.has(a.id)) ||
        b.createdAt - a.createdAt,
    )
    .map(comment => ({ comment, isUnread: unread.has(comment.id) }))
}

/** The `$.store` key a PR's "Mark read" time is kept under. */
export function lastReadKey(repo: RepoRef, prNumber: number): string {
  return `lastRead:${repo.owner}/${repo.name}#${prNumber}`
}

/** The store key marking that a new PR's pane was opened for it once. */
export function openedKey(repo: RepoRef, prNumber: number): string {
  return `opened:${repo.owner}/${repo.name}#${prNumber}`
}

/** The comments a view shows: inline review comments always, the conversation (summaries, bot reports) only when asked. */
export function visibleComments(
  comments: readonly Comment[],
  showConversation: boolean,
): Comment[] {
  return comments.filter(
    comment => showConversation || comment.kind === 'review-comment',
  )
}
