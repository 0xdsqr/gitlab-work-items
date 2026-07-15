import type { WorkItem } from "@github-work-items/domain"

export const colors = {
  background: "#18171d",
  panel: "#28272d",
  panelRaised: "#3a383f",
  panelSoft: "#28272d",
  border: "#4c4b51",
  borderActive: "#7b58cf",
  text: "#fbfafd",
  muted: "#bfbfc3",
  subtle: "#89888d",
  accent: "#ac93e6",
  accentStrong: "#7b58cf",
  active: "#63a6e9",
  confirm: "#108548",
  gitlab: "#fc6d26",
  selected: "#342d59",
  success: "#52b87a",
  warning: "#e9be74",
  error: "#f6806d",
  epic: "#cbbbf2",
  issue: "#9dc7f1",
  task: "#91d4a8",
} as const

const labelPalette = ["#9dc7f1", "#91d4a8", "#e9be74", "#fcb5aa", "#cbbbf2", "#bfbfc3"] as const

export const typeColor = (item: WorkItem) => {
  if (item.type === "EPIC") return colors.epic
  if (item.type === "TASK") return colors.task
  return colors.issue
}

export const labelColor = (label: string) => {
  const hash = [...label].reduce((value, character) => (value * 31 + character.charCodeAt(0)) >>> 0, 7)
  return labelPalette[hash % labelPalette.length] ?? labelPalette[0]
}

export const ellipsis = (value: string, width: number) => {
  if (value.length <= width) return value
  return width <= 1 ? "…" : `${value.slice(0, width - 1)}…`
}
