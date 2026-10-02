import type { Armed, Check, Comment, PullRequest } from '../../types'

/** The most the armed items add to one prompt, together. */
export const ARMED_MAX_CHARS = 40_000

const fence = (text: string, info = ''): string => {
  const ticks = text.includes('```') ? '````' : '```'

  return `${ticks}${info}\n${text}\n${ticks}`
}

/** A failing check, its log tail if fetched, as context for "fix this". */
export function armCheck(pr: PullRequest, check: Check, logTail: string | null): Armed {
  const lines = [
    `The user attached a failing CI check from PR #${pr.number} (${pr.url}), head ${pr.headSha.slice(0, 7)}.`,
    `Check: ${check.name}${check.url ? ` (${check.url})` : ''}`,
  ]

  if (check.description) {
    lines.push(`Summary: ${check.description}`)
  }

  lines.push(
    logTail
      ? `Last lines of its log:\n${fence(logTail)}`
      : 'Its log could not be fetched; open the link above if needed.',
  )

  return { id: `check:${check.id}`, label: check.name, text: lines.join('\n') }
}

/** A review comment, with its file, line and diff hunk, as context to address. */
export function armComment(pr: PullRequest, comment: Comment): Armed {
  const where = comment.path
    ? ` on ${comment.path}${comment.line ? `:${comment.line}` : ''}`
    : ''
  const verdict = comment.reviewState ? ` (${comment.reviewState.toLowerCase()})` : ''
  const lines = [
    `The user attached a review comment from PR #${pr.number} (${pr.url}) to address.`,
    `@${comment.author}${verdict}${where}: ${comment.url}`,
  ]

  if (comment.diffHunk) {
    lines.push(fence(comment.diffHunk, 'diff'))
  }

  lines.push(comment.body.trim() ? fence(comment.body.trim(), 'markdown') : '(no text)')

  const label = comment.path
    ? `${comment.path.split('/').pop()}${comment.line ? `:${comment.line}` : ''}`
    : `@${comment.author}`

  return { id: `comment:${comment.id}`, label, text: lines.join('\n') }
}

/** Adds an item, or leaves the list as is when it is already armed. */
export function withArmed(list: readonly Armed[], item: Armed): Armed[] {
  return list.some(one => one.id === item.id) ? [...list] : [...list, item]
}

/**
 * The context blocks the armed items become, in arming order, within the cap
 * left over from what the prompt already carries. Items that do not fit
 * whole are cut at the cap; once the cap is spent the rest are dropped.
 */
export function contextOf(
  list: readonly Armed[],
  room: number = ARMED_MAX_CHARS,
): { blocks: string[]; dropped: Armed[] } {
  const blocks: string[] = []
  const dropped: Armed[] = []
  let left = Math.max(0, room)

  for (const item of list) {
    if (left < 200) {
      dropped.push(item)
      continue
    }

    const text =
      item.text.length <= left
        ? item.text
        : `${item.text.slice(0, left - 40)}\n… (cut to fit the prompt)`

    blocks.push(text)
    left -= text.length
  }

  return { blocks, dropped }
}
