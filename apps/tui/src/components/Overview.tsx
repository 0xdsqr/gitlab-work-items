import { relativeAge, type WorkItem } from "@github-work-items/domain"
import { TextAttributes } from "@opentui/core"
import { colors, ellipsis, typeColor } from "../theme.ts"
import { LabelChips } from "./LabelChips.tsx"

const Metric = ({ label, value, color, width }: { label: string; value: number; color: string; width: number }) => (
  <box
    width={width}
    height={4}
    border
    borderStyle="single"
    borderColor={colors.border}
    backgroundColor={colors.panel}
    paddingLeft={1}
  >
    <text fg={color} attributes={TextAttributes.BOLD}>
      {String(value).padStart(2, "0")}
    </text>
    <text fg={colors.muted}>{ellipsis(label, Math.max(4, width - 4))}</text>
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
  const open = items.filter((item) => item.state === "OPEN")
  const closed = items.length - open.length
  const doing = open.filter((item) =>
    item.labels.some((label) => ["workflow::in progress", "workflow::doing"].includes(label.toLowerCase())),
  ).length
  const review = open.filter((item) => item.labels.some((label) => label.toLowerCase().includes("review"))).length
  const metricCount = width >= 76 ? 4 : 2
  const metricWidth = Math.max(14, Math.floor(width / metricCount))
  const listHeight = Math.max(5, height - 7)
  const listWidth = width >= 92 ? Math.floor(width * 0.58) : width
  const selected = items[selectedIndex] ?? null

  return (
    <box width={width} height={height} flexDirection="column">
      <box height={2} paddingLeft={1} paddingRight={1} justifyContent="space-between" alignItems="center">
        <box flexDirection="column">
          <text fg={colors.text} attributes={TextAttributes.BOLD}>
            Your work, at a glance
          </text>
          <text fg={colors.muted}>Triage the queue, then move into the board.</text>
        </box>
        <text fg={colors.background} bg={colors.gitlab} attributes={TextAttributes.BOLD} onMouseDown={onCreate}>
          {" n  Create work item "}
        </text>
      </box>

      <box height={4} flexDirection="row">
        <Metric label="Open" value={open.length} color={colors.accent} width={metricWidth} />
        <Metric label="In progress" value={doing} color="#a78bfa" width={metricWidth} />
        {metricCount === 4 ? <Metric label="In review" value={review} color="#f0abfc" width={metricWidth} /> : null}
        {metricCount === 4 ? <Metric label="Closed" value={closed} color={colors.success} width={metricWidth} /> : null}
      </box>

      <box height={listHeight} flexDirection="row">
        <box
          width={listWidth}
          height={listHeight}
          border
          borderStyle="single"
          borderColor={colors.borderActive}
          backgroundColor={colors.panel}
          title={` Recent work · ${items.length} `}
          flexDirection="column"
        >
          {items.length === 0 ? (
            <box padding={1}>
              <text fg={colors.muted}>Nothing in this scope yet.</text>
            </box>
          ) : (
            items.slice(0, Math.max(1, Math.floor((listHeight - 2) / 3))).map((item, index) => {
              const active = index === selectedIndex
              return (
                <box
                  key={item.id}
                  height={3}
                  paddingLeft={1}
                  paddingRight={1}
                  backgroundColor={active ? colors.selected : colors.panel}
                  onMouseDown={() => onSelect(index)}
                  flexDirection="column"
                >
                  <text fg={colors.text} attributes={active ? TextAttributes.BOLD : 0}>
                    <span fg={active ? colors.accent : colors.border}>{active ? "▌" : "│"}</span>
                    <span fg={typeColor(item)}>{` ${item.type.toLowerCase()} `}</span>
                    {ellipsis(item.title, Math.max(8, listWidth - 20))}
                  </text>
                  <text
                    fg={colors.muted}
                  >{`${ellipsis(item.reference, Math.max(8, listWidth - 12))} · ${relativeAge(item.updatedAt)}`}</text>
                  <text>
                    <LabelChips labels={item.labels} width={Math.max(8, listWidth - 4)} />
                  </text>
                </box>
              )
            })
          )}
        </box>

        {width >= 92 ? (
          <box
            width={Math.max(1, width - listWidth)}
            height={listHeight}
            border
            borderStyle="single"
            borderColor={colors.border}
            backgroundColor={colors.background}
            padding={1}
            flexDirection="column"
            title=" Work item "
          >
            {selected ? (
              <>
                <text
                  fg={typeColor(selected)}
                  attributes={TextAttributes.BOLD}
                >{`${selected.type.toLowerCase()}  ${selected.reference}`}</text>
                <text fg={colors.text} attributes={TextAttributes.BOLD}>
                  {selected.title}
                </text>
                <text
                  fg={colors.muted}
                >{`updated ${relativeAge(selected.updatedAt)} ago · ${selected.namespace}`}</text>
                <box height={1} />
                <text fg={colors.text}>
                  {ellipsis(selected.description || "No description.", Math.max(10, width - listWidth - 4))}
                </text>
                <box height={1} />
                <text fg={colors.muted}>{`author     @${selected.author}`}</text>
                <text
                  fg={colors.muted}
                >{`assignees  ${selected.assignees.map((name) => `@${name}`).join(", ") || "none"}`}</text>
                <box height={1} />
                <text>
                  <LabelChips labels={selected.labels} width={Math.max(8, width - listWidth - 4)} />
                </text>
                <box height={1} />
                <text fg={colors.gitlab}>o Open in GitLab</text>
                <text
                  fg={selected.state === "OPEN" ? colors.error : colors.success}
                >{`x  ${selected.state === "OPEN" ? "Close" : "Reopen"} work item`}</text>
              </>
            ) : (
              <text fg={colors.muted}>Select a work item to inspect it.</text>
            )}
          </box>
        ) : null}
      </box>
    </box>
  )
}
