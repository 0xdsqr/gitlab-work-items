const dragSourcePrefix = "work-item:"

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
