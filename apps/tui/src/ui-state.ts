import type { WorkItem } from "@github-work-items/domain"

const dragSourcePrefix = "work-item:"

export type WorkItemStateFilter = "open" | "closed" | "all"

export const workItemStateFilters: readonly WorkItemStateFilter[] = ["open", "closed", "all"]

export const filterWorkItems = (items: readonly WorkItem[], filter: WorkItemStateFilter) =>
  filter === "all" ? items : items.filter((item) => item.state === filter.toUpperCase())

export const nextWorkItemStateFilter = (filter: WorkItemStateFilter) => {
  const index = workItemStateFilters.indexOf(filter)
  return workItemStateFilters[(index + 1) % workItemStateFilters.length] ?? "open"
}

export const visibleWindowStart = (itemCount: number, capacity: number, selectedIndex: number) => {
  const safeCapacity = Math.max(1, capacity)
  const lastStart = Math.max(0, itemCount - safeCapacity)
  return Math.max(0, Math.min(lastStart, selectedIndex - safeCapacity + 1))
}

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
