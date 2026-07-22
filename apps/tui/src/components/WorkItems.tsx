import { relativeAge, type WorkItem } from "@gitlab-work-items/domain"
import { TextAttributes, type MouseEvent } from "@opentui/core"
import { createMemo, createSignal, For, Show } from "solid-js"
import { cellWidth, colors, ellipsis, typeColor, workItemTypeIcon } from "../theme.ts"
import { nextWorkItemStateFilter, visibleWindowStart, type WorkItemStateFilter } from "../ui-state.ts"
import { LabelChips } from "./LabelChips.tsx"
import { StyledSpan } from "./StyledSpan.tsx"

const Separator = (props: { height: number }) => (
  <box width={1} height={props.height} flexDirection="column">
    <For each={Array.from({ length: props.height })}>{() => <text fg={colors.border}>│</text>}</For>
  </box>
)

type WorkItemsProps = {
  width: number
  height: number
  items: readonly WorkItem[]
  allItems: readonly WorkItem[]
  filter: WorkItemStateFilter
  query: string
  queryEditing: boolean
  selectedIndex: number
  onSelect: (index: number) => void
  onFilterChange: (filter: WorkItemStateFilter) => void
  onQueryChange: (query: string) => void
  onQueryEditingChange: (editing: boolean) => void
  onCreate: () => void
}

export const WorkItems = (props: WorkItemsProps) => {
  const [createHovered, setCreateHovered] = createSignal(false)
  const [hoveredIndex, setHoveredIndex] = createSignal<number | null>(null)
  const statusCount = createMemo(() =>
    props.filter === "all"
      ? props.allItems.length
      : props.allItems.filter((item) => item.state === props.filter.toUpperCase()).length,
  )
  const bodyHeight = createMemo(() => Math.max(4, props.height - 3))
  const showDetail = createMemo(() => props.width >= 92 && props.height >= 16)
  const listWidth = createMemo(() => (showDetail() ? Math.max(42, Math.floor(props.width * 0.58)) : props.width))
  const detailWidth = createMemo(() => Math.max(1, props.width - listWidth() - 1))
  const descriptionHeight = createMemo(() => Math.min(4, Math.max(1, bodyHeight() - 11)))
  const capacity = createMemo(() => Math.max(1, Math.floor(bodyHeight() / 2)))
  const start = createMemo(() => visibleWindowStart(props.items.length, capacity(), props.selectedIndex))
  const visibleItems = createMemo(() => props.items.slice(start(), start() + capacity()))
  const selected = createMemo(() => props.items[props.selectedIndex] ?? null)

  const scroll = (event: MouseEvent) => {
    if (!event.scroll || props.items.length === 0) return
    const direction = event.scroll.direction === "down" ? 1 : event.scroll.direction === "up" ? -1 : 0
    if (direction === 0) return
    props.onSelect(Math.max(0, Math.min(props.items.length - 1, props.selectedIndex + direction)))
    event.stopPropagation()
  }

  return (
    <box width={props.width} height={props.height} flexDirection="column">
      <box height={1} paddingLeft={1} paddingRight={1} flexDirection="row" justifyContent="space-between">
        <text fg={colors.text} attributes={TextAttributes.BOLD}>
          Work items
        </text>
        <text
          fg={colors.text}
          bg={createHovered() ? colors.accentStrong : colors.confirm}
          attributes={TextAttributes.BOLD}
          onMouseDown={props.onCreate}
          onMouseOver={() => setCreateHovered(true)}
          onMouseOut={() => setCreateHovered(false)}
        >
          {props.width >= 58 ? " + Create work item " : " + New "}
        </text>
      </box>
      <box height={1} paddingLeft={1} paddingRight={1} flexDirection="row" backgroundColor={colors.panel}>
        <text fg={colors.active}>⌕ </text>
        <text
          fg={colors.text}
          bg={colors.selected}
          attributes={TextAttributes.BOLD}
          onMouseDown={() => props.onFilterChange(nextWorkItemStateFilter(props.filter))}
        >
          {` status:${props.filter} `}
        </text>
        <text fg={colors.border}> │ </text>
        <Show
          when={props.queryEditing}
          fallback={
            <text
              flexGrow={1}
              fg={props.query ? colors.text : colors.subtle}
              wrapMode="none"
              truncate
              onMouseDown={() => props.onQueryEditingChange(true)}
            >
              {props.query || "/ Search work items"}
            </text>
          }
        >
          <input
            flexGrow={1}
            value={props.query}
            focused
            placeholder="Search"
            backgroundColor={colors.panelRaised}
            focusedBackgroundColor={colors.panelRaised}
            textColor={colors.text}
            focusedTextColor={colors.text}
            placeholderColor={colors.subtle}
            onInput={props.onQueryChange}
            onSubmit={() => props.onQueryEditingChange(false)}
          />
        </Show>
        <Show when={props.query}>
          <text fg={colors.muted} onMouseDown={() => props.onQueryChange("")}>
            {" × "}
          </text>
        </Show>
        <text fg={colors.subtle}>{`${props.items.length}/${statusCount()}`}</text>
      </box>
      <text fg={colors.border}>{"─".repeat(Math.max(1, props.width))}</text>

      <box height={bodyHeight()} flexDirection="row">
        <box width={listWidth()} height={bodyHeight()} flexDirection="column" onMouseScroll={scroll}>
          <Show
            when={props.items.length > 0}
            fallback={
              <box height={3} paddingLeft={1} flexDirection="column" justifyContent="center">
                <text fg={colors.text}>
                  {props.query
                    ? "No work items match this search."
                    : `No ${props.filter === "all" ? "" : `${props.filter} `}work items.`}
                </text>
                <text fg={colors.muted}>
                  {props.query ? "Press / to edit or clear the search." : "Press f to change status."}
                </text>
              </box>
            }
          >
            <For each={visibleItems()}>
              {(item, localIndex) => {
                const index = () => start() + localIndex()
                const active = () => index() === props.selectedIndex
                const innerWidth = () => Math.max(8, listWidth() - 2)
                const age = () => relativeAge(item.updatedAt)
                const titleWidth = () => Math.max(4, innerWidth() - cellWidth(age()) - 5)
                const reference = () =>
                  ellipsis(item.reference, Math.min(18, Math.max(8, Math.floor(innerWidth() * 0.32))))
                const people = () =>
                  ellipsis(
                    item.assignees.map((name) => `@${name}`).join(" ") || `@${item.author}`,
                    Math.min(16, Math.max(6, Math.floor(innerWidth() * 0.25))),
                  )
                const labelWidth = () => Math.max(0, innerWidth() - cellWidth(reference()) - cellWidth(people()) - 7)
                return (
                  <box
                    height={2}
                    paddingLeft={1}
                    paddingRight={1}
                    backgroundColor={
                      active() ? colors.selected : hoveredIndex() === index() ? colors.panel : colors.background
                    }
                    onMouseDown={() => props.onSelect(index())}
                    onMouseOver={() => setHoveredIndex(index())}
                    onMouseOut={() => setHoveredIndex((current) => (current === index() ? null : current))}
                    flexDirection="column"
                  >
                    <text fg={colors.text} attributes={active() ? TextAttributes.BOLD : 0}>
                      <StyledSpan fg={active() ? colors.accent : colors.border}>{active() ? "▌" : " "}</StyledSpan>
                      <StyledSpan fg={typeColor(item)}>{workItemTypeIcon(item)}</StyledSpan>
                      {` ${ellipsis(item.title, titleWidth())}`}
                      <StyledSpan fg={colors.subtle}>{`  ${age()}`}</StyledSpan>
                    </text>
                    <text selectable={false}>
                      <StyledSpan fg={colors.active}>{`  ${reference()}`}</StyledSpan>
                      <StyledSpan fg={colors.subtle}> · </StyledSpan>
                      <StyledSpan fg={colors.muted}>{`${people()}  `}</StyledSpan>
                      <LabelChips labels={item.labels} width={labelWidth()} />
                    </text>
                  </box>
                )
              }}
            </For>
          </Show>
        </box>

        <Show when={showDetail()}>
          <Separator height={bodyHeight()} />
          <box width={detailWidth()} height={bodyHeight()} paddingLeft={1} paddingRight={1} flexDirection="column">
            <text fg={colors.muted} attributes={TextAttributes.BOLD}>
              WORK ITEM
            </text>
            <Show when={selected()} fallback={<text fg={colors.muted}>Select a work item to inspect it.</text>}>
              {(item) => (
                <>
                  <text fg={colors.text} attributes={TextAttributes.BOLD}>
                    {ellipsis(item().title, Math.max(10, detailWidth() - 2))}
                  </text>
                  <text fg={colors.muted} width={Math.max(1, detailWidth() - 2)} wrapMode="none" truncate>
                    <StyledSpan fg={typeColor(item())}>
                      {`${workItemTypeIcon(item())} ${item().type.toLowerCase()}`}
                    </StyledSpan>
                    <StyledSpan fg={item().state === "OPEN" ? colors.active : colors.success}>
                      {`  ${item().state.toLowerCase()}`}
                    </StyledSpan>
                    {`  ·  ${item().reference}  ·  updated ${relativeAge(item().updatedAt)} ago`}
                  </text>
                  <text>
                    <LabelChips labels={item().labels} width={Math.max(8, detailWidth() - 2)} />
                  </text>
                  <text fg={colors.border}>{"─".repeat(Math.max(1, detailWidth() - 2))}</text>
                  <text
                    fg={colors.text}
                    width={Math.max(1, detailWidth() - 2)}
                    height={descriptionHeight()}
                    wrapMode="word"
                    truncate
                  >
                    {item().description || "No description."}
                  </text>
                  <box height={1} />
                  <text fg={colors.muted} wrapMode="none" truncate>
                    {`Project    ${ellipsis(item().namespace, Math.max(6, detailWidth() - 13))}`}
                  </text>
                  <text fg={colors.muted} wrapMode="none" truncate>
                    {`Author     ${ellipsis(`@${item().author}`, Math.max(6, detailWidth() - 13))}`}
                  </text>
                  <text fg={colors.muted}>
                    {`Assignees  ${ellipsis(
                      item()
                        .assignees.map((name) => `@${name}`)
                        .join(", ") || "none",
                      Math.max(6, detailWidth() - 13),
                    )}`}
                  </text>
                  <box flexGrow={1} />
                  <text fg={colors.active}>o Open in GitLab</text>
                  <text fg={item().state === "OPEN" ? colors.error : colors.success}>
                    {`x  ${item().state === "OPEN" ? "Close" : "Reopen"} work item`}
                  </text>
                </>
              )}
            </Show>
          </box>
        </Show>
      </box>
    </box>
  )
}
