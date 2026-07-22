import { workflowColumns, type WorkItem } from "@gitlab-work-items/domain"

const dragSourcePrefix = "work-item:"

export type WorkItemStateFilter = "open" | "closed" | "all"

export const workItemStateFilters: readonly WorkItemStateFilter[] = ["open", "closed", "all"]

export const filterWorkItems = (items: readonly WorkItem[], filter: WorkItemStateFilter, query = "") => {
  const normalizedQuery = query.trim().toLowerCase()
  return items.filter((item) => {
    if (filter !== "all" && item.state !== filter.toUpperCase()) return false
    if (!normalizedQuery) return true
    return [
      item.title,
      item.description,
      item.reference,
      item.namespace,
      item.author,
      ...item.assignees,
      ...item.labels.map((label) => label.name),
    ]
      .join(" ")
      .toLowerCase()
      .includes(normalizedQuery)
  })
}

export const nextWorkItemStateFilter = (filter: WorkItemStateFilter) => {
  const index = workItemStateFilters.indexOf(filter)
  return workItemStateFilters[(index + 1) % workItemStateFilters.length] ?? "open"
}

export const visibleWindowStart = (itemCount: number, capacity: number, selectedIndex: number) => {
  const safeCapacity = Math.max(1, capacity)
  const lastStart = Math.max(0, itemCount - safeCapacity)
  return Math.max(0, Math.min(lastStart, selectedIndex - safeCapacity + 1))
}

const minimumWorkflowColumnWidth = 25

export const visibleWorkflowColumns = (width: number, focusedIndex: number) => {
  const count = Math.max(
    1,
    Math.min(workflowColumns.length, Math.floor((Math.max(1, width) + 1) / (minimumWorkflowColumnWidth + 1))),
  )
  const focused = Math.max(0, Math.min(workflowColumns.length - 1, focusedIndex))
  const start = Math.max(0, Math.min(workflowColumns.length - count, focused - Math.floor(count / 2)))
  return workflowColumns.slice(start, start + count)
}

export const terminalSizeSupported = (width: number, height: number) => width >= 44 && height >= 16

export const workItemDragSourceId = (itemId: string) => `${dragSourcePrefix}${itemId}`

export const workItemIdFromDragSource = (sourceId: string | undefined) => {
  if (!sourceId?.startsWith(dragSourcePrefix)) return null
  const itemId = sourceId.slice(dragSourcePrefix.length)
  return itemId.length > 0 ? itemId : null
}

type DragRenderable = {
  readonly id: string
  readonly parent: DragRenderable | null
}

export const workItemIdFromDragRenderable = (source: DragRenderable | undefined) => {
  let current: DragRenderable | null | undefined = source
  while (current) {
    const itemId = workItemIdFromDragSource(current.id)
    if (itemId) return itemId
    current = current.parent
  }
  return null
}
