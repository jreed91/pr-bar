import type { Elements } from 'claude-code'

import type { Check, Comment, DescriptionImage, Problem, PullRequest, Selection, Snapshot } from '../../types'
import { ageOf } from '../model/cadence'
import { descriptionPartsOf, imageBoxOf, type DescriptionPart } from '../model/description'
import { rollupOf } from '../model/rollup'
import { HUNK_ROWS, hunkTailOf, printableTailOf } from '../model/hunk'
import { bodyMarkdownOf, commentRowOf, fit } from '../model/preview'
import { orderedComments, visibleComments } from '../model/unread'

/** How many rows the checks and review-comment lists show before "+N more". */
export const LIST_ROWS = 10
/** How many rows the conversation list shows: bot summaries pile up there. */
export const CONVERSATION_ROWS = 4
/** A capped list the pane can show in full. */
export type ExpandableList = 'inline' | 'conversation' | 'checks'

/** The marker column every list row starts with: selection then state. */
const MARKER_COLUMNS = 4

export type PaneModel = {
  snapshot: Snapshot | null
  /** Why the last poll failed, if it did. */
  problem: Problem | null
  /** Whether the folder is a github.com checkout on a branch. */
  hasRepo: boolean
  lastRead: number
  selection: Selection
  logs: Readonly<Record<string, string>>
  armedIds: readonly string[]
  loadingLog: string | null
  /** The pane body's width, so each list row fits on one line. */
  columns: number
  /** List passing and skipped checks, not just their count. */
  showPassing: boolean
  /** List the conversation (summaries, bot reports), not just its count. */
  showConversation: boolean
  /** List the comments on resolved threads, not just their count. */
  showResolved: boolean
  /** The capped lists shown in full. */
  expanded: readonly ExpandableList[]
  /** Show the PR description, not just the row that opens it. */
  showDescription: boolean
  /** Whether the surface draws pictures: the terminal (kitty, Ghostty; elsewhere their alt text). */
  canDrawImages: boolean
  /** The description's images fetched so far, by their source in the markdown. */
  images: Readonly<Record<string, DescriptionImage>>
}

export type PaneActions = {
  select: (selection: Selection) => void
  loadLog: (check: Check) => void
  fixCi: (check: Check) => void
  address: (comment: Comment) => void
  markRead: () => void
  refresh: () => void
  togglePassing: () => void
  toggleConversation: () => void
  toggleResolved: () => void
  toggleDescription: () => void
  /** Shows a capped list in full, or caps it again. */
  toggleMore: (list: ExpandableList) => void
}

type Table = Pick<
  Elements['terminal'],
  'Box' | 'Text' | 'Button' | 'Link' | 'Code' | 'Markdown'
>
/** `Image` is the terminal's alone: elsewhere an image is its link. */
type WithImage = Table & { Image?: Elements['terminal']['Image'] }

const ICON: Record<Check['state'], { glyph: string; color: string }> = {
  fail: { glyph: '✗', color: 'error' },
  pending: { glyph: '◌', color: 'warning' },
  pass: { glyph: '✓', color: 'success' },
  skip: { glyph: '–', color: 'inactive' },
}

const KIND: Record<Comment['kind'], string> = {
  'review-comment': 'inline',
  conversation: 'comment',
  review: 'review',
}

/** One sentence for why GitHub could not be asked, and what happens next. */
export function problemTextOf(problem: Problem): string {
  switch (problem.kind) {
    case 'no-token':
      return 'No GitHub token: set GH_TOKEN, run `gh auth login`, or add one under /config.'
    case 'token-rejected':
      return 'GitHub rejected the token (401). It is asked again every 5 minutes.'
    case 'rate-limited':
      return `GitHub rate-limited the requests. It is asked again in ${ageOf(problem.waitMs)}.`
    case 'offline':
      return `Could not reach GitHub: ${problem.detail}. It is asked again in 5 minutes.`
  }
}

/** What the pane shows selected: the person's pick, else the first unread comment, else the first failing check. */
export function effectiveSelection(
  pr: PullRequest,
  selection: Selection,
  lastRead: number,
  viewer: string,
  showConversation: boolean,
): Selection {
  if (selection?.kind === 'none') {
    return null
  }

  if (
    selection &&
    (selection.kind === 'check'
      ? pr.checks.some(check => check.id === selection.id)
      : pr.comments.some(comment => comment.id === selection.id))
  ) {
    return selection
  }

  const first = orderedComments(
    visibleComments(pr.comments, showConversation),
    lastRead,
    viewer,
  )[0]

  if (first?.isUnread) {
    return { kind: 'comment', id: first.comment.id }
  }

  const failing = rollupOf(pr.checks).ordered.find(check => check.state === 'fail')

  return failing ? { kind: 'check', id: failing.id } : null
}

export function paneView(
  { Box, Text, Button, Link, Code, Markdown, Image }: WithImage,
  model: PaneModel,
  actions: PaneActions,
): JSX.Element {
  const { snapshot, lastRead, logs, armedIds, loadingLog } = model

  if (!model.hasRepo) {
    return (
      <Text dimColor>
        No GitHub branch here. PrBar needs a folder in a checkout whose origin is on github.com,
        on a branch rather than a detached HEAD.
      </Text>
    )
  }

  if (!snapshot) {
    return model.problem ? (
      <Box flexDirection="column">
        <Text color="error">{problemTextOf(model.problem)}</Text>
        <Box>
          <Button key="refresh" hotkey="r" label="Try again" onPress={actions.refresh} />
        </Box>
      </Box>
    ) : (
      <Text dimColor>Asking GitHub…</Text>
    )
  }

  const { pr, repo, viewer } = snapshot

  if (!pr) {
    return (
      <Text dimColor>
        No open PR for {repo.branch} in {repo.owner}/{repo.name}.
      </Text>
    )
  }

  const selection = effectiveSelection(
    pr,
    model.selection,
    lastRead,
    viewer,
    model.showConversation,
  )
  const allChecks = rollupOf(pr.checks).ordered
  const isQuiet = (check: Check) => check.state === 'pass' || check.state === 'skip'
  const quiet = allChecks.filter(isQuiet)
  const checks = model.showPassing ? allChecks : allChecks.filter(check => !isQuiet(check))
  const comments = orderedComments(pr.comments, lastRead, viewer)
  const allInline = comments.filter(row => row.comment.kind === 'review-comment')
  const resolved = allInline.filter(row => row.comment.isResolved)
  // Resolved threads are settled: listed last, and only when asked.
  const inline = [
    ...allInline.filter(row => !row.comment.isResolved),
    ...(model.showResolved ? resolved : []),
  ]
  const conversation = comments.filter(row => row.comment.kind !== 'review-comment')
  const rowWidth = Math.max(20, model.columns - MARKER_COLUMNS - 1)
  const description = descriptionPartsOf(pr.body)

  const selectedCheck =
    selection?.kind === 'check'
      ? checks.find(check => check.id === selection.id)
      : undefined
  const selectedComment =
    selection?.kind === 'comment'
      ? pr.comments.find(comment => comment.id === selection.id)
      : undefined

  const checkDetailOf = (check: Check) =>
    checkDetail(
      { Box, Text, Button, Link, Code },
      check,
      logs[check.id] ?? null,
      loadingLog === check.id,
      armedIds.includes(`check:${check.id}`),
      actions,
    )
  const commentDetailOf = (comment: Comment) =>
    commentDetail(
      { Box, Text, Button, Link, Code, Markdown },
      comment,
      armedIds.includes(`comment:${comment.id}`),
      actions,
    )
  // The selected row opens in place, under itself; one the lists do not
  // draw (folded, or past "+N more") opens at the foot instead.
  const rowsOf = (list: ExpandableList, cap: number) =>
    model.expanded.includes(list) ? Number.POSITIVE_INFINITY : cap
  const inlineRows = rowsOf('inline', LIST_ROWS)
  const conversationRows = rowsOf('conversation', CONVERSATION_ROWS)
  const checkRows = rowsOf('checks', LIST_ROWS)
  const moreRow = (list: ExpandableList, total: number, cap: number) =>
    total > cap && (
      <Box key={`more:${list}`}>
        <Box width={MARKER_COLUMNS} flexShrink={0}>
          <Text dimColor>  {model.expanded.includes(list) ? '▾' : '▸'}</Text>
        </Box>
        <Button
          key={`more:${list}`}
          plain
          dimColor
          label={model.expanded.includes(list) ? 'show fewer' : `${total - cap} more`}
          onPress={() => actions.toggleMore(list)}
        />
      </Box>
    )
  const drawnComments = [
    ...inline.slice(0, inlineRows),
    ...(model.showConversation ? conversation.slice(0, conversationRows) : []),
  ]
  const isOpenInPlace = selectedCheck
    ? checks.slice(0, checkRows).includes(selectedCheck)
    : selectedComment
      ? drawnComments.some(row => row.comment.id === selectedComment.id)
      : false

  return (
    <Box flexDirection="column">
      <Box flexDirection="column">
        <Box>
          <Link href={pr.url} label={`#${pr.number}`} />
          <Text bold wrap="truncate-end">
            {' '}
            {pr.title}
          </Text>
        </Box>
        <Text dimColor wrap="truncate-end">
          {pr.baseRef} ← {pr.headRef}
          {pr.isDraft ? ' · draft' : ''}
          {pr.reviewDecision ? ` · ${pr.reviewDecision.toLowerCase().replace('_', ' ')}` : ''}
          {pr.hasConflict ? ' · conflict' : ''}
        </Text>
        {model.problem && (
          <Text color="warning" wrap="truncate-end">
            Showing the last answer. {problemTextOf(model.problem)}
          </Text>
        )}
        <Box columnGap={1}>
          <Button key="mark-read" hotkey="m" plain dimColor label="mark read" onPress={actions.markRead} />
          <Button key="refresh" hotkey="r" plain dimColor label="refresh" onPress={actions.refresh} />
        </Box>
      </Box>

      {description.length > 0 && (
        <Box marginTop={1} flexDirection="column">
          <Box>
            <Box width={MARKER_COLUMNS} flexShrink={0}>
              <Text dimColor>  {model.showDescription ? '▾' : '▸'}</Text>
            </Box>
            <Button
              key="toggle-description"
              plain
              dimColor
              label={model.showDescription ? 'hide description' : 'Description'}
              onPress={actions.toggleDescription}
            />
          </Box>
          {model.showDescription &&
            openedRow(
              Box,
              descriptionView({ Box, Text, Link, Markdown, Image: model.canDrawImages ? Image : undefined }, description, model.images, rowWidth),
            )}
        </Box>
      )}

      {commentList(
        { Box, Text, Button },
        'Review comments',
        inline,
        inlineRows,
        selection,
        rowWidth,
        actions,
        commentDetailOf,
      )}
      {moreRow('inline', inline.length, LIST_ROWS)}
      {resolved.length > 0 && (
        <Box>
          <Box width={MARKER_COLUMNS} flexShrink={0}>
            <Text dimColor>  {model.showResolved ? '▾' : '▸'}</Text>
          </Box>
          <Button
            key="toggle-resolved"
            plain
            dimColor
            label={model.showResolved ? `hide ${resolved.length} resolved` : `${resolved.length} resolved`}
            onPress={actions.toggleResolved}
          />
        </Box>
      )}
      {model.showConversation ? (
        commentList(
          { Box, Text, Button },
          'Conversation',
          conversation,
          conversationRows,
          selection,
          rowWidth,
          actions,
          commentDetailOf,
        )
      ) : null}
      {model.showConversation && moreRow('conversation', conversation.length, CONVERSATION_ROWS)}
      {model.showConversation && conversation.length > 0 && (
        <Box>
          <Box width={MARKER_COLUMNS} flexShrink={0}>
            <Text dimColor>  ▾</Text>
          </Box>
          <Button
            key="toggle-conversation"
            plain
            dimColor
            label="hide conversation"
            onPress={actions.toggleConversation}
          />
        </Box>
      )}
      {!model.showConversation && conversation.length > 0 ? (
        <Box marginTop={1}>
          <Box width={MARKER_COLUMNS} flexShrink={0}>
            <Text dimColor>  ▸</Text>
          </Box>
          <Button
            key="toggle-conversation"
            plain
            dimColor
            label={`${conversation.length} conversation comments and review summaries`}
            onPress={actions.toggleConversation}
          />
        </Box>
      ) : null}

      <Box marginTop={1}>
        <Text bold>Checks ({allChecks.length})</Text>
      </Box>
      {allChecks.length === 0 && <Text dimColor>    none reported</Text>}
      {checks.slice(0, checkRows).map(check => (
        <Box key={`row:check:${check.id}`} flexDirection="column">
          <Box>
            <Box width={MARKER_COLUMNS} flexShrink={0}>
              <Text color={ICON[check.state].color}>
                {selection?.kind === 'check' && selection.id === check.id ? '❯' : ' '}{' '}
                {ICON[check.state].glyph}
              </Text>
            </Box>
            <Button
              key={`select:check:${check.id}`}
              plain
              dimColor={check.state === 'pass' || check.state === 'skip'}
              label={fit(check.name, rowWidth)}
              onPress={() =>
                actions.select(check === selectedCheck ? { kind: 'none' } : { kind: 'check', id: check.id })
              }
            />
          </Box>
          {check === selectedCheck && openedRow(Box, checkDetailOf(check))}
        </Box>
      ))}
      {moreRow('checks', checks.length, LIST_ROWS)}
      {quiet.length > 0 && (
        <Box>
          <Box width={MARKER_COLUMNS} flexShrink={0}>
            <Text color="success">  {model.showPassing ? '▾' : '▸'}</Text>
          </Box>
          <Button
            key="toggle-passing"
            plain
            dimColor
            label={model.showPassing ? `hide ${quiet.length} passing` : `${quiet.length} passing`}
            onPress={actions.togglePassing}
          />
        </Box>
      )}

      {!isOpenInPlace && (
        <Box marginTop={1} flexDirection="column">
          {selectedCheck && checkDetailOf(selectedCheck)}
          {selectedComment && commentDetailOf(selectedComment)}
          {!selectedCheck && !selectedComment && model.selection?.kind !== 'none' && (
            <Text dimColor>Nothing failing and nothing unread. Pick a row to see it.</Text>
          )}
        </Box>
      )}
    </Box>
  )
}

/** Whether `comment` is the open row. */
const isOpen = (selection: Selection, comment: Comment): boolean =>
  selection?.kind === 'comment' && selection.id === comment.id

function commentList(
  { Box, Text, Button }: Pick<Table, 'Box' | 'Text' | 'Button'>,
  title: string,
  rows: readonly { comment: Comment; isUnread: boolean }[],
  limit: number,
  selection: Selection,
  width: number,
  actions: PaneActions,
  detailOf: (comment: Comment) => JSX.Element,
): JSX.Element {
  const unread = rows.filter(row => row.isUnread).length

  return (
    <Box flexDirection="column" marginTop={1}>
      <Text bold>
        {title} ({rows.length}
        {unread > 0 ? `, ${unread} new` : ''})
      </Text>
      {rows.length === 0 && <Text dimColor>    none</Text>}
      {rows.slice(0, limit).map(({ comment, isUnread }) => (
        <Box key={`row:comment:${comment.id}`} flexDirection="column">
          <Box>
            <Box width={MARKER_COLUMNS} flexShrink={0}>
              <Text color={isUnread ? 'warning' : 'inactive'}>
                {isOpen(selection, comment) ? '❯' : ' '}{' '}
                {isUnread ? '●' : comment.isResolved ? '✓' : '·'}
              </Text>
            </Box>
            <Button
              key={`select:comment:${comment.id}`}
              plain
              dimColor={!isUnread}
              label={commentRowOf(comment, width)}
              onPress={() =>
                actions.select(
                  isOpen(selection, comment) ? { kind: 'none' } : { kind: 'comment', id: comment.id },
                )
              }
            />
          </Box>
          {isOpen(selection, comment) && openedRow(Box, detailOf(comment))}
        </Box>
      ))}
    </Box>
  )
}

function checkDetail(
  { Box, Text, Button, Link, Code }: Omit<Table, 'Markdown'>,
  check: Check,
  log: string | null,
  isLoading: boolean,
  isArmed: boolean,
  actions: PaneActions,
): JSX.Element {
  return (
    <Box flexDirection="column">
      <Box columnGap={1}>
        <Text bold color={ICON[check.state].color}>
          {ICON[check.state].glyph} {check.name}
        </Text>
        {check.url && <Link href={check.url} label="Open" />}
      </Box>
      {check.description && <Text dimColor>{check.description}</Text>}
      <Box columnGap={1}>
        {check.state === 'fail' && (
          <Button
            key="fix-ci"
            hotkey="f"
            variant="primary"
            label={isArmed ? 'Fix CI (attached)' : 'Fix CI'}
            onPress={() => actions.fixCi(check)}
          />
        )}
        {check.jobId !== null && log === null && (
          <Button
            key="load-log"
            hotkey="l"
            label={isLoading ? 'Loading log…' : 'Load log'}
            onPress={() => actions.loadLog(check)}
          />
        )}
      </Box>
      {check.jobId === null && (
        <Text dimColor>Not a GitHub Actions job, so its log is not fetchable here.</Text>
      )}
      {log !== null && <Code source={log || '(empty log)'} wrap="truncate-end" />}
    </Box>
  )
}

function commentDetail(
  { Box, Text, Button, Link, Code, Markdown }: Table,
  comment: Comment,
  isArmed: boolean,
  actions: PaneActions,
): JSX.Element {
  return (
    <Box flexDirection="column">
      <Box columnGap={1}>
        <Text bold>@{comment.author}</Text>
        <Text dimColor>
          {KIND[comment.kind]}
          {comment.reviewState ? ` · ${comment.reviewState.toLowerCase()}` : ''}
          {comment.path ? ` · ${comment.path}${comment.line ? `:${comment.line}` : ''}` : ''}
        </Text>
        {comment.url && <Link href={comment.url} label="Open" />}
      </Box>
      {comment.diffHunk && hunkCode(Code, comment.diffHunk)}
      <Markdown text={bodyMarkdownOf(comment.body) || '_(no text)_'} />
      <Box>
        <Button
          key="address"
          hotkey="a"
          variant="primary"
          label={isArmed ? 'Address (attached)' : 'Address'}
          onPress={() => actions.address(comment)}
        />
      </Box>
    </Box>
  )
}

/**
 * The commented lines of an inline comment, as GitHub shows them beside it:
 * the hunk's last rows, ending at the commented line, drawn as a diff with
 * line numbers. A hunk that does not parse is drawn as highlighted source.
 */
function hunkCode(Code: Table['Code'], diffHunk: string): JSX.Element {
  const hunk = hunkTailOf(diffHunk)

  return hunk ? (
    <Code source={hunk} format="diff" wrap="truncate-end" />
  ) : (
    <Code source={printableTailOf(diffHunk, HUNK_ROWS)} language="diff" wrap="truncate-end" />
  )
}

/** A selected row's detail, indented under the row and set off below it. */
/** The description in order: its text as markdown, each image drawn where it was fetched, else a link to it. */
function descriptionView(
  { Box, Text, Link, Markdown, Image }: Pick<WithImage, 'Box' | 'Text' | 'Link' | 'Markdown' | 'Image'>,
  parts: readonly DescriptionPart[],
  images: Readonly<Record<string, DescriptionImage>>,
  width: number,
): JSX.Element {
  return (
    <Box flexDirection="column">
      {parts.map((part, index) => {
        if (part.kind === 'text') {
          return <Markdown key={`description:${index}`} text={part.markdown} />
        }

        const image = images[part.src]
        const alt = part.alt.trim() || 'image'

        return Image && image?.kind === 'png' ? (
          <Image
            key={`description:${index}`}
            source={{ png: image.base64 }}
            {...imageBoxOf(image, width)}
            alt={alt}
          />
        ) : (
          <Box key={`description:${index}`}>
            {/^https:\/\//.test(part.src) ? (
              <Link href={part.src} label={`[image: ${alt}]`} />
            ) : (
              <Text dimColor>[image: {alt}]</Text>
            )}
            {image?.kind === 'loading' && <Text dimColor> loading…</Text>}
          </Box>
        )
      })}
    </Box>
  )
}

function openedRow(Box: Table['Box'], detail: JSX.Element): JSX.Element {
  return (
    <Box marginLeft={MARKER_COLUMNS} marginBottom={1} flexDirection="column">
      {detail}
    </Box>
  )
}
