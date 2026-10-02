import { describe, expect, test } from 'claude-code/testing'

import { locateCheckout, readRepoRef } from '../hooks/git/locate'
import { hostOf } from './host'

const REMOTE = 'git@github.com:o/r.git'

/** A file system of `files` (path to text) and `dirs`, under `cwd`. */
const tree = (cwd: string, files: Record<string, string>, dirs: string[] = [], remote: string | null = REMOTE) =>
  hostOf({
    repo: async () => ({ root: cwd, remote, internal: false, name: null }) as never,
    cwd: async () => cwd,
    exists: async path => path in files || dirs.includes(path),
    stat: async path => ({ kind: dirs.includes(path) ? 'dir' : 'file', size: 0, mtimeMs: 0, isLink: false }) as never,
    readFile: async path => {
      const text = files[path]
      if (text === undefined) throw new Error(`ENOENT ${path}`)
      return text
    },
  })

describe('locateCheckout', () => {
  test('finds the nearest .git folder above the working directory', async () => {
    const host = tree('/repo/src/deep', {}, ['/repo/.git'])

    expect(await locateCheckout(host)).toEqual({ headPath: '/repo/.git/HEAD', owner: 'o', name: 'r' })
  })

  test("follows a worktree's pointer file, and gives up on a broken one", async () => {
    expect(await locateCheckout(tree('/wt', { '/wt/.git': 'gitdir: /repo/.git/worktrees/wt\n' }))).toEqual({
      headPath: '/repo/.git/worktrees/wt/HEAD',
      owner: 'o',
      name: 'r',
    })
    expect(await locateCheckout(tree('/wt', { '/wt/.git': 'not a pointer' }))).toBeNull()
  })

  test('is null outside a github.com checkout', async () => {
    expect(await locateCheckout(tree('/repo', {}, ['/repo/.git'], 'https://gitlab.com/o/r.git'))).toBeNull()
    expect(await locateCheckout(tree('/repo', {}, ['/repo/.git'], null))).toBeNull()
    expect(await locateCheckout(hostOf({ repo: async () => null }))).toBeNull()
  })

  test('stops at the root, at a relative folder, and after 40 levels', async () => {
    expect(await locateCheckout(tree('/a/b', {}))).toBeNull()
    expect(await locateCheckout(tree('/', {}))).toBeNull()
    expect(await locateCheckout(tree('relative', {}))).toBeNull()

    const deep = `/${Array.from({ length: 45 }, (_, n) => `d${n}`).join('/')}`
    expect(await locateCheckout(tree(deep, {}, ['/d0/.git']))).toBeNull()
  })
})

describe('readRepoRef', () => {
  const checkout = { headPath: '/repo/.git/HEAD', owner: 'o', name: 'r' }

  test('names the branch HEAD is on', async () => {
    const host = tree('/repo', { '/repo/.git/HEAD': 'ref: refs/heads/feat/band\n' })

    expect(await readRepoRef(host, checkout)).toEqual({ owner: 'o', name: 'r', branch: 'feat/band' })
  })

  test('is null when HEAD is detached or unreadable', async () => {
    expect(await readRepoRef(tree('/repo', { '/repo/.git/HEAD': '3f2a9c0d1e\n' }), checkout)).toBeNull()
    expect(await readRepoRef(tree('/repo', {}), checkout)).toBeNull()
  })
})
