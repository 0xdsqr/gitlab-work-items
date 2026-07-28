import { describe, expect, it } from "vitest"
import { mockWorkspace } from "../src/fixtures.ts"
import { relativeAge, typeLabel } from "../src/work-item.ts"

describe("work-item presentation", () => {
  it("formats stable type labels", () => {
    expect(typeLabel("KEY_RESULT")).toBe("key result")
  })

  it("formats relative age", () => {
    expect(relativeAge("2026-07-15T10:00:00.000Z", Date.parse("2026-07-15T12:30:00.000Z"))).toBe("2h")
  })

  it("handles invalid and future timestamps safely", () => {
    const now = Date.parse("2026-07-15T12:30:00.000Z")
    expect(relativeAge("not-a-date", now)).toBe("unknown")
    expect(relativeAge("2026-07-15T13:00:00.000Z", now)).toBe("0m")
  })

  it("represents group-level work items without a project ID", () => {
    expect(mockWorkspace.items[0]).toMatchObject({ type: "EPIC", projectId: null })
  })
})
