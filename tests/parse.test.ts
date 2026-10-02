import { describe, expect, test } from 'claude-code/testing'

import { branchOfHead, gitDirOfPointer, githubRepoOf } from '../hooks/git/parse'

describe('githubRepoOf', () => {
  test('reads the three remote spellings', async () => {
    expect(githubRepoOf('git@github.com:jreed91/pr-bar.git')).toEqual({ owner: 'jreed91', name: 'pr-bar' })
    expect(githubRepoOf('ssh://git@github.com/o/r.git')).toEqual({ owner: 'o', name: 'r' })
    expect(githubRepoOf('https://github.com/o/r')).toEqual({ owner: 'o', name: 'r' })
    expect(githubRepoOf('https://x-access-token@github.com/o/r.git')).toEqual({ owner: 'o', name: 'r' })
  })

  test('refuses other hosts and nothing', async () => {
    expect(githubRepoOf('git@gitlab.com:o/r.git')).toBeNull()
    expect(githubRepoOf('https://github.example.com/o/r')).toBeNull()
    expect(githubRepoOf(null)).toBeNull()
  })
})

describe('HEAD', () => {
  test('names the branch, or null when detached', async () => {
    expect(branchOfHead('ref: refs/heads/feat/band\n')).toBe('feat/band')
    expect(branchOfHead('3f2a9c0d1e\n')).toBeNull()
  })

  test("follows a worktree's pointer file", async () => {
    expect(gitDirOfPointer('gitdir: /repo/.git/worktrees/x\n', '/wt')).toBe('/repo/.git/worktrees/x')
    expect(gitDirOfPointer('gitdir: ../repo/.git/worktrees/x', '/wt')).toBe('/wt/../repo/.git/worktrees/x')
    expect(gitDirOfPointer('nonsense', '/wt')).toBeNull()
  })
})
