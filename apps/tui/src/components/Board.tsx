import {
  relativeAge,
  type WorkflowColumnId,
  type WorkItem,
  workflowColumns,
  workItemsByColumn,
} from "@github-work-items/domain"
import { TextAttributes, type MouseEvent } from "@opentui/core"
import { createMemo, createSignal, For, Show } from "solid-js"
import { colors, ellipsis, typeColor, workItemTypeIcon } from "../theme.ts"
import { visibleWindowStart, workItemDragSourceId, workItemIdFromDragRenderable } from "../ui-state.ts"
import { LabelChips } from "./LabelChips.tsx"
import { StyledSpan } from "./StyledSpan.tsx"

const visibleColumns = (width: number, focusedIndex: number) => {
  if (width >= 126) return workflowColumns
  if (width < 66) return [workflowColumns[focusedIndex] ?? workflowColumns[0]]
  const start = Math.max(0, Math.min(workflowColumns.length - 3, focusedIndex - 1))
  return workflowColumns.slice(start, start + 3)
}

const draggedWorkItemId = (event: MouseEvent) => workItemIdFromDragRenderable(event.source)

const Separator = (props: { height: number }) => (
  <box width={1} height={props.height} flexDirection="column">
    <For each={Array.from({ length: props.height })}>{() => <text fg={colors.border}>│</text>}</For>
  </box>
)

type BoardProps = {
  width: number
  height: number
  items: readonly WorkItem[]
  focusedColumnIndex: number
  selectedIndex: number
  pendingItemId: string | null
  onSelect: (column: WorkflowColumnId, index: number) => void
  onMove: (item: WorkItem, target: WorkflowColumnId) => void
}

export const Board = (props: BoardProps) => {
  const [draggingId, setDraggingId] = createSignal<string | null>(null)
  const [dropTarget, setDropTarget] = createSignal<WorkflowColumnId | null>(null)
  const grouped = createMemo(() => workItemsByColumn(props.items))
  const columns = createMemo(() => visibleColumns(props.width, props.focusedColumnIndex))
  const focused = createMemo(() => workflowColumns[props.focusedColumnIndex] ?? workflowColumns[0])
  const boardHeight = createMemo(() => Math.max(1, props.height - 3))
  const separatorWidth = createMemo(() => Math.max(0, columns().length - 1))
  const availableWidth = createMemo(() => Math.max(columns().length * 20, props.width - separatorWidth()))
  const columnWidth = createMemo(() => Math.max(20, Math.floor(availableWidth() / columns().length)))
  const cardCapacity = createMemo(() => Math.max(1, Math.floor((boardHeight() - 2) / 7)))

  const drop = (event: MouseEvent, target: WorkflowColumnId) => {
    const itemId = draggedWorkItemId(event)
    if (!itemId) return
    const item = props.items.find((candidate) => candidate.id === itemId)
    if (item) props.onMove(item, target)
    setDraggingId(null)
    setDropTarget(null)
    event.stopPropagation()
  }

  return (
    <box width={props.width} height={props.height} flexDirection="column">
      <box height={1} paddingLeft={1} paddingRight={1} flexDirection="row" justifyContent="space-between">
        <text fg={colors.text} attributes={TextAttributes.BOLD}>
          Board <StyledSpan fg={colors.subtle}>· {focused().label}</StyledSpan>
        </text>
        <text fg={colors.muted}>[ move left · ] move right · enter summary</text>
      </box>
      <box height={1} paddingLeft={1}>
        <text fg={colors.muted}>Mouse: hold on ⠿, move to a highlighted column, then release.</text>
      </box>
      <text fg={colors.border}>{"─".repeat(Math.max(1, props.width))}</text>
      <box width={props.width} height={boardHeight()} flexDirection="row">
        <For each={columns()}>
          {(column, visibleIndex) => {
            const columnIndex = workflowColumns.findIndex((candidate) => candidate.id === column.id)
            const active = () => columnIndex === props.focusedColumnIndex
            const columnItems = () => grouped()[column.id]
            const start = () =>
              active() ? visibleWindowStart(columnItems().length, cardCapacity(), props.selectedIndex) : 0
            const isDropTarget = () => dropTarget() === column.id && draggingId() !== null
            const renderedWidth = () =>
              visibleIndex() === columns().length - 1
                ? Math.max(20, props.width - separatorWidth() - columnWidth() * visibleIndex())
                : columnWidth()
            const cardWidth = () => Math.max(8, renderedWidth() - 6)

            return (
              <>
                <Show when={visibleIndex() > 0}>
                  <Separator height={boardHeight()} />
                </Show>
                <box
                  id={`workflow-column:${column.id}`}
                  width={renderedWidth()}
                  height={boardHeight()}
                  backgroundColor={isDropTarget() ? colors.panel : colors.background}
                  flexDirection="column"
                  onMouseDown={() => props.onSelect(column.id, 0)}
                  onMouseOver={(event) => {
                    const itemId = draggedWorkItemId(event)
                    if (!itemId) return
                    setDraggingId(itemId)
                    setDropTarget(column.id)
                  }}
                  onMouseOut={() => setDropTarget((current) => (current === column.id ? null : current))}
                  onMouseDrop={(event) => drop(event, column.id)}
                  onMouseScroll={(event) => {
                    if (!event.scroll || columnItems().length === 0) return
                    const current = active() ? props.selectedIndex : 0
                    const direction = event.scroll.direction === "down" ? 1 : event.scroll.direction === "up" ? -1 : 0
                    if (direction === 0) return
                    props.onSelect(column.id, Math.max(0, Math.min(columnItems().length - 1, current + direction)))
                    event.stopPropagation()
                  }}
                >
                  <box
                    height={2}
                    paddingLeft={1}
                    paddingRight={1}
                    backgroundColor={active() || isDropTarget() ? colors.panel : colors.background}
                    flexDirection="column"
                  >
                    <text fg={active() ? colors.text : colors.muted} attributes={active() ? TextAttributes.BOLD : 0}>
                      <StyledSpan fg={isDropTarget() ? colors.success : column.color}>
                        {isDropTarget() ? "↓" : active() ? "▌" : "●"}
                      </StyledSpan>
                      {` ${column.label}  `}
                      <StyledSpan fg={colors.subtle}>{columnItems().length}</StyledSpan>
                    </text>
                    <text fg={isDropTarget() ? colors.success : colors.subtle}>
                      {isDropTarget()
                        ? "Release to move here"
                        : ellipsis(column.hint, Math.max(8, renderedWidth() - 2))}
                    </text>
                  </box>
                  <For each={columnItems().slice(start(), start() + cardCapacity())}>
                    {(item, localIndex) => {
                      const index = () => start() + localIndex()
                      const selected = () => active() && index() === props.selectedIndex
                      const dragging = () => draggingId() === item.id
                      const pending = () => props.pendingItemId === item.id
                      return (
                        <box
                          id={workItemDragSourceId(item.id)}
                          height={7}
                          marginLeft={1}
                          marginRight={1}
                          border
                          borderStyle="single"
                          borderColor={selected() ? colors.accent : dragging() ? colors.success : colors.border}
                          backgroundColor={selected() ? colors.selected : colors.panel}
                          paddingLeft={1}
                          paddingRight={1}
                          flexDirection="column"
                          onMouseDown={(event) => {
                            props.onSelect(column.id, index())
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
                          <text selectable={false} fg={colors.text} attributes={selected() ? TextAttributes.BOLD : 0}>
                            <StyledSpan fg={dragging() ? colors.success : colors.subtle}>⠿</StyledSpan>
                            <StyledSpan fg={typeColor(item)}>
                              {` ${workItemTypeIcon(item)} ${item.type.toLowerCase()} `}
                            </StyledSpan>
                            <StyledSpan fg={colors.subtle}>{relativeAge(item.updatedAt)}</StyledSpan>
                          </text>
                          <text selectable={false} fg={colors.text} attributes={selected() ? TextAttributes.BOLD : 0}>
                            {ellipsis(item.title, cardWidth())}
                          </text>
                          <text selectable={false} fg={colors.muted}>
                            {ellipsis(item.reference, cardWidth())}
                          </text>
                          <text selectable={false}>
                            <LabelChips labels={item.labels} width={cardWidth()} />
                          </text>
                          <text selectable={false} fg={pending() ? colors.warning : colors.muted}>
                            {pending()
                              ? "syncing with GitLab…"
                              : ellipsis(
                                  item.assignees.map((name) => `@${name}`).join(" ") || "unassigned",
                                  cardWidth(),
                                )}
                          </text>
                        </box>
                      )
                    }}
                  </For>
                  <Show when={columnItems().length === 0}>
                    <box height={4} margin={1} alignItems="center" justifyContent="center">
                      <text fg={isDropTarget() ? colors.success : colors.subtle}>
                        {isDropTarget() ? "↓  Release to move here" : "No work items"}
                      </text>
                    </box>
                  </Show>
                </box>
              </>
            )
          }}
        </For>
      </box>
    </box>
  )
}
