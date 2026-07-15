import {
  applyWorkflowTransition,
  GitLabUser,
  mockWorkspace,
  workflowTransition,
  type WorkflowColumnId,
  type WorkItem,
  type WorkItemScope,
  type Workspace,
} from "@github-work-items/domain"
import { Context, Effect, Layer, Schema } from "effect"
import { gitLabConfigFromEnv, issuePathFor } from "./config.ts"
import { GitLabRequestError } from "./errors.ts"

const RawUser = Schema.Struct({
  id: Schema.Number,
  username: Schema.String,
  name: Schema.String,
})

const RawIssue = Schema.Struct({
  id: Schema.Number,
  project_id: Schema.Number,
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
type RequestMethod = "GET" | "POST" | "PUT"
type RequestFields = Readonly<Record<string, string>>

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
  projectId: issue.project_id,
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

const platformOpener = () => {
  if (process.platform === "darwin") return ["open"] as const
  if (process.platform === "win32") return ["cmd", "/c", "start", ""] as const
  return ["xdg-open"] as const
}

export class GitLabClient extends Context.Service<
  GitLabClient,
  {
    readonly loadWorkspace: (scope: WorkItemScope) => Effect.Effect<Workspace, GitLabRequestError | Schema.SchemaError>
    readonly moveWorkItem: (
      item: WorkItem,
      target: WorkflowColumnId,
    ) => Effect.Effect<WorkItem, GitLabRequestError | Schema.SchemaError>
    readonly setWorkItemState: (
      item: WorkItem,
      state: WorkItem["state"],
    ) => Effect.Effect<WorkItem, GitLabRequestError | Schema.SchemaError>
    readonly createWorkItem: (
      project: string,
      title: string,
    ) => Effect.Effect<WorkItem, GitLabRequestError | Schema.SchemaError>
    readonly openWorkItem: (item: WorkItem) => Effect.Effect<void, GitLabRequestError>
  }
>()("github-work-items/GitLabClient") {
  static readonly layer = Layer.succeed(
    GitLabClient,
    GitLabClient.of({
      loadWorkspace: (scope) => {
        const config = gitLabConfigFromEnv()
        if (config.mock) return Effect.succeed(mockWorkspace)
        return Effect.all(
          {
            user: request("currentUser", "GET", "user", RawUser).pipe(
              Effect.flatMap(Schema.decodeUnknownEffect(GitLabUser)),
            ),
            items: request("listIssues", "GET", issuePathFor(scope, config.group), RawIssues).pipe(
              Effect.map((issues) => issues.map(normalizeIssue)),
            ),
          },
          { concurrency: "unbounded" },
        )
      },
      moveWorkItem: (item, target) => {
        const config = gitLabConfigFromEnv()
        if (config.mock) return Effect.succeed(applyWorkflowTransition(item, target))
        const transition = workflowTransition(item, target)
        const fields = {
          ...(transition.stateEvent ? { state_event: transition.stateEvent } : {}),
          ...(transition.addLabels.length > 0 ? { add_labels: transition.addLabels.join(",") } : {}),
          ...(transition.removeLabels.length > 0 ? { remove_labels: transition.removeLabels.join(",") } : {}),
        }
        if (Object.keys(fields).length === 0) return Effect.succeed(item)
        return updateIssue("moveWorkItem", item, fields)
      },
      setWorkItemState: (item, state) => {
        const config = gitLabConfigFromEnv()
        if (config.mock) return Effect.succeed({ ...item, state })
        if (item.state === state) return Effect.succeed(item)
        return updateIssue("setWorkItemState", item, { state_event: state === "CLOSED" ? "close" : "reopen" })
      },
      createWorkItem: (project, title) => {
        const config = gitLabConfigFromEnv()
        if (config.mock)
          return Effect.succeed({
            id: `mock-${Date.now()}`,
            projectId: 0,
            iid: mockWorkspace.items.length + 1,
            type: "ISSUE",
            title,
            description: "",
            state: "OPEN",
            reference: `${project}#new`,
            namespace: project,
            author: mockWorkspace.user.username,
            assignees: [],
            labels: [],
            webUrl: `${config.host}/${project}/-/issues`,
            updatedAt: new Date().toISOString(),
          })
        return request("createWorkItem", "POST", `projects/${encodeURIComponent(project)}/issues`, RawIssue, {
          title,
        }).pipe(Effect.map(normalizeIssue))
      },
      openWorkItem: (item) => {
        if (gitLabConfigFromEnv().mock) return Effect.void
        const command = [...platformOpener(), item.webUrl]
        return Effect.tryPromise({
          try: async () => {
            const proc = Bun.spawn({ cmd: command, stdout: "ignore", stderr: "pipe" })
            const [exitCode, stderr] = await Promise.all([proc.exited, readStream(proc.stderr)])
            if (exitCode !== 0) throw new Error(stderr.trim() || `${command[0]} exited with ${exitCode}`)
          },
          catch: (cause) =>
            new GitLabRequestError({
              operation: "openWorkItem",
              detail: `Could not open ${item.webUrl}: ${String(cause)}`,
              cause,
            }),
        })
      },
    }),
  )
}

const request = <S extends Schema.Top>(
  operation: string,
  method: RequestMethod,
  path: string,
  schema: S,
  fields: RequestFields = {},
) =>
  Effect.gen(function* () {
    const config = gitLabConfigFromEnv()
    const unknown = yield* Effect.tryPromise({
      try: async () => {
        if (config.token) {
          const response = await fetch(`${config.host}/api/v4/${path}`, {
            method,
            headers: { "PRIVATE-TOKEN": config.token, "Content-Type": "application/x-www-form-urlencoded" },
            ...(method === "GET" ? {} : { body: new URLSearchParams(fields) }),
          })
          if (!response.ok) throw new Error(`${response.status} ${response.statusText}: ${await response.text()}`)
          return response.json() as Promise<unknown>
        }

        const host = new URL(config.host).host
        const args = [
          "glab",
          "api",
          path,
          "--hostname",
          host,
          ...(method === "GET" ? [] : ["--method", method]),
          ...Object.entries(fields).flatMap(([name, value]) => ["--field", `${name}=${value}`]),
        ]
        const proc = Bun.spawn({ cmd: args, stdout: "pipe", stderr: "pipe" })
        const [exitCode, stdout, stderr] = await Promise.all([
          proc.exited,
          readStream(proc.stdout),
          readStream(proc.stderr),
        ])
        if (exitCode !== 0) throw new Error(stderr.trim() || stdout.trim() || `glab exited with ${exitCode}`)
        return JSON.parse(stdout) as unknown
      },
      catch: (cause) =>
        new GitLabRequestError({
          operation,
          detail: `GitLab ${operation} failed: ${String(cause)}. Check GITLAB_TOKEN or \`glab auth status\`.`,
          cause,
        }),
    })
    return yield* Schema.decodeUnknownEffect(schema)(unknown)
  }).pipe(Effect.withSpan(`GitLabClient.${operation}`))

const updateIssue = (operation: string, item: WorkItem, fields: RequestFields) =>
  request(operation, "PUT", `projects/${item.projectId}/issues/${item.iid}`, RawIssue, fields).pipe(
    Effect.map(normalizeIssue),
  )

export const loadWorkspace = (scope: WorkItemScope) =>
  Effect.gen(function* () {
    const client = yield* GitLabClient
    return yield* client.loadWorkspace(scope)
  }).pipe(Effect.provide(GitLabClient.layer))

export const moveWorkItem = (item: WorkItem, target: WorkflowColumnId) =>
  Effect.gen(function* () {
    const client = yield* GitLabClient
    return yield* client.moveWorkItem(item, target)
  }).pipe(Effect.provide(GitLabClient.layer))

export const setWorkItemState = (item: WorkItem, state: WorkItem["state"]) =>
  Effect.gen(function* () {
    const client = yield* GitLabClient
    return yield* client.setWorkItemState(item, state)
  }).pipe(Effect.provide(GitLabClient.layer))

export const createWorkItem = (project: string, title: string) =>
  Effect.gen(function* () {
    const client = yield* GitLabClient
    return yield* client.createWorkItem(project, title)
  }).pipe(Effect.provide(GitLabClient.layer))

export const openWorkItem = (item: WorkItem) =>
  Effect.gen(function* () {
    const client = yield* GitLabClient
    return yield* client.openWorkItem(item)
  }).pipe(Effect.provide(GitLabClient.layer))
