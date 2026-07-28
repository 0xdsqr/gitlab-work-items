import {
  relativeAge,
  workflowColumnOf,
  workflowBoardColumns,
  type BoardCard,
  type BoardColumn,
  type WorkItem,
} from "@gitlab-work-items/domain"
import { TextAttributes, type MouseEvent } from "@opentui/core"
import { createMemo, createSignal, For, Show } from "solid-js"
import { cellWidth, colors, ellipsis, typeColor, workItemTypeIcon } from "../theme.ts"
import {
  visibleBoardColumns,
  visibleWindowStart,
  workItemDragSourceId,
  workItemIdFromDragRenderable,
} from "../ui-state.ts"
import { LabelChips } from "./LabelChips.tsx"
import { StyledSpan } from "./StyledSpan.tsx"

const draggedWorkItemId = (event: MouseEvent) => workItemIdFromDragRenderable(event.source)
type BoardItem = Readonly<{ item: WorkItem; card: BoardCard }>
const noBoardItems: readonly BoardItem[] = []

const Separator = (props: { height: number }) => (
  <box width={1} height={props.height} flexDirection="column">
    <For each={Array.from({ length: props.height })}>{() => <text fg={colors.border}>│</text>}</For>
  </box>
)

type BoardProps = {
  width: number
  height: number
  items: readonly WorkItem[]
  columns?: readonly BoardColumn[]
  cards?: readonly BoardCard[]
  title?: string
  badge?: string
  emptyTitle?: string
  emptyHint?: string
  focusedColumnIndex: number
  selectedIndex: number
  pendingItemId: string | null
  onSelect: (column: BoardColumn, index: number) => void
  onMove?: (item: WorkItem, target: BoardColumn) => void
}

export const Board = (props: BoardProps) => {
  const [draggingId, setDraggingId] = createSignal<string | null>(null)
  const [dropTarget, setDropTarget] = createSignal<string | null>(null)
  const boardColumns = createMemo(() => props.columns ?? workflowBoardColumns)
  const itemById = createMemo(() => new Map(props.items.map((item) => [item.id, item])))
  const cards = createMemo<readonly BoardCard[]>(() => {
    if (props.cards) return props.cards
    return props.items.map((item, position) => ({
      itemId: item.id,
      columnId: workflowColumnOf(item),
      position,
      parentItemId: null,
      depth: 0,
    }))
  })
  const itemsByColumn = createMemo(() => {
    const positioned = new Map<string, Array<BoardItem & { order: number }>>()
    cards().forEach((card, order) => {
      const item = itemById().get(card.itemId)
      if (!item) return
      const columnItems = positioned.get(card.columnId) ?? []
      columnItems.push({ item, card, order })
      positioned.set(card.columnId, columnItems)
    })

    return new Map(
      [...positioned].map(([columnId, columnItems]) => [
        columnId,
        columnItems
          .sort((left, right) => left.card.position - right.card.position || left.order - right.order)
          .map(({ item, card }) => ({ item, card })),
      ]),
    )
  })
  const itemsInColumn = (columnId: string) => itemsByColumn().get(columnId) ?? noBoardItems
  const columns = createMemo(() => visibleBoardColumns(boardColumns(), props.width, props.focusedColumnIndex))
  const focused = createMemo(() => boardColumns()[props.focusedColumnIndex] ?? boardColumns()[0])
  const firstVisibleIndex = createMemo(() =>
    Math.max(
      0,
      boardColumns().findIndex((column) => column.id === columns()[0]?.id),
    ),
  )
  const hiddenLeft = createMemo(() => firstVisibleIndex())
  const hiddenRight = createMemo(() => boardColumns().length - firstVisibleIndex() - columns().length)
  const headerPosition = createMemo(() => {
    const columnCount = boardColumns().length
    if (columnCount === 0) return "0/0"
    return `${Math.min(columnCount, Math.max(1, props.focusedColumnIndex + 1))}/${columnCount}`
  })
  const headerMeta = createMemo(() => {
    if (props.width < 58) return ""
    return [
      props.badge ? ` ${props.badge} ` : "",
      hiddenLeft() > 0 ? `← ${hiddenLeft()}` : "",
      hiddenRight() > 0 ? `${hiddenRight()} →` : "",
    ]
      .filter(Boolean)
      .join(" ")
  })
  const headerTextWidth = createMemo(() =>
    Math.max(8, props.width - 2 - (headerMeta() ? cellWidth(headerMeta()) + 1 : 0)),
  )
  const headerNamesWidth = createMemo(() => Math.max(8, headerTextWidth() - cellWidth(headerPosition()) - 4))
  const boardTitleWidth = createMemo(() => Math.max(4, Math.floor(headerNamesWidth() * 0.45)))
  const focusedTitleWidth = createMemo(() => Math.max(4, headerNamesWidth() - boardTitleWidth()))
  const boardHeight = createMemo(() => Math.max(1, props.height - 2))
  const separatorWidth = createMemo(() => Math.max(0, columns().length - 1))
  const availableWidth = createMemo(() => Math.max(columns().length * 25, props.width - separatorWidth()))
  const columnWidth = createMemo(() => Math.max(25, Math.floor(availableWidth() / columns().length)))
  const cardHeight = 6
  const cardCapacity = createMemo(() => Math.max(1, Math.floor((boardHeight() - 2) / cardHeight)))

  const canMoveTo = (target: BoardColumn) => Boolean(props.onMove) && target.move.kind !== "read-only"

  const drop = (event: MouseEvent, target: BoardColumn) => {
    if (!canMoveTo(target)) return
    const itemId = draggedWorkItemId(event)
    if (!itemId) return
    const item = props.items.find((candidate) => candidate.id === itemId)
    if (item) props.onMove?.(item, target)
    setDraggingId(null)
    setDropTarget(null)
    event.stopPropagation()
  }

  return (
    <box width={props.width} height={props.height} flexDirection="column">
      <box height={1} paddingLeft={1} paddingRight={1} flexDirection="row" justifyContent="space-between">
        <text width={headerTextWidth()} fg={colors.text} attributes={TextAttributes.BOLD} wrapMode="none" truncate>
          {ellipsis(props.title ?? "Board", boardTitleWidth())} <StyledSpan fg={colors.subtle}>·</StyledSpan>{" "}
          {ellipsis(focused()?.title ?? "No columns", focusedTitleWidth())}{" "}
          <StyledSpan fg={colors.subtle}>{headerPosition()}</StyledSpan>
        </text>
        <Show when={headerMeta()}>
          <text fg={colors.subtle} attributes={TextAttributes.BOLD} wrapMode="none">
            {headerMeta()}
          </text>
        </Show>
      </box>
      <text fg={colors.border}>{"─".repeat(Math.max(1, props.width))}</text>
      <Show
        when={cards().length > 0}
        fallback={
          <box
            width={props.width}
            height={boardHeight()}
            alignItems="center"
            justifyContent="center"
            flexDirection="column"
          >
            <text fg={colors.text} attributes={TextAttributes.BOLD}>
              {props.emptyTitle ?? "Nothing in this board yet"}
            </text>
            <text fg={colors.muted}>{props.emptyHint ?? "Press b for another board or r to sync again."}</text>
          </box>
        }
      >
        <box width={props.width} height={boardHeight()} flexDirection="row">
          <For each={columns()}>
            {(column, visibleIndex) => {
              const columnIndex = boardColumns().findIndex((candidate) => candidate.id === column.id)
              const active = () => columnIndex === props.focusedColumnIndex
              const columnItems = () => itemsInColumn(column.id)
              const start = () =>
                active() ? visibleWindowStart(columnItems().length, cardCapacity(), props.selectedIndex) : 0
              const isDropTarget = () => dropTarget() === column.id && draggingId() !== null && canMoveTo(column)
              const renderedWidth = () =>
                visibleIndex() === columns().length - 1
                  ? Math.max(25, props.width - separatorWidth() - columnWidth() * visibleIndex())
                  : columnWidth()
              const cardWidth = () => Math.max(8, renderedWidth() - 6)
              const columnCountLabel = () => ` ${columnItems().length} `
              const columnTitleWidth = () => Math.max(1, renderedWidth() - 5 - cellWidth(columnCountLabel()))

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
                    onMouseDown={() => props.onSelect(column, 0)}
                    onMouseOver={(event) => {
                      if (!canMoveTo(column)) return
                      const itemId = draggedWorkItemId(event)
                      if (!itemId) return
                      setDraggingId(itemId)
                      setDropTarget(column.id)
                    }}
                    onMouseOut={() => setDropTarget((current) => (current === column.id ? null : current))}
                    onMouseDrop={(event) => drop(event, column)}
                    onMouseScroll={(event) => {
                      if (!event.scroll || columnItems().length === 0) return
                      const current = active() ? props.selectedIndex : 0
                      const direction = event.scroll.direction === "down" ? 1 : event.scroll.direction === "up" ? -1 : 0
                      if (direction === 0) return
                      props.onSelect(column, Math.max(0, Math.min(columnItems().length - 1, current + direction)))
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
                      <text
                        width={Math.max(1, renderedWidth() - 2)}
                        fg={active() ? colors.text : colors.muted}
                        attributes={active() ? TextAttributes.BOLD : 0}
                        wrapMode="none"
                        truncate
                      >
                        <StyledSpan fg={isDropTarget() ? colors.success : (column.color ?? colors.subtle)}>
                          {isDropTarget() ? "↓" : active() ? "▌" : "●"}
                        </StyledSpan>
                        {` ${ellipsis(column.title, columnTitleWidth())} `}
                        <StyledSpan
                          fg={active() ? colors.text : colors.subtle}
                          bg={active() ? colors.panelRaised : undefined}
                        >
                          {columnCountLabel()}
                        </StyledSpan>
                      </text>
                      <text
                        width={Math.max(1, renderedWidth() - 2)}
                        fg={isDropTarget() ? colors.success : colors.subtle}
                        wrapMode="none"
                        truncate
                      >
                        {isDropTarget()
                          ? "Release to move here"
                          : ellipsis(
                              active() && columnItems().length > 0
                                ? `${Math.min(props.selectedIndex + 1, columnItems().length)}/${columnItems().length} · ${column.hint ?? ""}`
                                : (column.hint ?? ""),
                              Math.max(8, renderedWidth() - 2),
                            )}
                      </text>
                    </box>
                    <For each={columnItems().slice(start(), start() + cardCapacity())}>
                      {({ item, card }, localIndex) => {
                        const index = () => start() + localIndex()
                        const selected = () => active() && index() === props.selectedIndex
                        const dragging = () => draggingId() === item.id
                        const pending = () => props.pendingItemId === item.id
                        const hierarchyCue = () =>
                          card.parentItemId && card.depth > 1
                            ? `${" ".repeat(Math.min(2, Math.max(0, card.depth - 2)))}↳ `
                            : ""
                        return (
                          <box
                            id={workItemDragSourceId(item.id)}
                            height={cardHeight}
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
                              props.onSelect(column, index())
                              event.stopPropagation()
                            }}
                            onMouseDrag={(event) => {
                              if (!props.onMove) return
                              setDraggingId(item.id)
                              event.stopPropagation()
                            }}
                            onMouseDragEnd={() => {
                              setDraggingId(null)
                              setDropTarget(null)
                            }}
                          >
                            <text selectable={false} fg={colors.text} attributes={selected() ? TextAttributes.BOLD : 0}>
                              <StyledSpan fg={dragging() ? colors.success : colors.subtle}>
                                {props.onMove ? "⠿" : "·"}
                              </StyledSpan>
                              <StyledSpan fg={typeColor(item)}>{` ${workItemTypeIcon(item)} `}</StyledSpan>
                              <StyledSpan fg={colors.active}>
                                {ellipsis(
                                  item.reference,
                                  Math.max(3, cardWidth() - cellWidth(relativeAge(item.updatedAt)) - 5),
                                )}
                              </StyledSpan>
                              <StyledSpan fg={colors.subtle}>{` ${relativeAge(item.updatedAt)}`}</StyledSpan>
                            </text>
                            <text selectable={false} fg={colors.text} attributes={selected() ? TextAttributes.BOLD : 0}>
                              <StyledSpan fg={colors.subtle}>{hierarchyCue()}</StyledSpan>
                              {ellipsis(item.title, Math.max(1, cardWidth() - cellWidth(hierarchyCue())))}
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
                          {isDropTarget()
                            ? "↓  Release to move here"
                            : column.move.kind === "read-only"
                              ? column.move.reason
                              : "Drop work here"}
                        </text>
                      </box>
                    </Show>
                  </box>
                </>
              )
            }}
          </For>
        </box>
      </Show>
    </box>
  )
}
