// Bumps the plugin's patch version past the base branch's, in plugin.json and
// the marketplace entry, unless it's already higher. The dependabot-version
// workflow runs it on Dependabot's PRs, which can't bump the version themselves.
//
// Usage: node scripts/bump.mjs <base ref>   (run from the checkout to bump)

import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

const ROOT = process.cwd()
const PLUGIN = '.claude-plugin/plugin.json'
const MARKETPLACE = '.claude-plugin/marketplace.json'

const base = process.argv[2]

if (!base) {
  console.error('usage: node scripts/bump.mjs <base ref>')
  process.exit(2)
}

/** major.minor.patch as numbers, or null for anything else. */
const partsOf = version => {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(version ?? '')

  return match ? match.slice(1).map(Number) : null
}

const compare = (a, b) => a.map((part, at) => part - b[at]).find(diff => diff !== 0) ?? 0

const head = JSON.parse(readFileSync(resolve(ROOT, PLUGIN), 'utf8')).version
const was = JSON.parse(execFileSync('git', ['show', `${base}:${PLUGIN}`], { cwd: ROOT, encoding: 'utf8' })).version

if (!partsOf(head) || !partsOf(was)) {
  console.error(`Can't bump: ${PLUGIN} is "${head}" here and "${was}" on ${base}; both must be major.minor.patch.`)
  process.exit(1)
}

if (compare(partsOf(head), partsOf(was)) > 0) {
  console.log(`Version ${head} is already higher than ${was} on ${base}.`)
  process.exit(0)
}

const [major, minor, patch] = partsOf(was)
const next = `${major}.${minor}.${patch + 1}`

// Rewrite the version fields in place, so the files keep their formatting.
const plugin = readFileSync(resolve(ROOT, PLUGIN), 'utf8')
writeFileSync(resolve(ROOT, PLUGIN), plugin.replace(/("version":\s*")[^"]*(")/, `$1${next}$2`))

const marketplace = JSON.parse(readFileSync(resolve(ROOT, MARKETPLACE), 'utf8'))
marketplace.plugins.find(entry => entry.name === 'pr-bar').version = next
writeFileSync(resolve(ROOT, MARKETPLACE), `${JSON.stringify(marketplace, null, 2)}\n`)

console.log(`Bumped ${head} to ${next} (${base} is at ${was}).`)
