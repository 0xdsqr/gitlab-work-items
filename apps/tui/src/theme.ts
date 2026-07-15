import type { WorkItem } from "@github-work-items/domain"

export const colors = {
  background: "#100b18",
  panel: "#181022",
  panelRaised: "#21162f",
  panelSoft: "#2a1b3d",
  border: "#4c3564",
  borderActive: "#a855f7",
  text: "#f2eaff",
  muted: "#aa96bd",
  accent: "#c084fc",
  accentStrong: "#a855f7",
  gitlab: "#fc6d26",
  selected: "#332047",
  success: "#6ee7b7",
  warning: "#f6c177",
  error: "#fb7185",
  epic: "#f0abfc",
  issue: "#93c5fd",
  task: "#5eead4",
} as const

const labelPalette = ["#4c1d95", "#581c87", "#3b2766", "#312e81", "#4a255f", "#28305f"] as const

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
