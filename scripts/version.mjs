// Keeps the plugin's version in step with package.json, which changesets owns.
// Installs only update when plugin.json's version changes, so the release PR
// (`npm run version-packages`) copies the version changesets picked into
// plugin.json and the marketplace entry.
//
// Usage: node scripts/version.mjs          fails unless all three agree
//        node scripts/version.mjs --sync   writes package.json's version to the other two

import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

const ROOT = process.cwd()
const PACKAGE = 'package.json'
const PLUGIN = '.claude-plugin/plugin.json'
const MARKETPLACE = '.claude-plugin/marketplace.json'

const read = path => readFileSync(resolve(ROOT, path), 'utf8')
const entryOf = marketplace => marketplace.plugins.find(plugin => plugin.name === 'pr-bar')

const version = JSON.parse(read(PACKAGE)).version

if (!/^\d+\.\d+\.\d+$/.test(version ?? '')) {
  console.error(`${PACKAGE} has version "${version}"; use major.minor.patch.`)
  process.exit(1)
}

if (process.argv.includes('--sync')) {
  // Rewrite plugin.json's version field in place, so the file keeps its formatting.
  writeFileSync(resolve(ROOT, PLUGIN), read(PLUGIN).replace(/("version":\s*")[^"]*(")/, `$1${version}$2`))

  const marketplace = JSON.parse(read(MARKETPLACE))
  entryOf(marketplace).version = version
  writeFileSync(resolve(ROOT, MARKETPLACE), `${JSON.stringify(marketplace, null, 2)}\n`)
}

const problems = []
const plugin = JSON.parse(read(PLUGIN)).version
const listed = entryOf(JSON.parse(read(MARKETPLACE)))?.version

if (plugin !== version) {
  problems.push(`${PLUGIN} is ${plugin}, but ${PACKAGE} is ${version}.`)
}

if (listed !== version) {
  problems.push(`${MARKETPLACE} lists pr-bar at ${listed}, but ${PACKAGE} is ${version}.`)
}

if (problems.length > 0) {
  for (const problem of problems) {
    console.error(problem)
  }
  console.error('Versions come from changesets: run `npm run version-packages`, or leave them to the release PR.')
  process.exit(1)
}

console.log(`Version ${version} in ${PACKAGE}, ${PLUGIN} and ${MARKETPLACE}.`)
