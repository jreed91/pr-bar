import { bodyMarkdownOf, withoutHtmlComments } from './preview'

/** How many of a description's images are fetched and drawn; the rest are links. */
export const DESCRIPTION_IMAGES = 6
/** The tallest an image is drawn, in terminal rows. */
export const IMAGE_ROWS = 24
/** Roughly how many pixels wide one terminal cell is. */
const CELL_PIXELS = 8

/** One piece of a PR description, in order: markdown, or an image in its place. */
export type DescriptionPart =
  | { kind: 'text'; markdown: string }
  | { kind: 'image'; alt: string; src: string }

const attributeOf = (tag: string, name: string): string | null =>
  new RegExp(`\\s${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, 'i')
    .exec(tag)
    ?.slice(1)
    .find(value => value !== undefined) ?? null

/** A `<picture>` (its first `<img>`), a bare `<img>`, or a markdown image. */
const IMAGE = /<picture\b[\s\S]*?(?:<\/picture>|$)|<img\b[^>]*>|!\[([^\]]*)\]\(\s*<?([^)\s>]+)>?(?:\s+"[^"]*")?\s*\)/gi

/**
 * A PR description split around its images, outside code: the text between
 * them as markdown for the pane (HTML turned into text), each image with
 * its alt text and source. An image without a source stays out.
 */
export function descriptionPartsOf(body: string): DescriptionPart[] {
  const parts: DescriptionPart[] = []
  let text = ''
  const flush = () => {
    const markdown = bodyMarkdownOf(text)

    if (markdown) {
      parts.push({ kind: 'text', markdown })
    }

    text = ''
  }

  withoutHtmlComments(body)
    .split(/(```[\s\S]*?(?:```|$)|`[^`\n]*`)/)
    .forEach((piece, index) => {
      if (index % 2 === 1) {
        text += piece
        return
      }

      let last = 0

      for (const match of piece.matchAll(IMAGE)) {
        const [whole, mdAlt, mdSrc] = match
        const img = mdSrc === undefined ? (/<img\b[^>]*>/i.exec(whole)?.[0] ?? '') : null
        const src = img === null ? mdSrc : attributeOf(img, 'src')

        text += piece.slice(last, match.index)
        last = match.index + whole.length

        if (src) {
          flush()
          parts.push({ kind: 'image', alt: (img === null ? mdAlt : attributeOf(img, 'alt')) ?? '', src })
        }
      }

      text += piece.slice(last)
    })
  flush()

  return parts
}

/**
 * The image sources in GitHub's rendering of a description, in order: for a
 * private repo they are short-lived signed links that need no token. Custom
 * emoji, drawn as images there but text in the markdown, are left out.
 */
export function imageSrcsOf(bodyHtml: string): string[] {
  return [...bodyHtml.matchAll(/<img\b[^>]*>/gi)]
    .map(([img]) => img)
    .filter(img => !/\sclass\s*=\s*"[^"]*\bemoji\b/i.test(img))
    .map(img => attributeOf(img, 'src') ?? '')
}

const BASE64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'

/** The first bytes of base64 `text`, enough to read a file's header. */
function headOf(text: string, bytes: number): number[] {
  const out: number[] = []
  let bits = 0
  let value = 0

  for (const char of text.slice(0, Math.ceil(bytes / 3) * 4)) {
    const digit = BASE64.indexOf(char)

    if (digit < 0) {
      break
    }

    value = (value << 6) | digit
    bits += 6

    if (bits >= 8) {
      bits -= 8
      out.push((value >> bits) & 0xff)
    }
  }

  return out
}

/** The signature, then the IHDR chunk's length (13) and type, every PNG opens with. */
const PNG_HEAD = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]

/** The CRC-32 of `bytes`, as a PNG chunk carries it. */
function crc32Of(bytes: readonly number[]): number {
  let crc = 0xffffffff

  for (const byte of bytes) {
    crc ^= byte

    for (let bit = 0; bit < 8; bit++) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1))
    }
  }

  return (crc ^ 0xffffffff) >>> 0
}

/**
 * A PNG's size in pixels from its base64 bytes, or null when it does not
 * open with a whole, checksummed IHDR chunk (`Image` refuses one that does
 * not, and a refused tree draws nothing).
 */
export function pngSizeOf(base64: string): { width: number; height: number } | null {
  const head = headOf(base64, 33)

  if (head.length < 33 || PNG_HEAD.some((byte, at) => head[at] !== byte)) {
    return null
  }

  const u32 = (at: number) =>
    (((head[at] as number) << 24) | ((head[at + 1] as number) << 16) | ((head[at + 2] as number) << 8) | (head[at + 3] as number)) >>> 0
  const width = u32(16)
  const height = u32(20)

  if (crc32Of(head.slice(12, 29)) !== u32(29)) {
    return null
  }

  return width > 0 && height > 0 ? { width, height } : null
}

/**
 * The box of cells an image is drawn in: its own width at about eight pixels
 * a cell, no wider than `maxColumns`, no taller than IMAGE_ROWS, keeping its
 * shape (a cell is about twice as tall as it is wide).
 */
export function imageBoxOf(
  size: { width: number; height: number },
  maxColumns: number,
): { columns: number; rows: number } {
  const ratio = size.height / size.width / 2
  let columns = Math.max(1, Math.min(255, maxColumns, Math.ceil(size.width / CELL_PIXELS)))
  let rows = Math.max(1, Math.round(columns * ratio))

  if (rows > IMAGE_ROWS) {
    rows = IMAGE_ROWS
    columns = Math.max(1, Math.round(rows / ratio))
  }

  return { columns, rows }
}
