import { describe, expect, it } from "vitest"
import {
  boardPickerRows,
  boardPickerUnavailableReason,
  filterBoardPickerEntries,
  firstBoardPickerEntryId,
  moveBoardPickerSelection,
  orderBoardPickerEntries,
  visibleBoardPickerRows,
  type BoardPickerEntry,
} from "./board-picker.ts"

const entries: readonly BoardPickerEntry[] = [
  { id: "epic:87", kind: "epic", title: "Authentication modernization", subtitle: "acme/platform", badge: "8/13" },
  { id: "smart:mine", kind: "smart", title: "My work", subtitle: "Assigned to me" },
  { id: "gitlab:release", kind: "gitlab", title: "Release train", subtitle: "acme", badge: "12" },
  {
    id: "smart:created",
    kind: "smart",
    title: "Created by me",
    unavailableReason: "Requires an authenticated user",
  },
  { id: "epic:51", kind: "epic", title: "Billing cleanup", subtitle: "acme/commerce", badge: "3/9" },
]

describe("board picker filtering", () => {
  it("matches title, metadata, source aliases, and accent-insensitive terms", () => {
    const accented: BoardPickerEntry = {
      id: "gitlab:triage",
      kind: "gitlab",
      title: "Sécurité triage",
      subtitle: "platform",
    }
    const searchable = [...entries, accented]

    expect(filterBoardPickerEntries(searchable, "auth platform").map((entry) => entry.id)).toEqual(["epic:87"])
    expect(filterBoardPickerEntries(searchable, "group release").map((entry) => entry.id)).toEqual(["gitlab:release"])
    expect(filterBoardPickerEntries(searchable, "assigned billing").map((entry) => entry.id)).toEqual(["epic:51"])
    expect(filterBoardPickerEntries(searchable, "securite").map((entry) => entry.id)).toEqual(["gitlab:triage"])
    expect(filterBoardPickerEntries(searchable, "authenticated").map((entry) => entry.id)).toEqual(["smart:created"])
  })

  it("returns a copy in catalog order for an empty query", () => {
    const result = filterBoardPickerEntries(entries, "   ")
    expect(result).toEqual(entries)
    expect(result).not.toBe(entries)
  })
})

describe("board picker navigation", () => {
  it("prefers the active board and otherwise returns the first visual entry ID", () => {
    expect(firstBoardPickerEntryId(entries, "gitlab:release")).toBe("gitlab:release")
    expect(firstBoardPickerEntryId(entries, "smart:created")).toBe("smart:created")
    expect(firstBoardPickerEntryId(entries, "missing")).toBe("smart:mine")
    expect(firstBoardPickerEntryId([])).toBeNull()
  })

  it("wraps single-step movement in visual group order using stable IDs", () => {
    expect(moveBoardPickerSelection(entries, "gitlab:release", "next")).toBe("epic:87")
    expect(moveBoardPickerSelection(entries, "epic:51", "next")).toBe("smart:mine")
    expect(moveBoardPickerSelection(entries, "smart:mine", "previous")).toBe("epic:51")
    expect(moveBoardPickerSelection(entries, "missing", "next")).toBe("smart:mine")
    expect(moveBoardPickerSelection(entries, "missing", "previous")).toBe("epic:51")
  })

  it("clamps page movement and supports first and last", () => {
    expect(moveBoardPickerSelection(entries, "smart:mine", "page-next", 2)).toBe("gitlab:release")
    expect(moveBoardPickerSelection(entries, "gitlab:release", "page-next", 20)).toBe("epic:51")
    expect(moveBoardPickerSelection(entries, "epic:51", "page-previous", 2)).toBe("gitlab:release")
    expect(moveBoardPickerSelection(entries, "gitlab:release", "first")).toBe("smart:mine")
    expect(moveBoardPickerSelection(entries, "gitlab:release", "last")).toBe("epic:51")
    expect(moveBoardPickerSelection([], null, "next")).toBeNull()
  })

  it("keeps unavailable entries focusable and exposes a textual reason", () => {
    expect(moveBoardPickerSelection(entries, "smart:mine", "next")).toBe("smart:created")
    expect(boardPickerUnavailableReason(entries[3]!)).toBe("Requires an authenticated user")
    expect(boardPickerUnavailableReason(entries[0]!)).toBeNull()
  })
})

describe("board picker grouping and viewport", () => {
  it("orders a mixed catalog in the same sequence shown by the picker", () => {
    expect(orderBoardPickerEntries(entries).map((entry) => entry.id)).toEqual([
      "smart:mine",
      "smart:created",
      "gitlab:release",
      "epic:87",
      "epic:51",
    ])
  })

  it("groups a mixed catalog into stable smart, GitLab, and epic sections", () => {
    expect(boardPickerRows(entries).map((row) => (row.type === "group" ? `group:${row.kind}` : row.entry.id))).toEqual([
      "group:smart",
      "smart:mine",
      "smart:created",
      "group:gitlab",
      "gitlab:release",
      "group:epic",
      "epic:87",
      "epic:51",
    ])
  })

  it("keeps the selected board in a compact result window", () => {
    const rows = visibleBoardPickerRows(entries, "epic:51", 4)
    expect(rows).toHaveLength(4)
    expect(rows.some((row) => row.type === "entry" && row.entry.id === "epic:51")).toBe(true)
  })
})
