import { afterEach, expect, test } from "bun:test"
import { mockWorkspace, type WorkflowColumnId } from "@gitlab-work-items/domain"
import { testRender } from "@opentui/solid"
import { createSignal } from "solid-js"
import { App } from "../src/App.tsx"
import { Board } from "../src/components/Board.tsx"
import { StyledSpan } from "../src/components/StyledSpan.tsx"
import { WorkItems } from "../src/components/WorkItems.tsx"
import { colors } from "../src/theme.ts"
import { filterWorkItems, workItemDragSourceId } from "../src/ui-state.ts"

process.env.GLWI_MOCK = "1"

let cleanup: (() => void) | null = null

afterEach(async () => {
  await cleanup?.()
  cleanup = null
})

test("a drag starting on card text drops the card into a visible column", async () => {
  const moves: Array<{ itemId: string; target: WorkflowColumnId }> = []
  const setup = await testRender(
    () => (
      <Board
        width={80}
        height={28}
        items={mockWorkspace.items}
        focusedColumnIndex={1}
        selectedIndex={0}
        pendingItemId={null}
        onSelect={() => undefined}
        onMove={(item, target) => moves.push({ itemId: item.id, target })}
      />
    ),
    { width: 80, height: 28 },
  )
  cleanup = () => setup.renderer.destroy()
  await setup.renderOnce()
  await setup.flush()

  const cardFrame = setup.captureCharFrame()
  expect(cardFrame).toContain("◆ acme/platfor")
  expect(cardFrame).toContain("Unify the developer…")
  expect(cardFrame).toContain("@alex @mira")

  const item = mockWorkspace.items[0]
  expect(item).toBeDefined()
  if (!item) return
  const source = setup.renderer.root.findDescendantById(workItemDragSourceId(item.id))
  const target = setup.renderer.root.findDescendantById("workflow-column:doing")
  expect(source).toBeDefined()
  expect(target).toBeDefined()
  if (!source || !target) return

  // y + 1 lands on the first text row, reproducing a real Ghostty drag.
  await setup.mockMouse.drag(source.x + 4, source.y + 1, target.x + 2, target.y + 1)
  await setup.flush()

  expect(moves).toEqual([{ itemId: item.id, target: "doing" }])
})

test("the compact filter bar renders a searched work-item list", async () => {
  const setup = await testRender(
    () => (
      <WorkItems
        width={80}
        height={20}
        items={filterWorkItems(mockWorkspace.items, "open", "saved")}
        allItems={mockWorkspace.items}
        filter="open"
        query="saved"
        queryEditing={false}
        selectedIndex={0}
        onSelect={() => undefined}
        onFilterChange={() => undefined}
        onQueryChange={() => undefined}
        onQueryEditingChange={() => undefined}
        onCreate={() => undefined}
      />
    ),
    { width: 80, height: 20 },
  )
  cleanup = () => setup.renderer.destroy()
  await setup.renderOnce()
  await setup.flush()

  const frame = setup.captureCharFrame()
  expect(frame).toContain("status:open")
  expect(frame).toContain("saved")
  expect(frame).toContain("1/3")
  expect(frame).toContain("○ Add saved views")
  expect(frame).toContain("acme/console#184")
  expect(frame).not.toContain("Unify the developer")
})

test("semantic inline colors survive the Solid text reconciler", async () => {
  let setAccent: ((color: string) => void) | undefined
  const InlineAccent = () => {
    const [accent, updateAccent] = createSignal(colors.gitlab)
    setAccent = updateAccent
    return (
      <StyledSpan fg={accent()} bg={colors.panel}>
        accent
      </StyledSpan>
    )
  }
  const setup = await testRender(
    () => (
      <text fg={colors.text}>
        plain <InlineAccent />
      </text>
    ),
    { width: 24, height: 2 },
  )
  cleanup = () => setup.renderer.destroy()
  await setup.renderOnce()
  await setup.flush()

  const accent = setup
    .captureSpans()
    .lines.flatMap((line) => line.spans)
    .find((span) => span.text.includes("accent"))
  expect(accent?.fg.toInts().slice(0, 3)).toEqual([252, 109, 38])
  expect(accent?.bg.toInts().slice(0, 3)).toEqual([40, 39, 45])

  setAccent?.(colors.success)
  await setup.flush()
  const updated = setup
    .captureSpans()
    .lines.flatMap((line) => line.spans)
    .find((span) => span.text.includes("accent"))
  expect(updated?.fg.toInts().slice(0, 3)).toEqual([82, 184, 122])
})

test("input shortcuts open clean fields and work-item Enter opens details", async () => {
  const setup = await testRender(() => <App />, { width: 80, height: 24 })
  cleanup = () => setup.renderer.destroy()
  await setup.renderOnce()
  await setup.waitForFrame((frame) => frame.includes("4 work items synced"))

  setup.mockInput.pressKey("n")
  await setup.flush()
  expect(setup.captureCharFrame()).toContain("What needs to change?")

  await setup.mockInput.pressKeys(["ESCAPE"], 50)
  await setup.flush()
  setup.mockInput.pressKey("2")
  await setup.flush()
  setup.mockInput.pressKey("/")
  await setup.flush()
  const searchFrame = setup.captureCharFrame()
  expect(searchFrame).toContain("Search")
  expect(searchFrame).not.toContain("No work items match this search")

  setup.mockInput.pressEnter()
  await setup.flush()
  setup.mockInput.pressEnter()
  await setup.flush()
  expect(setup.captureCharFrame()).toContain("Create one focused place")
})

test("an undersized terminal gets a resize prompt instead of clipped controls", async () => {
  const setup = await testRender(() => <App />, { width: 40, height: 14 })
  cleanup = () => setup.renderer.destroy()
  await setup.renderOnce()
  await setup.flush()

  const frame = setup.captureCharFrame()
  expect(frame).toContain("Resize the terminal")
  expect(frame).toContain("Need 44×16 · now 40×14")
  expect(frame).not.toContain("Scope")
})
