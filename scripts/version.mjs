// Fails unless the plugin's version is higher than the base branch's, so
// every PR ships as a new version. plugin.json and the marketplace entry
// must also agree.
//
// Usage: node scripts/version.mjs <base ref>   (CI passes origin/<base branch>)
// Checks the checkout it runs from, so the dependabot-version workflow can run
// main's copy against a PR's worktree.

import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const ROOT = process.cwd()
const PLUGIN = '.claude-plugin/plugin.json'
const MARKETPLACE = '.claude-plugin/marketplace.json'

const base = process.argv[2]

if (!base) {
  console.error('usage: node scripts/version.mjs <base ref>')
  process.exit(2)
}

const marketplaceVersionOf = text => JSON.parse(text).plugins.find(plugin => plugin.name === 'pr-bar')?.version

const head = JSON.parse(readFileSync(resolve(ROOT, PLUGIN), 'utf8')).version
const listed = marketplaceVersionOf(readFileSync(resolve(ROOT, MARKETPLACE), 'utf8'))
const was = JSON.parse(execFileSync('git', ['show', `${base}:${PLUGIN}`], { cwd: ROOT, encoding: 'utf8' })).version

/** major.minor.patch as numbers, or null for anything else. */
const partsOf = version => {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(version ?? '')

  return match ? match.slice(1).map(Number) : null
}

const compare = (a, b) => a.map((part, at) => part - b[at]).find(diff => diff !== 0) ?? 0

const problems = []

if (!partsOf(head)) {
  problems.push(`${PLUGIN} has version "${head}"; use major.minor.patch.`)
} else if (partsOf(was) && compare(partsOf(head), partsOf(was)) <= 0) {
  problems.push(`${PLUGIN} is ${head}, not higher than ${was} on ${base}. Bump it: patch for fixes, minor for features.`)
}

if (listed !== head) {
  problems.push(`${MARKETPLACE} lists pr-bar at ${listed}, but ${PLUGIN} is ${head}. Keep them the same.`)
}

if (problems.length > 0) {
  problems.forEach(problem => console.error(problem))
  process.exit(1)
}

console.log(`Version ${head} is higher than ${was} on ${base}.`)
