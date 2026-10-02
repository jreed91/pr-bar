import { describe, expect, test } from 'claude-code/testing'

import { descriptionPartsOf, imageBoxOf, imageSrcsOf, IMAGE_ROWS, pngSizeOf } from '../hooks/model/description'

/** PNGs, base64: 800x400 (and one with a broken IHDR checksum), 0x10 and 100x4000. */
export const PNG_800x400 = 'iVBORw0KGgoAAAANSUhEUgAAAyAAAAGQCAIAAADZR5NjAAAAC0lEQVR42mNgwAsAAB8AARNZND0AAAAASUVORK5CYII='
const BAD_CRC = 'iVBORw0KGgoAAAANSUhEUgAAAyAAAAGQCAIAAADZR5NiAAAAC0lEQVR42mNgwAsAAB8AARNZND0AAAAASUVORK5CYII='
const PNG_0x10 = 'iVBORw0KGgoAAAANSUhEUgAAAAAAAAAKCAIAAAAVcsgjAAAACUlEQVR42mMAAAABAAGxDbaTAAAAAElFTkSuQmCC'
const PNG_100x4000 = 'iVBORw0KGgoAAAANSUhEUgAAAGQAAA+gCAIAAACDsS5IAAAAC0lEQVR42mNgwAsAAB8AARNZND0AAAAASUVORK5CYII='
export const GIF = 'R0lGODlhAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'

describe('descriptionPartsOf', () => {
  test('splits the text around each kind of image, in order', async () => {
    const body = [
      '## Why',
      'The retry loop never stopped.',
      '![before](https://github.com/user-attachments/assets/a1 "the old one")',
      'In between <img width="300" alt="after" src="https://github.com/user-attachments/assets/b2" /> and',
      '<picture><source srcset="x"><img src="https://example.com/c3.png"></picture>',
      '<!-- ![hidden](https://example.com/h.png) -->',
      '```\n![not an image](in-code)\n```',
    ].join('\n')

    expect(descriptionPartsOf(body)).toEqual([
      { kind: 'text', markdown: '## Why\nThe retry loop never stopped.' },
      { kind: 'image', alt: 'before', src: 'https://github.com/user-attachments/assets/a1' },
      { kind: 'text', markdown: 'In between' },
      { kind: 'image', alt: 'after', src: 'https://github.com/user-attachments/assets/b2' },
      { kind: 'text', markdown: 'and' },
      { kind: 'image', alt: '', src: 'https://example.com/c3.png' },
      { kind: 'text', markdown: '```\n![not an image](in-code)\n```' },
    ])
  })

  test('an image with no source is dropped, and an empty body has no parts', async () => {
    expect(descriptionPartsOf('<picture></picture><img alt="x">')).toEqual([])
    expect(descriptionPartsOf('  ')).toEqual([])
  })
})

describe('imageSrcsOf', () => {
  test('lists rendered sources in order, leaving out custom emoji', async () => {
    const html = '<p><img src="https://private-user-images.githubusercontent.com/1?jwt=x" alt="a"> <img class="emoji" src="e.png"> <img alt="no source"></p>'

    expect(imageSrcsOf(html)).toEqual(['https://private-user-images.githubusercontent.com/1?jwt=x', ''])
  })
})

describe('pngSizeOf', () => {
  test('reads a PNG header, and refuses anything else', async () => {
    expect(pngSizeOf(PNG_800x400)).toEqual({ width: 800, height: 400 })
    expect(pngSizeOf(PNG_0x10)).toBeNull()
    expect(pngSizeOf(GIF)).toBeNull()
    expect(pngSizeOf(BAD_CRC)).toBeNull()
    expect(pngSizeOf('iVBO')).toBeNull()
    expect(pngSizeOf('iVBO*w0KGgo')).toBeNull()
  })
})

describe('imageBoxOf', () => {
  test('keeps the shape inside the width and the row cap', async () => {
    expect(imageBoxOf({ width: 800, height: 400 }, 70)).toEqual({ columns: 70, rows: 18 })
    expect(imageBoxOf({ width: 80, height: 40 }, 70)).toEqual({ columns: 10, rows: 3 })
    expect(imageBoxOf({ width: 100, height: 4000 }, 70)).toEqual({ columns: 1, rows: IMAGE_ROWS })
    expect(imageBoxOf({ width: 1, height: 1 }, 70)).toEqual({ columns: 1, rows: 1 })
  })
})

test('the fixture PNG is tall', async () => {
  expect(pngSizeOf(PNG_100x4000)).toEqual({ width: 100, height: 4000 })
})
