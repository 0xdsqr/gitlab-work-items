import type { WorkItem } from "./work-item.ts"

export const workflowColumns = [
  { id: "backlog", label: "Backlog", hint: "Open, not scheduled", color: "#89888d", labelName: null },
  { id: "ready", label: "Ready", hint: "Prepared to start", color: "#63a6e9", labelName: "workflow::ready" },
  { id: "doing", label: "In progress", hint: "Actively moving", color: "#d99530", labelName: "workflow::in progress" },
  { id: "review", label: "Review", hint: "Waiting for a verdict", color: "#e9be74", labelName: "workflow::review" },
  { id: "closed", label: "Closed", hint: "Finished work", color: "#52b87a", labelName: null },
] as const

export type WorkflowColumnId = (typeof workflowColumns)[number]["id"]

const labelAliases: Readonly<Record<Exclude<WorkflowColumnId, "backlog" | "closed">, readonly string[]>> = {
  ready: ["workflow::ready", "workflow::todo", "workflow::planned"],
  doing: ["workflow::in progress", "workflow::doing", "workflow::active"],
  review: ["workflow::review", "workflow::verification", "workflow::testing"],
}

export const workflowLabels = Object.values(labelAliases).flat()

export const workflowColumnOf = (item: WorkItem): WorkflowColumnId => {
  if (item.state === "CLOSED") return "closed"
  const labels = new Set(item.labels.map((label) => label.name.toLowerCase()))
  const matched = (Object.entries(labelAliases) as readonly ["ready" | "doing" | "review", readonly string[]][]).find(
    ([, aliases]) => aliases.some((alias) => labels.has(alias)),
  )
  return matched?.[0] ?? "backlog"
}

export const workItemsByColumn = (items: readonly WorkItem[]): Record<WorkflowColumnId, readonly WorkItem[]> => ({
  backlog: items.filter((item) => workflowColumnOf(item) === "backlog"),
  ready: items.filter((item) => workflowColumnOf(item) === "ready"),
  doing: items.filter((item) => workflowColumnOf(item) === "doing"),
  review: items.filter((item) => workflowColumnOf(item) === "review"),
  closed: items.filter((item) => workflowColumnOf(item) === "closed"),
})

export type WorkflowTransition = {
  readonly stateEvent: "close" | "reopen" | null
  readonly addLabels: readonly string[]
  readonly removeLabels: readonly string[]
}

export const workflowTransition = (item: WorkItem, target: WorkflowColumnId): WorkflowTransition => {
  if (target === "closed")
    return { stateEvent: item.state === "CLOSED" ? null : "close", addLabels: [], removeLabels: [] }

  const column = workflowColumns.find((candidate) => candidate.id === target)
  const existingWorkflowLabels = item.labels
    .map((label) => label.name)
    .filter((label) => workflowLabels.includes(label.toLowerCase()))
  return {
    stateEvent: item.state === "CLOSED" ? "reopen" : null,
    addLabels: column?.labelName ? [column.labelName] : [],
    removeLabels: existingWorkflowLabels.filter((label) => label.toLowerCase() !== column?.labelName),
  }
}

export const applyWorkflowTransition = (item: WorkItem, target: WorkflowColumnId): WorkItem => {
  const transition = workflowTransition(item, target)
  const removed = new Set(transition.removeLabels.map((label) => label.toLowerCase()))
  return {
    ...item,
    state: target === "closed" ? "CLOSED" : "OPEN",
    labels: [
      ...item.labels.filter((label) => !removed.has(label.name.toLowerCase())),
      ...transition.addLabels.map((name) => ({ name, color: null, textColor: null })),
    ].filter(
      (label, index, labels) =>
        labels.findIndex((candidate) => candidate.name.toLowerCase() === label.name.toLowerCase()) === index,
    ),
  }
}
