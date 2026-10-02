import { describe, expect, test } from 'claude-code/testing'

import { bodyMarkdownOf, commentRowOf, fit, previewOf, shortAuthorOf, withoutHtmlComments } from '../hooks/model/preview'
import { commentOf } from './fixtures'

describe('previewOf', () => {
  test('drops bot markers, HTML and markdown down to one line', async () => {
    expect(previewOf('<!-- ccr-overview-v2 -->\n## Pull request overview\n\nThis PR adds **retry** to the [worker](https://x).')).toBe(
      'Pull request overview This PR adds retry to the worker.',
    )
    expect(previewOf('<h2>Coverage Report for apps/webhooks</h2>\n<details><summary>Files</summary>\n| a | b |\n</details>\n\nLines 87.2%')).toBe(
      'Coverage Report for apps/webhooks Lines 87.2%',
    )
    expect(previewOf('nit:\n```ts\nconst a = 1\n```\nuse `b`')).toBe('nit: use `b`')
    expect(previewOf('<!-- marker only -->')).toBe('')
  })

  test('keeps HTML comments out of the detail body too', async () => {
    expect(withoutHtmlComments('<!-- ccr -->\nReal text')).toBe('Real text')
  })
})

describe('rows', () => {
  test('short authors and one fitted line', async () => {
    expect(shortAuthorOf('copilot-pull-request-reviewer')).toBe('copilot')
    expect(shortAuthorOf('github-actions[bot]')).toBe('actions')
    expect(shortAuthorOf('maria')).toBe('maria')
    expect(fit('abcdef', 4)).toBe('abc…')

    const row = commentRowOf(
      commentOf({
        author: 'copilot-pull-request-reviewer',
        path: 'apps/webhooks/src/retry/send-webhook.ts',
        line: 91,
        body: 'A transient network failure here causes the queue to redeliver and call the endpoint again for the same event.',
      }),
      60,
    )
    expect(row.startsWith('copilot  send-webhook.ts:91  A transient')).toBe(true)
    expect([...row].length).toBeLessThanOrEqual(60)
    expect(row.endsWith('…')).toBe(true)
  })
})

describe('bodyMarkdownOf', () => {
  const copilotSummary = "## 🟡 Changes recommended\n\nThe retry limit in the code contradicts the limit the README documents.\n\n**Review effort:** Balanced\n**Findings:** 1 <picture><source media=\"(prefers-color-scheme: dark)\" srcset=\"https://github.githubassets.com/static/images/icons/copilot-code-review/high-v2-dark.svg\"><source media=\"(prefers-color-scheme: light)\" srcset=\"https://github.githubassets.com/static/images/icons/copilot-code-review/high-v2-light.svg\"><img src=\"https://github.githubassets.com/static/images/icons/copilot-code-review/high-v2-light.png\" alt=\"High severity\" width=\"62\" height=\"18\" align=\"texttop\"></picture> · 2 <picture><source media=\"(prefers-color-scheme: dark)\" srcset=\"https://github.githubassets.com/static/images/icons/copilot-code-review/medium-v2-dark.svg\"><source media=\"(prefers-color-scheme: light)\" srcset=\"https://github.githubassets.com/static/images/icons/copilot-code-review/medium-v2-light.svg\"><img src=\"https://github.githubassets.com/static/images/icons/copilot-code-review/medium-v2-light.png\" alt=\"Medium severity\" width=\"62\" height=\"18\" align=\"texttop\"></picture> · 3 <picture><source media=\"(prefers-color-scheme: dark)\" srcset=\"https://github.githubassets.com/static/images/icons/copilot-code-review/low-v2-dark.svg\"><source media=\"(prefers-color-scheme: light)\" srcset=\"https://github.githubassets.com/static/images/icons/copilot-code-review/low-v2-light.svg\"><img src=\"https://github.githubassets.com/static/images/icons/copilot-code-review/low-v2-light.png\" alt=\"Low severity\" width=\"62\" height=\"18\" align=\"texttop\"></picture>"

  test('a Copilot review summary has no raw HTML left', async () => {
    const body = bodyMarkdownOf(copilotSummary)

    expect(body).toContain('**Findings:** 1 High severity · 2 Medium severity · 3 Low severity')
    expect(body).not.toMatch(/<|>|githubassets/)
    expect(previewOf(copilotSummary)).toContain('Findings: 1 High severity · 2 Medium severity · 3 Low severity')
  })

  test('converts GitHub HTML to markdown and leaves code alone', async () => {
    expect(
      bodyMarkdownOf(
        '<!-- ccr -->\n<h2>Coverage</h2>\n<details><summary>Files</summary>\n<p>See <a href="https://x">the run</a> &amp; <b>fix</b><br>it</p>\n</details>\n<img src="x.png">',
      ),
    ).toBe('## Coverage\n\n**Files**\n\nSee [the run](https://x) & **fix**\nit')
    expect(bodyMarkdownOf('Use `<T>` here:\n```ts\nconst a = <div>x</div>\n```')).toBe(
      'Use `<T>` here:\n```ts\nconst a = <div>x</div>\n```',
    )
  })
})
