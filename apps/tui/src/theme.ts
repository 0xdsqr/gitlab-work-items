import type { WorkItem, WorkItemLabel } from "@gitlab-work-items/domain"

export const colors = {
  background: "#18171d",
  scrim: "#111017dd",
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

export const workItemTypeIcon = (item: WorkItem) => {
  if (item.type === "EPIC") return "◆"
  if (item.type === "TASK") return "□"
  return "○"
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

const graphemeSegmenter = new Intl.Segmenter("en", { granularity: "grapheme" })

const isFullWidthCodePoint = (codePoint: number) =>
  codePoint >= 0x1100 &&
  (codePoint <= 0x115f ||
    codePoint === 0x2329 ||
    codePoint === 0x232a ||
    (codePoint >= 0x2e80 && codePoint <= 0xa4cf && codePoint !== 0x303f) ||
    (codePoint >= 0xac00 && codePoint <= 0xd7a3) ||
    (codePoint >= 0xf900 && codePoint <= 0xfaff) ||
    (codePoint >= 0xfe10 && codePoint <= 0xfe19) ||
    (codePoint >= 0xfe30 && codePoint <= 0xfe6f) ||
    (codePoint >= 0xff00 && codePoint <= 0xff60) ||
    (codePoint >= 0xffe0 && codePoint <= 0xffe6) ||
    (codePoint >= 0x1b000 && codePoint <= 0x1b2ff) ||
    (codePoint >= 0x20000 && codePoint <= 0x3fffd))

const fallbackCellWidth = (value: string) => {
  let width = 0
  for (const { segment } of graphemeSegmenter.segment(value)) {
    const codePoint = segment.codePointAt(0) ?? 0
    const control = codePoint <= 0x1f || (codePoint >= 0x7f && codePoint <= 0x9f)
    if (/^\p{Mark}+$/u.test(segment) || control) continue
    width += /\p{Extended_Pictographic}/u.test(segment) || isFullWidthCodePoint(codePoint) ? 2 : 1
  }
  return width
}

const runtimeStringWidth = (globalThis as typeof globalThis & { Bun?: { stringWidth?: (value: string) => number } }).Bun
  ?.stringWidth

export const cellWidth = (value: string) => runtimeStringWidth?.(value) ?? fallbackCellWidth(value)

export const ellipsis = (value: string, width: number) => {
  if (width <= 0) return ""
  if (cellWidth(value) <= width) return value
  if (width === 1) return "…"

  let fitted = ""
  for (const { segment } of graphemeSegmenter.segment(value)) {
    if (cellWidth(`${fitted}${segment}…`) > width) break
    fitted += segment
  }
  return `${fitted}…`
}
