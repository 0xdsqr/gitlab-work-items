import { Schema } from "effect"

export const WorkItemType = Schema.Literals([
  "ISSUE",
  "TASK",
  "EPIC",
  "OBJECTIVE",
  "KEY_RESULT",
  "INCIDENT",
  "TICKET",
  "TEST_CASE",
  "REQUIREMENT",
])
export type WorkItemType = typeof WorkItemType.Type

export const WorkItemState = Schema.Literals(["OPEN", "CLOSED"])
export type WorkItemState = typeof WorkItemState.Type

export const WorkItem = Schema.Struct({
  id: Schema.String,
  projectId: Schema.Number,
  iid: Schema.Number,
  type: WorkItemType,
  title: Schema.String,
  description: Schema.String,
  state: WorkItemState,
  reference: Schema.String,
  namespace: Schema.String,
  author: Schema.String,
  assignees: Schema.Array(Schema.String),
  labels: Schema.Array(Schema.String),
  webUrl: Schema.String,
  updatedAt: Schema.String,
})
export type WorkItem = typeof WorkItem.Type

export const GitLabUser = Schema.Struct({
  id: Schema.Number,
  username: Schema.String,
  name: Schema.String,
})
export type GitLabUser = typeof GitLabUser.Type

export const Workspace = Schema.Struct({
  user: GitLabUser,
  items: Schema.Array(WorkItem),
})
export type Workspace = typeof Workspace.Type

export type WorkItemScope = "assigned" | "created" | "organization"

export const typeLabel = (type: WorkItemType) => type.toLowerCase().replaceAll("_", " ")

export const relativeAge = (timestamp: string, now = Date.now()) => {
  const elapsedMinutes = Math.max(0, Math.floor((now - Date.parse(timestamp)) / 60_000))
  if (elapsedMinutes < 60) return `${elapsedMinutes}m`
  const hours = Math.floor(elapsedMinutes / 60)
  if (hours < 24) return `${hours}h`
  const days = Math.floor(hours / 24)
  if (days < 30) return `${days}d`
  return `${Math.floor(days / 30)}mo`
}
