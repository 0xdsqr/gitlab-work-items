export const boardPickerKinds = ["smart", "gitlab", "epic"] as const

export type BoardPickerKind = (typeof boardPickerKinds)[number]

export type BoardPickerEntry = Readonly<{
  id: string
  kind: BoardPickerKind
  title: string
  subtitle?: string
  badge?: string
  unavailableReason?: string | null
}>

export type BoardPickerMovement = "next" | "previous" | "first" | "last" | "page-next" | "page-previous"

export type BoardPickerRow =
  | Readonly<{ type: "group"; kind: BoardPickerKind }>
  | Readonly<{ type: "entry"; entry: BoardPickerEntry }>

export const boardPickerGroupLabels: Readonly<Record<BoardPickerKind, string>> = {
  smart: "SMART VIEWS",
  gitlab: "GITLAB BOARDS",
  epic: "ASSIGNED EPICS",
}

const boardPickerKindSearchTerms: Readonly<Record<BoardPickerKind, string>> = {
  smart: "smart view personal my work created organization",
  gitlab: "gitlab group organization board kanban",
  epic: "assigned epic hierarchy",
}

const normalizedSearchText = (value: string) =>
  value
    .normalize("NFKD")
    .replace(/\p{Mark}/gu, "")
    .toLocaleLowerCase()

export const filterBoardPickerEntries = (entries: readonly BoardPickerEntry[], query: string) => {
  const terms = normalizedSearchText(query).trim().split(/\s+/u).filter(Boolean)
  if (terms.length === 0) return [...entries]

  return entries.filter((entry) => {
    const haystack = normalizedSearchText(
      [
        entry.title,
        entry.subtitle ?? "",
        entry.badge ?? "",
        entry.unavailableReason ?? "",
        boardPickerKindSearchTerms[entry.kind],
      ].join(" "),
    )
    return terms.every((term) => haystack.includes(term))
  })
}

export const orderBoardPickerEntries = (entries: readonly BoardPickerEntry[]) =>
  boardPickerKinds.flatMap((kind) => entries.filter((entry) => entry.kind === kind))

export const boardPickerUnavailableReason = (entry: BoardPickerEntry) => entry.unavailableReason?.trim() || null

export const firstBoardPickerEntryId = (entries: readonly BoardPickerEntry[], preferredId?: string | null) => {
  const ordered = orderBoardPickerEntries(entries)
  if (preferredId && ordered.some((entry) => entry.id === preferredId)) return preferredId
  return ordered[0]?.id ?? null
}

export const moveBoardPickerSelection = (
  entries: readonly BoardPickerEntry[],
  selectedId: string | null,
  movement: BoardPickerMovement,
  pageSize = 5,
) => {
  const ordered = orderBoardPickerEntries(entries)
  if (ordered.length === 0) return null

  if (movement === "first") return ordered[0]?.id ?? null
  if (movement === "last") return ordered.at(-1)?.id ?? null

  const currentPosition = ordered.findIndex((entry) => entry.id === selectedId)
  if (currentPosition < 0)
    return movement === "previous" || movement === "page-previous" ? (ordered.at(-1)?.id ?? null) : ordered[0]!.id

  if (movement === "next") return ordered[(currentPosition + 1) % ordered.length]!.id
  if (movement === "previous") return ordered[(currentPosition - 1 + ordered.length) % ordered.length]!.id

  const distance = Math.max(1, pageSize)
  const targetPosition =
    movement === "page-next"
      ? Math.min(ordered.length - 1, currentPosition + distance)
      : Math.max(0, currentPosition - distance)
  return ordered[targetPosition]!.id
}

export const boardPickerRows = (entries: readonly BoardPickerEntry[]): BoardPickerRow[] => {
  const orderedEntries = orderBoardPickerEntries(entries)
  return boardPickerKinds.flatMap((kind) => {
    const groupEntries = orderedEntries.flatMap((entry) =>
      entry.kind === kind ? [{ type: "entry" as const, entry }] : [],
    )
    return groupEntries.length > 0 ? [{ type: "group" as const, kind }, ...groupEntries] : []
  })
}

export const visibleBoardPickerRows = (
  entries: readonly BoardPickerEntry[],
  selectedId: string | null,
  capacity: number,
) => {
  const rows = boardPickerRows(entries)
  const safeCapacity = Math.max(1, capacity)
  if (rows.length <= safeCapacity) return rows

  const selectedRowIndex = rows.findIndex((row) => row.type === "entry" && row.entry.id === selectedId)
  const lastStart = rows.length - safeCapacity
  const start = selectedRowIndex < 0 ? 0 : Math.max(0, Math.min(lastStart, selectedRowIndex - safeCapacity + 1))
  return rows.slice(start, start + safeCapacity)
}
