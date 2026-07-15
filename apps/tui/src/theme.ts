import type { WorkItem, WorkItemLabel } from "@github-work-items/domain"

export const colors = {
  background: "#18171d",
  panel: "#28272d",
  panelRaised: "#3a383f",
  panelSoft: "#28272d",
  border: "#4c4b51",
  borderActive: "#d99530",
  text: "#fbfafd",
  muted: "#bfbfc3",
  subtle: "#89888d",
  accent: "#d99530",
  accentStrong: "#ab6100",
  active: "#e9be74",
  confirm: "#995715",
  gitlab: "#fc6d26",
  selected: "#382315",
  success: "#52b87a",
  warning: "#e9be74",
  error: "#f6806d",
  epic: "#e9be74",
  issue: "#9dc7f1",
  task: "#91d4a8",
} as const

const labelPalette = ["#9dc7f1", "#91d4a8", "#e9be74", "#fcb5aa", "#63a6e9", "#bfbfc3"] as const

export const typeColor = (item: WorkItem) => {
  if (item.type === "EPIC") return colors.epic
  if (item.type === "TASK") return colors.task
  return colors.issue
}

const validHex = (value: string | null) => (value && /^#[\da-f]{6}$/i.test(value) ? value : null)

export const labelColor = (label: WorkItemLabel) => {
  const actual = validHex(label.color)
  if (actual) return actual
  const hash = [...label.name].reduce((value, character) => (value * 31 + character.charCodeAt(0)) >>> 0, 7)
  return labelPalette[hash % labelPalette.length] ?? labelPalette[0]
}

export const labelTextColor = (label: WorkItemLabel) => validHex(label.textColor) ?? colors.background

export const darkerLabelColor = (label: WorkItemLabel) => {
  const color = labelColor(label)
  const channels = [color.slice(1, 3), color.slice(3, 5), color.slice(5, 7)].map((channel) =>
    Math.max(0, Math.round(Number.parseInt(channel, 16) * 0.72)),
  )
  return `#${channels.map((channel) => channel.toString(16).padStart(2, "0")).join("")}`
}

export const ellipsis = (value: string, width: number) => {
  if (value.length <= width) return value
  return width <= 1 ? "…" : `${value.slice(0, width - 1)}…`
}
