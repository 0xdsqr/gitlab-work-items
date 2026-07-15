import { relativeAge, type WorkItem } from "@github-work-items/domain"
import { TextAttributes, type MouseEvent } from "@opentui/core"
import { useState } from "react"
import { colors, ellipsis, typeColor } from "../theme.ts"
import { visibleWindowStart } from "../ui-state.ts"
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

export const Overview = ({
  width,
  height,
  items,
  selectedIndex,
  onSelect,
  onCreate,
}: {
  width: number
  height: number
  items: readonly WorkItem[]
  selectedIndex: number
  onSelect: (index: number) => void
  onCreate: () => void
}) => {
  const [createHovered, setCreateHovered] = useState(false)
  const open = items.filter((item) => item.state === "OPEN")
  const closed = items.length - open.length
  const doing = open.filter((item) =>
    item.labels.some((label) => ["workflow::in progress", "workflow::doing"].includes(label.toLowerCase())),
  ).length
  const review = open.filter((item) => item.labels.some((label) => label.toLowerCase().includes("review"))).length
  const bodyHeight = Math.max(4, height - 3)
  const listWidth = width >= 92 ? Math.max(42, Math.floor(width * 0.58)) : width
  const detailWidth = Math.max(1, width - listWidth - 1)
  const capacity = Math.max(1, Math.floor((bodyHeight - 1) / 3))
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
          My work <span fg={colors.subtle}>· updated activity</span>
        </text>
        <text
          fg={colors.text}
          bg={createHovered ? colors.success : colors.confirm}
          attributes={TextAttributes.BOLD}
          onMouseDown={onCreate}
          onMouseOver={() => setCreateHovered(true)}
          onMouseOut={() => setCreateHovered(false)}
        >
          {" + Create work item "}
        </text>
      </box>
      <box height={1} paddingLeft={1}>
        <text fg={colors.muted}>
          <span fg={colors.active}>{open.length}</span> open
          <span fg={colors.border}> │ </span>
          <span fg={colors.warning}>{doing}</span> in progress
          <span fg={colors.border}> │ </span>
          <span fg={colors.accent}>{review}</span> in review
          <span fg={colors.border}> │ </span>
          <span fg={colors.success}>{closed}</span> closed
        </text>
      </box>
      <text fg={colors.border}>{"─".repeat(Math.max(1, width))}</text>

      <box height={bodyHeight} flexDirection="row">
        <box width={listWidth} height={bodyHeight} flexDirection="column" onMouseScroll={scroll}>
          <box height={1} paddingLeft={1} paddingRight={1} flexDirection="row" justifyContent="space-between">
            <text fg={colors.muted} attributes={TextAttributes.BOLD}>
              RECENT WORK
            </text>
            <text fg={colors.subtle}>
              {items.length === 0
                ? "0 items"
                : `${start + 1}–${Math.min(items.length, start + capacity)} of ${items.length}`}
            </text>
          </box>
          {items.length === 0 ? (
            <box height={3} paddingLeft={1} flexDirection="column" justifyContent="center">
              <text fg={colors.text}>Nothing in this scope yet.</text>
              <text fg={colors.muted}>Create an item or switch scope with tab.</text>
            </box>
          ) : (
            items.slice(start, start + capacity).map((item, localIndex) => {
              const index = start + localIndex
              const active = index === selectedIndex
              return (
                <box
                  key={item.id}
                  height={3}
                  paddingLeft={1}
                  paddingRight={1}
                  backgroundColor={active ? colors.selected : colors.background}
                  onMouseDown={() => onSelect(index)}
                  flexDirection="column"
                >
                  <text fg={colors.text} attributes={active ? TextAttributes.BOLD : 0}>
                    <span fg={active ? colors.accent : colors.border}>{active ? "▌" : " "}</span>
                    <span fg={typeColor(item)}>{` ${item.type.toLowerCase()} `}</span>
                    {ellipsis(item.title, Math.max(8, listWidth - 20))}
                  </text>
                  <text
                    fg={colors.muted}
                  >{`${ellipsis(item.reference, Math.max(8, listWidth - 16))}  ·  ${relativeAge(item.updatedAt)}`}</text>
                  <text>
                    <LabelChips labels={item.labels} width={Math.max(8, listWidth - 4)} />
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
                  <text fg={typeColor(selected)}>{`${selected.type.toLowerCase()}  ${selected.reference}`}</text>
                  <text fg={colors.text} attributes={TextAttributes.BOLD}>
                    {ellipsis(selected.title, Math.max(10, detailWidth - 2))}
                  </text>
                  <text
                    fg={colors.muted}
                  >{`${selected.namespace}  ·  updated ${relativeAge(selected.updatedAt)} ago`}</text>
                  <box height={1} />
                  <text fg={colors.text}>
                    {ellipsis(selected.description || "No description.", Math.max(10, detailWidth - 2))}
                  </text>
                  <box height={1} />
                  <text fg={colors.muted}>{`Author     @${selected.author}`}</text>
                  <text
                    fg={colors.muted}
                  >{`Assignees  ${selected.assignees.map((name) => `@${name}`).join(", ") || "none"}`}</text>
                  <box height={1} />
                  <text>
                    <LabelChips labels={selected.labels} width={Math.max(8, detailWidth - 2)} />
                  </text>
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
