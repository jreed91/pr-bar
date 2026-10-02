import { describe, expect, test } from 'claude-code/testing'

import { hunkTailOf, printableTailOf } from '../hooks/model/hunk'
import { bodyMarkdownOf, commentRowOf, fit, previewOf, shortWhereOf } from '../hooks/model/preview'
import { commentOf } from './fixtures'

describe('hunk edges', () => {
  test('a long line is cut to stay inside Code', async () => {
    const long = `+${'x'.repeat(500)}`
    const row = hunkTailOf(`@@ -1 +1 @@\n${long}`)?.split('\n')[1] ?? ''

    expect([...row]).toHaveLength(400)
    expect(row.endsWith('…')).toBe(true)
    expect(printableTailOf(long, 1)).toHaveLength(400)
  })

  test('a deleted file counts the new side from the line before', async () => {
    expect(hunkTailOf('@@ -1,2 +0,0 @@\n-a\n-b')).toBe('@@ -1,2 +0,0 @@\n-a\n-b')
  })

  test('skips "no newline" markers and reads an empty line as context', async () => {
    expect(hunkTailOf('@@ -1,2 +1,2 @@\n-a\n\\ No newline at end of file\n+b\n\n')).toBe('@@ -1,2 +1,2 @@\n-a\n+b\n ')
  })

  test('a header with no lines under it is not a hunk', async () => {
    expect(hunkTailOf('@@ -1 +1 @@')).toBeNull()
    expect(hunkTailOf('')).toBeNull()
  })
})

describe('preview edges', () => {
  test('images: a picture with no img, and an img with no alt, leave nothing', async () => {
    expect(previewOf('<picture><source srcset="x"></picture> ok <img src="y">')).toBe('ok')
    expect(previewOf('<picture><img src="y"></picture>done')).toBe('done')
  })

  test('a link without an href keeps its text', async () => {
    expect(bodyMarkdownOf('<a name="top">Top</a>')).toBe('Top')
  })

  test('where a comment points', async () => {
    expect(shortWhereOf(commentOf({ path: 'README.md', line: null }))).toBe('README.md')
    expect(shortWhereOf(commentOf({ path: null, kind: 'review', reviewState: 'CHANGES_REQUESTED' }))).toBe('changes requested')
    expect(shortWhereOf(commentOf({ path: null, kind: 'review', reviewState: 'APPROVED' }))).toBe('approved')
    expect(shortWhereOf(commentOf({ path: null, kind: 'review', reviewState: 'COMMENTED' }))).toBe('review')
  })

  test('fits into one cell, and a row with no readable body is its head', async () => {
    expect(fit('abc', 1)).toBe('…')
    expect(fit('abc', 0)).toBe('…')
    expect(commentRowOf(commentOf({ author: 'alice', path: 'a.ts', line: 3, body: '<!-- marker -->' }), 40)).toBe('alice  a.ts:3')
  })
})
