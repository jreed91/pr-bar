import { describe, expect, test } from 'claude-code/testing'

import { checkOf, parseResponse } from '../hooks/github/query'

const answer = (data: unknown, errors?: unknown) => JSON.stringify({ data, errors })

describe('a sparse GraphQL answer', () => {
  test('a PR with every field missing reads as empty values', async () => {
    const outcome = parseResponse(answer({ repository: { pullRequests: { nodes: [{ reviewDecision: 'REVIEW_REQUIRED', commits: 'not a connection' }] } } }))

    expect(outcome).toEqual({
      kind: 'ok',
      viewer: 'ghost',
      pr: {
        number: 0,
        title: '',
        url: '',
        isDraft: false,
        reviewDecision: 'REVIEW_REQUIRED',
        hasConflict: false,
        baseRef: '',
        headRef: '',
        headSha: '',
        checks: [],
        comments: [],
      },
    })
  })

  test('an unknown review decision is none', async () => {
    const outcome = parseResponse(answer({ repository: { pullRequests: { nodes: [{ reviewDecision: 'SOMETHING_NEW' }] } } }))

    expect(outcome.kind === 'ok' && outcome.pr?.reviewDecision).toBeNull()
  })

  test('comments with every field missing', async () => {
    const outcome = parseResponse(answer({ repository: { pullRequests: { nodes: [{
      comments: { nodes: [{}] },
      reviews: { nodes: [{ state: 'APPROVED' }, { state: 'COMMENTED' }] },
      reviewThreads: { nodes: [{ comments: { nodes: [{}] } }] },
    }] } } }))
    const empty = { id: '', author: 'ghost', body: '', createdAt: 0, url: '', path: null, line: null, diffHunk: null }

    expect(outcome.kind === 'ok' && outcome.pr?.comments).toEqual([
      { ...empty, kind: 'conversation', reviewState: null },
      { ...empty, kind: 'review', reviewState: 'APPROVED' },
      { ...empty, kind: 'review-comment', reviewState: null },
    ])
  })

  test('an error with no message, and with data alongside it', async () => {
    expect(parseResponse(answer({}, [{}]))).toEqual({ kind: 'error', detail: 'GitHub returned an error' })
    expect(parseResponse(answer({ repository: { pullRequests: { nodes: [] } } }, [{ message: 'partial' }]))).toEqual({ kind: 'ok', viewer: 'ghost', pr: null })
  })
})

describe('checkOf', () => {
  test('a status context: its state, and names when fields are missing', async () => {
    expect(checkOf({ __typename: 'StatusContext', id: 'S1', context: 'ci/legacy', state: 'FAILURE', targetUrl: null, description: null })).toMatchObject({ id: 'S1', name: 'ci/legacy', state: 'fail' })
    expect(checkOf({ __typename: 'StatusContext', context: 'deploy', state: 'PENDING' })).toMatchObject({ id: 'deploy', name: 'deploy', state: 'pending' })
    expect(checkOf({ __typename: 'StatusContext' })).toMatchObject({ id: '', name: 'status', state: 'pending' })
  })

  test('a check run with no name, id or suite', async () => {
    expect(checkOf({ status: 'COMPLETED', conclusion: 'SUCCESS' })).toEqual({ id: 'check', name: 'check', state: 'pass', url: null, jobId: null, description: null })
  })
})
