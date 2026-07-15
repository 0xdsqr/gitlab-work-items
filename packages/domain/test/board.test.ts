import {
  applyWorkflowTransition,
  mockWorkspace,
  workflowColumnOf,
  workflowTransition,
  workItemsByColumn,
} from "../src/index.ts"
import { describe, expect, it } from "vitest"

describe("work item board", () => {
  it("derives workflow columns from state and scoped labels", () => {
    expect(mockWorkspace.items.map(workflowColumnOf)).toEqual(["ready", "doing", "review"])
    expect(workItemsByColumn(mockWorkspace.items).doing).toHaveLength(1)
  })

  it("replaces the previous workflow label when moving a card", () => {
    const item = mockWorkspace.items[0]!
    expect(workflowTransition(item, "doing")).toEqual({
      stateEvent: null,
      addLabels: ["workflow::in progress"],
      removeLabels: ["workflow::ready"],
    })
    expect(applyWorkflowTransition(item, "doing").labels).toEqual(["product", "workflow::in progress"])
  })

  it("closes and reopens work without losing unrelated labels", () => {
    const item = mockWorkspace.items[0]!
    const closed = applyWorkflowTransition(item, "closed")
    expect(closed.state).toBe("CLOSED")
    expect(workflowTransition(closed, "ready").stateEvent).toBe("reopen")
    expect(applyWorkflowTransition(closed, "ready").labels).toContain("product")
  })
})
