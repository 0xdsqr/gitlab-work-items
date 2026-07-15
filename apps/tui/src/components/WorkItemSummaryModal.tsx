import { relativeAge, type WorkItem } from "@github-work-items/domain"
import { TextAttributes } from "@opentui/core"
import { colors, ellipsis, typeColor, workItemTypeIcon } from "../theme.ts"
import { LabelChips } from "./LabelChips.tsx"

export const WorkItemSummaryModal = ({
  screenWidth,
  screenHeight,
  item,
  pending,
  onOpen,
  onToggleState,
  onClose,
}: {
  screenWidth: number
  screenHeight: number
  item: WorkItem
  pending: boolean
  onOpen: () => void
  onToggleState: () => void
  onClose: () => void
}) => {
  const width = Math.min(78, Math.max(28, screenWidth - 4))
  const height = Math.min(17, Math.max(13, screenHeight - 4))
  const contentWidth = Math.max(20, width - 4)

  return (
    <box
      position="absolute"
      left={Math.max(1, Math.floor((screenWidth - width) / 2))}
      top={Math.max(1, Math.floor((screenHeight - height) / 2))}
      width={width}
      height={height}
      zIndex={100}
      border
      borderStyle="single"
      borderColor={colors.borderActive}
      backgroundColor={colors.panel}
      padding={1}
      flexDirection="column"
      title=" Work item summary "
    >
      <text fg={colors.text} attributes={TextAttributes.BOLD}>
        {ellipsis(item.title, contentWidth)}
      </text>
      <text fg={colors.muted}>
        <span fg={typeColor(item)}>{`${workItemTypeIcon(item)} ${item.type.toLowerCase()}`}</span>
        <span fg={item.state === "OPEN" ? colors.active : colors.success}>{`  ${item.state.toLowerCase()}`}</span>
        {`  ·  ${item.reference}  ·  updated ${relativeAge(item.updatedAt)} ago`}
      </text>
      <text>
        <LabelChips labels={item.labels} width={contentWidth} />
      </text>
      <text fg={colors.border}>{"─".repeat(contentWidth)}</text>
      <text fg={colors.text}>{ellipsis(item.description || "No description.", contentWidth)}</text>
      <box height={1} />
      <text fg={colors.muted}>{`Project    ${ellipsis(item.namespace, Math.max(8, contentWidth - 11))}`}</text>
      <text fg={colors.muted}>{`Author     @${item.author}`}</text>
      <text fg={colors.muted}>{`Assignees  ${item.assignees.map((name) => `@${name}`).join(", ") || "none"}`}</text>
      <box flexGrow={1} />
      <box height={1} flexDirection="row" justifyContent="space-between">
        <text fg={colors.muted} onMouseDown={onClose}>
          esc/enter Return to board
        </text>
        <box height={1} flexDirection="row">
          <text fg={colors.active} onMouseDown={onOpen}>
            {" o Open in GitLab "}
          </text>
          <text
            fg={pending ? colors.muted : item.state === "OPEN" ? colors.error : colors.success}
            onMouseDown={onToggleState}
          >
            {pending ? " syncing… " : ` x ${item.state === "OPEN" ? "Close" : "Reopen"} `}
          </text>
        </box>
      </box>
    </box>
  )
}
