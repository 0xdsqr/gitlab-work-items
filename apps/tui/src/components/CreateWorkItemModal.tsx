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
  const width = Math.max(42, Math.min(72, screenWidth - 6))
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
      borderStyle="double"
      borderColor={colors.accent}
      backgroundColor={colors.panelRaised}
      padding={1}
      flexDirection="column"
      title=" Create work item "
    >
      <text fg={colors.text} attributes={TextAttributes.BOLD}>
        Start with a clear, useful title.
      </text>
      <text fg={colors.muted}>The issue is created in GitLab immediately.</text>
      <box height={1} />
      <text fg={field === "project" ? colors.accent : colors.muted}>Project path</text>
      <input
        value={project}
        focused={field === "project"}
        placeholder="group/project"
        backgroundColor={colors.panelSoft}
        focusedBackgroundColor={colors.selected}
        textColor={colors.text}
        focusedTextColor={colors.text}
        placeholderColor={colors.muted}
        onMouseDown={() => onFieldChange("project")}
        onInput={onProjectChange}
        onSubmit={() => onFieldChange("title")}
      />
      <text fg={field === "title" ? colors.accent : colors.muted}>Title</text>
      <input
        value={title}
        focused={field === "title"}
        placeholder="What needs to change?"
        backgroundColor={colors.panelSoft}
        focusedBackgroundColor={colors.selected}
        textColor={colors.text}
        focusedTextColor={colors.text}
        placeholderColor={colors.muted}
        onMouseDown={() => onFieldChange("title")}
        onInput={onTitleChange}
        onSubmit={onSubmit}
      />
      <box height={1} />
      <box justifyContent="space-between">
        <text fg={colors.muted} onMouseDown={onClose}>
          esc Cancel
        </text>
        <text
          fg={busy ? colors.muted : colors.background}
          bg={busy ? colors.border : colors.gitlab}
          attributes={TextAttributes.BOLD}
          onMouseDown={() => {
            if (!busy) onSubmit()
          }}
        >
          {busy ? " Creating… " : " enter  Create "}
        </text>
      </box>
    </box>
  )
}
