import { TextAttributes } from "@opentui/core"
import { colors } from "../theme.ts"

export const CreateWorkItemModal = ({
  screenWidth,
  screenHeight,
  project,
  title,
  field,
  busy,
  onProjectChange,
  onTitleChange,
  onFieldChange,
  onSubmit,
  onClose,
}: {
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
}) => {
  const width = Math.min(72, Math.max(24, screenWidth - 4))
  const height = 12
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
      title=" Create work item "
    >
      <text fg={colors.text} attributes={TextAttributes.BOLD}>
        Create a GitLab work item
      </text>
      <text fg={colors.muted}>Choose a project and give the work a clear title.</text>
      <box height={1} />
      <text fg={field === "project" ? colors.active : colors.muted}>Project path</text>
      <input
        value={project}
        focused={field === "project"}
        placeholder="group/project"
        backgroundColor={colors.panelRaised}
        focusedBackgroundColor={colors.selected}
        textColor={colors.text}
        focusedTextColor={colors.text}
        placeholderColor={colors.muted}
        onMouseDown={() => onFieldChange("project")}
        onInput={onProjectChange}
        onSubmit={() => onFieldChange("title")}
      />
      <text fg={field === "title" ? colors.active : colors.muted}>Title</text>
      <input
        value={title}
        focused={field === "title"}
        placeholder="What needs to change?"
        backgroundColor={colors.panelRaised}
        focusedBackgroundColor={colors.selected}
        textColor={colors.text}
        focusedTextColor={colors.text}
        placeholderColor={colors.muted}
        onMouseDown={() => onFieldChange("title")}
        onInput={onTitleChange}
        onSubmit={onSubmit}
      />
      <box height={1} />
      <box flexDirection="row" justifyContent="space-between">
        <text fg={colors.muted} onMouseDown={onClose}>
          esc Cancel
        </text>
        <text
          fg={busy ? colors.muted : colors.text}
          bg={busy ? colors.border : colors.confirm}
          attributes={TextAttributes.BOLD}
          onMouseDown={() => {
            if (!busy) onSubmit()
          }}
        >
          {busy ? " Creating… " : " + Create work item "}
        </text>
      </box>
    </box>
  )
}
