import { describe, expect, it } from "vitest"
import {
  visibleWindowStart,
  workItemDragSourceId,
  workItemIdFromDragRenderable,
  workItemIdFromDragSource,
} from "./ui-state.ts"

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
