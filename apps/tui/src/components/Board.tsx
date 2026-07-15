import {
  relativeAge,
  type WorkflowColumnId,
  type WorkItem,
  workflowColumns,
  workItemsByColumn,
} from "@github-work-items/domain"
import { TextAttributes, type MouseEvent } from "@opentui/core"
import { Fragment, useState } from "react"
import { colors, ellipsis, typeColor } from "../theme.ts"
import { visibleWindowStart, workItemDragSourceId, workItemIdFromDragSource } from "../ui-state.ts"
import { LabelChips } from "./LabelChips.tsx"

const visibleColumns = (width: number, focusedIndex: number) => {
  if (width >= 126) return workflowColumns
  if (width < 86) return [workflowColumns[focusedIndex] ?? workflowColumns[0]]
  const start = Math.max(0, Math.min(workflowColumns.length - 3, focusedIndex - 1))
  return workflowColumns.slice(start, start + 3)
}

const draggedWorkItemId = (event: MouseEvent) => workItemIdFromDragSource(event.source?.id)

const Separator = ({ height }: { height: number }) => (
  <box width={1} height={height} flexDirection="column">
    {Array.from({ length: height }, (_, index) => (
      <text key={index} fg={colors.border}>
        │
      </text>
    ))}
  </box>
)

export const Board = ({
  width,
  height,
  items,
  focusedColumnIndex,
  selectedIndex,
  pendingItemId,
  onSelect,
  onMove,
}: {
  width: number
  height: number
  items: readonly WorkItem[]
  focusedColumnIndex: number
  selectedIndex: number
  pendingItemId: string | null
  onSelect: (column: WorkflowColumnId, index: number) => void
  onMove: (item: WorkItem, target: WorkflowColumnId) => void
}) => {
  const grouped = workItemsByColumn(items)
  const columns = visibleColumns(width, focusedColumnIndex)
  const focused = workflowColumns[focusedColumnIndex] ?? workflowColumns[0]
  const [draggingId, setDraggingId] = useState<string | null>(null)
  const [dropTarget, setDropTarget] = useState<WorkflowColumnId | null>(null)
  const boardHeight = Math.max(1, height - 3)
  const separatorWidth = Math.max(0, columns.length - 1)
  const availableWidth = Math.max(columns.length * 20, width - separatorWidth)
  const columnWidth = Math.max(20, Math.floor(availableWidth / columns.length))
  const cardCapacity = Math.max(1, Math.floor((boardHeight - 2) / 6))

  const drop = (event: MouseEvent, target: WorkflowColumnId) => {
    const itemId = draggedWorkItemId(event)
    if (!itemId) return
    const item = items.find((candidate) => candidate.id === itemId)
    if (item) onMove(item, target)
    setDraggingId(null)
    setDropTarget(null)
    event.stopPropagation()
  }

  return (
    <box width={width} height={height} flexDirection="column">
      <box height={1} paddingLeft={1} paddingRight={1} flexDirection="row" justifyContent="space-between">
        <text fg={colors.text} attributes={TextAttributes.BOLD}>
          Board <span fg={colors.subtle}>· {focused.label}</span>
        </text>
        <text fg={colors.muted}>drag a card between columns · [ / ] also moves</text>
      </box>
      <box height={1} paddingLeft={1}>
        <text fg={colors.muted}>Hold the left mouse button, drag, then release over a destination column.</text>
      </box>
      <text fg={colors.border}>{"─".repeat(Math.max(1, width))}</text>
      <box width={width} height={boardHeight} flexDirection="row">
        {columns.map((column, visibleIndex) => {
          const columnIndex = workflowColumns.findIndex((candidate) => candidate.id === column.id)
          const active = columnIndex === focusedColumnIndex
          const columnItems = grouped[column.id]
          const start = active ? visibleWindowStart(columnItems.length, cardCapacity, selectedIndex) : 0
          const isDropTarget = dropTarget === column.id && draggingId !== null
          const renderedWidth =
            visibleIndex === columns.length - 1
              ? Math.max(20, width - separatorWidth - columnWidth * visibleIndex)
              : columnWidth
          const cardWidth = Math.max(8, renderedWidth - 4)
          return (
            <Fragment key={column.id}>
              {visibleIndex > 0 ? <Separator height={boardHeight} /> : null}
              <box
                id={`workflow-column:${column.id}`}
                width={renderedWidth}
                height={boardHeight}
                backgroundColor={isDropTarget ? colors.panel : colors.background}
                flexDirection="column"
                onMouseDown={() => onSelect(column.id, 0)}
                onMouseOver={(event) => {
                  const itemId = draggedWorkItemId(event)
                  if (!itemId) return
                  setDraggingId(itemId)
                  setDropTarget(column.id)
                }}
                onMouseOut={() => setDropTarget((current) => (current === column.id ? null : current))}
                onMouseDrop={(event) => drop(event, column.id)}
                onMouseScroll={(event) => {
                  if (!event.scroll || columnItems.length === 0) return
                  const current = active ? selectedIndex : 0
                  const direction = event.scroll.direction === "down" ? 1 : event.scroll.direction === "up" ? -1 : 0
                  if (direction === 0) return
                  onSelect(column.id, Math.max(0, Math.min(columnItems.length - 1, current + direction)))
                  event.stopPropagation()
                }}
              >
                <box
                  height={2}
                  paddingLeft={1}
                  paddingRight={1}
                  backgroundColor={active || isDropTarget ? colors.panel : colors.background}
                  flexDirection="column"
                >
                  <text fg={active ? colors.text : colors.muted} attributes={active ? TextAttributes.BOLD : 0}>
                    <span fg={isDropTarget ? colors.success : column.color}>
                      {isDropTarget ? "↓" : active ? "▌" : "●"}
                    </span>
                    {` ${column.label}  `}
                    <span fg={colors.subtle}>{columnItems.length}</span>
                  </text>
                  <text fg={isDropTarget ? colors.success : colors.subtle}>
                    {isDropTarget ? "Release to move here" : ellipsis(column.hint, Math.max(8, renderedWidth - 2))}
                  </text>
                </box>
                {columnItems.slice(start, start + cardCapacity).map((item, localIndex) => {
                  const index = start + localIndex
                  const selected = active && index === selectedIndex
                  const dragging = draggingId === item.id
                  const pending = pendingItemId === item.id
                  return (
                    <box
                      id={workItemDragSourceId(item.id)}
                      key={item.id}
                      height={6}
                      marginLeft={1}
                      marginRight={1}
                      border
                      borderStyle="single"
                      borderColor={selected ? colors.accent : dragging ? colors.success : colors.border}
                      backgroundColor={selected ? colors.selected : colors.panel}
                      paddingLeft={1}
                      paddingRight={1}
                      flexDirection="column"
                      onMouseDown={(event) => {
                        onSelect(column.id, index)
                        event.stopPropagation()
                      }}
                      onMouseDrag={(event) => {
                        setDraggingId(item.id)
                        event.stopPropagation()
                      }}
                      onMouseDragEnd={() => {
                        setDraggingId(null)
                        setDropTarget(null)
                      }}
                    >
                      <text fg={colors.text} attributes={selected ? TextAttributes.BOLD : 0}>
                        <span fg={dragging ? colors.success : colors.subtle}>⠿</span>
                        <span fg={typeColor(item)}>{` ${item.type.toLowerCase()} `}</span>
                        <span fg={colors.subtle}>{relativeAge(item.updatedAt)}</span>
                      </text>
                      <text fg={colors.text} attributes={selected ? TextAttributes.BOLD : 0}>
                        {ellipsis(item.title, cardWidth)}
                      </text>
                      <text fg={colors.muted}>{ellipsis(item.reference, cardWidth)}</text>
                      <text>
                        <LabelChips labels={item.labels} width={cardWidth} />
                      </text>
                      <text fg={pending ? colors.warning : colors.muted}>
                        {pending
                          ? "syncing with GitLab…"
                          : ellipsis(item.assignees.map((name) => `@${name}`).join(" ") || "unassigned", cardWidth)}
                      </text>
                    </box>
                  )
                })}
                {columnItems.length === 0 ? (
                  <box height={4} margin={1} alignItems="center" justifyContent="center">
                    <text fg={isDropTarget ? colors.success : colors.subtle}>
                      {isDropTarget ? "↓  Release to move here" : "No work items"}
                    </text>
                  </box>
                ) : null}
              </box>
            </Fragment>
          )
        })}
      </box>
    </box>
  )
}
