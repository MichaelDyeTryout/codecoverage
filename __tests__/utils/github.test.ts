import {test, expect, expectTypeOf} from 'vitest'
import {GithubUtil} from '../../src/utils/github'
import {Octokit} from 'octokit'

test('github init successfully', async function () {
  const githubUtil = new GithubUtil('1234', 'https://api.github.com')
  expect(githubUtil).toBeInstanceOf(GithubUtil)
})

test('github init to throw error', function () {
  expect(() => new GithubUtil('', 'https://api.github.com')).toThrowError(
    'Either GITHUB_TOKEN or both APP_ID and PRIVATE_KEY are required'
  )
})

test.skip('octokit gets diff', async () => {
  const tok = process.env.GITHUB_TOKEN
  if (!tok) {
    throw new Error('GITHUB_TOKEN is not set')
  }

  const client = new Octokit({
    auth: tok,
    baseUrl: 'https://api.github.com'
  })

  const resp = await client.rest.pulls.get({
    ...{owner: 'MichaelDyeTryout', repo: 'golang-test-lab'},
    pull_number: 7,
    mediaType: {
      format: 'diff'
    }
  })

  expect(resp.status).toBe(200)
  expect(resp.data).toBeDefined()
  expectTypeOf(resp.data).toBeString

  const dd = resp.data as unknown as string
  dd.split('\n')
})

test('build annotations', function () {
  const githubUtil = new GithubUtil('1234', 'https://api.github.com')

  const prFiles = {
    'file1.txt': [
      {end_line: 139, start_line: 132},
      {end_line: 1007, start_line: 1000}
    ],
    'test/dir/file1.txt': [{end_line: 45, start_line: 22}]
  }

  const coverageFiles = [
    {fileName: 'unchanged.txt', missingLineNumbers: [1, 2, 3]},
    {
      fileName: 'file1.txt',
      missingLineNumbers: [1, 2, 3, 132, 134, 135, 136, 1007, 1008]
    },
    {
      fileName: 'test/dir/file1.txt',
      missingLineNumbers: [20, 21, 22]
    }
  ]

  const annotations = githubUtil.buildAnnotations(coverageFiles, prFiles)

  expect(annotations).toEqual([
    {
      path: 'file1.txt',
      start_line: 132,
      end_line: 132,
      annotation_level: 'warning',
      message: 'This line is not covered by a test'
    },
    {
      path: 'file1.txt',
      start_line: 134,
      end_line: 136,
      annotation_level: 'warning',
      message: 'These lines are not covered by a test'
    },
    {
      path: 'file1.txt',
      start_line: 1007,
      end_line: 1007,
      annotation_level: 'warning',
      message: 'This line is not covered by a test'
    },
    {
      path: 'test/dir/file1.txt',
      start_line: 22,
      end_line: 22,
      annotation_level: 'warning',
      message: 'This line is not covered by a test'
    }
  ])
})

// @todo test for rest of github class
