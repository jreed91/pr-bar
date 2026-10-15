import { describe, expect, test } from 'claude-code/testing'

import { TIMELINE_ROWS, timelineSvgOf } from '../hooks/model/timeline'
import { checkOf } from './fixtures'

const T0 = Date.parse('2026-10-01T12:00:00Z')

describe('timelineSvgOf', () => {
  test('one bar a check on a shared axis, a running one to now, each with a tooltip', async () => {
    const svg = timelineSvgOf(
      [
        checkOf({ id: 'b', name: 'CI / lint & <types>', state: 'pass', startedAt: T0 + 60_000, completedAt: T0 + 120_000 }),
        checkOf({ id: 'a', name: 'CI / test', state: 'fail', startedAt: T0, completedAt: T0 + 180_000 }),
        checkOf({ id: 'c', name: 'deploy', state: 'pending', startedAt: T0 + 120_000, completedAt: null }),
        checkOf({ id: 'd', name: 'status', state: 'pass' }),
      ],
      T0 + 240_000,
    )

    expect(svg).toMatch(/^<svg xmlns="http:\/\/www.w3.org\/2000\/svg" width="600" height="42" viewBox="0 0 600 42">/)
    // Earliest start first; the axis runs from it to the running check's now.
    expect(svg).toContain('<rect x="0.0" y="2" width="450.0" height="10" rx="2" fill="#cf222e"><title>CI / test · failed · 3m</title></rect>')
    expect(svg).toContain('<rect x="150.0" y="16" width="150.0" height="10" rx="2" fill="#2da44e"><title>CI / lint &amp; &lt;types&gt; · passed · 1m</title></rect>')
    expect(svg).toContain('<rect x="300.0" y="30" width="300.0" height="10" rx="2" fill="#bf8700"><title>deploy · running · 2m</title></rect>')
    expect(svg).not.toContain('status')
  })

  test('needs two started checks, keeps the first rows, and gives a zero-length check a sliver', async () => {
    expect(timelineSvgOf([checkOf({ startedAt: T0, completedAt: T0 })], T0)).toBeNull()

    const many = Array.from({ length: TIMELINE_ROWS + 5 }, (_, n) =>
      checkOf({ id: `c${n}`, name: `"job" ${n}`, state: 'skip', startedAt: T0, completedAt: T0 }),
    )
    const svg = timelineSvgOf(many, T0) ?? ''

    expect(svg.match(/<rect /g)).toHaveLength(TIMELINE_ROWS)
    expect(svg).toContain('width="2.0"')
    expect(svg).toContain('&quot;job&quot; 0 · skipped · 0s')
  })

  test('gives up past what an Svg holds', async () => {
    const long = Array.from({ length: TIMELINE_ROWS }, (_, n) =>
      checkOf({ id: `c${n}`, name: 'x'.repeat(5_000), startedAt: T0, completedAt: T0 + 1_000 }),
    )

    expect(timelineSvgOf(long, T0)).toBeNull()
  })
})
