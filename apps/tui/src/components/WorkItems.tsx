import { relativeAge, type WorkItem } from "@github-work-items/domain"
import { TextAttributes, type MouseEvent } from "@opentui/core"
import { useState } from "react"
import { colors, ellipsis, typeColor, workItemTypeIcon } from "../theme.ts"
import { nextWorkItemStateFilter, visibleWindowStart, type WorkItemStateFilter } from "../ui-state.ts"
import { LabelChips } from "./LabelChips.tsx"

const Separator = ({ height }: { height: number }) => (
  <box width={1} height={height} flexDirection="column">
    {Array.from({ length: height }, (_, index) => (
      <text key={index} fg={colors.border}>
        │
      </text>
    ))}
  </box>
)

export const WorkItems = ({
  width,
  height,
  items,
  allItems,
  filter,
  query,
  queryEditing,
  selectedIndex,
  onSelect,
  onFilterChange,
  onQueryChange,
  onQueryEditingChange,
  onCreate,
}: {
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
}) => {
  const [createHovered, setCreateHovered] = useState(false)
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null)
  const statusCount =
    filter === "all" ? allItems.length : allItems.filter((item) => item.state === filter.toUpperCase()).length
  const bodyHeight = Math.max(4, height - 3)
  const listWidth = width >= 92 ? Math.max(42, Math.floor(width * 0.58)) : width
  const detailWidth = Math.max(1, width - listWidth - 1)
  const capacity = Math.max(1, Math.floor(bodyHeight / 2))
  const start = visibleWindowStart(items.length, capacity, selectedIndex)
  const selected = items[selectedIndex] ?? null

  const scroll = (event: MouseEvent) => {
    if (!event.scroll || items.length === 0) return
    const direction = event.scroll.direction === "down" ? 1 : event.scroll.direction === "up" ? -1 : 0
    if (direction === 0) return
    onSelect(Math.max(0, Math.min(items.length - 1, selectedIndex + direction)))
    event.stopPropagation()
  }

  return (
    <box width={width} height={height} flexDirection="column">
      <box height={1} paddingLeft={1} paddingRight={1} flexDirection="row" justifyContent="space-between">
        <text fg={colors.text} attributes={TextAttributes.BOLD}>
          Work items
        </text>
        <text
          fg={colors.text}
          bg={createHovered ? colors.accentStrong : colors.confirm}
          attributes={TextAttributes.BOLD}
          onMouseDown={onCreate}
          onMouseOver={() => setCreateHovered(true)}
          onMouseOut={() => setCreateHovered(false)}
        >
          {" + Create work item "}
        </text>
      </box>
      <box height={1} paddingLeft={1} paddingRight={1} flexDirection="row" backgroundColor={colors.panel}>
        <text fg={colors.active}>⌕ </text>
        <text
          fg={colors.text}
          bg={colors.selected}
          attributes={TextAttributes.BOLD}
          onMouseDown={() => onFilterChange(nextWorkItemStateFilter(filter))}
        >
          {` status:${filter} `}
        </text>
        <text fg={colors.border}> │ </text>
        {queryEditing ? (
          <input
            flexGrow={1}
            value={query}
            focused
            placeholder="Search"
            backgroundColor={colors.panelRaised}
            focusedBackgroundColor={colors.panelRaised}
            textColor={colors.text}
            focusedTextColor={colors.text}
            placeholderColor={colors.subtle}
            onInput={onQueryChange}
            onSubmit={() => onQueryEditingChange(false)}
          />
        ) : (
          <text flexGrow={1} fg={query ? colors.text : colors.subtle} onMouseDown={() => onQueryEditingChange(true)}>
            {query || "/ Search work items"}
          </text>
        )}
        {query ? (
          <text fg={colors.muted} onMouseDown={() => onQueryChange("")}>
            {" × "}
          </text>
        ) : null}
        <text fg={colors.subtle}>{`${items.length}/${statusCount}`}</text>
      </box>
      <text fg={colors.border}>{"─".repeat(Math.max(1, width))}</text>

      <box height={bodyHeight} flexDirection="row">
        <box width={listWidth} height={bodyHeight} flexDirection="column" onMouseScroll={scroll}>
          {items.length === 0 ? (
            <box height={3} paddingLeft={1} flexDirection="column" justifyContent="center">
              <text fg={colors.text}>
                {query ? "No work items match this search." : `No ${filter === "all" ? "" : `${filter} `}work items.`}
              </text>
              <text fg={colors.muted}>
                {query ? "Press / to edit or clear the search." : "Press f to change status."}
              </text>
            </box>
          ) : (
            items.slice(start, start + capacity).map((item, localIndex) => {
              const index = start + localIndex
              const active = index === selectedIndex
              return (
                <box
                  key={item.id}
                  height={2}
                  paddingLeft={1}
                  paddingRight={1}
                  backgroundColor={active ? colors.selected : hoveredIndex === index ? colors.panel : colors.background}
                  onMouseDown={() => onSelect(index)}
                  onMouseOver={() => setHoveredIndex(index)}
                  onMouseOut={() => setHoveredIndex((current) => (current === index ? null : current))}
                  flexDirection="column"
                >
                  <text fg={colors.text} attributes={active ? TextAttributes.BOLD : 0}>
                    <span fg={active ? colors.accent : colors.border}>{active ? "▌" : " "}</span>
                    <span fg={typeColor(item)}>{workItemTypeIcon(item)}</span>
                    <span fg={colors.active}>{` ${ellipsis(item.reference, 18)} `}</span>
                    {ellipsis(item.title, Math.max(8, listWidth - Math.min(18, item.reference.length) - 14))}
                    <span fg={colors.subtle}>{`  ${relativeAge(item.updatedAt)}`}</span>
                  </text>
                  <text selectable={false}>
                    <span
                      fg={colors.muted}
                    >{`  ${item.assignees.map((name) => `@${name}`).join(" ") || `@${item.author}`}  `}</span>
                    <LabelChips labels={item.labels} width={Math.max(8, listWidth - 20)} />
                  </text>
                </box>
              )
            })
          )}
        </box>

        {width >= 92 ? (
          <>
            <Separator height={bodyHeight} />
            <box width={detailWidth} height={bodyHeight} paddingLeft={1} paddingRight={1} flexDirection="column">
              <text fg={colors.muted} attributes={TextAttributes.BOLD}>
                WORK ITEM
              </text>
              {selected ? (
                <>
                  <text fg={colors.text} attributes={TextAttributes.BOLD}>
                    {ellipsis(selected.title, Math.max(10, detailWidth - 2))}
                  </text>
                  <text fg={colors.muted}>
                    <span
                      fg={typeColor(selected)}
                    >{`${workItemTypeIcon(selected)} ${selected.type.toLowerCase()}`}</span>
                    <span fg={selected.state === "OPEN" ? colors.active : colors.success}>
                      {`  ${selected.state.toLowerCase()}`}
                    </span>
                    {`  ·  ${selected.reference}  ·  updated ${relativeAge(selected.updatedAt)} ago`}
                  </text>
                  <text>
                    <LabelChips labels={selected.labels} width={Math.max(8, detailWidth - 2)} />
                  </text>
                  <text fg={colors.border}>{"─".repeat(Math.max(1, detailWidth - 2))}</text>
                  <text fg={colors.text}>
                    {ellipsis(selected.description || "No description.", Math.max(10, detailWidth - 2))}
                  </text>
                  <box height={1} />
                  <text fg={colors.muted}>{`Project    ${selected.namespace}`}</text>
                  <text fg={colors.muted}>{`Author     @${selected.author}`}</text>
                  <text
                    fg={colors.muted}
                  >{`Assignees  ${selected.assignees.map((name) => `@${name}`).join(", ") || "none"}`}</text>
                  <box height={1} />
                  <text fg={colors.active}>o Open in GitLab</text>
                  <text fg={selected.state === "OPEN" ? colors.error : colors.success}>
                    {`x  ${selected.state === "OPEN" ? "Close" : "Reopen"} work item`}
                  </text>
                </>
              ) : (
                <text fg={colors.muted}>Select a work item to inspect it.</text>
              )}
            </box>
          </>
        ) : null}
      </box>
    </box>
  )
}
