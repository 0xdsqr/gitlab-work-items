import { describe, expect, it } from "vitest"
import { relativeAge, typeLabel } from "../src/work-item.ts"

describe("work-item presentation", () => {
  it("formats stable type labels", () => {
    expect(typeLabel("KEY_RESULT")).toBe("key result")
  })

  it("formats relative age", () => {
    expect(relativeAge("2026-07-15T10:00:00.000Z", Date.parse("2026-07-15T12:30:00.000Z"))).toBe("2h")
  })
})
