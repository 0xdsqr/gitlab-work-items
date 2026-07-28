import { TextAttributes, type MouseEvent } from "@opentui/core"
import { useKeyboard } from "@opentui/solid"
import { createEffect, createMemo, createSignal, For, Show, untrack } from "solid-js"
import {
  boardPickerGroupLabels,
  boardPickerUnavailableReason,
  filterBoardPickerEntries,
  firstBoardPickerEntryId,
  moveBoardPickerSelection,
  orderBoardPickerEntries,
  visibleBoardPickerRows,
  type BoardPickerEntry,
  type BoardPickerKind,
  type BoardPickerMovement,
} from "../board-picker.ts"
import { colors, ellipsis } from "../theme.ts"
import { StyledSpan } from "./StyledSpan.tsx"

export type { BoardPickerEntry, BoardPickerKind } from "../board-picker.ts"

export type BoardPickerProps = {
  screenWidth: number
  screenHeight: number
  entries: readonly BoardPickerEntry[]
  activeId?: string | null
  initialQuery?: string
  title?: string
  notice?: string | null
  onSelect: (entry: BoardPickerEntry) => void
  onClose: () => void
}

const kindIcon: Readonly<Record<BoardPickerKind, string>> = {
  smart: "◇",
  gitlab: "▦",
  epic: "◆",
}

const kindColor: Readonly<Record<BoardPickerKind, string>> = {
  smart: colors.active,
  gitlab: colors.gitlab,
  epic: colors.epic,
}

export const BoardPicker = (props: BoardPickerProps) => {
  const [query, setQuery] = createSignal(props.initialQuery ?? "")
  const [selectedId, setSelectedId] = createSignal<string | null>(props.activeId ?? null)
  const width = createMemo(() => Math.max(1, Math.min(76, props.screenWidth - 4)))
  const height = createMemo(() => Math.max(1, Math.min(20, props.screenHeight - 2)))
  const contentWidth = createMemo(() => Math.max(1, width() - 4))
  const notice = createMemo(() => props.notice?.trim() || null)
  const resultsHeight = createMemo(() => Math.max(1, height() - 8 - (notice() ? 1 : 0)))
  const filteredEntries = createMemo(() => orderBoardPickerEntries(filterBoardPickerEntries(props.entries, query())))
  const selectedEntry = createMemo(() => filteredEntries().find((entry) => entry.id === selectedId()) ?? null)
  const visibleRows = createMemo(() => visibleBoardPickerRows(filteredEntries(), selectedId(), resultsHeight()))

  createEffect(() => {
    const entries = filteredEntries()
    const currentId = untrack(selectedId)
    if (entries.some((entry) => entry.id === currentId)) return

    setSelectedId(firstBoardPickerEntryId(entries, props.activeId))
  })

  const moveSelection = (movement: BoardPickerMovement) => {
    setSelectedId(moveBoardPickerSelection(filteredEntries(), selectedId(), movement, Math.max(1, resultsHeight() - 1)))
  }

  const select = (entry: BoardPickerEntry | null) => {
    if (entry && !boardPickerUnavailableReason(entry)) props.onSelect(entry)
  }

  const consumeKey = (key: { preventDefault: () => void; stopPropagation: () => void }) => {
    key.preventDefault()
    key.stopPropagation()
  }

  useKeyboard((key) => {
    if (key.name === "escape") {
      consumeKey(key)
      props.onClose()
      return
    }
    if (key.name === "enter" || key.name === "return") {
      consumeKey(key)
      select(selectedEntry())
      return
    }
    if (key.name === "down" || (key.ctrl && key.name === "n") || (key.name === "tab" && !key.shift)) {
      consumeKey(key)
      moveSelection("next")
      return
    }
    if (key.name === "up" || (key.ctrl && key.name === "p") || (key.name === "tab" && key.shift)) {
      consumeKey(key)
      moveSelection("previous")
      return
    }
    if (key.name === "home") {
      consumeKey(key)
      moveSelection("first")
      return
    }
    if (key.name === "end") {
      consumeKey(key)
      moveSelection("last")
      return
    }
    if (key.name === "pagedown" || key.name === "page_down") {
      consumeKey(key)
      moveSelection("page-next")
      return
    }
    if (key.name === "pageup" || key.name === "page_up") {
      consumeKey(key)
      moveSelection("page-previous")
    }
  })

  const scroll = (event: MouseEvent) => {
    if (!event.scroll) return
    if (event.scroll.direction === "down") moveSelection("next")
    if (event.scroll.direction === "up") moveSelection("previous")
    event.stopPropagation()
  }

  const selectedDescription = createMemo(() => {
    const entry = selectedEntry()
    if (!entry) return query() ? "No boards match this search." : "No boards are available."
    const unavailableReason = boardPickerUnavailableReason(entry)
    if (unavailableReason) return `Unavailable · ${unavailableReason}`
    const context = entry.subtitle ?? boardPickerGroupLabels[entry.kind].toLocaleLowerCase()
    if (entry.id === props.activeId) return `${context} · current board`
    return context
  })

  return (
    <>
      <box
        position="absolute"
        left={0}
        top={0}
        width={props.screenWidth}
        height={props.screenHeight}
        zIndex={90}
        backgroundColor={colors.scrim}
        onMouseDown={(event) => {
          event.stopPropagation()
          props.onClose()
        }}
      />
      <box
        position="absolute"
        left={Math.max(1, Math.floor((props.screenWidth - width()) / 2))}
        top={Math.max(1, Math.floor((props.screenHeight - height()) / 2))}
        width={width()}
        height={height()}
        zIndex={100}
        border
        borderStyle="single"
        borderColor={colors.borderActive}
        backgroundColor={colors.panel}
        padding={1}
        flexDirection="column"
        title={` ${props.title ?? "Switch board"} `}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <box height={1} flexDirection="row" backgroundColor={colors.panelRaised}>
          <text fg={colors.active}>{" ⌕ "}</text>
          <input
            flexGrow={1}
            value={query()}
            focused
            placeholder={props.screenWidth < 64 ? "Search boards" : "Search smart views, GitLab boards, and epics"}
            backgroundColor={colors.panelRaised}
            focusedBackgroundColor={colors.panelRaised}
            textColor={colors.text}
            focusedTextColor={colors.text}
            placeholderColor={colors.subtle}
            onInput={setQuery}
          />
          <Show when={query()}>
            <text fg={colors.muted} onMouseDown={() => setQuery("")}>
              {" × "}
            </text>
          </Show>
        </box>
        <text fg={colors.border}>{"─".repeat(contentWidth())}</text>
        <box height={resultsHeight()} flexDirection="column" onMouseScroll={scroll}>
          <Show
            when={visibleRows().length > 0}
            fallback={
              <box height={resultsHeight()} paddingLeft={1} flexDirection="column" justifyContent="center">
                <text fg={colors.text}>No matching boards</text>
                <text fg={colors.muted}>Edit the search or press esc.</text>
              </box>
            }
          >
            <For each={visibleRows()}>
              {(row) => {
                if (row.type === "group")
                  return (
                    <text fg={kindColor[row.kind]} attributes={TextAttributes.BOLD}>
                      {` ${boardPickerGroupLabels[row.kind]}`}
                    </text>
                  )

                const unavailableReason = boardPickerUnavailableReason(row.entry)
                const selected = () => row.entry.id === selectedId()
                return (
                  <box
                    height={1}
                    paddingRight={1}
                    flexDirection="row"
                    backgroundColor={
                      selected() ? colors.selected : unavailableReason ? colors.panel : colors.background
                    }
                    onMouseDown={() => {
                      setSelectedId(row.entry.id)
                      select(row.entry)
                    }}
                    onMouseOver={() => setSelectedId(row.entry.id)}
                  >
                    <text
                      flexGrow={1}
                      fg={unavailableReason ? colors.subtle : colors.text}
                      attributes={selected() ? TextAttributes.BOLD : 0}
                      wrapMode="none"
                      truncate
                    >
                      <StyledSpan fg={selected() ? colors.accent : colors.border}>{selected() ? "▌" : " "}</StyledSpan>
                      <StyledSpan fg={unavailableReason ? colors.subtle : kindColor[row.entry.kind]}>
                        {` ${kindIcon[row.entry.kind]} `}
                      </StyledSpan>
                      {ellipsis(row.entry.title, Math.max(4, contentWidth() - 12))}
                    </text>
                    <Show when={row.entry.badge}>
                      {(badge) => <text fg={colors.muted}>{` ${ellipsis(badge(), 8)} `}</text>}
                    </Show>
                    <Show when={unavailableReason}>
                      <text fg={colors.warning}> ×</text>
                    </Show>
                    <Show when={row.entry.id === props.activeId}>
                      <text fg={colors.success}>●</text>
                    </Show>
                  </box>
                )
              }}
            </For>
          </Show>
        </box>
        <Show when={notice()}>
          {(message) => (
            <text width={contentWidth()} fg={colors.warning} wrapMode="none" truncate>
              {ellipsis(`◌ Some sources unavailable · ${message()}`, contentWidth())}
            </text>
          )}
        </Show>
        <text width={contentWidth()} fg={colors.muted} wrapMode="none" truncate>
          {ellipsis(selectedDescription(), contentWidth())}
        </text>
        <text width={contentWidth()} fg={colors.subtle} wrapMode="none" truncate>
          {props.screenWidth < 64
            ? "↑↓ move · enter open · esc close"
            : "↑↓ move · pgup/pgdn page · enter open · esc close"}
        </text>
      </box>
    </>
  )
}
