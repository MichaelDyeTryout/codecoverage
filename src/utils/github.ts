import * as core from '@actions/core'
import * as diff from './diff'
import * as github from '@actions/github'
import {
  CoverageFile,
  LineRange,
  coalesceLineNumbers,
  intersectLineRanges
} from './general'
import {Octokit} from 'octokit'
import {createAppAuth} from '@octokit/auth-app'

export class GithubUtil {
  private client: Octokit

  constructor(
    token: string,
    baseUrl: string,
    appId?: string,
    privateKey?: string
  ) {
    if (!token && (!appId || !privateKey)) {
      throw new Error(
        'Either GITHUB_TOKEN or both APP_ID and PRIVATE_KEY are required'
      )
    }

    if (appId && privateKey) {
      // GitHub App authentication
      this.client = new Octokit({
        authStrategy: createAppAuth,
        auth: {
          appId,
          privateKey,
          installationId: github.context.payload.installation?.id
        },
        baseUrl
      })
      core.info('Using GitHub App authentication')
    } else {
      // Token-based authentication
      this.client = new Octokit({auth: token, baseUrl})
      core.info('Using token-based authentication')
    }
  }

  getPullRequestRef(): string {
    const pullRequest = github.context.payload.pull_request
    return pullRequest
      ? pullRequest.head.ref
      : github.context.ref.replace('refs/heads/', '')
  }

  async getPullRequestDiff(): Promise<PullRequestFiles> {
    const pr_num = github.context.payload.pull_request?.number
    if (!pr_num) {
      throw new Error('Pull request number is missing')
    }

    const payload = {
      ...github.context.repo,
      pull_number: pr_num,
      mediaType: {
        format: 'diff'
      }
    }

    core.info(`Payload: ${JSON.stringify(payload)}`)

    const resp = await this.client.rest.pulls.get(payload)
    const diff_data = resp.data as unknown as string

    core.info(`Diff data: ${diff_data}`)
    const fileLines = diff.parseGitDiff(diff_data)
    const prFiles: PullRequestFiles = {}
    for (const item of fileLines) {
      prFiles[item.filename] = coalesceLineNumbers(item.addedLines)
    }

    return prFiles
  }

  /**
   * https://docs.github.com/en/rest/checks/runs?apiVersion=2022-11-28#create-a-check-run
   * https://docs.github.com/en/rest/checks/runs?apiVersion=2022-11-28#update-a-check-run
   */
  async annotate(input: InputAnnotateParams): Promise<number> {
    if (input.annotations.length === 0) {
      return 0
    }
    // github API lets you post 50 annotations at a time
    const chunkSize = 50
    const chunks: Annotations[][] = []
    for (let i = 0; i < input.annotations.length; i += chunkSize) {
      chunks.push(input.annotations.slice(i, i + chunkSize))
    }
    let lastResponseStatus = 0
    let checkId
    for (let i = 0; i < chunks.length; i++) {
      let status: 'in_progress' | 'completed' | 'queued' = 'in_progress'
      let conclusion:
        | 'success'
        | 'action_required'
        | 'cancelled'
        | 'failure'
        | 'neutral'
        | 'skipped'
        | 'stale'
        | 'timed_out'
        | undefined = undefined
      if (i === chunks.length - 1) {
        status = 'completed'
        conclusion = 'success'
      }
      const params = {
        ...github.context.repo,
        name: 'Annotate',
        head_sha: input.referenceCommitHash,
        status,
        ...(conclusion && {conclusion}),
        output: {
          title: 'Coverage Tool',
          summary: 'Missing Coverage',
          annotations: chunks[i]
        }
      }
      let response
      if (i === 0) {
        response = await this.client.rest.checks.create({
          ...params
        })
        checkId = response.data.id
      } else {
        response = await this.client.rest.checks.update({
          ...params,
          check_run_id: checkId,
          status: 'in_progress' as const
        })
      }
      core.info(response.data.output.annotations_url)
      lastResponseStatus = response.status
    }
    return lastResponseStatus
  }

  buildAnnotations(
    coverageFiles: CoverageFile[],
    pullRequestFiles: PullRequestFiles
  ): Annotations[] {
    const annotations: Annotations[] = []
    for (const current of coverageFiles) {
      // Only annotate relevant files
      const prFileRanges = pullRequestFiles[current.fileName]
      if (prFileRanges) {
        const coverageRanges = coalesceLineNumbers(current.missingLineNumbers)
        const uncoveredRanges = intersectLineRanges(
          coverageRanges,
          prFileRanges
        )

        // Only annotate relevant line ranges
        for (const uRange of uncoveredRanges) {
          const message =
            uRange.end_line > uRange.start_line
              ? 'These lines are not covered by a test'
              : 'This line is not covered by a test'
          annotations.push({
            path: current.fileName,
            start_line: uRange.start_line,
            end_line: uRange.end_line,
            annotation_level: 'warning',
            message
          })
        }
      }
    }
    core.info(`Annotation count: ${annotations.length}`)
    return annotations
  }
}

type InputAnnotateParams = {
  referenceCommitHash: string
  annotations: Annotations[]
}

type Annotations = {
  path: string
  start_line: number
  end_line: number
  start_column?: number
  end_column?: number
  annotation_level: 'notice' | 'warning' | 'failure'
  message: string
}

type PullRequestFiles = {
  [key: string]: LineRange[]
}
