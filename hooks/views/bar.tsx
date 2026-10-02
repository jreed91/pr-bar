import type { Elements } from 'claude-code'

import type { Armed, Problem, RepoRef, Snapshot } from '../../types'
import { ageOf } from '../model/cadence'
import { fit } from '../model/preview'
import { rollupOf } from '../model/rollup'
import { positionOf } from '../model/stack'
import { problemTextOf } from './pane'
import { unreadOf, visibleComments } from '../model/unread'

/** A poll older than this draws the stale tag. */
export const STALE_AFTER_MS = 3 * 60_000
/** The compact bar's title, at most. */
const COMPACT_TITLE_COLUMNS = 48

export type BarLayout = 'compact' | 'full'

export type BarModel = {
  repo: RepoRef
  snapshot: Snapshot | null
  problem: Problem | null
  lastRead: number
  armed: readonly Armed[]
  now: number
  layout: BarLayout
  showConversation: boolean
}

export type BarActions = {
  details: () => void
  markRead: () => void
  refresh: () => void
  disarm: (id: string) => void
  disarmAll: () => void
}

type Table = Pick<Elements['terminal'], 'Box' | 'Text' | 'Button' | 'Link'>

const REVIEW: Record<string, { text: string; short: string; color: string }> = {
  APPROVED: { text: '✓ approved', short: '✓ approved', color: 'success' },
  CHANGES_REQUESTED: { text: '⚑ changes requested', short: '⚑ changes', color: 'error' },
  REVIEW_REQUIRED: { text: '◌ review required', short: '◌ review', color: 'warning' },
}

/** The compare page that opens a PR for the branch. */
export function compareUrlOf(repo: RepoRef): string {
  return `https://github.com/${repo.owner}/${repo.name}/compare/${encodeURIComponent(repo.branch)}?expand=1`
}

/** The bar's tree, or null when there is nothing to draw yet. */
export function barView(
  { Box, Text, Button, Link }: Table,
  model: BarModel,
  actions: BarActions,
): JSX.Element | null {
  const { repo, snapshot, problem, lastRead, armed, now, layout } = model

  if (problem?.kind === 'no-token') {
    return (
      <Box>
        <Text color="warning" wrap="truncate-end">
          PrBar: no GitHub token. Set GH_TOKEN, run `gh auth login`, or add one under /config.
        </Text>
      </Box>
    )
  }

  if (problem?.kind === 'token-rejected') {
    return (
      <Box>
        <Text color="error" wrap="truncate-end">
          PrBar: GitHub rejected the token (401); it is asked again every 5 minutes.
        </Text>
      </Box>
    )
  }

  if (!snapshot) {
    return problem ? (
      <Box columnGap={1}>
        <Text color="error" wrap="truncate-end">
          PrBar: {problemTextOf(problem)}
        </Text>
        <Button key="refresh" hotkey="r" plain dimColor label="retry" onPress={actions.refresh} />
      </Box>
    ) : null
  }

  const age = now - snapshot.fetchedAt
  const stale =
    problem !== null || age > STALE_AFTER_MS ? (
      <Text dimColor> · stale {ageOf(age)}</Text>
    ) : null

  const { pr } = snapshot

  if (!pr) {
    return (
      <Box>
        <Text dimColor wrap="truncate-end">
          no PR for {repo.branch}{' '}
        </Text>
        <Link href={compareUrlOf(repo)} label="Open compare" />
        {stale}
      </Box>
    )
  }

  const rollup = rollupOf(pr.checks)
  const failing = rollup.ordered.filter(check => check.state === 'fail')
  const unread = unreadOf(
    visibleComments(pr.comments, model.showConversation),
    lastRead,
    snapshot.viewer,
  ).length
  const review = pr.reviewDecision ? REVIEW[pr.reviewDecision] : undefined
  const position = positionOf(pr.stack, pr.number)

  if (layout === 'compact') {
    return (
      <Box columnGap={1}>
        <Link href={pr.url} label={`#${pr.number}`} />
        <Text dimColor wrap="truncate-end">
          {fit(pr.title, COMPACT_TITLE_COLUMNS)}
        </Text>
        {position && <Text dimColor>stack {position}</Text>}
        {unread > 0 && <Text color="warning">💬 {unread}</Text>}
        {rollup.overall === 'fail' && <Text color="error">✗ {rollup.fail} failing</Text>}
        {rollup.overall === 'pending' && <Text color="warning">◌ {rollup.pending} running</Text>}
        {rollup.overall === 'pass' && <Text color="success">✓ CI</Text>}
        {review && <Text color={review.color}>{review.short}</Text>}
        {pr.hasConflict && <Text color="error">⚠ conflict</Text>}
        {armed.length > 0 && <Text color="warning">📎 {armed.length} for next prompt</Text>}
        {armed.length > 0 && (
          <Button key="disarm-all" plain dimColor label="✕" onPress={actions.disarmAll} />
        )}
        {stale}
        <Button key="details" hotkey="d" plain dimColor label="details" onPress={actions.details} />
      </Box>
    )
  }

  return (
    <Box flexDirection="column">
      <Box>
        <Link href={pr.url} label={`#${pr.number}`} />
        <Text bold wrap="truncate-end">
          {' '}
          {pr.title}
        </Text>
        {pr.isDraft && <Text dimColor> · draft</Text>}
        {position && <Text dimColor> · stack {position}</Text>}
        {review && <Text color={review.color}> · {review.text}</Text>}
        {pr.hasConflict && <Text color="error"> · ⚠ conflict</Text>}
        {stale}
      </Box>
      <Box columnGap={1} flexWrap="wrap">
        <Text color={unread > 0 ? 'warning' : 'inactive'}>💬 {unread} new</Text>
        {rollup.overall === 'none' ? (
          <Text dimColor>CI: no checks</Text>
        ) : (
          <Text>
            <Text color="success">✓ {rollup.pass}</Text>{' '}
            <Text color={rollup.fail > 0 ? 'error' : 'inactive'}>✗ {rollup.fail}</Text>{' '}
            <Text color={rollup.pending > 0 ? 'warning' : 'inactive'}>◌ {rollup.pending}</Text>
          </Text>
        )}
        {failing.length > 0 && (
          <Text color="error" wrap="truncate-end">
            {failing
              .slice(0, 3)
              .map(check => check.name)
              .join(', ')}
            {failing.length > 3 ? ` +${failing.length - 3}` : ''}
          </Text>
        )}
        {armed.map(item => (
          <Button
            key={`disarm:${item.id}`}
            plain
            dimColor
            label={`📎 ${item.label} ✕`}
            onPress={() => actions.disarm(item.id)}
          />
        ))}
        <Button key="details" hotkey="d" label="Details" onPress={actions.details} />
        <Button key="mark-read" hotkey="m" label="Mark read" onPress={actions.markRead} />
        <Button key="refresh" hotkey="r" label="Refresh" onPress={actions.refresh} />
      </Box>
    </Box>
  )
}
