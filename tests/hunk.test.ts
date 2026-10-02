import { describe, expect, test } from 'claude-code/testing'

import { hunkTailOf, printableTailOf } from '../hooks/model/hunk'

describe('hunkTailOf', () => {
  test('keeps the lines that end at the commented line, recounted', async () => {
    // A new file's hunk runs from line 1 down to the commented line 240.
    const lines = Array.from({ length: 240 }, (_, n) => `+line ${n + 1}`)
    const hunk = hunkTailOf(`@@ -0,0 +1,300 @@\n${lines.join('\n')}`)

    expect(hunk).toBe('@@ -0,0 +235,6 @@\n+line 235\n+line 236\n+line 237\n+line 238\n+line 239\n+line 240')
  })

  test('counts both sides through context, removals and additions', async () => {
    expect(hunkTailOf('@@ -10,9 +10,9 @@ fn()\n ctx\n-old\n+new\n ctx2', 3)).toBe('@@ -11,2 +11,2 @@\n-old\n+new\n ctx2')
    expect(hunkTailOf('@@ -1,3 +1,3 @@\n-a\n+b')).toBe('@@ -1 +1 @@\n-a\n+b')
  })

  test('drops carriage returns and refuses what is not a hunk', async () => {
    expect(hunkTailOf('@@ -1 +1 @@\r\n-a\r\n+b\r')).toBe('@@ -1 +1 @@\n-a\n+b')
    expect(hunkTailOf('@@')).toBeNull()
    expect(hunkTailOf('@@ -1 +1 @@\nnot a diff line')).toBeNull()
    expect(printableTailOf('a\r\nb\u0007\nc', 2)).toBe('b\nc')
  })
})
