import type { RepoRef } from '../../types'
import type { Host } from '../host'
import { branchOfHead, gitDirOfPointer, githubRepoOf } from './parse'

/** Where the session's checkout keeps HEAD, and the GitHub repo it pushes to. */
export type Checkout = { headPath: string; owner: string; name: string }

/**
 * Finds the checkout the session runs in through the file system alone (so it needs
 * no `git` binary): the nearest `.git` above the working directory, a
 * worktree's pointer file followed. Null outside a github.com repository.
 */
export async function locateCheckout(host: Host): Promise<Checkout | null> {
  const repo = await host.repo()
  const github = githubRepoOf(repo?.remote ?? null)

  if (!repo || !github) {
    return null
  }

  let folder = await host.cwd()

  for (let depth = 0; depth < 40; depth += 1) {
    const dotGit = `${folder}/.git`

    if (await host.exists(dotGit)) {
      const stat = await host.stat(dotGit)

      if (stat.kind === 'dir') {
        return { headPath: `${dotGit}/HEAD`, ...github }
      }

      const gitDir = gitDirOfPointer(await host.readFile(dotGit), folder)

      return gitDir ? { headPath: `${gitDir}/HEAD`, ...github } : null
    }

    const parent = folder.replace(/\/[^/]+\/?$/, '')

    if (parent === folder || parent === '') {
      break
    }

    folder = parent
  }

  return null
}

/** The repo and branch HEAD names now; null when detached or unreadable. */
export async function readRepoRef(
  host: Host,
  checkout: Checkout,
): Promise<RepoRef | null> {
  try {
    const branch = branchOfHead(await host.readFile(checkout.headPath))

    return branch ? { owner: checkout.owner, name: checkout.name, branch } : null
  } catch {
    return null
  }
}
