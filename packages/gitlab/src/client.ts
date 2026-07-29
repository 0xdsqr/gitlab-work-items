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
  gitLabGraphqlUrl,
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

const RawBoardEntityId = Schema.Union([Schema.Number, Schema.String])

const RawBoardLabel = Schema.Struct({
  id: Schema.optional(RawBoardEntityId),
  name: Schema.String,
  color: Schema.optional(Schema.NullOr(Schema.String)),
  description: Schema.optional(Schema.NullOr(Schema.String)),
})

const RawBoardAssignee = Schema.Struct({
  id: RawBoardEntityId,
  username: Schema.String,
  name: Schema.String,
})

const RawBoardMilestone = Schema.Struct({
  id: RawBoardEntityId,
  title: Schema.String,
})

const RawBoardIteration = Schema.Struct({
  id: RawBoardEntityId,
  title: Schema.String,
})

const RawBoardStatus = Schema.Struct({
  id: RawBoardEntityId,
  name: Schema.optional(Schema.String),
  title: Schema.optional(Schema.String),
  color: Schema.optional(Schema.NullOr(Schema.String)),
})

const RawBoardList = Schema.Struct({
  id: Schema.Number,
  position: Schema.optional(Schema.Number),
  label: Schema.optional(Schema.NullOr(RawBoardLabel)),
  assignee: Schema.optional(Schema.NullOr(RawBoardAssignee)),
  milestone: Schema.optional(Schema.NullOr(RawBoardMilestone)),
  iteration: Schema.optional(Schema.NullOr(RawBoardIteration)),
  status: Schema.optional(Schema.NullOr(RawBoardStatus)),
  list_type: Schema.optional(Schema.String),
  type: Schema.optional(Schema.String),
})

const RawBoardLists = Schema.Array(RawBoardList)

const RawBoardGroup = Schema.Struct({
  id: Schema.Number,
  name: Schema.String,
  web_url: Schema.String,
})

const RawBoard = Schema.Struct({
  id: Schema.Number,
  name: Schema.NullOr(Schema.String),
  hide_backlog_list: Schema.Boolean,
  hide_closed_list: Schema.Boolean,
  group: RawBoardGroup,
  lists: Schema.optional(RawBoardLists),
  labels: Schema.optional(Schema.Array(RawBoardLabel)),
  assignee: Schema.optional(Schema.NullOr(RawBoardAssignee)),
  milestone: Schema.optional(Schema.NullOr(RawBoardMilestone)),
  iteration: Schema.optional(Schema.NullOr(RawBoardIteration)),
  weight: Schema.optional(Schema.NullOr(Schema.Number)),
})

const RawBoards = Schema.Array(RawBoard)

const RawGraphqlUser = Schema.Struct({
  username: Schema.String,
})

const RawGraphqlLabel = Schema.Struct({
  title: Schema.String,
  color: Schema.NullOr(Schema.String),
  textColor: Schema.NullOr(Schema.String),
})

const RawGraphqlPageInfo = Schema.Struct({
  hasNextPage: Schema.Boolean,
  endCursor: Schema.NullOr(Schema.String),
})

const RawGraphqlWidget = Schema.Struct({
  __typename: Schema.String,
  hasChildren: Schema.optional(Schema.Boolean),
  assignees: Schema.optional(
    Schema.NullOr(
      Schema.Struct({
        nodes: Schema.Array(RawGraphqlUser),
        pageInfo: RawGraphqlPageInfo,
      }),
    ),
  ),
  labels: Schema.optional(
    Schema.NullOr(
      Schema.Struct({
        nodes: Schema.Array(RawGraphqlLabel),
        pageInfo: RawGraphqlPageInfo,
      }),
    ),
  ),
  parent: Schema.optional(
    Schema.NullOr(
      Schema.Struct({
        id: Schema.String,
      }),
    ),
  ),
})

const RawGraphqlWorkItem = Schema.Struct({
  id: Schema.String,
  iid: Schema.String,
  title: Schema.String,
  description: Schema.NullOr(Schema.String),
  state: Schema.Literals(["OPEN", "CLOSED"]),
  reference: Schema.String,
  namespace: Schema.Struct({ fullPath: Schema.String }),
  project: Schema.NullOr(Schema.Struct({ id: Schema.String })),
  author: Schema.NullOr(RawGraphqlUser),
  webUrl: Schema.String,
  updatedAt: Schema.String,
  workItemType: Schema.Struct({ name: Schema.String }),
  widgets: Schema.Array(RawGraphqlWidget),
})

const RawGraphqlWorkItemConnection = Schema.Struct({
  nodes: Schema.Array(RawGraphqlWorkItem),
  pageInfo: RawGraphqlPageInfo,
})

const RawGraphqlError = Schema.Struct({
  message: Schema.String,
})

const RawAssignedEpicsPage = Schema.Struct({
  data: Schema.optional(
    Schema.NullOr(
      Schema.Struct({
        group: Schema.NullOr(
          Schema.Struct({
            workItems: RawGraphqlWorkItemConnection,
          }),
        ),
      }),
    ),
  ),
  errors: Schema.optional(Schema.Array(RawGraphqlError)),
})

const RawEpicHierarchyRootPage = Schema.Struct({
  data: Schema.optional(
    Schema.NullOr(
      Schema.Struct({
        root: Schema.NullOr(RawGraphqlWorkItem),
      }),
    ),
  ),
  errors: Schema.optional(Schema.Array(RawGraphqlError)),
})

const RawWorkItemChildrenPage = Schema.Struct({
  data: Schema.optional(
    Schema.NullOr(
      Schema.Struct({
        parent: Schema.NullOr(
          Schema.Struct({
            id: Schema.String,
            widgets: Schema.Array(
              Schema.Struct({
                __typename: Schema.String,
                children: Schema.optional(Schema.NullOr(RawGraphqlWorkItemConnection)),
              }),
            ),
          }),
        ),
      }),
    ),
  ),
  errors: Schema.optional(Schema.Array(RawGraphqlError)),
})

const RawGraphqlBoardTarget = Schema.Struct({
  id: RawBoardEntityId,
  name: Schema.optional(Schema.String),
  title: Schema.optional(Schema.String),
  username: Schema.optional(Schema.String),
  color: Schema.optional(Schema.NullOr(Schema.String)),
  textColor: Schema.optional(Schema.NullOr(Schema.String)),
})

const RawGraphqlBoardList = Schema.Struct({
  id: Schema.String,
  listType: Schema.String,
  title: Schema.String,
  position: Schema.NullOr(Schema.Number),
  label: Schema.NullOr(RawGraphqlBoardTarget),
  assignee: Schema.NullOr(RawGraphqlBoardTarget),
  milestone: Schema.NullOr(RawGraphqlBoardTarget),
  iteration: Schema.NullOr(RawGraphqlBoardTarget),
  status: Schema.NullOr(RawGraphqlBoardTarget),
})

const RawGraphqlBoardListConnection = Schema.Struct({
  nodes: Schema.Array(RawGraphqlBoardList),
  pageInfo: RawGraphqlPageInfo,
})

const RawGraphqlBoardListsPage = Schema.Struct({
  data: Schema.optional(
    Schema.NullOr(
      Schema.Struct({
        group: Schema.NullOr(
          Schema.Struct({
            board: Schema.NullOr(
              Schema.Struct({
                lists: RawGraphqlBoardListConnection,
              }),
            ),
          }),
        ),
      }),
    ),
  ),
  errors: Schema.optional(Schema.Array(RawGraphqlError)),
})

const RawGraphqlIssue = Schema.Struct({
  id: Schema.String,
  iid: Schema.String,
  title: Schema.String,
  description: Schema.NullOr(Schema.String),
  state: Schema.Literals(["opened", "closed", "locked", "all"]),
  type: Schema.NullOr(Schema.String),
  reference: Schema.String,
  webUrl: Schema.String,
  updatedAt: Schema.String,
  projectId: Schema.NullOr(Schema.Number),
  author: Schema.NullOr(RawGraphqlUser),
  assignees: Schema.Struct({
    nodes: Schema.Array(RawGraphqlUser),
    pageInfo: RawGraphqlPageInfo,
  }),
  labels: Schema.Struct({
    nodes: Schema.Array(RawGraphqlLabel),
    pageInfo: RawGraphqlPageInfo,
  }),
})

const RawGraphqlIssueConnection = Schema.Struct({
  nodes: Schema.Array(RawGraphqlIssue),
  pageInfo: RawGraphqlPageInfo,
})

const RawGraphqlBoardCardsPage = Schema.Struct({
  data: Schema.optional(
    Schema.NullOr(
      Schema.Struct({
        group: Schema.NullOr(
          Schema.Struct({
            board: Schema.NullOr(
              Schema.Struct({
                lists: Schema.Struct({
                  nodes: Schema.Array(
                    Schema.Struct({
                      id: Schema.String,
                      issues: RawGraphqlIssueConnection,
                    }),
                  ),
                }),
              }),
            ),
          }),
        ),
      }),
    ),
  ),
  errors: Schema.optional(Schema.Array(RawGraphqlError)),
})

export type GitLabBoardListKind = "label" | "assignee" | "milestone" | "iteration" | "status" | "unknown"

export type GitLabBoardList = {
  readonly id: number
  readonly position: number
  readonly kind: GitLabBoardListKind
  readonly title: string
  readonly color: string | null
  readonly valueId: number | string | null
  readonly rawKind: string | null
}

export type GitLabGroupBoardSummary = {
  readonly id: number
  readonly name: string
  readonly hideBacklogList: boolean
  readonly hideClosedList: boolean
  readonly group: {
    readonly id: number
    readonly name: string
    readonly webUrl: string
  }
}

export type GitLabGroupBoardDefinition = GitLabGroupBoardSummary & {
  readonly filters: {
    readonly labels: readonly string[]
    readonly assigneeUsername: string | null
    readonly milestoneTitle: string | null
    readonly iterationTitle: string | null
    readonly weight: number | null
  }
  readonly lists: readonly GitLabBoardList[]
}

export type GitLabBoardSnapshotListKind = GitLabBoardListKind | "backlog" | "closed"

export type GitLabBoardSnapshotList = {
  readonly id: string
  readonly gitLabListId: number | null
  readonly position: number
  readonly kind: GitLabBoardSnapshotListKind
  readonly title: string
  readonly color: string | null
  readonly valueId: number | string | null
  readonly rawKind: string
}

export type GitLabBoardCardReference = {
  readonly itemId: string
  readonly listId: string
  readonly position: number
}

export type GitLabGroupBoardSnapshot = {
  readonly boardId: number
  readonly lists: readonly GitLabBoardSnapshotList[]
  readonly items: readonly WorkItem[]
  readonly cards: readonly GitLabBoardCardReference[]
  readonly fetchedAt: string
}

export type GitLabEpicHierarchyItem = {
  readonly item: WorkItem
  readonly parentId: string
  readonly depth: number
}

export type GitLabEpicHierarchy = {
  readonly root: WorkItem
  readonly descendants: readonly GitLabEpicHierarchyItem[]
}

type RequestMethod = "GET" | "POST" | "PUT"
type RequestFields = Readonly<Record<string, string>>

const REQUEST_TIMEOUT_MS = 30_000
const OPEN_TIMEOUT_MS = 10_000
const MAX_PROCESS_OUTPUT_BYTES = 64 * 1024 * 1024
const MAX_ERROR_BODY_BYTES = 64 * 1024
const MAX_PAGINATED_ITEMS = 100_000
const MAX_PAGES = 1_000
const GRAPHQL_PAGE_SIZE = 100
const OPERATION_TIMEOUT_MS = 120_000

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

const normalizeBoardSummary = (board: typeof RawBoard.Type): GitLabGroupBoardSummary => ({
  id: board.id,
  name: sanitizeGitLabInlineText(board.name ?? "Development"),
  hideBacklogList: board.hide_backlog_list,
  hideClosedList: board.hide_closed_list,
  group: {
    id: board.group.id,
    name: sanitizeGitLabInlineText(board.group.name),
    webUrl: sanitizeGitLabInlineText(board.group.web_url),
  },
})

const boardListRawKind = (list: typeof RawBoardList.Type) =>
  sanitizeGitLabInlineText(list.list_type ?? list.type ?? "").trim() || null

const normalizeBoardList = (list: typeof RawBoardList.Type): GitLabBoardList => {
  const rawKind = boardListRawKind(list)
  if (list.label)
    return {
      id: list.id,
      position: list.position ?? 0,
      kind: "label",
      title: sanitizeGitLabInlineText(list.label.name),
      color: list.label.color ? sanitizeGitLabInlineText(list.label.color) : null,
      valueId: list.label.id ?? null,
      rawKind,
    }
  if (list.assignee)
    return {
      id: list.id,
      position: list.position ?? 0,
      kind: "assignee",
      title: sanitizeGitLabInlineText(list.assignee.name || list.assignee.username),
      color: null,
      valueId: list.assignee.id,
      rawKind,
    }
  if (list.milestone)
    return {
      id: list.id,
      position: list.position ?? 0,
      kind: "milestone",
      title: sanitizeGitLabInlineText(list.milestone.title),
      color: null,
      valueId: list.milestone.id,
      rawKind,
    }
  if (list.iteration)
    return {
      id: list.id,
      position: list.position ?? 0,
      kind: "iteration",
      title: sanitizeGitLabInlineText(list.iteration.title),
      color: null,
      valueId: list.iteration.id,
      rawKind,
    }
  if (list.status)
    return {
      id: list.id,
      position: list.position ?? 0,
      kind: "status",
      title: sanitizeGitLabInlineText(list.status.name ?? list.status.title ?? `Status ${list.id}`),
      color: list.status.color ? sanitizeGitLabInlineText(list.status.color) : null,
      valueId: list.status.id,
      rawKind,
    }
  return {
    id: list.id,
    position: list.position ?? 0,
    kind: "unknown",
    title: rawKind ? sanitizeGitLabInlineText(rawKind) : `List ${list.id}`,
    color: null,
    valueId: null,
    rawKind,
  }
}

const normalizeBoardDefinition = (
  board: typeof RawBoard.Type,
  lists: readonly (typeof RawBoardList.Type)[],
): GitLabGroupBoardDefinition => ({
  ...normalizeBoardSummary(board),
  filters: {
    labels: (board.labels ?? []).map((label) => sanitizeGitLabInlineText(label.name)),
    assigneeUsername: board.assignee ? sanitizeGitLabInlineText(board.assignee.username) : null,
    milestoneTitle: board.milestone ? sanitizeGitLabInlineText(board.milestone.title) : null,
    iterationTitle: board.iteration ? sanitizeGitLabInlineText(board.iteration.title) : null,
    weight: board.weight ?? null,
  },
  lists: lists.map(normalizeBoardList).toSorted((left, right) => left.position - right.position || left.id - right.id),
})

const graphqlWorkItemType = (name: string): WorkItem["type"] => {
  const normalized = sanitizeGitLabInlineText(name)
    .trim()
    .toLowerCase()
    .replaceAll(/[\s-]+/gu, "_")
  if (normalized === "task") return "TASK"
  if (normalized === "epic") return "EPIC"
  if (normalized === "objective") return "OBJECTIVE"
  if (normalized === "key_result") return "KEY_RESULT"
  if (normalized === "incident") return "INCIDENT"
  if (normalized === "ticket") return "TICKET"
  if (normalized === "test_case") return "TEST_CASE"
  if (normalized === "requirement") return "REQUIREMENT"
  return "ISSUE"
}

const numericGraphqlId = (value: string, type: "Project") => {
  const match = value.match(new RegExp(`^gid://gitlab/${type}/([1-9][0-9]*)$`, "u"))
  if (!match)
    throw new ClassifiedFailure("invalid-response", `GitLab returned an invalid ${type.toLowerCase()} global ID`)
  const id = Number(match[1])
  if (!Number.isSafeInteger(id))
    throw new ClassifiedFailure("invalid-response", `GitLab returned an unsafe ${type.toLowerCase()} global ID`)
  return id
}

const ensureNestedConnectionIsComplete = (
  connection: { readonly pageInfo: typeof RawGraphqlPageInfo.Type },
  field: "assignees" | "labels",
) => {
  if (connection.pageInfo.hasNextPage)
    throw new ClassifiedFailure(
      "invalid-response",
      `GitLab returned more than ${GRAPHQL_PAGE_SIZE} ${field} for one work item; refusing incomplete metadata`,
    )
}

const graphqlWorkItemHasChildren = (item: typeof RawGraphqlWorkItem.Type) =>
  item.widgets.find((widget) => widget["__typename"] === "WorkItemWidgetHierarchy")?.hasChildren === true

const normalizeGraphqlWorkItem = (item: typeof RawGraphqlWorkItem.Type): WorkItem => {
  const iid = Number(item.iid)
  if (!Number.isSafeInteger(iid) || iid < 1)
    throw new ClassifiedFailure("invalid-response", "GitLab returned an invalid work-item IID")
  const assigneesConnection = item.widgets.find(
    (widget) => widget["__typename"] === "WorkItemWidgetAssignees",
  )?.assignees
  const labelsConnection = item.widgets.find((widget) => widget["__typename"] === "WorkItemWidgetLabels")?.labels
  if (assigneesConnection) ensureNestedConnectionIsComplete(assigneesConnection, "assignees")
  if (labelsConnection) ensureNestedConnectionIsComplete(labelsConnection, "labels")
  const assignees = assigneesConnection?.nodes ?? []
  const labels = labelsConnection?.nodes ?? []
  return {
    id: sanitizeGitLabInlineText(item.id),
    projectId: item.project ? numericGraphqlId(item.project.id, "Project") : null,
    iid,
    type: graphqlWorkItemType(item.workItemType.name),
    title: sanitizeGitLabInlineText(item.title),
    description: sanitizeGitLabDescription(item.description ?? ""),
    state: item.state,
    reference: sanitizeGitLabInlineText(item.reference),
    namespace: sanitizeGitLabInlineText(item.namespace.fullPath),
    author: sanitizeGitLabInlineText(item.author?.username ?? ""),
    assignees: assignees.map((assignee) => sanitizeGitLabInlineText(assignee.username)),
    labels: labels.map((label) => ({
      name: sanitizeGitLabInlineText(label.title),
      color: label.color ? sanitizeGitLabInlineText(label.color) : null,
      textColor: label.textColor ? sanitizeGitLabInlineText(label.textColor) : null,
    })),
    webUrl: sanitizeGitLabInlineText(item.webUrl),
    updatedAt: sanitizeGitLabInlineText(item.updatedAt),
  }
}

const graphqlParentId = (item: typeof RawGraphqlWorkItem.Type) => {
  const parent = item.widgets.find((widget) => widget["__typename"] === "WorkItemWidgetHierarchy")?.parent
  if (!parent) throw new ClassifiedFailure("invalid-response", "GitLab returned a descendant without its parent")
  return sanitizeGitLabInlineText(parent.id)
}

const numericGraphqlListId = (value: string) => {
  const match = value.match(/^gid:\/\/gitlab\/List\/([1-9][0-9]*)$/u)
  if (!match) return null
  const id = Number(match[1])
  return Number.isSafeInteger(id) ? id : null
}

const graphqlBoardId = (boardId: number) => `gid://gitlab/Board/${boardId}`

const boardSnapshotListKind = (rawKind: string): GitLabBoardSnapshotListKind => {
  switch (rawKind) {
    case "backlog":
    case "open":
      return "backlog"
    case "closed":
    case "label":
    case "assignee":
    case "milestone":
    case "iteration":
    case "status":
      return rawKind
    default:
      return "unknown"
  }
}

const normalizeGraphqlBoardList = (
  list: typeof RawGraphqlBoardList.Type,
  position: number,
): GitLabBoardSnapshotList => {
  const rawKind = sanitizeGitLabInlineText(list.listType).trim().toLowerCase()
  const kind = boardSnapshotListKind(rawKind)
  let target: typeof RawGraphqlBoardTarget.Type | null = null
  if (kind === "label") target = list.label
  else if (kind === "assignee") target = list.assignee
  else if (kind === "milestone") target = list.milestone
  else if (kind === "iteration") target = list.iteration
  else if (kind === "status") target = list.status
  return {
    id: sanitizeGitLabInlineText(list.id),
    gitLabListId: numericGraphqlListId(list.id),
    position,
    kind,
    title: sanitizeGitLabInlineText(list.title),
    color: target?.color ? sanitizeGitLabInlineText(target.color) : null,
    valueId: target?.id ?? null,
    rawKind,
  }
}

const normalizeGraphqlIssue = (issue: typeof RawGraphqlIssue.Type): WorkItem => {
  const iid = Number(issue.iid)
  if (!Number.isSafeInteger(iid) || iid < 1)
    throw new ClassifiedFailure("invalid-response", "GitLab returned an invalid board-card IID")
  if (issue.projectId === null || !Number.isSafeInteger(issue.projectId) || issue.projectId < 1)
    throw new ClassifiedFailure("invalid-response", "GitLab returned an invalid board-card project ID")
  ensureNestedConnectionIsComplete(issue.assignees, "assignees")
  ensureNestedConnectionIsComplete(issue.labels, "labels")
  const reference = sanitizeGitLabInlineText(issue.reference)
  return {
    id: sanitizeGitLabInlineText(issue.id),
    projectId: issue.projectId,
    iid,
    type: graphqlWorkItemType(issue.type ?? "issue"),
    title: sanitizeGitLabInlineText(issue.title),
    description: sanitizeGitLabDescription(issue.description ?? ""),
    state: issue.state === "closed" ? "CLOSED" : "OPEN",
    reference,
    namespace: reference.replace(/[#&].*$/u, ""),
    author: sanitizeGitLabInlineText(issue.author?.username ?? ""),
    assignees: issue.assignees.nodes.map((assignee) => sanitizeGitLabInlineText(assignee.username)),
    labels: issue.labels.nodes.map((label) => ({
      name: sanitizeGitLabInlineText(label.title),
      color: label.color ? sanitizeGitLabInlineText(label.color) : null,
      textColor: label.textColor ? sanitizeGitLabInlineText(label.textColor) : null,
    })),
    webUrl: sanitizeGitLabInlineText(issue.webUrl),
    updatedAt: sanitizeGitLabInlineText(issue.updatedAt),
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
    readonly maxOperationDurationMs?: number
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
  maxOperationDurationMs: positiveLimit(dependencies.limits?.maxOperationDurationMs, OPERATION_TIMEOUT_MS),
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

const GLAB_OUTPUT_REMEDIATION = "Check the GitLab CLI output or set GITLAB_TOKEN to use the direct API, then retry."

const malformedGlabJsonFailure = (cause: unknown, context = "") =>
  new ClassifiedFailure(
    "invalid-response",
    `glab returned malformed JSON${context}: ${stringFromCause(cause)}`,
    GLAB_OUTPUT_REMEDIATION,
  )

const parseGlabJson = (stdout: string) => {
  try {
    return sanitizeServerPayload(JSON.parse(stdout))
  } catch (cause) {
    throw malformedGlabJsonFailure(cause)
  }
}

const isJsonWhitespace = (character: string | undefined) =>
  character === " " || character === "\t" || character === "\n" || character === "\r"

const jsonDocumentEnd = (stdout: string, start: number) => {
  let depth = 0
  let inString = false
  let escaped = false

  for (let index = start; index < stdout.length; index += 1) {
    const character = stdout[index]!
    if (inString) {
      if (escaped) escaped = false
      else if (character === "\\") escaped = true
      else if (character === '"') inString = false
      continue
    }
    if (character === '"') inString = true
    else if (character === "[" || character === "{") depth += 1
    else if (character === "]" || character === "}") {
      depth -= 1
      if (depth === 0) return index + 1
    }
  }

  return null
}

const parseGlabPaginatedJson = (stdout: string, maximumItems: number, maximumPages: number) => {
  const items: unknown[] = []
  let offset = 0
  let page = 0

  while (offset < stdout.length) {
    while (isJsonWhitespace(stdout[offset])) offset += 1
    if (offset >= stdout.length) break
    page += 1
    if (page > maximumPages)
      throw new ClassifiedFailure(
        "invalid-response",
        `GitLab pagination exceeded the ${maximumPages}-page limit; no partial results were returned`,
      )
    if (stdout[offset] !== "[")
      throw new ClassifiedFailure(
        "invalid-response",
        `glab returned a non-array result for paginated JSON page ${page}`,
        GLAB_OUTPUT_REMEDIATION,
      )

    const end = jsonDocumentEnd(stdout, offset)
    if (end === null)
      throw malformedGlabJsonFailure(new SyntaxError("unterminated response"), ` for paginated page ${page}`)

    let payload: unknown
    try {
      payload = sanitizeServerPayload(JSON.parse(stdout.slice(offset, end)))
    } catch (cause) {
      throw malformedGlabJsonFailure(cause, ` for paginated page ${page}`)
    }
    if (!Array.isArray(payload))
      throw new ClassifiedFailure(
        "invalid-response",
        `glab returned a non-array result for paginated JSON page ${page}`,
        GLAB_OUTPUT_REMEDIATION,
      )
    if (items.length + payload.length > maximumItems) throw paginationItemLimitFailure(maximumItems)
    for (const item of payload) items.push(item)
    offset = end
  }

  if (page === 0) throw malformedGlabJsonFailure(new SyntaxError("empty response"), " for pagination")
  return items
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

const withOperationDeadline = <A, E, R>(
  operation: string,
  dependencies: GitLabClientDependencies,
  effect: Effect.Effect<A, E, R>,
) =>
  Effect.timeoutOrElse(effect, {
    duration: limitsFor(dependencies).maxOperationDurationMs,
    orElse: () =>
      Effect.fail(
        classifyFailure(
          operation,
          new ClassifiedFailure(
            "timeout",
            `GitLab ${operation} exceeded its whole-operation deadline; no partial results were returned`,
          ),
        ),
      ),
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

export const gitLabGraphqlArguments = (host: string, query: string, variables: Readonly<Record<string, string>>) =>
  gitLabApiArguments(host, "graphql", "POST", { query, ...variables })

const GRAPHQL_WORK_ITEM_FIELDS = `
  id
  iid
  title
  description
  state
  reference(full: true)
  webUrl
  updatedAt
  namespace { fullPath }
  project { id }
  author { username }
  workItemType { name }
  widgets {
    __typename
    ... on WorkItemWidgetAssignees {
      assignees(first: ${GRAPHQL_PAGE_SIZE}) {
        nodes { username }
        pageInfo { hasNextPage endCursor }
      }
    }
    ... on WorkItemWidgetLabels {
      labels(first: ${GRAPHQL_PAGE_SIZE}) {
        nodes { title color textColor }
        pageInfo { hasNextPage endCursor }
      }
    }
    ... on WorkItemWidgetHierarchy {
      parent { id }
      hasChildren
    }
  }
`

const ASSIGNED_EPICS_QUERY = `
  query AssignedEpics($fullPath: ID!, $username: String!, $after: String) {
    group(fullPath: $fullPath) {
      workItems(
        types: [EPIC]
        assigneeUsernames: [$username]
        includeDescendants: true
        first: ${GRAPHQL_PAGE_SIZE}
        after: $after
        sort: UPDATED_DESC
      ) {
        nodes { ${GRAPHQL_WORK_ITEM_FIELDS} }
        pageInfo { hasNextPage endCursor }
      }
    }
  }
`

const EPIC_HIERARCHY_ROOT_QUERY = `
  query EpicHierarchyRoot($epicId: WorkItemID!) {
    root: workItem(id: $epicId) {
      ${GRAPHQL_WORK_ITEM_FIELDS}
    }
  }
`

const WORK_ITEM_CHILDREN_QUERY = `
  query WorkItemChildren($parentId: WorkItemID!, $after: String) {
    parent: workItem(id: $parentId) {
      id
      widgets {
        __typename
        ... on WorkItemWidgetHierarchy {
          children(first: ${GRAPHQL_PAGE_SIZE}, after: $after) {
            nodes { ${GRAPHQL_WORK_ITEM_FIELDS} }
            pageInfo { hasNextPage endCursor }
          }
        }
      }
    }
  }
`

const GROUP_BOARD_LISTS_QUERY = `
  query GroupBoardLists($fullPath: ID!, $boardId: BoardID!, $after: String) {
    group(fullPath: $fullPath) {
      board(id: $boardId) {
        lists(first: ${GRAPHQL_PAGE_SIZE}, after: $after) {
          nodes {
            id
            listType
            title
            position
            label { id title color textColor }
            assignee { id name username }
            milestone { id title }
            iteration { id title }
            status { id name color }
          }
          pageInfo { hasNextPage endCursor }
        }
      }
    }
  }
`

const groupBoardCardsQuery = (filters: GitLabGroupBoardDefinition["filters"]) => {
  const declarations: string[] = []
  const filterFields: string[] = []
  const variables: Record<string, string> = {}

  if (filters.labels.length > 0) {
    const references = filters.labels.map((label, index) => {
      const variable = `boardLabel${index}`
      declarations.push(`$${variable}: String!`)
      variables[variable] = label
      return `$${variable}`
    })
    filterFields.push(`labelName: [${references.join(", ")}]`)
  }
  if (filters.assigneeUsername !== null) {
    declarations.push("$boardAssigneeUsername: String!")
    variables["boardAssigneeUsername"] = filters.assigneeUsername
    filterFields.push("assigneeUsername: [$boardAssigneeUsername]")
  }
  if (filters.milestoneTitle !== null) {
    declarations.push("$boardMilestoneTitle: String!")
    variables["boardMilestoneTitle"] = filters.milestoneTitle
    filterFields.push("milestoneTitle: $boardMilestoneTitle")
  }
  if (filters.iterationTitle !== null) {
    declarations.push("$boardIterationTitle: String!")
    variables["boardIterationTitle"] = filters.iterationTitle
    filterFields.push("iterationTitle: $boardIterationTitle")
  }
  if (filters.weight !== null) {
    declarations.push("$boardWeight: String!")
    variables["boardWeight"] = String(filters.weight)
    filterFields.push("weight: $boardWeight")
  }

  const variableDeclarations = declarations.length > 0 ? `, ${declarations.join(", ")}` : ""
  const filterInput = filterFields.length > 0 ? `{ ${filterFields.join(", ")} }` : null
  const listFilter = filterInput ? `, issueFilters: ${filterInput}` : ""
  const issueFilter = filterInput ? `, filters: ${filterInput}` : ""

  return {
    variables,
    query: `
  query GroupBoardCards($fullPath: ID!, $boardId: BoardID!, $listId: ListID!, $after: String${variableDeclarations}) {
    group(fullPath: $fullPath) {
      board(id: $boardId) {
        lists(id: $listId, first: 1${listFilter}) {
          nodes {
            id
            issues(first: ${GRAPHQL_PAGE_SIZE}, after: $after${issueFilter}) {
              nodes {
                id
                iid
                title
                description
                state
                type
                reference(full: true)
                webUrl
                updatedAt
                projectId
                author { username }
                assignees(first: ${GRAPHQL_PAGE_SIZE}) {
                  nodes { username }
                  pageInfo { hasNextPage endCursor }
                }
                labels(first: ${GRAPHQL_PAGE_SIZE}) {
                  nodes { title color textColor }
                  pageInfo { hasNextPage endCursor }
                }
              }
              pageInfo { hasNextPage endCursor }
            }
          }
        }
      }
    }
  }
`,
  }
}

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
  const limits = limitsFor(dependencies)
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
    let stdout: string
    let stderr: string
    let exitCode: number
    try {
      ;[exitCode, stdout, stderr] = await Promise.all([
        process.exited,
        readStreamLimited(
          process.stdout,
          paginate ? limits.maxPaginatedResponseBytes : MAX_PROCESS_OUTPUT_BYTES,
          terminate,
        ),
        readStreamLimited(process.stderr, MAX_ERROR_BODY_BYTES, terminate),
      ])
    } catch (cause) {
      if (paginate && cause instanceof OutputLimitFailure)
        throw paginationByteLimitFailure(limits.maxPaginatedResponseBytes)
      throw cause
    }
    if (timeoutSignal.aborted && !effectSignal.aborted)
      throw new ClassifiedFailure("timeout", "glab timed out after 30 seconds")
    if (exitCode !== 0)
      throw new Error(
        sanitizeGitLabInlineText(stderr).trim() ||
          sanitizeGitLabInlineText(stdout).trim() ||
          `glab exited with ${exitCode}`,
      )
    return paginate ? parseGlabPaginatedJson(stdout, limits.maxPaginatedItems, limits.maxPages) : parseGlabJson(stdout)
  } catch (cause) {
    if (timeoutSignal.aborted && !effectSignal.aborted)
      throw new ClassifiedFailure("timeout", "glab timed out after 30 seconds")
    throw cause
  }
}

type GraphqlTransportResult = {
  readonly payload: unknown
  readonly responseBytes: number
}

const directGraphqlRequest = async (
  dependencies: GitLabClientDependencies,
  config: GitLabConfig,
  query: string,
  variables: Readonly<Record<string, string>>,
  maximumBytes: number,
  aggregateLimit: number,
  effectSignal: AbortSignal,
): Promise<GraphqlTransportResult> => {
  const timeoutSignal = AbortSignal.timeout(REQUEST_TIMEOUT_MS)
  const signal = AbortSignal.any([effectSignal, timeoutSignal])
  try {
    const response = await dependencies.fetch(gitLabGraphqlUrl(config.host, true), {
      method: "POST",
      headers: { "PRIVATE-TOKEN": config.token ?? "", "Content-Type": "application/json" },
      body: JSON.stringify({ query, variables }),
      redirect: "error",
      signal,
    })
    if (!response.ok) {
      const body = sanitizeGitLabInlineText(await responseTextLimited(response, MAX_ERROR_BODY_BYTES))
      throw new HttpFailure(response.status, sanitizeGitLabInlineText(response.statusText), body)
    }
    let text: string
    try {
      text = await responseTextLimited(response, maximumBytes)
    } catch (cause) {
      if (cause instanceof OutputLimitFailure) throw paginationByteLimitFailure(aggregateLimit)
      throw cause
    }
    return {
      payload: sanitizeServerPayload(JSON.parse(text)),
      responseBytes: Buffer.byteLength(text),
    }
  } catch (cause) {
    if (timeoutSignal.aborted && !effectSignal.aborted)
      throw new ClassifiedFailure("timeout", "GitLab GraphQL request timed out after 30 seconds")
    throw cause
  }
}

const glabGraphqlRequest = async (
  dependencies: GitLabClientDependencies,
  config: GitLabConfig,
  query: string,
  variables: Readonly<Record<string, string>>,
  maximumBytes: number,
  aggregateLimit: number,
  effectSignal: AbortSignal,
): Promise<GraphqlTransportResult> => {
  const timeoutSignal = AbortSignal.timeout(REQUEST_TIMEOUT_MS)
  const signal = AbortSignal.any([effectSignal, timeoutSignal])
  const process = dependencies.spawn({
    cmd: gitLabGraphqlArguments(config.host, query, variables),
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
    signal,
    timeout: REQUEST_TIMEOUT_MS,
    env: nonInteractiveEnvironment(),
  })
  const terminate = () => process.kill?.()

  try {
    let stdout: string
    let stderr: string
    let exitCode: number
    try {
      ;[exitCode, stdout, stderr] = await Promise.all([
        process.exited,
        readStreamLimited(process.stdout, maximumBytes, terminate),
        readStreamLimited(process.stderr, MAX_ERROR_BODY_BYTES, terminate),
      ])
    } catch (cause) {
      if (cause instanceof OutputLimitFailure) throw paginationByteLimitFailure(aggregateLimit)
      throw cause
    }
    if (timeoutSignal.aborted && !effectSignal.aborted)
      throw new ClassifiedFailure("timeout", "glab GraphQL request timed out after 30 seconds")
    if (exitCode !== 0)
      throw new Error(
        sanitizeGitLabInlineText(stderr).trim() ||
          sanitizeGitLabInlineText(stdout).trim() ||
          `glab exited with ${exitCode}`,
      )
    return {
      payload: parseGlabJson(stdout),
      responseBytes: Buffer.byteLength(stdout),
    }
  } catch (cause) {
    if (timeoutSignal.aborted && !effectSignal.aborted)
      throw new ClassifiedFailure("timeout", "glab GraphQL request timed out after 30 seconds")
    throw cause
  }
}

const graphqlErrorsFailure = (
  feature: "assigned epics" | "epic hierarchy" | "native board snapshot",
  errors: readonly (typeof RawGraphqlError.Type)[],
) => {
  const message = errors.map((error) => sanitizeGitLabInlineText(error.message)).join("; ")
  const normalized = message.toLowerCase()
  if (/unauthenticated|authentication (?:failed|required)|unauthorized/u.test(normalized))
    return new ClassifiedFailure("authentication", message)
  if (/forbidden|permission|not allowed/u.test(normalized)) return new ClassifiedFailure("authorization", message)
  if (/doesn't exist|unknown argument|undefinedfield|not supported/u.test(normalized))
    return new ClassifiedFailure(
      "invalid-response",
      `GitLab does not expose the required ${feature} GraphQL API: ${message}`,
      feature === "native board snapshot"
        ? "Use a compatible GitLab version with group issue board GraphQL access enabled."
        : "Use GitLab 18.3 or later with epic features enabled for the configured group.",
    )
  return new ClassifiedFailure("request", `GitLab GraphQL rejected the ${feature} query: ${message}`)
}

const configuredGroup = (operation: string, config: GitLabConfig) => {
  if (config.group) return config.group
  throw classifyFailure(
    operation,
    new Error(`${operation} requires GLWI_GROUP to identify the GitLab group`),
    "configuration",
  )
}

const validBoardId = (boardId: number) => {
  if (!Number.isSafeInteger(boardId) || boardId < 1)
    throw new ClassifiedFailure("configuration", "GitLab board ID must be a positive safe integer")
  return boardId
}

const validIssueMutationTarget = (item: WorkItem) => {
  if (item.projectId === null || !Number.isSafeInteger(item.projectId) || item.projectId < 1)
    throw new ClassifiedFailure("request", "Cannot mutate a work item without a valid GitLab project ID")
  if (!Number.isSafeInteger(item.iid) || item.iid < 1)
    throw new ClassifiedFailure("request", "Cannot mutate a work item without a valid GitLab IID")
  return { projectId: item.projectId, iid: item.iid }
}

const hierarchyItems = (
  root: WorkItem,
  descendants: readonly { readonly item: WorkItem; readonly parentId: string }[],
): readonly GitLabEpicHierarchyItem[] => {
  const parentById = new Map(descendants.map(({ item, parentId }) => [item.id, parentId]))
  const depthById = new Map<string, number>([[root.id, 0]])

  const depthFor = (startId: string) => {
    const chain: string[] = []
    const seen = new Set<string>()
    let currentId = startId
    while (!depthById.has(currentId)) {
      if (seen.has(currentId))
        throw new ClassifiedFailure("invalid-response", "GitLab returned a cycle in the epic hierarchy")
      seen.add(currentId)
      chain.push(currentId)
      const parentId = parentById.get(currentId)
      if (!parentId) throw new ClassifiedFailure("invalid-response", "GitLab returned an incomplete epic hierarchy")
      currentId = parentId
    }
    let depth = depthById.get(currentId) ?? 0
    for (const itemId of chain.reverse()) {
      depth += 1
      depthById.set(itemId, depth)
    }
    return depthById.get(startId) ?? 1
  }

  return descendants.map(({ item, parentId }) => ({ item, parentId, depth: depthFor(item.id) }))
}

const mockBoard: GitLabGroupBoardDefinition = {
  id: 1,
  name: "Development",
  hideBacklogList: false,
  hideClosedList: false,
  group: {
    id: 1,
    name: "Acme",
    webUrl: "https://gitlab.example.com/groups/acme",
  },
  filters: {
    labels: [],
    assigneeUsername: null,
    milestoneTitle: null,
    iterationTitle: null,
    weight: null,
  },
  lists: [
    {
      id: 11,
      position: 0,
      kind: "label",
      title: "workflow::ready",
      color: "#63a6e9",
      valueId: 101,
      rawKind: "label",
    },
    {
      id: 12,
      position: 1,
      kind: "label",
      title: "workflow::in progress",
      color: "#d99530",
      valueId: 102,
      rawKind: "label",
    },
    {
      id: 13,
      position: 2,
      kind: "label",
      title: "workflow::review",
      color: "#e9be74",
      valueId: 103,
      rawKind: "label",
    },
  ],
}

const mockBoardSnapshot = (): GitLabGroupBoardSnapshot => {
  const lists: GitLabBoardSnapshotList[] = [
    {
      id: "gid://gitlab/List/backlog",
      gitLabListId: null,
      position: 0,
      kind: "backlog",
      title: "Open",
      color: null,
      valueId: null,
      rawKind: "backlog",
    },
    ...mockBoard.lists.map(
      (list, index): GitLabBoardSnapshotList => ({
        id: `gid://gitlab/List/${list.id}`,
        gitLabListId: list.id,
        position: index + 1,
        kind: list.kind,
        title: list.title,
        color: list.color,
        valueId: list.valueId,
        rawKind: list.rawKind ?? list.kind,
      }),
    ),
    {
      id: "gid://gitlab/List/closed",
      gitLabListId: null,
      position: mockBoard.lists.length + 1,
      kind: "closed",
      title: "Closed",
      color: null,
      valueId: null,
      rawKind: "closed",
    },
  ]
  const items = mockWorkspace.items.filter((item) => item.projectId !== null && item.type !== "EPIC")
  const cards: GitLabBoardCardReference[] = []
  for (const list of lists) {
    const matching = items.filter((item) => {
      if (list.kind === "closed") return item.state === "CLOSED"
      if (item.state === "CLOSED") return false
      if (list.kind === "label")
        return item.labels.some((label) => label.name.toLowerCase() === list.title.toLowerCase())
      if (list.kind === "backlog")
        return !lists.some(
          (candidate) =>
            candidate.kind === "label" &&
            item.labels.some((label) => label.name.toLowerCase() === candidate.title.toLowerCase()),
        )
      return false
    })
    cards.push(...matching.map((item, position) => ({ itemId: item.id, listId: list.id, position })))
  }
  return {
    boardId: mockBoard.id,
    lists,
    items,
    cards,
    fetchedAt: new Date().toISOString(),
  }
}

export type GitLabClientService = {
  readonly loadWorkspace: (scope: WorkItemScope) => Effect.Effect<Workspace, GitLabRequestError>
  readonly listGroupBoards: () => Effect.Effect<readonly GitLabGroupBoardSummary[], GitLabRequestError>
  readonly loadGroupBoard: (boardId: number) => Effect.Effect<GitLabGroupBoardDefinition, GitLabRequestError>
  readonly loadGroupBoardSnapshot: (boardId: number) => Effect.Effect<GitLabGroupBoardSnapshot, GitLabRequestError>
  readonly listAssignedEpics: () => Effect.Effect<readonly WorkItem[], GitLabRequestError>
  readonly loadEpicHierarchy: (epicId: string) => Effect.Effect<GitLabEpicHierarchy, GitLabRequestError>
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

  const graphqlPage = <S extends Schema.Top>(
    config: GitLabConfig,
    operation: string,
    query: string,
    variables: Readonly<Record<string, string>>,
    schema: S,
    maximumBytes: number,
    aggregateLimit: number,
  ) =>
    Effect.tryPromise({
      try: (signal) =>
        config.token
          ? directGraphqlRequest(dependencies, config, query, variables, maximumBytes, aggregateLimit, signal)
          : glabGraphqlRequest(dependencies, config, query, variables, maximumBytes, aggregateLimit, signal),
      catch: (cause) => classifyFailure(operation, cause),
    }).pipe(
      Effect.flatMap(({ payload, responseBytes }) =>
        Schema.decodeUnknownEffect(schema)(payload).pipe(Effect.map((value) => ({ value, responseBytes }))),
      ),
      Effect.mapError((cause) =>
        cause instanceof GitLabRequestError ? cause : classifyFailure(operation, cause, "invalid-response"),
      ),
      Effect.withSpan(`GitLabClient.${operation}`),
    )

  const updateIssue = (config: GitLabConfig, operation: string, item: WorkItem, fields: RequestFields) =>
    Effect.try({
      try: () => validIssueMutationTarget(item),
      catch: (cause) => classifyFailure(operation, cause),
    }).pipe(
      Effect.flatMap(({ projectId, iid }) =>
        request(config, operation, "PUT", `projects/${projectId}/issues/${iid}`, RawIssue, fields),
      ),
      Effect.map((issue) => ({ ...normalizeIssue(issue, item.labels), id: item.id })),
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
    listGroupBoards: () =>
      Effect.gen(function* () {
        const config = yield* configuration("listGroupBoards", dependencies)
        if (config.mock) return [mockBoard]
        const group = yield* Effect.try({
          try: () => configuredGroup("listGroupBoards", config),
          catch: (cause) => (cause instanceof GitLabRequestError ? cause : classifyFailure("listGroupBoards", cause)),
        })
        return yield* request(
          config,
          "listGroupBoards",
          "GET",
          `groups/${encodeURIComponent(group)}/boards?per_page=100`,
          RawBoards,
          {},
          true,
        ).pipe(Effect.map((boards) => boards.map(normalizeBoardSummary)))
      }),
    loadGroupBoard: (boardId) =>
      Effect.gen(function* () {
        const config = yield* configuration("loadGroupBoard", dependencies)
        const id = yield* Effect.try({
          try: () => validBoardId(boardId),
          catch: (cause) => classifyFailure("loadGroupBoard", cause),
        })
        if (config.mock) {
          if (id === mockBoard.id) return mockBoard
          return yield* Effect.fail(
            classifyFailure("loadGroupBoard", new HttpFailure(404, "Not Found", "Mock board was not found")),
          )
        }
        const group = yield* Effect.try({
          try: () => configuredGroup("loadGroupBoard", config),
          catch: (cause) => (cause instanceof GitLabRequestError ? cause : classifyFailure("loadGroupBoard", cause)),
        })
        const root = `groups/${encodeURIComponent(group)}/boards/${id}`
        const result = yield* Effect.all(
          {
            board: request(config, "loadGroupBoard", "GET", root, RawBoard),
            lists: request(config, "listGroupBoardLists", "GET", `${root}/lists?per_page=100`, RawBoardLists, {}, true),
          },
          { concurrency: "unbounded" },
        )
        return normalizeBoardDefinition(result.board, result.lists)
      }),
    loadGroupBoardSnapshot: (boardId) =>
      withOperationDeadline(
        "loadGroupBoardSnapshot",
        dependencies,
        Effect.gen(function* () {
          const config = yield* configuration("loadGroupBoardSnapshot", dependencies)
          const id = yield* Effect.try({
            try: () => validBoardId(boardId),
            catch: (cause) => classifyFailure("loadGroupBoardSnapshot", cause),
          })
          if (config.mock) {
            if (id === mockBoard.id) return mockBoardSnapshot()
            return yield* Effect.fail(
              classifyFailure("loadGroupBoardSnapshot", new HttpFailure(404, "Not Found", "Mock board was not found")),
            )
          }
          const group = yield* Effect.try({
            try: () => configuredGroup("loadGroupBoardSnapshot", config),
            catch: (cause) =>
              cause instanceof GitLabRequestError ? cause : classifyFailure("loadGroupBoardSnapshot", cause),
          })
          const rawDefinition = yield* request(
            config,
            "loadGroupBoardSnapshot",
            "GET",
            `groups/${encodeURIComponent(group)}/boards/${id}`,
            RawBoard,
          )
          if (rawDefinition.id !== id)
            return yield* Effect.fail(
              classifyFailure(
                "loadGroupBoardSnapshot",
                new ClassifiedFailure("invalid-response", "GitLab returned an unexpected board definition"),
              ),
            )
          const boardFilters = normalizeBoardDefinition(rawDefinition, rawDefinition.lists ?? []).filters
          const cardsQuery = groupBoardCardsQuery(boardFilters)
          const limits = limitsFor(dependencies)
          const lists: GitLabBoardSnapshotList[] = []
          const itemsById = new Map<string, WorkItem>()
          const cards: GitLabBoardCardReference[] = []
          const seenListIds = new Set<string>()
          const listCursors = new Set<string>()
          let listAfter: string | null = null
          let pageCount = 0
          let paginatedItems = 0
          let responseBytes = 0

          while (true) {
            if (pageCount >= limits.maxPages)
              return yield* Effect.fail(
                classifyFailure(
                  "loadGroupBoardSnapshot",
                  new ClassifiedFailure("invalid-response", "GitLab GraphQL pagination exceeded its page limit"),
                ),
              )
            const remainingBytes = limits.maxPaginatedResponseBytes - responseBytes
            if (remainingBytes < 1)
              return yield* Effect.fail(
                classifyFailure("loadGroupBoardSnapshot", paginationByteLimitFailure(limits.maxPaginatedResponseBytes)),
              )
            const page: {
              readonly value: typeof RawGraphqlBoardListsPage.Type
              readonly responseBytes: number
            } = yield* graphqlPage(
              config,
              "loadGroupBoardSnapshot",
              GROUP_BOARD_LISTS_QUERY,
              {
                fullPath: group,
                boardId: graphqlBoardId(id),
                ...(listAfter ? { after: listAfter } : {}),
              },
              RawGraphqlBoardListsPage,
              remainingBytes,
              limits.maxPaginatedResponseBytes,
            )
            pageCount += 1
            responseBytes += page.responseBytes
            const connection: typeof RawGraphqlBoardListConnection.Type = yield* Effect.try({
              try: (): typeof RawGraphqlBoardListConnection.Type => {
                if (page.value.errors && page.value.errors.length > 0)
                  throw graphqlErrorsFailure("native board snapshot", page.value.errors)
                if (!page.value.data?.group)
                  throw new ClassifiedFailure(
                    "not-found",
                    `The configured GitLab group ${group} was not found or is not accessible`,
                  )
                if (!page.value.data.group.board)
                  throw new ClassifiedFailure("not-found", `GitLab board ${id} was not found or is not accessible`)
                return page.value.data.group.board.lists
              },
              catch: (cause) => classifyFailure("loadGroupBoardSnapshot", cause),
            })
            if (paginatedItems + connection.nodes.length > limits.maxPaginatedItems)
              return yield* Effect.fail(
                classifyFailure("loadGroupBoardSnapshot", paginationItemLimitFailure(limits.maxPaginatedItems)),
              )
            paginatedItems += connection.nodes.length
            for (const rawList of connection.nodes) {
              if (seenListIds.has(rawList.id))
                return yield* Effect.fail(
                  classifyFailure(
                    "loadGroupBoardSnapshot",
                    new ClassifiedFailure("invalid-response", "GitLab returned a duplicate board list"),
                  ),
                )
              seenListIds.add(rawList.id)
              lists.push(normalizeGraphqlBoardList(rawList, lists.length))
            }
            if (!connection.pageInfo.hasNextPage) break
            const cursor: string | null = connection.pageInfo.endCursor
            if (!cursor)
              return yield* Effect.fail(
                classifyFailure(
                  "loadGroupBoardSnapshot",
                  new ClassifiedFailure(
                    "invalid-response",
                    "GitLab omitted the next cursor from a paginated GraphQL response",
                  ),
                ),
              )
            if (listCursors.has(cursor))
              return yield* Effect.fail(
                classifyFailure(
                  "loadGroupBoardSnapshot",
                  new ClassifiedFailure("invalid-response", "GitLab returned a GraphQL pagination cycle"),
                ),
              )
            listCursors.add(cursor)
            listAfter = cursor
          }

          for (const list of lists) {
            const seenCardIds = new Set<string>()
            const cardCursors = new Set<string>()
            let cardAfter: string | null = null
            let position = 0
            while (true) {
              if (pageCount >= limits.maxPages)
                return yield* Effect.fail(
                  classifyFailure(
                    "loadGroupBoardSnapshot",
                    new ClassifiedFailure("invalid-response", "GitLab GraphQL pagination exceeded its page limit"),
                  ),
                )
              const remainingBytes = limits.maxPaginatedResponseBytes - responseBytes
              if (remainingBytes < 1)
                return yield* Effect.fail(
                  classifyFailure(
                    "loadGroupBoardSnapshot",
                    paginationByteLimitFailure(limits.maxPaginatedResponseBytes),
                  ),
                )
              const page: {
                readonly value: typeof RawGraphqlBoardCardsPage.Type
                readonly responseBytes: number
              } = yield* graphqlPage(
                config,
                "loadGroupBoardSnapshot",
                cardsQuery.query,
                {
                  fullPath: group,
                  boardId: graphqlBoardId(id),
                  listId: list.id,
                  ...cardsQuery.variables,
                  ...(cardAfter ? { after: cardAfter } : {}),
                },
                RawGraphqlBoardCardsPage,
                remainingBytes,
                limits.maxPaginatedResponseBytes,
              )
              pageCount += 1
              responseBytes += page.responseBytes
              const connection: typeof RawGraphqlIssueConnection.Type = yield* Effect.try({
                try: (): typeof RawGraphqlIssueConnection.Type => {
                  if (page.value.errors && page.value.errors.length > 0)
                    throw graphqlErrorsFailure("native board snapshot", page.value.errors)
                  if (!page.value.data?.group)
                    throw new ClassifiedFailure(
                      "not-found",
                      `The configured GitLab group ${group} was not found or is not accessible`,
                    )
                  if (!page.value.data.group.board)
                    throw new ClassifiedFailure("not-found", `GitLab board ${id} was not found or is not accessible`)
                  const matching = page.value.data.group.board.lists.nodes.filter(
                    (candidate) => candidate.id === list.id,
                  )
                  if (matching.length !== 1)
                    throw new ClassifiedFailure(
                      "request",
                      `GitLab board list ${list.title} changed while its cards were loading; refresh the board`,
                    )
                  return matching[0]!.issues
                },
                catch: (cause) => classifyFailure("loadGroupBoardSnapshot", cause),
              })
              if (paginatedItems + connection.nodes.length > limits.maxPaginatedItems)
                return yield* Effect.fail(
                  classifyFailure("loadGroupBoardSnapshot", paginationItemLimitFailure(limits.maxPaginatedItems)),
                )
              paginatedItems += connection.nodes.length
              const normalized = yield* Effect.try({
                try: () => connection.nodes.map((issue: typeof RawGraphqlIssue.Type) => normalizeGraphqlIssue(issue)),
                catch: (cause) => classifyFailure("loadGroupBoardSnapshot", cause, "invalid-response"),
              })
              for (const item of normalized) {
                if (seenCardIds.has(item.id))
                  return yield* Effect.fail(
                    classifyFailure(
                      "loadGroupBoardSnapshot",
                      new ClassifiedFailure("invalid-response", "GitLab returned a duplicate card in one board list"),
                    ),
                  )
                seenCardIds.add(item.id)
                itemsById.set(item.id, itemsById.get(item.id) ?? item)
                cards.push({ itemId: item.id, listId: list.id, position })
                position += 1
              }
              if (!connection.pageInfo.hasNextPage) break
              const cursor: string | null = connection.pageInfo.endCursor
              if (!cursor)
                return yield* Effect.fail(
                  classifyFailure(
                    "loadGroupBoardSnapshot",
                    new ClassifiedFailure(
                      "invalid-response",
                      "GitLab omitted the next cursor from a paginated GraphQL response",
                    ),
                  ),
                )
              if (cardCursors.has(cursor))
                return yield* Effect.fail(
                  classifyFailure(
                    "loadGroupBoardSnapshot",
                    new ClassifiedFailure("invalid-response", "GitLab returned a GraphQL pagination cycle"),
                  ),
                )
              cardCursors.add(cursor)
              cardAfter = cursor
            }
          }

          return {
            boardId: id,
            lists,
            items: [...itemsById.values()],
            cards,
            fetchedAt: new Date().toISOString(),
          }
        }),
      ),
    listAssignedEpics: () =>
      Effect.gen(function* () {
        const config = yield* configuration("listAssignedEpics", dependencies)
        if (config.mock) return mockWorkspace.items.filter((item) => item.type === "EPIC")
        const group = yield* Effect.try({
          try: () => configuredGroup("listAssignedEpics", config),
          catch: (cause) => (cause instanceof GitLabRequestError ? cause : classifyFailure("listAssignedEpics", cause)),
        })
        const user = yield* request(config, "currentUser", "GET", "user", RawUser).pipe(Effect.map(normalizeUser))
        const limits = limitsFor(dependencies)
        const items: WorkItem[] = []
        const seenCursors = new Set<string>()
        let after: string | null = null
        let pageCount = 0
        let responseBytes = 0

        while (true) {
          if (pageCount >= limits.maxPages)
            return yield* Effect.fail(
              classifyFailure(
                "listAssignedEpics",
                new ClassifiedFailure("invalid-response", "GitLab GraphQL pagination exceeded its page limit"),
              ),
            )
          const remainingBytes = limits.maxPaginatedResponseBytes - responseBytes
          if (remainingBytes < 1)
            return yield* Effect.fail(
              classifyFailure("listAssignedEpics", paginationByteLimitFailure(limits.maxPaginatedResponseBytes)),
            )
          const page: {
            readonly value: typeof RawAssignedEpicsPage.Type
            readonly responseBytes: number
          } = yield* graphqlPage(
            config,
            "listAssignedEpics",
            ASSIGNED_EPICS_QUERY,
            {
              fullPath: group,
              username: user.username,
              ...(after ? { after } : {}),
            },
            RawAssignedEpicsPage,
            remainingBytes,
            limits.maxPaginatedResponseBytes,
          )
          pageCount += 1
          responseBytes += page.responseBytes
          const connection: typeof RawGraphqlWorkItemConnection.Type = yield* Effect.try({
            try: (): typeof RawGraphqlWorkItemConnection.Type => {
              if (page.value.errors && page.value.errors.length > 0)
                throw graphqlErrorsFailure("assigned epics", page.value.errors)
              const value = page.value.data?.group?.workItems
              if (!value)
                throw new ClassifiedFailure(
                  "not-found",
                  `The configured GitLab group ${group} was not found or is not accessible`,
                )
              return value
            },
            catch: (cause) => classifyFailure("listAssignedEpics", cause),
          })
          const normalized = yield* Effect.try({
            try: () =>
              connection.nodes.map((item: typeof RawGraphqlWorkItem.Type) => {
                const normalizedItem = normalizeGraphqlWorkItem(item)
                if (normalizedItem.type !== "EPIC")
                  throw new ClassifiedFailure("invalid-response", "GitLab returned a non-epic in the epic catalog")
                return normalizedItem
              }),
            catch: (cause) => classifyFailure("listAssignedEpics", cause, "invalid-response"),
          })
          if (items.length + normalized.length > limits.maxPaginatedItems)
            return yield* Effect.fail(
              classifyFailure("listAssignedEpics", paginationItemLimitFailure(limits.maxPaginatedItems)),
            )
          items.push(...normalized)
          if (!connection.pageInfo.hasNextPage) return items
          const cursor: string | null = connection.pageInfo.endCursor
          if (!cursor)
            return yield* Effect.fail(
              classifyFailure(
                "listAssignedEpics",
                new ClassifiedFailure(
                  "invalid-response",
                  "GitLab omitted the next cursor from a paginated GraphQL response",
                ),
              ),
            )
          if (seenCursors.has(cursor))
            return yield* Effect.fail(
              classifyFailure(
                "listAssignedEpics",
                new ClassifiedFailure("invalid-response", "GitLab returned a GraphQL pagination cycle"),
              ),
            )
          seenCursors.add(cursor)
          after = cursor
        }
      }),
    loadEpicHierarchy: (epicId) =>
      withOperationDeadline(
        "loadEpicHierarchy",
        dependencies,
        Effect.gen(function* () {
          const config = yield* configuration("loadEpicHierarchy", dependencies)
          if (!/^gid:\/\/gitlab\/WorkItem\/[1-9][0-9]*$/u.test(epicId))
            return yield* Effect.fail(
              classifyFailure(
                "loadEpicHierarchy",
                new ClassifiedFailure("request", "Epic ID must be a GitLab Work Item global ID"),
              ),
            )
          if (config.mock) {
            const root = mockWorkspace.items.find((item) => item.id === epicId && item.type === "EPIC")
            if (!root)
              return yield* Effect.fail(
                classifyFailure("loadEpicHierarchy", new HttpFailure(404, "Not Found", "Mock epic was not found")),
              )
            return {
              root,
              descendants: mockWorkspace.items
                .filter((item) => item.id !== root.id)
                .map((item) => ({ item, parentId: root.id, depth: 1 })),
            }
          }

          const limits = limitsFor(dependencies)
          let pageCount = 0
          let responseBytes = 0
          if (pageCount >= limits.maxPages)
            return yield* Effect.fail(
              classifyFailure(
                "loadEpicHierarchy",
                new ClassifiedFailure("invalid-response", "GitLab GraphQL pagination exceeded its page limit"),
              ),
            )
          let remainingBytes = limits.maxPaginatedResponseBytes - responseBytes
          if (remainingBytes < 1)
            return yield* Effect.fail(
              classifyFailure("loadEpicHierarchy", paginationByteLimitFailure(limits.maxPaginatedResponseBytes)),
            )
          const rootPage: {
            readonly value: typeof RawEpicHierarchyRootPage.Type
            readonly responseBytes: number
          } = yield* graphqlPage(
            config,
            "loadEpicHierarchy",
            EPIC_HIERARCHY_ROOT_QUERY,
            { epicId },
            RawEpicHierarchyRootPage,
            remainingBytes,
            limits.maxPaginatedResponseBytes,
          )
          pageCount += 1
          responseBytes += rootPage.responseBytes
          const rawRoot: typeof RawGraphqlWorkItem.Type = yield* Effect.try({
            try: (): typeof RawGraphqlWorkItem.Type => {
              if (rootPage.value.errors && rootPage.value.errors.length > 0)
                throw graphqlErrorsFailure("epic hierarchy", rootPage.value.errors)
              if (!rootPage.value.data?.root)
                throw new ClassifiedFailure("not-found", "The selected GitLab epic was not found or is not accessible")
              return rootPage.value.data.root
            },
            catch: (cause) => classifyFailure("loadEpicHierarchy", cause),
          })
          const root = yield* Effect.try({
            try: () => normalizeGraphqlWorkItem(rawRoot),
            catch: (cause) => classifyFailure("loadEpicHierarchy", cause, "invalid-response"),
          })
          if (root.id !== epicId || root.type !== "EPIC")
            return yield* Effect.fail(
              classifyFailure(
                "loadEpicHierarchy",
                new ClassifiedFailure("invalid-response", "GitLab returned an unexpected epic hierarchy root"),
              ),
            )

          const descendants: { item: WorkItem; parentId: string }[] = []
          const seenItemIds = new Set<string>([root.id])
          const parentById = new Map<string, string | null>([[root.id, null]])
          const pendingParents = graphqlWorkItemHasChildren(rawRoot) ? [root.id] : []
          let parentIndex = 0

          const wouldCreateCycle = (childId: string, parentId: string) => {
            const checked = new Set<string>()
            let currentId: string | null = parentId
            while (currentId !== null) {
              if (currentId === childId) return true
              if (checked.has(currentId)) return true
              checked.add(currentId)
              currentId = parentById.get(currentId) ?? null
            }
            return false
          }

          while (parentIndex < pendingParents.length) {
            const parentId = pendingParents[parentIndex]!
            parentIndex += 1
            const seenCursors = new Set<string>()
            let after: string | null = null

            while (true) {
              if (pageCount >= limits.maxPages)
                return yield* Effect.fail(
                  classifyFailure(
                    "loadEpicHierarchy",
                    new ClassifiedFailure("invalid-response", "GitLab GraphQL pagination exceeded its page limit"),
                  ),
                )
              remainingBytes = limits.maxPaginatedResponseBytes - responseBytes
              if (remainingBytes < 1)
                return yield* Effect.fail(
                  classifyFailure("loadEpicHierarchy", paginationByteLimitFailure(limits.maxPaginatedResponseBytes)),
                )
              const page: {
                readonly value: typeof RawWorkItemChildrenPage.Type
                readonly responseBytes: number
              } = yield* graphqlPage(
                config,
                "loadEpicHierarchy",
                WORK_ITEM_CHILDREN_QUERY,
                {
                  parentId,
                  ...(after ? { after } : {}),
                },
                RawWorkItemChildrenPage,
                remainingBytes,
                limits.maxPaginatedResponseBytes,
              )
              pageCount += 1
              responseBytes += page.responseBytes
              const connection: typeof RawGraphqlWorkItemConnection.Type = yield* Effect.try({
                try: (): typeof RawGraphqlWorkItemConnection.Type => {
                  if (page.value.errors && page.value.errors.length > 0)
                    throw graphqlErrorsFailure("epic hierarchy", page.value.errors)
                  const parent = page.value.data?.parent
                  if (!parent)
                    throw new ClassifiedFailure(
                      "not-found",
                      "A GitLab hierarchy item disappeared or became inaccessible while loading its children",
                    )
                  if (sanitizeGitLabInlineText(parent.id) !== parentId)
                    throw new ClassifiedFailure("invalid-response", "GitLab returned an unexpected hierarchy parent")
                  const hierarchyWidgets = parent.widgets.filter(
                    (widget) => widget["__typename"] === "WorkItemWidgetHierarchy",
                  )
                  if (hierarchyWidgets.length !== 1 || !hierarchyWidgets[0]!.children)
                    throw new ClassifiedFailure(
                      "invalid-response",
                      "GitLab omitted the child connection for a hierarchy item that reported children",
                    )
                  return hierarchyWidgets[0]!.children
                },
                catch: (cause) => classifyFailure("loadEpicHierarchy", cause),
              })
              if (descendants.length + connection.nodes.length > limits.maxPaginatedItems)
                return yield* Effect.fail(
                  classifyFailure("loadEpicHierarchy", paginationItemLimitFailure(limits.maxPaginatedItems)),
                )
              const normalized = yield* Effect.try({
                try: () =>
                  connection.nodes.map((rawItem: typeof RawGraphqlWorkItem.Type) => {
                    const reportedParentId = graphqlParentId(rawItem)
                    if (reportedParentId !== parentId)
                      throw new ClassifiedFailure(
                        "invalid-response",
                        "GitLab returned a hierarchy child with an unexpected parent",
                      )
                    return {
                      rawItem,
                      item: normalizeGraphqlWorkItem(rawItem),
                      parentId,
                    }
                  }),
                catch: (cause) => classifyFailure("loadEpicHierarchy", cause, "invalid-response"),
              })
              for (const descendant of normalized) {
                if (seenItemIds.has(descendant.item.id)) {
                  const message = wouldCreateCycle(descendant.item.id, parentId)
                    ? "GitLab returned a cycle in the epic hierarchy"
                    : "GitLab returned a duplicate hierarchy item"
                  return yield* Effect.fail(
                    classifyFailure("loadEpicHierarchy", new ClassifiedFailure("invalid-response", message)),
                  )
                }
                seenItemIds.add(descendant.item.id)
                parentById.set(descendant.item.id, parentId)
                descendants.push({ item: descendant.item, parentId })
                if (graphqlWorkItemHasChildren(descendant.rawItem)) pendingParents.push(descendant.item.id)
              }

              if (!connection.pageInfo.hasNextPage) break
              const cursor = connection.pageInfo.endCursor
              if (!cursor)
                return yield* Effect.fail(
                  classifyFailure(
                    "loadEpicHierarchy",
                    new ClassifiedFailure(
                      "invalid-response",
                      "GitLab omitted the next cursor from a paginated GraphQL response",
                    ),
                  ),
                )
              if (seenCursors.has(cursor))
                return yield* Effect.fail(
                  classifyFailure(
                    "loadEpicHierarchy",
                    new ClassifiedFailure("invalid-response", "GitLab returned a GraphQL pagination cycle"),
                  ),
                )
              seenCursors.add(cursor)
              after = cursor
            }
          }

          return yield* Effect.try({
            try: () => ({ root, descendants: hierarchyItems(root, descendants) }),
            catch: (cause) => classifyFailure("loadEpicHierarchy", cause, "invalid-response"),
          })
        }),
      ),
    moveWorkItem: (item, target) =>
      Effect.gen(function* () {
        const config = yield* configuration("moveWorkItem", dependencies)
        yield* Effect.try({
          try: () => validIssueMutationTarget(item),
          catch: (cause) => classifyFailure("moveWorkItem", cause),
        })
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
        yield* Effect.try({
          try: () => validIssueMutationTarget(item),
          catch: (cause) => classifyFailure("setWorkItemState", cause),
        })
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
            projectId: mockWorkspace.items.find((item) => item.projectId !== null)?.projectId ?? 1,
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

export const listGroupBoards = () =>
  Effect.gen(function* () {
    const client = yield* GitLabClient
    return yield* client.listGroupBoards()
  })

export const loadGroupBoard = (boardId: number) =>
  Effect.gen(function* () {
    const client = yield* GitLabClient
    return yield* client.loadGroupBoard(boardId)
  })

export const loadGroupBoardSnapshot = (boardId: number) =>
  Effect.gen(function* () {
    const client = yield* GitLabClient
    return yield* client.loadGroupBoardSnapshot(boardId)
  })

export const listAssignedEpics = () =>
  Effect.gen(function* () {
    const client = yield* GitLabClient
    return yield* client.listAssignedEpics()
  })

export const loadEpicHierarchy = (epicId: string) =>
  Effect.gen(function* () {
    const client = yield* GitLabClient
    return yield* client.loadEpicHierarchy(epicId)
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
