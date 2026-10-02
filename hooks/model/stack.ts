import type { StackEntry } from '../../types'

/**
 * The stack `current` sits in, bottom first: its parents are the open PRs
 * whose head branch is its base, followed down to the trunk; its children
 * are the open PRs based on its head, followed up. Where a branch has more
 * than one child, the first in `open` (the most recently updated) is
 * followed. Empty when `current` stands alone.
 */
export function stackOf(current: StackEntry, open: readonly StackEntry[]): StackEntry[] {
  const seen = new Set([current.number])
  const next = (matches: (pr: StackEntry) => boolean) => {
    const found = open.find(pr => !seen.has(pr.number) && matches(pr))

    if (found) {
      seen.add(found.number)
    }

    return found
  }

  const below: StackEntry[] = []

  for (let parent = next(pr => pr.headRef === current.baseRef); parent; ) {
    below.unshift(parent)
    const base = parent.baseRef
    parent = next(pr => pr.headRef === base)
  }

  const above: StackEntry[] = []

  for (let child = next(pr => pr.baseRef === current.headRef); child; ) {
    above.push(child)
    const head = child.headRef
    child = next(pr => pr.baseRef === head)
  }

  const chain = [...below, current, ...above]

  return chain.length > 1 ? chain : []
}

/** Where `number` sits in `stack`, 1 at the bottom, as `2/3`; null outside a stack. */
export function positionOf(stack: readonly StackEntry[], number: number): string | null {
  const index = stack.findIndex(pr => pr.number === number)

  return index < 0 ? null : `${index + 1}/${stack.length}`
}
