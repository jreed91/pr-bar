// Runs `claude plugin test` against an instrumented copy of the mod and
// fails unless every statement, branch, function and line in hooks/ is covered.
//
// `claude plugin test` has no coverage flag, and the mod runs in two realms:
// test files (and the hooks modules they import directly) in one, the plugin
// the engine loads in another, neither with a file system. So the copy carries:
//   - every hooks/ source instrumented with istanbul, counting into its
//     realm's globalThis.__coverage__;
//   - a wrapper per hooks module that answers a `__coverage__` command with
//     the plugin realm's counters;
//   - a test kit shim whose `test` asks for those counters after each body and
//     prints both realms' counters, one marked line per file, read back here.
// Nothing is excluded: an `istanbul ignore` (or c8/v8) comment fails the run.

import { spawnSync } from 'node:child_process'
import { cpSync, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import libCoverage from 'istanbul-lib-coverage'
import { createInstrumenter } from 'istanbul-lib-instrument'
import libReport from 'istanbul-lib-report'
import reports from 'istanbul-reports'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const MARK = '@@pr-bar-coverage@@'
const END = '@@end@@'
const THRESHOLD = 100
const METRICS = ['statements', 'branches', 'functions', 'lines']

const walk = dir =>
  readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const path = join(dir, entry.name)
    return entry.isDirectory() ? walk(path) : [path]
  })

const isSource = path => /\.tsx?$/.test(path) && !path.endsWith('.d.ts')
const isTest = path => /\.test\.tsx?$/.test(path)

/** Copies the mod to `work` with hooks/ instrumented; returns each file's empty coverage. */
function prepare(work, sources) {
  for (const entry of ['.claude-plugin', 'hooks', 'tests', 'types']) {
    if (existsSync(join(ROOT, entry))) {
      cpSync(join(ROOT, entry), join(work, entry), {
        recursive: true,
        filter: src => !src.startsWith(join(ROOT, '.claude-plugin', 'types')),
      })
    }
  }

  const shapes = new Map()
  for (const path of sources) {
    const instrumenter = createInstrumenter({
      esModules: true,
      produceSourceMap: false,
      coverageGlobalScope: 'globalThis',
      coverageGlobalScopeFunc: false,
      parserPlugins: path.endsWith('.tsx') ? ['typescript', 'jsx'] : ['typescript'],
    })
    writeFileSync(join(work, relative(ROOT, path)), instrumenter.instrumentSync(readFileSync(path, 'utf8'), path))
    shapes.set(path, instrumenter.lastFileCoverage())
  }

  const hooksJsonPath = join(work, 'hooks', 'hooks.json')
  const hooksJson = JSON.parse(readFileSync(hooksJsonPath, 'utf8'))
  hooksJson.modules = hooksJson.modules.map((module, index) => {
    const wrapper = `./__coverage_${index}.tsx`
    writeFileSync(
      join(work, 'hooks', wrapper),
      `import type { Register } from 'claude-code'
import { register as inner } from '${module.replace(/\.[jt]sx?$/, '')}'

export const register: Register = (on, options) => {
  on('command.run', { command: '__coverage__' } as never, (() => ({
    text: JSON.stringify((globalThis as { __coverage__?: unknown }).__coverage__ ?? null),
  })) as never)
  return inner(on, options)
}
`,
    )
    return wrapper
  })
  writeFileSync(hooksJsonPath, JSON.stringify(hooksJson))

  const kit = join(work, 'tests', '__coverage_kit.ts')
  writeFileSync(
    kit,
    `import { test as base } from 'claude-code/testing'
export * from 'claude-code/testing'

const realm = globalThis as { __coverage__?: unknown }
// One short line per file and realm, counters only, so each line reaches the pipe whole.
const emit = (files: any) => {
  for (const [path, file] of Object.entries(files ?? {}) as any) {
    console.log('${MARK}' + JSON.stringify([path, file.s, file.f, file.b]) + '${END}')
  }
}
const dump = async ($: any) => {
  try {
    emit(JSON.parse((await $.command.run({ command: '__coverage__', args: '' })).text ?? 'null'))
  } catch {}
  emit(realm.__coverage__)
}

export const test = (name: string, ...rest: any[]) => {
  const body = rest[rest.length - 1]
  const wrapped = async ($: any, on: any) => {
    try {
      return await body($, on)
    } finally {
      await dump($)
    }
  }
  return (base as any)(name, ...rest.slice(0, -1), wrapped)
}
`,
  )
  for (const path of walk(join(work, 'tests')).filter(isTest)) {
    let spec = relative(dirname(path), kit).replace(/\.ts$/, '')
    if (!spec.startsWith('.')) spec = `./${spec}`
    writeFileSync(path, readFileSync(path, 'utf8').replaceAll(`from 'claude-code/testing'`, `from '${spec}'`))
  }

  return shapes
}

function main() {
  const sources = walk(join(ROOT, 'hooks')).filter(isSource)
  const ignored = sources.filter(path => /\b(istanbul|c8|v8)\s+ignore\b/.test(readFileSync(path, 'utf8')))
  if (ignored.length > 0) {
    console.error(`Coverage exclusions are not allowed: ${ignored.map(path => relative(ROOT, path)).join(', ')}`)
    return 1
  }

  const work = mkdtempSync(join(tmpdir(), 'pr-bar-coverage-'))
  try {
    const shapes = prepare(work, sources)
    const coverage = libCoverage.createCoverageMap({})
    for (const [path, shape] of shapes) coverage.merge({ [path]: shape })

    const run = spawnSync('claude', ['plugin', 'test', work], { encoding: 'utf8', maxBuffer: 1 << 30 })
    if (run.error) throw run.error

    const output = `${run.stdout}\n${run.stderr}`
    let dumps = 0
    for (const [, json] of output.matchAll(new RegExp(`${MARK}(.*?)${END}`, 'g'))) {
      const [path, s, f, b] = JSON.parse(json)
      coverage.merge({ [path]: { ...shapes.get(path), s, f, b } })
      dumps++
    }
    console.log(output.replace(new RegExp(`${MARK}.*?${END}\n?`, 'g'), '').trim())

    if (run.status !== 0) {
      console.error(`claude plugin test exited ${run.status}`)
      return run.status ?? 1
    }
    if (dumps === 0) {
      console.error('No coverage was reported: the tests may not have run.')
      return 1
    }

    // A type-only module has nothing to run, so it has nothing to cover.
    coverage.filter(path => Object.keys(coverage.fileCoverageFor(path).s).length > 0)

    const context = libReport.createContext({ dir: join(ROOT, 'coverage'), coverageMap: coverage })
    for (const reporter of ['text', 'lcov', 'json', 'json-summary']) reports.create(reporter).execute(context)

    const summary = coverage.getCoverageSummary()
    const short = METRICS.filter(metric => summary[metric].pct < THRESHOLD)
    if (short.length > 0) {
      console.error(`Coverage is below ${THRESHOLD}% for ${short.map(metric => `${metric} (${summary[metric].pct}%)`).join(', ')}`)
      return 1
    }
    console.log(`Coverage is ${THRESHOLD}% for ${METRICS.join(', ')}.`)
    return 0
  } finally {
    rmSync(work, { recursive: true, force: true })
  }
}

process.exit(main())
