import { describe, expect, it } from "vitest"
import { cellWidth, ellipsis } from "./theme.ts"

describe("terminal text fitting", () => {
  it("measures terminal cells instead of JavaScript code units", () => {
    expect(cellWidth("界")).toBe(2)
    expect(cellWidth("😀")).toBe(2)
    expect(cellWidth("e\u0301")).toBe(1)
  })

  it("truncates on grapheme boundaries within the requested width", () => {
    expect(ellipsis("界面 settings", 7)).toBe("界面 s…")
    expect(cellWidth(ellipsis("roadmap 😀 review", 10))).toBeLessThanOrEqual(10)
    expect(ellipsis("anything", 0)).toBe("")
  })
})
