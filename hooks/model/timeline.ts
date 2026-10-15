import type { Check } from '../../types'
import { ageOf } from './cadence'
import { SVG_MAX_CHARS } from './description'

/** The timeline's drawing width, in SVG units; the surface scales it to its slot. */
const WIDTH = 600
/** One check's row, and the gap the bars leave in it. */
const ROW = 14
const BAR = 10
/** The most checks drawn; the timeline is for seeing a run's shape, the list for the rest. */
export const TIMELINE_ROWS = 30

/** Each state's bar, in colors that read on a light and a dark page alike. */
const FILL: Record<Check['state'], string> = {
  fail: '#cf222e',
  pending: '#bf8700',
  pass: '#2da44e',
  skip: '#8c959f',
}

const STATE: Record<Check['state'], string> = {
  fail: 'failed',
  pending: 'running',
  pass: 'passed',
  skip: 'skipped',
}

const escaped = (text: string): string =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

/**
 * The PR's checks as a timeline: one bar per check that has started, from its
 * start to its end (a running one to `now`), on one shared time axis, each with
 * a tooltip naming it, its state and how long it took. Null when fewer than two
 * checks have a start, or the markup would not fit an `Svg`.
 */
export function timelineSvgOf(checks: readonly Check[], now: number): string | null {
  const timed = checks
    .flatMap(check => (check.startedAt === null ? [] : [{ check, start: check.startedAt, end: check.completedAt ?? now }]))
    .sort((a, b) => a.start - b.start)
    .slice(0, TIMELINE_ROWS)

  if (timed.length < 2) {
    return null
  }

  const first = Math.min(...timed.map(row => row.start))
  const span = Math.max(1, Math.max(...timed.map(row => row.end)) - first)
  const height = timed.length * ROW
  const bars = timed.map(({ check, start, end }, index) => {
    const x = ((start - first) / span) * WIDTH
    const width = Math.max(2, ((Math.max(end, start) - start) / span) * WIDTH)
    const tip = `${check.name} · ${STATE[check.state]} · ${ageOf(end - start)}`

    return (
      `<rect x="${x.toFixed(1)}" y="${index * ROW + (ROW - BAR) / 2}" width="${width.toFixed(1)}" height="${BAR}" rx="2" fill="${FILL[check.state]}">` +
      `<title>${escaped(tip)}</title></rect>`
    )
  })
  const source =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${height}" viewBox="0 0 ${WIDTH} ${height}">` +
    `${bars.join('')}</svg>`

  return source.length <= SVG_MAX_CHARS ? source : null
}
