import type { Host } from '../hooks/host'

const unused = (name: string) => () => {
  throw new Error(`the test did not expect host.${name}`)
}

/** A Host whose members throw unless the test supplies them. */
export const hostOf = (overrides: Partial<Host> = {}): Host => ({
  now: unused('now'),
  after: unused('after'),
  every: unused('every'),
  cwd: unused('cwd'),
  repo: unused('repo'),
  exists: unused('exists'),
  stat: unused('stat'),
  readFile: unused('readFile'),
  readBytes: unused('readBytes'),
  envGet: unused('envGet'),
  run: unused('run'),
  fetch: unused('fetch'),
  storeGet: unused('storeGet'),
  storeSet: unused('storeSet'),
  toast: unused('toast'),
  invalidate: unused('invalidate'),
  panes: unused('panes'),
  openPane: unused('openPane'),
  closePane: unused('closePane'),
  ...overrides,
})

/** An HTTP answer as `$.http.fetch` gives it. */
export const responseOf = (status: number, text = '', headers: Record<string, string> = {}) => ({
  status,
  ok: status >= 200 && status < 300,
  headers,
  text,
})
