/** How many diff lines an inline comment shows, ending at the commented line. */
export const HUNK_ROWS = 6
/** A diff line longer than this is cut, so the hunk stays inside Code's bound. */
const LINE_CHARS = 400

/** Drops what `Code` refuses: control characters other than tab and newline. */
function printable(text: string): string {
  // eslint-disable-next-line no-control-regex
  return text.replace(/\r\n?/g, '\n').replace(/[\x00-\x08\x0b-\x1f\x7f]/g, '')
}

const cut = (line: string) =>
  [...line].length > LINE_CHARS ? `${[...line].slice(0, LINE_CHARS - 1).join('')}…` : line

/** The last `rows` lines of `text`, made printable, each cut to a bounded width. */
export function printableTailOf(text: string, rows: number): string {
  return printable(text).split('\n').slice(-rows).map(cut).join('\n')
}

/**
 * The end of a review comment's `diffHunk`, where the commented line is, as
 * one unified-diff hunk with its header recounted for those lines.
 *
 * GitHub's `diffHunk` runs from the top of the file's hunk down to the
 * commented line, which can be hundreds of lines on a new file, and its
 * header keeps the whole hunk's counts, so it does not parse as written.
 * Null when it is not a hunk at all.
 */
export function hunkTailOf(diffHunk: string, rows = HUNK_ROWS): string | null {
  const source = printable(diffHunk).replace(/\n$/, '')
  // Anchored to the start and kept to one line, so it reads the header alone.
  const match = /^@@ -(\d+)(,0)?(?:,\d+)? \+(\d+)(,0)?(?:,\d+)? @@/.exec(source)
  const body = source.split('\n').slice(1)

  if (!match) {
    return null
  }

  // A side counted 0 names the line before the hunk, not its first line.
  let oldLine = Number(match[1]) + (match[2] ? 1 : 0)
  let newLine = Number(match[3]) + (match[4] ? 1 : 0)
  const lines: { text: string; old: number; new: number }[] = []

  for (const raw of body) {
    if (raw.startsWith('\\')) {
      continue
    }

    const text = raw === '' ? ' ' : raw
    const marker = text[0]

    if (marker !== ' ' && marker !== '+' && marker !== '-') {
      return null
    }

    lines.push({ text: cut(text), old: oldLine, new: newLine })
    oldLine += marker === '+' ? 0 : 1
    newLine += marker === '-' ? 0 : 1
  }

  const tail = lines.slice(-rows)
  const first = tail[0]

  if (!first) {
    return null
  }

  const oldCount = tail.filter(line => line.text[0] !== '+').length
  const newCount = tail.filter(line => line.text[0] !== '-').length
  const range = (start: number, count: number) =>
    count === 0 ? `${start - 1},0` : count === 1 ? `${start}` : `${start},${count}`

  return [
    `@@ -${range(first.old, oldCount)} +${range(first.new, newCount)} @@`,
    ...tail.map(line => line.text),
  ].join('\n')
}
