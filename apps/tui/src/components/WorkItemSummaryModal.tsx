import { relativeAge, type WorkItem } from "@github-work-items/domain"
import { TextAttributes } from "@opentui/core"
import { createMemo } from "solid-js"
import { colors, ellipsis, typeColor, workItemTypeIcon } from "../theme.ts"
import { LabelChips } from "./LabelChips.tsx"
import { StyledSpan } from "./StyledSpan.tsx"

type WorkItemSummaryModalProps = {
  screenWidth: number
  screenHeight: number
  item: WorkItem
  pending: boolean
  onOpen: () => void
  onToggleState: () => void
  onClose: () => void
}

export const WorkItemSummaryModal = (props: WorkItemSummaryModalProps) => {
  const width = createMemo(() => Math.min(78, Math.max(28, props.screenWidth - 4)))
  const height = createMemo(() => Math.min(17, Math.max(13, props.screenHeight - 4)))
  const contentWidth = createMemo(() => Math.max(20, width() - 4))

  return (
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
      title=" Work item summary "
    >
      <text fg={colors.text} attributes={TextAttributes.BOLD}>
        {ellipsis(props.item.title, contentWidth())}
      </text>
      <text fg={colors.muted}>
        <StyledSpan fg={typeColor(props.item)}>
          {`${workItemTypeIcon(props.item)} ${props.item.type.toLowerCase()}`}
        </StyledSpan>
        <StyledSpan fg={props.item.state === "OPEN" ? colors.active : colors.success}>
          {`  ${props.item.state.toLowerCase()}`}
        </StyledSpan>
        {`  ·  ${props.item.reference}  ·  updated ${relativeAge(props.item.updatedAt)} ago`}
      </text>
      <text>
        <LabelChips labels={props.item.labels} width={contentWidth()} />
      </text>
      <text fg={colors.border}>{"─".repeat(contentWidth())}</text>
      <text fg={colors.text}>{ellipsis(props.item.description || "No description.", contentWidth())}</text>
      <box height={1} />
      <text fg={colors.muted}>{`Project    ${ellipsis(props.item.namespace, Math.max(8, contentWidth() - 11))}`}</text>
      <text fg={colors.muted}>{`Author     @${props.item.author}`}</text>
      <text fg={colors.muted}>
        {`Assignees  ${props.item.assignees.map((name) => `@${name}`).join(", ") || "none"}`}
      </text>
      <box flexGrow={1} />
      <box height={1} flexDirection="row" justifyContent="space-between">
        <text fg={colors.muted} onMouseDown={props.onClose}>
          esc/enter Return to board
        </text>
        <box height={1} flexDirection="row">
          <text fg={colors.active} onMouseDown={props.onOpen}>
            {" o Open in GitLab "}
          </text>
          <text
            fg={props.pending ? colors.muted : props.item.state === "OPEN" ? colors.error : colors.success}
            onMouseDown={props.onToggleState}
          >
            {props.pending ? " syncing… " : ` x ${props.item.state === "OPEN" ? "Close" : "Reopen"} `}
          </text>
        </box>
      </box>
    </box>
  )
}
