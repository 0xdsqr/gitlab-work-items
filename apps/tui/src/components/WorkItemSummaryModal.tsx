import { relativeAge, type WorkItem } from "@gitlab-work-items/domain"
import { TextAttributes } from "@opentui/core"
import { createMemo, Show } from "solid-js"
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
  const compact = createMemo(() => props.screenWidth < 64 || props.screenHeight < 21)
  const width = createMemo(() => Math.min(78, Math.max(28, props.screenWidth - 4)))
  const height = createMemo(() => Math.min(17, Math.max(12, props.screenHeight - 2)))
  const contentWidth = createMemo(() => Math.max(20, width() - 4))
  const innerHeight = createMemo(() => Math.max(1, height() - 4))
  const descriptionHeight = createMemo(() =>
    compact() ? Math.min(3, Math.max(1, innerHeight() - 7)) : Math.min(4, Math.max(1, innerHeight() - 9)),
  )

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
        title=" Work item "
        onMouseDown={(event) => event.stopPropagation()}
      >
        <text width={contentWidth()} fg={colors.text} attributes={TextAttributes.BOLD} wrapMode="none" truncate>
          {ellipsis(props.item.title, contentWidth())}
        </text>
        <text fg={colors.muted} width={contentWidth()} wrapMode="none" truncate>
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
        <text fg={colors.text} width={contentWidth()} height={descriptionHeight()} wrapMode="word" truncate>
          {props.item.description || "No description."}
        </text>
        <Show
          when={compact()}
          fallback={
            <>
              <box height={1} />
              <text
                fg={colors.muted}
              >{`Project    ${ellipsis(props.item.namespace, Math.max(8, contentWidth() - 11))}`}</text>
              <text
                fg={colors.muted}
              >{`Author     ${ellipsis(`@${props.item.author}`, Math.max(8, contentWidth() - 11))}`}</text>
              <text fg={colors.muted}>
                {`Assignees  ${ellipsis(
                  props.item.assignees.map((name) => `@${name}`).join(", ") || "none",
                  Math.max(8, contentWidth() - 11),
                )}`}
              </text>
            </>
          }
        >
          <text width={contentWidth()} fg={colors.muted} wrapMode="none" truncate>
            {`Project  ${ellipsis(props.item.namespace, Math.max(8, contentWidth() - 9))}`}
          </text>
          <text width={contentWidth()} fg={colors.muted} wrapMode="none" truncate>
            {ellipsis(
              `By @${props.item.author}  ·  To ${props.item.assignees.map((name) => `@${name}`).join(", ") || "none"}`,
              contentWidth(),
            )}
          </text>
        </Show>
        <box flexGrow={1} />
        <box height={1} flexDirection="row" justifyContent="space-between">
          <text fg={colors.muted} onMouseDown={props.onClose}>
            {compact() ? "esc Back" : "esc/enter Return"}
          </text>
          <box height={1} flexDirection="row">
            <text fg={colors.active} bg={colors.panelRaised} onMouseDown={props.onOpen}>
              {compact() ? " o Open " : " o Open in GitLab "}
            </text>
            <text
              fg={props.pending ? colors.muted : props.item.state === "OPEN" ? colors.error : colors.success}
              bg={colors.panelRaised}
              onMouseDown={props.onToggleState}
            >
              {props.pending ? " syncing… " : ` x ${props.item.state === "OPEN" ? "Close" : "Reopen"} `}
            </text>
          </box>
        </box>
      </box>
    </>
  )
}
