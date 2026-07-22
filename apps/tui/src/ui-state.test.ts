import { describe, expect, it } from "vitest"
import {
  filterWorkItems,
  nextWorkItemStateFilter,
  terminalSizeSupported,
  visibleWindowStart,
  visibleWorkflowColumns,
  workItemDragSourceId,
  workItemIdFromDragRenderable,
  workItemIdFromDragSource,
} from "./ui-state.ts"
import { mockWorkspace } from "@github-work-items/domain"

describe("work item status filters", () => {
  it("defaults can be applied without mutating the workspace", () => {
    expect(filterWorkItems(mockWorkspace.items, "open")).toHaveLength(3)
    expect(filterWorkItems(mockWorkspace.items, "closed").map((item) => item.id)).toEqual(["gid://gitlab/WorkItem/104"])
    expect(filterWorkItems(mockWorkspace.items, "all")).toHaveLength(4)
  })

  it("cycles open, closed, and all", () => {
    expect(nextWorkItemStateFilter("open")).toBe("closed")
    expect(nextWorkItemStateFilter("closed")).toBe("all")
    expect(nextWorkItemStateFilter("all")).toBe("open")
  })

  it("searches work-item content within the selected status", () => {
    expect(filterWorkItems(mockWorkspace.items, "open", "saved views").map((item) => item.id)).toEqual([
      "gid://gitlab/WorkItem/102",
    ])
    expect(filterWorkItems(mockWorkspace.items, "open", "workflow::review").map((item) => item.id)).toEqual([
      "gid://gitlab/WorkItem/103",
    ])
    expect(filterWorkItems(mockWorkspace.items, "open", "keyboard")).toEqual([])
    expect(filterWorkItems(mockWorkspace.items, "all", "keyboard").map((item) => item.id)).toEqual([
      "gid://gitlab/WorkItem/104",
    ])
  })
})

describe("visibleWindowStart", () => {
  it("keeps the first page anchored while its selection is visible", () => {
    expect(visibleWindowStart(12, 4, 0)).toBe(0)
    expect(visibleWindowStart(12, 4, 3)).toBe(0)
  })

  it("follows a selection beyond the visible page", () => {
    expect(visibleWindowStart(12, 4, 4)).toBe(1)
    expect(visibleWindowStart(12, 4, 11)).toBe(8)
  })

  it("clamps short and empty lists", () => {
    expect(visibleWindowStart(2, 4, 1)).toBe(0)
    expect(visibleWindowStart(0, 0, 0)).toBe(0)
  })
})

describe("responsive terminal layout", () => {
  it("adds board columns progressively without abrupt one-to-three jumps", () => {
    expect(visibleWorkflowColumns(44, 2).map((column) => column.id)).toEqual(["doing"])
    expect(visibleWorkflowColumns(60, 2).map((column) => column.id)).toEqual(["ready", "doing"])
    expect(visibleWorkflowColumns(80, 2).map((column) => column.id)).toEqual(["ready", "doing", "review"])
    expect(visibleWorkflowColumns(110, 2).map((column) => column.id)).toEqual(["backlog", "ready", "doing", "review"])
    expect(visibleWorkflowColumns(130, 2)).toHaveLength(5)
  })

  it("recognizes the smallest supported workspace", () => {
    expect(terminalSizeSupported(44, 16)).toBe(true)
    expect(terminalSizeSupported(43, 16)).toBe(false)
    expect(terminalSizeSupported(44, 15)).toBe(false)
  })
})

describe("work item drag sources", () => {
  it("round trips a work item id", () => {
    const source = workItemDragSourceId("gid://gitlab/WorkItem/42")
    expect(workItemIdFromDragSource(source)).toBe("gid://gitlab/WorkItem/42")
  })

  it("ignores unrelated and empty sources", () => {
    expect(workItemIdFromDragSource("column:ready")).toBeNull()
    expect(workItemIdFromDragSource("work-item:")).toBeNull()
    expect(workItemIdFromDragSource(undefined)).toBeNull()
  })

  it("finds the card id when a text child owns the mouse capture", () => {
    const card = { id: workItemDragSourceId("42"), parent: null }
    const text = { id: "text-17", parent: card }
    expect(workItemIdFromDragRenderable(text)).toBe("42")
  })
})
