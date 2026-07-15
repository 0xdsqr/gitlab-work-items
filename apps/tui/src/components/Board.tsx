import {
  relativeAge,
  type WorkflowColumnId,
  type WorkItem,
  workflowColumns,
  workItemsByColumn,
} from "@github-work-items/domain"
import { TextAttributes, type MouseEvent } from "@opentui/core"
import { useState } from "react"
import { colors, ellipsis, typeColor } from "../theme.ts"
import { LabelChips } from "./LabelChips.tsx"

const sourcePrefix = "work-item:"

const visibleColumns = (width: number, focusedIndex: number) => {
  if (width >= 126) return workflowColumns
  if (width < 86) return [workflowColumns[focusedIndex] ?? workflowColumns[0]]
  const start = Math.max(0, Math.min(workflowColumns.length - 3, focusedIndex - 1))
  return workflowColumns.slice(start, start + 3)
}

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
  const columnWidth = Math.max(20, Math.floor(width / columns.length))
  const cardCapacity = Math.max(1, Math.floor((height - 3) / 6))

  const drop = (event: MouseEvent, target: WorkflowColumnId) => {
    const sourceId = event.source?.id ?? ""
    if (!sourceId.startsWith(sourcePrefix)) return
    const item = items.find((candidate) => candidate.id === sourceId.slice(sourcePrefix.length))
    if (item) onMove(item, target)
    setDraggingId(null)
    event.stopPropagation()
  }

  return (
    <box width={width} height={height} flexDirection="column">
      <box height={2} paddingLeft={1} paddingRight={1} justifyContent="space-between" alignItems="center">
        <box flexDirection="column">
          <text fg={colors.text} attributes={TextAttributes.BOLD}>
            Workflow board
          </text>
          <text fg={colors.muted}>{width >= 126 ? "All stages" : `${focused.label} · h/l changes column`}</text>
        </box>
        <text fg={colors.muted}>drag cards or use [ / ]</text>
      </box>
      <box width={width} height={Math.max(1, height - 2)} flexDirection="row">
        {columns.map((column, visibleIndex) => {
          const columnIndex = workflowColumns.findIndex((candidate) => candidate.id === column.id)
          const active = columnIndex === focusedColumnIndex
          const columnItems = grouped[column.id]
          const start = active ? Math.max(0, selectedIndex - cardCapacity + 1) : 0
          return (
            <box
              key={column.id}
              width={
                visibleIndex === columns.length - 1 ? Math.max(20, width - columnWidth * visibleIndex) : columnWidth
              }
              height={Math.max(1, height - 2)}
              border
              borderStyle="single"
              borderColor={active ? column.color : colors.border}
              backgroundColor={active ? colors.panel : colors.background}
              flexDirection="column"
              onMouseDown={() => onSelect(column.id, 0)}
              onMouseDrop={(event) => drop(event, column.id)}
              title={` ${column.label} · ${columnItems.length} `}
            >
              <box height={1} paddingLeft={1} paddingRight={1} justifyContent="space-between">
                <text fg={column.color}>●</text>
                <text fg={colors.muted}>{ellipsis(column.hint, Math.max(8, columnWidth - 6))}</text>
              </box>
              {columnItems.slice(start, start + cardCapacity).map((item, localIndex) => {
                const index = start + localIndex
                const selected = active && index === selectedIndex
                const dragging = draggingId === item.id
                const pending = pendingItemId === item.id
                return (
                  <box
                    id={`${sourcePrefix}${item.id}`}
                    key={item.id}
                    height={6}
                    marginLeft={1}
                    marginRight={1}
                    border
                    borderStyle="single"
                    borderColor={selected ? colors.accent : dragging ? colors.gitlab : colors.border}
                    backgroundColor={selected ? colors.selected : colors.panelRaised}
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
                    onMouseDragEnd={() => setDraggingId(null)}
                  >
                    <text fg={colors.text} attributes={selected ? TextAttributes.BOLD : 0}>
                      <span fg={selected ? colors.accent : colors.border}>{selected ? "▌" : "│"}</span>
                      <span fg={typeColor(item)}>{` ${item.type.toLowerCase()} `}</span>
                      <span fg={colors.muted}>{relativeAge(item.updatedAt)}</span>
                    </text>
                    <text fg={colors.text} attributes={selected ? TextAttributes.BOLD : 0}>
                      {ellipsis(item.title, Math.max(8, columnWidth - 6))}
                    </text>
                    <text fg={colors.muted}>{ellipsis(item.reference, Math.max(8, columnWidth - 6))}</text>
                    <text>
                      <LabelChips labels={item.labels} width={Math.max(8, columnWidth - 6)} />
                    </text>
                    <text fg={pending ? colors.warning : colors.muted}>
                      {pending
                        ? "syncing with GitLab…"
                        : item.assignees.map((name) => `@${name}`).join(" ") || "unassigned"}
                    </text>
                  </box>
                )
              })}
              {columnItems.length === 0 ? (
                <box
                  height={3}
                  margin={1}
                  border
                  borderStyle="single"
                  borderColor={colors.border}
                  alignItems="center"
                  justifyContent="center"
                >
                  <text fg={draggingId ? colors.accent : colors.muted}>
                    {draggingId ? "Drop here" : "No work here"}
                  </text>
                </box>
              ) : null}
            </box>
          )
        })}
      </box>
    </box>
  )
}
