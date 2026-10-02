import type { Comment } from '../../types'

/** Drops HTML comments, which bots use as markers (`<!-- ccr-overview-v2 -->`). */
export function withoutHtmlComments(body: string): string {
  return body.replace(/<!--[\s\S]*?(?:-->|$)/g, '').trim()
}

const attributeOf = (tag: string, name: string): string | null =>
  new RegExp(`\\s${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, 'i')
    .exec(tag)
    ?.slice(1)
    .find(value => value !== undefined) ?? null

/**
 * Images become their alt text: a `<picture>` (Copilot's severity badges)
 * and a bare `<img>` alike; one with no alt text goes.
 */
function withImagesAsAlt(html: string): string {
  return html
    .replace(/<picture\b[\s\S]*?(?:<\/picture>|$)/gi, picture => {
      const img = /<img\b[^>]*>/i.exec(picture)?.[0]

      return img ? (attributeOf(img, 'alt') ?? '') : ''
    })
    .replace(/<img\b[^>]*>/gi, img => attributeOf(img, 'alt') ?? '')
}

/** Markdown with the HTML in `text` turned into its markdown or text. */
function htmlAsMarkdown(text: string): string {
  return withImagesAsAlt(text)
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1>/gi, (_, level: string, inner: string) =>
      `\n${'#'.repeat(Number(level))} ${inner.trim()}\n`,
    )
    .replace(/<summary\b[^>]*>([\s\S]*?)<\/summary>/gi, (_, inner: string) =>
      `\n**${inner.trim()}**\n`,
    )
    .replace(/<a\b[^>]*>([\s\S]*?)<\/a>/gi, (tag: string, inner: string) => {
      const href = attributeOf(tag, 'href')

      return href ? `[${inner.trim()}](${href})` : inner
    })
    .replace(/<\/?(?:b|strong)>/gi, '**')
    .replace(/<\/?(?:i|em)>/gi, '_')
    .replace(/<\/?code>/gi, '`')
    .replace(/<\/?(?:p|div|details|table|tr|ul|ol|blockquote)\b[^>]*>/gi, '\n')
    .replace(/<li\b[^>]*>/gi, '\n- ')
    .replace(/<\/?[a-z][^>]*>/gi, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
}

/**
 * A comment body for the pane's Markdown view: bot markers dropped and the
 * HTML GitHub renders (badges, `<details>`, headings, links) turned into
 * markdown or plain text, so no raw tag reaches the terminal. Code blocks
 * and inline code are left as written.
 */
export function bodyMarkdownOf(body: string): string {
  return withoutHtmlComments(body)
    .split(/(```[\s\S]*?(?:```|$)|`[^`\n]*`)/)
    .map((part, index) => (index % 2 === 1 ? part : htmlAsMarkdown(part)))
    .join('')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/**
 * One line of plain text for a list row: no HTML, no markdown syntax, no
 * code blocks or tables, whitespace collapsed. Empty when nothing readable
 * is left (a body of only markers or markup).
 */
export function previewOf(body: string): string {
  return withImagesAsAlt(withoutHtmlComments(body))
    .replace(/```[\s\S]*?(?:```|$)/g, ' ')
    .replace(/<details[\s\S]*?(?:<\/details>|$)/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .split('\n')
    .map(line => line.trim())
    .filter(line => line !== '' && !/^\|/.test(line) && !/^[-=*_]{3,}$/.test(line))
    .map(line =>
      line
        .replace(/^#{1,6}\s+/, '')
        .replace(/^>\s?/, '')
        .replace(/^[-*+]\s+(\[[ x]\]\s+)?/i, '')
        .replace(/(\*\*|__)(.+?)\1/g, '$2')
        .replace(/&nbsp;/g, ' ')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>'),
    )
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim()
}

const AUTHOR_ALIASES: Record<string, string> = {
  'copilot-pull-request-reviewer': 'copilot',
  'github-actions': 'actions',
}

/** A login short enough for a list column: `[bot]` dropped, known bots aliased. */
export function shortAuthorOf(login: string): string {
  const bare = login.replace(/\[bot\]$/, '')

  return AUTHOR_ALIASES[bare] ?? bare
}

/** Where a comment points, short: `retry.ts:27` for inline, else its kind. */
export function shortWhereOf(comment: Comment): string {
  if (comment.path) {
    const file = comment.path.slice(comment.path.lastIndexOf('/') + 1)

    return comment.line ? `${file}:${comment.line}` : file
  }

  if (comment.kind === 'review') {
    return comment.reviewState === 'CHANGES_REQUESTED'
      ? 'changes requested'
      : comment.reviewState === 'APPROVED'
        ? 'approved'
        : 'review'
  }

  return 'comment'
}

/** Cuts `text` to `width` cells, ending in `…` when cut. */
export function fit(text: string, width: number): string {
  const chars = [...text]

  if (chars.length <= width) {
    return text
  }

  return width <= 1 ? '…' : `${chars.slice(0, width - 1).join('').trimEnd()}…`
}

/** A comment's one-line row: `author  where  preview`, cut to `width`. */
export function commentRowOf(comment: Comment, width: number): string {
  const preview = previewOf(comment.body)
  const head = `${fit(shortAuthorOf(comment.author), 14)}  ${shortWhereOf(comment)}`

  return fit(preview ? `${head}  ${preview}` : head, width)
}

/** The most text one `Markdown` element takes; the pane refuses the whole tree past 10,000. */
export const MARKDOWN_MAX_CHARS = 9_000

/** `text` cut to what `Markdown` draws, saying so where it stops. */
export function boundedMarkdownOf(text: string): string {
  return text.length <= MARKDOWN_MAX_CHARS
    ? text
    : `${text.slice(0, MARKDOWN_MAX_CHARS)}\n\n_… cut here; open it on GitHub for the rest._`
}
