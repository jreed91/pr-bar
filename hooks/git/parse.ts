/**
 * Reads `owner/name` off a github.com remote URL, or null for any other host.
 *
 * Takes the three spellings git keeps: `git@github.com:o/r.git`,
 * `ssh://git@github.com/o/r.git` and `https://github.com/o/r(.git)`.
 */
export function githubRepoOf(
  remote: string | null,
): { owner: string; name: string } | null {
  if (!remote) {
    return null
  }

  const match =
    /^(?:git@github\.com:|ssh:\/\/git@github\.com(?::\d+)?\/|https?:\/\/(?:[^@/]+@)?github\.com\/)([^/\s]+)\/([^/\s]+?)(?:\.git)?\/?$/.exec(
      remote.trim(),
    )

  if (!match || !match[1] || !match[2]) {
    return null
  }

  return { owner: match[1], name: match[2] }
}

/**
 * The branch a `.git/HEAD` file names, or null when HEAD is detached.
 */
export function branchOfHead(head: string): string | null {
  const match = /^ref: refs\/heads\/(.+)$/m.exec(head.trim())

  return match?.[1] ?? null
}

/**
 * The git directory a worktree's `.git` file points at (`gitdir: <path>`),
 * resolved against the folder holding that file.
 */
export function gitDirOfPointer(pointer: string, folder: string): string | null {
  const match = /^gitdir:\s*(.+)$/m.exec(pointer.trim())

  if (!match?.[1]) {
    return null
  }

  const target = match[1].trim()

  return target.startsWith('/') ? target : `${folder}/${target}`
}
