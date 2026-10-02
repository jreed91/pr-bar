import type {
  FsStat,
  HttpInit,
  HttpResponse,
  PaneCloseArgs,
  PaneOpenArgs,
  ProcessRunInit,
  ProcessRunResult,
  SessionRepo,
  TimerCall,
  ToastOptions,
  UiOpenResult,
  UiPane,
} from 'claude-code'

import type { Armed, Problem, RepoRef, Selection, Snapshot } from '../types'

/** What the bar and pane draw from: module state, redrawn through `invalidate`. */
export type View = {
  repo: RepoRef | null
  snapshot: Snapshot | null
  problem: Problem | null
  lastRead: number
  armed: Armed[]
  selection: Selection
  logs: Record<string, string>
  /** Session toggles, seeded from the plugin's settings. */
  showPassing: boolean
  showConversation: boolean
}

/**
 * The engine as `session.start` bound it from its `$`, each member spelled
 * `$.noun.event(...)` there, so timers, presses and the helper modules reach
 * the engine without holding `$` (as the built-in /diff mod does).
 */
export type Host = {
  now: () => Promise<number>
  after: TimerCall
  every: TimerCall
  cwd: () => Promise<string>
  repo: () => Promise<SessionRepo | null>
  exists: (path: string) => Promise<boolean>
  stat: (path: string) => Promise<FsStat>
  readFile: (path: string) => Promise<string>
  envGet: (name: 'GH_TOKEN' | 'GITHUB_TOKEN') => Promise<string | undefined>
  run: (argv: readonly string[], init?: ProcessRunInit) => Promise<ProcessRunResult>
  fetch: (url: string, init?: HttpInit) => Promise<HttpResponse>
  storeGet: (key: string) => Promise<unknown>
  storeSet: (key: string, value: unknown) => Promise<void>
  toast: (text: string, options?: ToastOptions) => void
  invalidate: () => void
  panes: () => Promise<readonly UiPane[]>
  openPane: (pane: PaneOpenArgs) => Promise<UiOpenResult>
  closePane: (pane: PaneCloseArgs) => Promise<void>
}
