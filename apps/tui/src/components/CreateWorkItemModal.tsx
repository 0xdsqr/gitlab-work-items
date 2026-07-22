import { TextAttributes } from "@opentui/core"
import { createMemo } from "solid-js"
import { colors } from "../theme.ts"

type CreateWorkItemModalProps = {
  screenWidth: number
  screenHeight: number
  project: string
  title: string
  field: "project" | "title"
  busy: boolean
  onProjectChange: (value: string) => void
  onTitleChange: (value: string) => void
  onFieldChange: (field: "project" | "title") => void
  onSubmit: () => void
  onClose: () => void
}

export const CreateWorkItemModal = (props: CreateWorkItemModalProps) => {
  const width = createMemo(() => Math.min(72, Math.max(24, props.screenWidth - 4)))
  const height = 12
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
          if (!props.busy) props.onClose()
        }}
      />
      <box
        position="absolute"
        left={Math.max(1, Math.floor((props.screenWidth - width()) / 2))}
        top={Math.max(1, Math.floor((props.screenHeight - height) / 2))}
        width={width()}
        height={height}
        zIndex={100}
        border
        borderStyle="single"
        borderColor={colors.borderActive}
        backgroundColor={colors.panel}
        padding={1}
        flexDirection="column"
        title=" New GitLab work item "
        onMouseDown={(event) => event.stopPropagation()}
      >
        <text fg={colors.muted}>Choose a project and give the work a clear title.</text>
        <box height={1} />
        <text fg={props.field === "project" ? colors.active : colors.muted}>
          {props.field === "project" ? "▌ " : "  "}Project path
        </text>
        <input
          value={props.project}
          focused={!props.busy && props.field === "project"}
          placeholder="group/project"
          backgroundColor={colors.panelRaised}
          focusedBackgroundColor={colors.selected}
          textColor={colors.text}
          focusedTextColor={colors.text}
          placeholderColor={colors.muted}
          onMouseDown={() => {
            if (!props.busy) props.onFieldChange("project")
          }}
          onInput={(value) => {
            if (!props.busy) props.onProjectChange(value)
          }}
          onSubmit={() => {
            if (!props.busy) props.onFieldChange("title")
          }}
        />
        <text fg={props.field === "title" ? colors.active : colors.muted}>
          {props.field === "title" ? "▌ " : "  "}Title
        </text>
        <input
          value={props.title}
          focused={!props.busy && props.field === "title"}
          placeholder="What needs to change?"
          backgroundColor={colors.panelRaised}
          focusedBackgroundColor={colors.selected}
          textColor={colors.text}
          focusedTextColor={colors.text}
          placeholderColor={colors.muted}
          onMouseDown={() => {
            if (!props.busy) props.onFieldChange("title")
          }}
          onInput={(value) => {
            if (!props.busy) props.onTitleChange(value)
          }}
          onSubmit={() => {
            if (!props.busy) props.onSubmit()
          }}
        />
        <box height={1} />
        <box flexDirection="row" justifyContent="space-between">
          <text
            fg={props.busy ? colors.subtle : colors.muted}
            onMouseDown={() => {
              if (!props.busy) props.onClose()
            }}
          >
            {props.busy ? "GitLab update in progress" : "esc Cancel"}
          </text>
          <text
            fg={props.busy ? colors.muted : colors.text}
            bg={props.busy ? colors.border : colors.confirm}
            attributes={TextAttributes.BOLD}
            onMouseDown={() => {
              if (!props.busy) props.onSubmit()
            }}
          >
            {props.busy ? " Creating… " : " + Create work item "}
          </text>
        </box>
      </box>
    </>
  )
}
