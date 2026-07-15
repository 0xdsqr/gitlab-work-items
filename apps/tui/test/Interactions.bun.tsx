import { afterEach, expect, test } from "bun:test"
import { mockWorkspace, type WorkflowColumnId } from "@github-work-items/domain"
import { createTestRenderer } from "@opentui/core/testing"
import { createRoot } from "@opentui/react"
import { act } from "react"
import { Board } from "../src/components/Board.tsx"
import { WorkItems } from "../src/components/WorkItems.tsx"
import { filterWorkItems, workItemDragSourceId } from "../src/ui-state.ts"

let cleanup: (() => Promise<void>) | null = null

afterEach(async () => {
  await cleanup?.()
  cleanup = null
})

test("a drag starting on card text drops the card into a visible column", async () => {
  const setup = await createTestRenderer({ width: 80, height: 28 })
  const root = createRoot(setup.renderer)
  cleanup = async () => {
    await act(async () => root.unmount())
    setup.renderer.destroy()
    globalThis.IS_REACT_ACT_ENVIRONMENT = false
  }
  const moves: Array<{ itemId: string; target: WorkflowColumnId }> = []

  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  await act(async () => {
    root.render(
      <Board
        width={80}
        height={28}
        items={mockWorkspace.items}
        focusedColumnIndex={1}
        selectedIndex={0}
        pendingItemId={null}
        onSelect={() => undefined}
        onMove={(item, target) => moves.push({ itemId: item.id, target })}
      />,
    )
  })
  await setup.renderOnce()
  await setup.flush()

  const cardFrame = setup.captureCharFrame()
  expect(cardFrame).toContain("◆ epic")
  expect(cardFrame).toContain("Unify the developer…")
  expect(cardFrame).toContain("acme/platform&42")
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
  await act(async () => {
    await setup.mockMouse.drag(source.x + 4, source.y + 1, target.x + 2, target.y + 1)
    await setup.flush()
  })

  expect(moves).toEqual([{ itemId: item.id, target: "doing" }])
})

test("the compact filter bar renders a searched work-item list", async () => {
  const setup = await createTestRenderer({ width: 80, height: 20 })
  const root = createRoot(setup.renderer)
  cleanup = async () => {
    await act(async () => root.unmount())
    setup.renderer.destroy()
    globalThis.IS_REACT_ACT_ENVIRONMENT = false
  }

  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  await act(async () => {
    root.render(
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
      />,
    )
  })
  await setup.renderOnce()
  await setup.flush()

  const frame = setup.captureCharFrame()
  expect(frame).toContain("status:open")
  expect(frame).toContain("saved")
  expect(frame).toContain("1/3")
  expect(frame).toContain("○ acme/console#184")
  expect(frame).not.toContain("Unify the developer")
})
