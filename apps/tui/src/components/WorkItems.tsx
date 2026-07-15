import { relativeAge, type WorkItem } from "@github-work-items/domain"
import { TextAttributes, type MouseEvent } from "@opentui/core"
import { useState } from "react"
import { colors, ellipsis, typeColor } from "../theme.ts"
import { visibleWindowStart, workItemStateFilters, type WorkItemStateFilter } from "../ui-state.ts"
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

const filterLabel = (filter: WorkItemStateFilter) => `${filter[0]?.toUpperCase()}${filter.slice(1)}`

export const WorkItems = ({
  width,
  height,
  items,
  allItems,
  filter,
  selectedIndex,
  onSelect,
  onFilterChange,
  onCreate,
}: {
  width: number
  height: number
  items: readonly WorkItem[]
  allItems: readonly WorkItem[]
  filter: WorkItemStateFilter
  selectedIndex: number
  onSelect: (index: number) => void
  onFilterChange: (filter: WorkItemStateFilter) => void
  onCreate: () => void
}) => {
  const [createHovered, setCreateHovered] = useState(false)
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null)
  const counts = {
    open: allItems.filter((item) => item.state === "OPEN").length,
    closed: allItems.filter((item) => item.state === "CLOSED").length,
    all: allItems.length,
  }
  const bodyHeight = Math.max(4, height - 3)
  const listWidth = width >= 92 ? Math.max(42, Math.floor(width * 0.58)) : width
  const detailWidth = Math.max(1, width - listWidth - 1)
  const capacity = Math.max(1, Math.floor((bodyHeight - 1) / 2))
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
          Work items <span fg={colors.subtle}>· {filterLabel(filter).toLowerCase()}</span>
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
      <box height={1} paddingLeft={1} flexDirection="row">
        <text fg={colors.subtle}>Status </text>
        {workItemStateFilters.map((candidate) => {
          const active = candidate === filter
          return (
            <text
              key={candidate}
              fg={active ? colors.text : colors.muted}
              bg={active ? colors.selected : colors.background}
              attributes={active ? TextAttributes.BOLD : 0}
              onMouseDown={() => onFilterChange(candidate)}
            >
              {` ${active ? "● " : ""}${filterLabel(candidate)} ${counts[candidate]} `}
            </text>
          )
        })}
        <text fg={colors.subtle}> f cycles</text>
      </box>
      <text fg={colors.border}>{"─".repeat(Math.max(1, width))}</text>

      <box height={bodyHeight} flexDirection="row">
        <box width={listWidth} height={bodyHeight} flexDirection="column" onMouseScroll={scroll}>
          <box height={1} paddingLeft={1} paddingRight={1} flexDirection="row" justifyContent="space-between">
            <text fg={colors.muted} attributes={TextAttributes.BOLD}>
              WORK ITEMS
            </text>
            <text fg={colors.subtle}>
              {items.length === 0
                ? "0 items"
                : `${start + 1}–${Math.min(items.length, start + capacity)} of ${items.length}`}
            </text>
          </box>
          {items.length === 0 ? (
            <box height={3} paddingLeft={1} flexDirection="column" justifyContent="center">
              <text fg={colors.text}>{`No ${filter === "all" ? "" : `${filter} `}work items in this scope.`}</text>
              <text fg={colors.muted}>Change the status filter with f, create an item, or switch scope with tab.</text>
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
                    <span fg={typeColor(item)}>{item.state === "CLOSED" ? "×" : item.type === "EPIC" ? "◆" : "⊙"}</span>
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
                    <span fg={typeColor(selected)}>{selected.type.toLowerCase()}</span>
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
