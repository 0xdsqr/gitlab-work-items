import { GitLabUser, mockWorkspace, type WorkItem, type WorkItemScope, type Workspace } from "@github-work-items/domain"
import { Context, Effect, Layer, Schema } from "effect"
import { gitLabConfigFromEnv, issuePathFor } from "./config.ts"
import { GitLabAuthError, GitLabRequestError } from "./errors.ts"

const RawUser = Schema.Struct({
  id: Schema.Number,
  username: Schema.String,
  name: Schema.String,
})

const RawIssue = Schema.Struct({
  id: Schema.Number,
  iid: Schema.Number,
  title: Schema.String,
  description: Schema.NullOr(Schema.String),
  state: Schema.String,
  labels: Schema.Array(Schema.String),
  updated_at: Schema.String,
  issue_type: Schema.optional(Schema.String),
  web_url: Schema.String,
  references: Schema.Struct({ full: Schema.String }),
  author: Schema.Struct({ username: Schema.String }),
  assignees: Schema.Array(Schema.Struct({ username: Schema.String })),
})

const RawIssues = Schema.Array(RawIssue)

const readStream = (stream: ReadableStream | null | undefined) =>
  stream ? Bun.readableStreamToText(stream) : Promise.resolve("")

const workItemType = (type: string | undefined): WorkItem["type"] => {
  if (type === "task") return "TASK"
  if (type === "incident") return "INCIDENT"
  if (type === "test_case") return "TEST_CASE"
  return "ISSUE"
}

const normalizeIssue = (issue: typeof RawIssue.Type): WorkItem => ({
  id: String(issue.id),
  iid: issue.iid,
  type: workItemType(issue.issue_type),
  title: issue.title,
  description: issue.description ?? "",
  state: issue.state === "closed" ? "CLOSED" : "OPEN",
  reference: issue.references.full,
  namespace: issue.references.full.replace(/[#&].*$/, ""),
  author: issue.author.username,
  assignees: issue.assignees.map((assignee) => assignee.username),
  labels: [...issue.labels],
  webUrl: issue.web_url,
  updatedAt: issue.updated_at,
})

export class GitLabClient extends Context.Service<
  GitLabClient,
  {
    readonly loadWorkspace: (
      scope: WorkItemScope,
    ) => Effect.Effect<Workspace, GitLabAuthError | GitLabRequestError | Schema.SchemaError>
  }
>()("github-work-items/GitLabClient") {
  static readonly layer = Layer.succeed(
    GitLabClient,
    GitLabClient.of({
      loadWorkspace: (scope) => {
        const config = gitLabConfigFromEnv()
        if (config.mock) return Effect.succeed(mockWorkspace)

        const request = <S extends Schema.Top>(operation: string, path: string, schema: S) =>
          Effect.gen(function* () {
            const unknown = yield* config.token
              ? Effect.tryPromise({
                  try: async () => {
                    const response = await fetch(`${config.host}/api/v4/${path}`, {
                      headers: { "PRIVATE-TOKEN": config.token ?? "" },
                    })
                    if (!response.ok)
                      throw new Error(`${response.status} ${response.statusText}: ${await response.text()}`)
                    return response.json() as Promise<unknown>
                  },
                  catch: (cause) =>
                    new GitLabRequestError({ operation, detail: `GitLab request failed: ${String(cause)}`, cause }),
                })
              : Effect.tryPromise({
                  try: async () => {
                    const host = new URL(config.host).host
                    const proc = Bun.spawn({
                      cmd: ["glab", "api", path, "--hostname", host],
                      stdout: "pipe",
                      stderr: "pipe",
                    })
                    const [exitCode, stdout, stderr] = await Promise.all([
                      proc.exited,
                      readStream(proc.stdout),
                      readStream(proc.stderr),
                    ])
                    if (exitCode !== 0)
                      throw new Error(stderr.trim() || stdout.trim() || `glab exited with ${exitCode}`)
                    return JSON.parse(stdout) as unknown
                  },
                  catch: (cause) =>
                    new GitLabAuthError({
                      detail: "No usable GitLab credentials. Set GITLAB_TOKEN or run `glab auth login`.",
                      cause,
                    }),
                })
            return yield* Schema.decodeUnknownEffect(schema)(unknown)
          }).pipe(Effect.withSpan(`GitLabClient.${operation}`))

        return Effect.all(
          {
            user: request("currentUser", "user", RawUser).pipe(Effect.flatMap(Schema.decodeUnknownEffect(GitLabUser))),
            items: request("listIssues", issuePathFor(scope, config.group), RawIssues).pipe(
              Effect.map((issues) => issues.map(normalizeIssue)),
            ),
          },
          { concurrency: "unbounded" },
        )
      },
    }),
  )
}

export const loadWorkspace = (scope: WorkItemScope) =>
  Effect.gen(function* () {
    return yield* (yield* GitLabClient).loadWorkspace(scope)
  }).pipe(Effect.provide(GitLabClient.layer))
