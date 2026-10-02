// Lays the engine's plugin API types in .claude-plugin/types/, for `tsc -p .`.
//
// Claude Code writes them beside a mod each time it loads the mod from a
// folder, and there is no command that only writes them. So this loads the
// mod in a headless session pointed at an address nothing answers (no
// credential is used and no request leaves the machine), waits for the
// files, and stops the session.

import { spawn } from 'node:child_process'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const TYPES = join(ROOT, '.claude-plugin', 'types')
const API = join(TYPES, 'claude-code', 'index.d.ts')
const TIMEOUT_MS = 60_000

rmSync(TYPES, { recursive: true, force: true })

const home = mkdtempSync(join(tmpdir(), 'pr-bar-types-'))
const session = spawn('claude', ['--plugin-dir', ROOT, '-p', 'types'], {
  cwd: ROOT,
  stdio: 'ignore',
  env: {
    PATH: process.env.PATH,
    HOME: home,
    ANTHROPIC_API_KEY: 'unused',
    ANTHROPIC_BASE_URL: 'http://127.0.0.1:9',
  },
})

const started = Date.now()
const timer = setInterval(() => {
  const isLaid = existsSync(API)
  if (isLaid || Date.now() - started > TIMEOUT_MS) {
    clearInterval(timer)
    session.kill()
    rmSync(home, { recursive: true, force: true })
    if (!isLaid) {
      console.error(`Claude Code did not write ${API} within ${TIMEOUT_MS / 1000}s`)
      process.exit(1)
    }
    console.log(`Wrote the plugin API types to ${TYPES}`)
  }
}, 250)
