import {
  applyWorkflowTransition,
  mockWorkspace,
  workflowTransition,
  type GitLabUser,
  type WorkflowColumnId,
  type WorkItem,
  type WorkItemLabel,
  type WorkItemScope,
  type Workspace,
} from "@gitlab-work-items/domain"
import { Context, Effect, Layer, Schema } from "effect"
import {
  gitLabApiUrl,
  gitLabConfigFromEnv,
  gitLabHostname,
  gitLabNextPageUrl,
  issuePathFor,
  trustedGitLabWebUrl,
  type GitLabConfig,
} from "./config.ts"
import { GitLabRequestError, type GitLabRequestErrorKind } from "./errors.ts"

const RawUser = Schema.Struct({
  id: Schema.Number,
  username: Schema.String,
  name: Schema.String,
})

const RawLabel = Schema.Struct({
  name: Schema.String,
  color: Schema.String,
  text_color: Schema.String,
})

const RawIssueLabel = Schema.Union([Schema.String, RawLabel])

const RawIssue = Schema.Struct({
  id: Schema.Number,
  project_id: Schema.Number,
  iid: Schema.Number,
  title: Schema.String,
  description: Schema.NullOr(Schema.String),
  state: Schema.Literals(["opened", "closed"]),
  labels: Schema.Array(RawIssueLabel),
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

const REQUEST_TIMEOUT_MS = 30_000
const OPEN_TIMEOUT_MS = 10_000
const MAX_PROCESS_OUTPUT_BYTES = 64 * 1024 * 1024
const MAX_ERROR_BODY_BYTES = 64 * 1024
const MAX_PAGINATED_ITEMS = 100_000
const MAX_PAGES = 1_000

const isTerminalControl = (character: string) => {
  const codePoint = character.codePointAt(0) ?? 0
  return codePoint <= 0x1f || (codePoint >= 0x7f && codePoint <= 0x9f)
}

export const sanitizeGitLabInlineText = (value: string) =>
  Array.from(value, (character) => (isTerminalControl(character) ? " " : character)).join("")

export const sanitizeGitLabDescription = (value: string) =>
  Array.from(value.replace(/\r\n?/gu, "\n"), (character) =>
    character !== "\n" && isTerminalControl(character) ? " " : character,
  ).join("")

const sanitizeServerPayload = (value: unknown, field = ""): unknown => {
  if (typeof value === "string")
    return field === "description" ? sanitizeGitLabDescription(value) : sanitizeGitLabInlineText(value)
  if (Array.isArray(value)) return value.map((item) => sanitizeServerPayload(item, field))
  if (typeof value !== "object" || value === null) return value

  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [sanitizeGitLabInlineText(key), sanitizeServerPayload(item, key)]),
  )
}

const normalizeUser = (user: typeof RawUser.Type): GitLabUser => ({
  id: user.id,
  username: sanitizeGitLabInlineText(user.username),
  name: sanitizeGitLabInlineText(user.name),
})

const workItemType = (type: string | undefined): WorkItem["type"] => {
  if (type === "task") return "TASK"
  if (type === "incident") return "INCIDENT"
  if (type === "test_case") return "TEST_CASE"
  return "ISSUE"
}

const normalizeLabel = (label: typeof RawIssueLabel.Type, previous: readonly WorkItemLabel[]): WorkItemLabel => {
  if (typeof label !== "string")
    return {
      name: sanitizeGitLabInlineText(label.name),
      color: sanitizeGitLabInlineText(label.color),
      textColor: sanitizeGitLabInlineText(label.text_color),
    }
  const name = sanitizeGitLabInlineText(label)
  return (
    previous.find((candidate) => candidate.name.toLowerCase() === name.toLowerCase()) ?? {
      name,
      color: null,
      textColor: null,
    }
  )
}

const normalizeIssue = (issue: typeof RawIssue.Type, previousLabels: readonly WorkItemLabel[] = []): WorkItem => {
  const reference = sanitizeGitLabInlineText(issue.references.full)
  return {
    id: String(issue.id),
    projectId: issue.project_id,
    iid: issue.iid,
    type: workItemType(sanitizeGitLabInlineText(issue.issue_type ?? "")),
    title: sanitizeGitLabInlineText(issue.title),
    description: sanitizeGitLabDescription(issue.description ?? ""),
    state: issue.state === "closed" ? "CLOSED" : "OPEN",
    reference,
    namespace: reference.replace(/[#&].*$/u, ""),
    author: sanitizeGitLabInlineText(issue.author.username),
    assignees: issue.assignees.map((assignee) => sanitizeGitLabInlineText(assignee.username)),
    labels: issue.labels.map((label) => normalizeLabel(label, previousLabels)),
    webUrl: sanitizeGitLabInlineText(issue.web_url),
    updatedAt: sanitizeGitLabInlineText(issue.updated_at),
  }
}

type ProcessOutput = ReadableStream<Uint8Array> | null | undefined

export type GitLabSpawnOptions = {
  readonly cmd: string[]
  readonly stdin: "ignore"
  readonly stdout: "ignore" | "pipe"
  readonly stderr: "pipe"
  readonly signal: AbortSignal
  readonly timeout: number
  readonly env: Record<string, string | undefined>
}

export type GitLabSpawnResult = {
  readonly exited: Promise<number>
  readonly stdout?: ProcessOutput
  readonly stderr?: ProcessOutput
  readonly kill?: () => void
}

export type GitLabClientDependencies = {
  readonly getConfig: () => GitLabConfig
  readonly fetch: typeof globalThis.fetch
  readonly spawn: (options: GitLabSpawnOptions) => GitLabSpawnResult
  readonly limits?: {
    readonly maxPaginatedResponseBytes?: number
    readonly maxPaginatedItems?: number
    readonly maxPages?: number
  }
}

class OutputLimitFailure extends Error {}

const readStreamLimited = async (stream: ProcessOutput, limit: number, onLimit: () => void = () => undefined) => {
  if (!stream) return ""
  const reader = stream.getReader()
  const decoder = new TextDecoder()
  const chunks: string[] = []
  let size = 0
  try {
    while (true) {
      // Stream chunks are ordered and must be consumed sequentially.
      // eslint-disable-next-line no-await-in-loop
      const result = await reader.read()
      if (result.done) break
      size += result.value.byteLength
      if (size > limit) {
        onLimit()
        // Cancel this reader before surfacing the bounded-output failure.
        // eslint-disable-next-line no-await-in-loop
        await reader.cancel()
        throw new OutputLimitFailure(`GitLab command output exceeded ${limit} bytes`)
      }
      chunks.push(decoder.decode(result.value, { stream: true }))
    }
    chunks.push(decoder.decode())
    return chunks.join("")
  } finally {
    reader.releaseLock()
  }
}

const responseTextLimited = (response: Response, limit: number) => readStreamLimited(response.body, limit)

const positiveLimit = (value: number | undefined, fallback: number) =>
  value === undefined || !Number.isFinite(value) || value < 1 ? fallback : Math.floor(value)

const limitsFor = (dependencies: GitLabClientDependencies) => ({
  maxPaginatedResponseBytes: positiveLimit(dependencies.limits?.maxPaginatedResponseBytes, MAX_PROCESS_OUTPUT_BYTES),
  maxPaginatedItems: positiveLimit(dependencies.limits?.maxPaginatedItems, MAX_PAGINATED_ITEMS),
  maxPages: positiveLimit(dependencies.limits?.maxPages, MAX_PAGES),
})

const byteLimitLabel = (bytes: number) =>
  bytes >= 1024 * 1024 ? `${Math.floor(bytes / (1024 * 1024))} MiB` : `${bytes} bytes`

class HttpFailure extends Error {
  constructor(
    readonly status: number,
    statusText: string,
    body: string,
  ) {
    const suffix = body.trim() ? `: ${body.trim()}` : ""
    super(`HTTP ${status} ${statusText}${suffix}`)
  }
}

class ClassifiedFailure extends Error {
  constructor(
    readonly kind: GitLabRequestErrorKind,
    message: string,
    readonly remediation?: string,
  ) {
    super(message)
  }
}

const paginationByteLimitFailure = (bytes: number) =>
  new ClassifiedFailure(
    "invalid-response",
    `GitLab pagination exceeded the ${byteLimitLabel(bytes)} aggregate response limit; no partial results were returned`,
  )

const paginationItemLimitFailure = (items: number) =>
  new ClassifiedFailure(
    "invalid-response",
    `GitLab pagination exceeded the ${items}-item aggregate limit; no partial results were returned`,
  )

const stringFromCause = (cause: unknown) => {
  const message = cause instanceof Error ? cause.message : String(cause)
  const safe = sanitizeGitLabInlineText(message).trim()
  return safe.length > 600 ? `${safe.slice(0, 599)}…` : safe
}

const statusKind = (status: number): GitLabRequestErrorKind => {
  if (status === 401) return "authentication"
  if (status === 403) return "authorization"
  if (status === 404) return "not-found"
  if (status === 429) return "rate-limit"
  return "request"
}

const remediationFor = (kind: GitLabRequestErrorKind) => {
  if (kind === "authentication") return "Check GITLAB_TOKEN or run `glab auth status` for the configured host."
  if (kind === "authorization") return "Check that the token or glab account can access this group and its projects."
  if (kind === "rate-limit") return "Wait for the GitLab rate limit to reset, then retry."
  if (kind === "network") return "Check GITLAB_HOST and your network connection, then retry."
  if (kind === "timeout") return "Retry the request; if it persists, check GitLab and glab connectivity."
  if (kind === "configuration") return "Correct the GitLab environment configuration and restart the application."
  if (kind === "invalid-response") return "Retry, then check that the configured host serves a compatible GitLab API."
  return undefined
}

const classifyFailure = (operation: string, cause: unknown, forcedKind?: GitLabRequestErrorKind) => {
  let kind = forcedKind ?? "request"
  let status: number | undefined
  let remediation: string | undefined

  if (cause instanceof ClassifiedFailure) {
    kind = cause.kind
    remediation = cause.remediation
  } else if (cause instanceof HttpFailure) {
    status = cause.status
    kind = statusKind(cause.status)
  } else if (cause instanceof DOMException && cause.name === "TimeoutError") {
    kind = "timeout"
  } else if (cause instanceof DOMException && cause.name === "AbortError") {
    kind = "cancelled"
  } else if (cause instanceof SyntaxError) {
    kind = "invalid-response"
  } else if (cause instanceof TypeError) {
    kind = "network"
  } else {
    const detail = stringFromCause(cause).toLowerCase()
    if (/\b401\b|unauthenticated|authentication (?:failed|required)|unauthorized/u.test(detail)) kind = "authentication"
    else if (/\b403\b|forbidden/u.test(detail)) kind = "authorization"
    else if (/\b404\b|not found/u.test(detail)) kind = "not-found"
    else if (/\b429\b|rate.?limit/u.test(detail)) kind = "rate-limit"
    else if (/timed? ?out|timeout/u.test(detail)) kind = "timeout"
  }

  remediation ??= remediationFor(kind)
  const detail = `GitLab ${operation} failed: ${stringFromCause(cause) || "unknown request failure"}.`
  return new GitLabRequestError({
    operation,
    kind,
    detail,
    ...(remediation ? { remediation } : {}),
    ...(status === undefined ? {} : { status }),
    cause,
  })
}

const configuration = (operation: string, dependencies: GitLabClientDependencies) =>
  Effect.try({
    try: dependencies.getConfig,
    catch: (cause) => classifyFailure(operation, cause, "configuration"),
  })

export const gitLabApiArguments = (
  host: string,
  path: string,
  method: RequestMethod,
  fields: RequestFields = {},
  paginate = false,
) => [
  "glab",
  "api",
  path,
  "--hostname",
  gitLabHostname(host),
  ...(method === "GET" ? [] : ["--method", method]),
  ...(paginate ? ["--paginate", "--output", "json"] : []),
  ...Object.entries(fields).flatMap(([name, value]) => ["--raw-field", `${name}=${value}`]),
]

const nonInteractiveEnvironment = () => ({
  ...process.env,
  GIT_TERMINAL_PROMPT: "0",
  GLAB_PROMPT_DISABLED: "1",
  GLAB_PAGER: "cat",
  PAGER: "cat",
  NO_COLOR: "1",
})

const platformOpener = () => {
  if (process.platform === "darwin") return ["open"] as const
  if (process.platform === "win32") return ["rundll32", "url.dll,FileProtocolHandler"] as const
  return ["xdg-open"] as const
}

const directRequest = async (
  dependencies: GitLabClientDependencies,
  config: GitLabConfig,
  method: RequestMethod,
  path: string,
  fields: RequestFields,
  paginate: boolean,
  effectSignal: AbortSignal,
) => {
  const timeoutSignal = AbortSignal.timeout(REQUEST_TIMEOUT_MS)
  const signal = AbortSignal.any([effectSignal, timeoutSignal])
  const limits = limitsFor(dependencies)
  const firstUrl = gitLabApiUrl(config.host, path, true)
  let nextUrl: string | null = firstUrl
  const pages: unknown[] = []
  const seen = new Set<string>()
  let responseBytes = 0

  try {
    while (nextUrl) {
      if (seen.size >= limits.maxPages)
        throw new ClassifiedFailure("invalid-response", "GitLab pagination exceeded its limit")
      if (seen.has(nextUrl)) throw new ClassifiedFailure("invalid-response", "GitLab returned a pagination cycle")
      seen.add(nextUrl)

      // Pagination is intentionally sequential because each validated Link header supplies the next URL.
      // eslint-disable-next-line no-await-in-loop
      const response = await dependencies.fetch(nextUrl, {
        method,
        headers: { "PRIVATE-TOKEN": config.token ?? "", "Content-Type": "application/x-www-form-urlencoded" },
        redirect: "error",
        signal,
        ...(method === "GET" ? {} : { body: new URLSearchParams(fields) }),
      })
      if (!response.ok) {
        // This response must be consumed before the next page can be requested.
        // eslint-disable-next-line no-await-in-loop
        const body = sanitizeGitLabInlineText(await responseTextLimited(response, MAX_ERROR_BODY_BYTES))
        throw new HttpFailure(response.status, sanitizeGitLabInlineText(response.statusText), body)
      }

      const remainingBytes = paginate ? limits.maxPaginatedResponseBytes - responseBytes : MAX_PROCESS_OUTPUT_BYTES
      if (remainingBytes < 1) throw paginationByteLimitFailure(limits.maxPaginatedResponseBytes)
      let text: string
      try {
        // This response must be decoded before its Link header can advance pagination.
        // eslint-disable-next-line no-await-in-loop
        text = await responseTextLimited(response, remainingBytes)
      } catch (cause) {
        if (cause instanceof OutputLimitFailure && paginate)
          throw paginationByteLimitFailure(limits.maxPaginatedResponseBytes)
        throw cause
      }
      responseBytes += Buffer.byteLength(text)
      const payload = sanitizeServerPayload(JSON.parse(text))
      if (!paginate) return payload
      if (!Array.isArray(payload))
        throw new ClassifiedFailure("invalid-response", "GitLab returned a non-array page for a list request")
      if (pages.length + payload.length > limits.maxPaginatedItems)
        throw paginationItemLimitFailure(limits.maxPaginatedItems)
      pages.push(...payload)
      try {
        nextUrl = gitLabNextPageUrl(config.host, nextUrl, response.headers.get("link"), true)
      } catch (cause) {
        throw new ClassifiedFailure("invalid-response", stringFromCause(cause))
      }
    }
    return pages
  } catch (cause) {
    if (timeoutSignal.aborted && !effectSignal.aborted)
      throw new ClassifiedFailure("timeout", "GitLab request timed out after 30 seconds")
    throw cause
  }
}

const glabRequest = async (
  dependencies: GitLabClientDependencies,
  config: GitLabConfig,
  method: RequestMethod,
  path: string,
  fields: RequestFields,
  paginate: boolean,
  effectSignal: AbortSignal,
) => {
  const timeoutSignal = AbortSignal.timeout(REQUEST_TIMEOUT_MS)
  const signal = AbortSignal.any([effectSignal, timeoutSignal])
  const process = dependencies.spawn({
    cmd: gitLabApiArguments(config.host, path, method, fields, paginate),
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
    signal,
    timeout: REQUEST_TIMEOUT_MS,
    env: nonInteractiveEnvironment(),
  })
  const terminate = () => process.kill?.()

  try {
    const [exitCode, stdout, stderr] = await Promise.all([
      process.exited,
      readStreamLimited(process.stdout, MAX_PROCESS_OUTPUT_BYTES, terminate),
      readStreamLimited(process.stderr, MAX_PROCESS_OUTPUT_BYTES, terminate),
    ])
    if (timeoutSignal.aborted && !effectSignal.aborted)
      throw new ClassifiedFailure("timeout", "glab timed out after 30 seconds")
    if (exitCode !== 0)
      throw new Error(
        sanitizeGitLabInlineText(stderr).trim() ||
          sanitizeGitLabInlineText(stdout).trim() ||
          `glab exited with ${exitCode}`,
      )
    return sanitizeServerPayload(JSON.parse(stdout))
  } catch (cause) {
    if (timeoutSignal.aborted && !effectSignal.aborted)
      throw new ClassifiedFailure("timeout", "glab timed out after 30 seconds")
    throw cause
  }
}

export type GitLabClientService = {
  readonly loadWorkspace: (scope: WorkItemScope) => Effect.Effect<Workspace, GitLabRequestError>
  readonly moveWorkItem: (item: WorkItem, target: WorkflowColumnId) => Effect.Effect<WorkItem, GitLabRequestError>
  readonly setWorkItemState: (item: WorkItem, state: WorkItem["state"]) => Effect.Effect<WorkItem, GitLabRequestError>
  readonly createWorkItem: (project: string, title: string) => Effect.Effect<WorkItem, GitLabRequestError>
  readonly openWorkItem: (item: WorkItem) => Effect.Effect<void, GitLabRequestError>
}

export class GitLabClient extends Context.Service<GitLabClient, GitLabClientService>()(
  "gitlab-work-items/GitLabClient",
) {}

export const makeGitLabClient = (dependencies: GitLabClientDependencies): GitLabClientService => {
  const request = <S extends Schema.Top>(
    config: GitLabConfig,
    operation: string,
    method: RequestMethod,
    path: string,
    schema: S,
    fields: RequestFields = {},
    paginate = false,
  ) =>
    Effect.tryPromise({
      try: (signal) =>
        config.token
          ? directRequest(dependencies, config, method, path, fields, paginate, signal)
          : glabRequest(dependencies, config, method, path, fields, paginate, signal),
      catch: (cause) => classifyFailure(operation, cause),
    }).pipe(
      Effect.flatMap((unknown) => Schema.decodeUnknownEffect(schema)(unknown)),
      Effect.mapError((cause) =>
        cause instanceof GitLabRequestError ? cause : classifyFailure(operation, cause, "invalid-response"),
      ),
      Effect.withSpan(`GitLabClient.${operation}`),
    )

  const updateIssue = (config: GitLabConfig, operation: string, item: WorkItem, fields: RequestFields) =>
    request(config, operation, "PUT", `projects/${item.projectId}/issues/${item.iid}`, RawIssue, fields).pipe(
      Effect.map((issue) => normalizeIssue(issue, item.labels)),
    )

  return GitLabClient.of({
    loadWorkspace: (scope) =>
      Effect.gen(function* () {
        const config = yield* configuration("loadWorkspace", dependencies)
        if (config.mock) return mockWorkspace
        const issuePath = yield* Effect.try({
          try: () => issuePathFor(scope, config.group),
          catch: (cause) => classifyFailure("loadWorkspace", cause, "configuration"),
        })
        return yield* Effect.all(
          {
            user: request(config, "currentUser", "GET", "user", RawUser).pipe(Effect.map(normalizeUser)),
            items: request(config, "listIssues", "GET", issuePath, RawIssues, {}, true).pipe(
              Effect.map((issues) => issues.map((issue) => normalizeIssue(issue))),
            ),
          },
          { concurrency: "unbounded" },
        )
      }),
    moveWorkItem: (item, target) =>
      Effect.gen(function* () {
        const config = yield* configuration("moveWorkItem", dependencies)
        if (config.mock) return applyWorkflowTransition(item, target)
        const transition = workflowTransition(item, target)
        const fields = {
          ...(transition.stateEvent ? { state_event: transition.stateEvent } : {}),
          ...(transition.addLabels.length > 0 ? { add_labels: transition.addLabels.join(",") } : {}),
          ...(transition.removeLabels.length > 0 ? { remove_labels: transition.removeLabels.join(",") } : {}),
        }
        if (Object.keys(fields).length === 0) return item
        return yield* updateIssue(config, "moveWorkItem", item, fields)
      }),
    setWorkItemState: (item, state) =>
      Effect.gen(function* () {
        const config = yield* configuration("setWorkItemState", dependencies)
        if (config.mock) return { ...item, state }
        if (item.state === state) return item
        return yield* updateIssue(config, "setWorkItemState", item, {
          state_event: state === "CLOSED" ? "close" : "reopen",
        })
      }),
    createWorkItem: (project, title) =>
      Effect.gen(function* () {
        const config = yield* configuration("createWorkItem", dependencies)
        if (config.mock)
          return {
            id: `mock-${Date.now()}`,
            projectId: 0,
            iid: mockWorkspace.items.length + 1,
            type: "ISSUE",
            title: sanitizeGitLabInlineText(title),
            description: "",
            state: "OPEN",
            reference: `${project}#new`,
            namespace: project,
            author: mockWorkspace.user.username,
            assignees: [],
            labels: [],
            webUrl: `${config.host}/${project}/-/issues`,
            updatedAt: new Date().toISOString(),
          }
        return yield* request(
          config,
          "createWorkItem",
          "POST",
          `projects/${encodeURIComponent(project)}/issues`,
          RawIssue,
          { title },
        ).pipe(Effect.map((issue) => normalizeIssue(issue)))
      }),
    openWorkItem: (item) =>
      Effect.gen(function* () {
        const config = yield* configuration("openWorkItem", dependencies)
        if (config.mock) return
        const url = yield* Effect.try({
          try: () => trustedGitLabWebUrl(config.host, item.webUrl),
          catch: (cause) => classifyFailure("openWorkItem", cause, "invalid-response"),
        })
        return yield* Effect.tryPromise({
          try: async (effectSignal) => {
            const timeoutSignal = AbortSignal.timeout(OPEN_TIMEOUT_MS)
            const signal = AbortSignal.any([effectSignal, timeoutSignal])
            const command = [...platformOpener(), url]
            const process = dependencies.spawn({
              cmd: command,
              stdin: "ignore",
              stdout: "ignore",
              stderr: "pipe",
              signal,
              timeout: OPEN_TIMEOUT_MS,
              env: nonInteractiveEnvironment(),
            })
            const [exitCode, stderr] = await Promise.all([
              process.exited,
              readStreamLimited(process.stderr, MAX_ERROR_BODY_BYTES, () => process.kill?.()),
            ])
            if (timeoutSignal.aborted && !effectSignal.aborted)
              throw new ClassifiedFailure("timeout", "URL opener timed out after 10 seconds")
            if (exitCode !== 0)
              throw new Error(sanitizeGitLabInlineText(stderr).trim() || `${command[0]} exited with ${exitCode}`)
          },
          catch: (cause) => classifyFailure("openWorkItem", cause),
        })
      }),
  })
}

const liveDependencies: GitLabClientDependencies = {
  getConfig: () => gitLabConfigFromEnv(),
  fetch: globalThis.fetch,
  spawn: (options) => {
    const process = Bun.spawn(options)
    return {
      exited: process.exited,
      ...(typeof process.stdout === "number" ? {} : { stdout: process.stdout }),
      ...(typeof process.stderr === "number" ? {} : { stderr: process.stderr }),
      kill: () => process.kill(),
    }
  },
}

export const GitLabClientLive = Layer.succeed(GitLabClient, makeGitLabClient(liveDependencies))

export const loadWorkspace = (scope: WorkItemScope) =>
  Effect.gen(function* () {
    const client = yield* GitLabClient
    return yield* client.loadWorkspace(scope)
  })

export const moveWorkItem = (item: WorkItem, target: WorkflowColumnId) =>
  Effect.gen(function* () {
    const client = yield* GitLabClient
    return yield* client.moveWorkItem(item, target)
  })

export const setWorkItemState = (item: WorkItem, state: WorkItem["state"]) =>
  Effect.gen(function* () {
    const client = yield* GitLabClient
    return yield* client.setWorkItemState(item, state)
  })

export const createWorkItem = (project: string, title: string) =>
  Effect.gen(function* () {
    const client = yield* GitLabClient
    return yield* client.createWorkItem(project, title)
  })

export const openWorkItem = (item: WorkItem) =>
  Effect.gen(function* () {
    const client = yield* GitLabClient
    return yield* client.openWorkItem(item)
  })

export const runGitLabEffect = <A, E>(
  effect: Effect.Effect<A, E, GitLabClient>,
  options?: { readonly signal?: AbortSignal },
): Promise<A> => {
  const provided = effect.pipe(Effect.provide(GitLabClientLive))
  return options?.signal ? Effect.runPromise(provided, { signal: options.signal }) : Effect.runPromise(provided)
}
