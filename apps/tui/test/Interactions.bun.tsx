import { afterEach, expect, test } from "bun:test"
import {
  applyWorkflowTransition,
  mockWorkspace,
  type WorkflowColumnId,
  type WorkItem,
  type Workspace,
} from "@gitlab-work-items/domain"
import { gitLabConfigFromEnv } from "@gitlab-work-items/gitlab"
import { testRender } from "@opentui/solid"
import { createSignal } from "solid-js"
import { App, type AppGitLabRuntime } from "../src/App.tsx"
import { Board } from "../src/components/Board.tsx"
import { StyledSpan } from "../src/components/StyledSpan.tsx"
import { WorkItemSummaryModal } from "../src/components/WorkItemSummaryModal.tsx"
import { WorkItems } from "../src/components/WorkItems.tsx"
import { colors } from "../src/theme.ts"
import { filterWorkItems, workItemDragSourceId } from "../src/ui-state.ts"

process.env.GLWI_MOCK = "1"

let cleanup: (() => void) | null = null

afterEach(async () => {
  await cleanup?.()
  cleanup = null
})

const createdItem: WorkItem = {
  ...mockWorkspace.items[1]!,
  id: "created-item",
  iid: 185,
  title: "Keep the interaction precise",
  reference: "acme/console#185",
  author: mockWorkspace.user.username,
  assignees: [],
}

const testGitLabRuntime = (overrides: Partial<AppGitLabRuntime> = {}): AppGitLabRuntime => ({
  config: gitLabConfigFromEnv({
    GITLAB_HOST: "https://gitlab.example.com",
    GLWI_GROUP: "acme",
    GLWI_MOCK: "1",
  }),
  loadWorkspace: async () => mockWorkspace,
  moveWorkItem: async (item, target) => applyWorkflowTransition(item, target),
  setWorkItemState: async (item, state) => ({ ...item, state }),
  createWorkItem: async () => createdItem,
  openWorkItem: async () => undefined,
  ...overrides,
})

const deferred = <A,>() => {
  let resolve!: (value: A | PromiseLike<A>) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<A>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

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
  await setup.mockInput.typeText("saved")
  await setup.flush()
  const searchFrame = setup.captureCharFrame()
  expect(searchFrame).toContain("saved")
  expect(searchFrame).toContain("Add saved views for assigned work")
  expect(searchFrame).not.toContain("Unify the developer work queue")
  expect(searchFrame).not.toContain("No work items match this search")

  setup.mockInput.pressEnter()
  await setup.flush()
  setup.mockInput.pressEnter()
  await setup.flush()
  expect(setup.captureCharFrame()).toContain("Persist filters by namespace")
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

for (const height of [16, 17, 18, 19, 20]) {
  test(`compact work-item details preserve identity, metadata, and every action at height ${height}`, async () => {
    const setup = await testRender(
      () => (
        <WorkItemSummaryModal
          screenWidth={44}
          screenHeight={height}
          item={mockWorkspace.items[0]!}
          pending={false}
          onOpen={() => undefined}
          onToggleState={() => undefined}
          onClose={() => undefined}
        />
      ),
      { width: 44, height },
    )
    cleanup = () => setup.renderer.destroy()
    await setup.renderOnce()
    await setup.flush()

    const frame = setup.captureCharFrame()
    expect(frame).toContain("Unify the developer work queue")
    expect(frame).toContain("Project  acme/platform")
    expect(frame).toContain("By @mira")
    expect(frame).toContain("esc Back")
    expect(frame).toContain("o Open")
    expect(frame).toContain("x Close")

    await setup.renderer.destroy()
    cleanup = null
  })
}

test("compact board help keeps keyboard movement discoverable", async () => {
  const setup = await testRender(() => <App gitLab={testGitLabRuntime()} />, { width: 44, height: 16 })
  cleanup = () => setup.renderer.destroy()
  await setup.renderOnce()
  await setup.waitForFrame((frame) => frame.includes("4 work items synced"))

  expect(setup.captureCharFrame()).toContain("[ ] move")
})

test("a failed load gives relevant recovery and r retries successfully", async () => {
  const firstLoad = deferred<Workspace>()
  let attempts = 0
  const gitLab = testGitLabRuntime({
    loadWorkspace: () => {
      attempts += 1
      return attempts === 1 ? firstLoad.promise : Promise.resolve(mockWorkspace)
    },
  })
  const setup = await testRender(() => <App gitLab={gitLab} />, { width: 80, height: 24 })
  cleanup = () => setup.renderer.destroy()
  await setup.renderOnce()
  await setup.waitForFrame((frame) => frame.includes("Syncing My work"))

  firstLoad.reject(new Error("Socket connection timed out"))
  await setup.waitForFrame((frame) => frame.includes("GitLab could not load this workspace"))
  const failedFrame = setup.captureCharFrame()
  expect(failedFrame).toContain("Check GITLAB_HOST and your network")
  expect(failedFrame).not.toContain("GITLAB_TOKEN")

  setup.mockInput.pressKey("r")
  await setup.waitForFrame((frame) => frame.includes("4 work items synced"))
  expect(attempts).toBe(2)
})

test("compact connection recovery keeps the retry key visible", async () => {
  const load = deferred<Workspace>()
  const setup = await testRender(
    () => (
      <App
        gitLab={testGitLabRuntime({
          loadWorkspace: () => load.promise,
        })}
      />
    ),
    { width: 44, height: 16 },
  )
  cleanup = () => setup.renderer.destroy()
  await setup.renderOnce()
  await setup.waitForFrame((frame) => frame.includes("Syncing My work"))

  load.reject(new Error("Network connection failed"))
  await setup.waitForFrame((frame) => frame.includes("GitLab could not load"))
  const frame = setup.captureCharFrame()
  expect(frame).toContain("Check GITLAB_HOST")
  expect(frame).toContain("press r")
})

test("scope changes and teardown abort superseded GitLab loads", async () => {
  const firstLoad = deferred<Workspace>()
  const secondLoad = deferred<Workspace>()
  const signals: AbortSignal[] = []
  const gitLab = testGitLabRuntime({
    loadWorkspace: (_scope, signal) => {
      signals.push(signal)
      return signals.length === 1 ? firstLoad.promise : secondLoad.promise
    },
  })
  const setup = await testRender(() => <App gitLab={gitLab} />, { width: 80, height: 24 })
  cleanup = () => setup.renderer.destroy()
  await setup.renderOnce()
  await setup.waitForFrame((frame) => frame.includes("Syncing My work"))

  setup.mockInput.pressTab()
  await setup.flush()
  expect(signals).toHaveLength(2)
  expect(signals[0]?.aborted).toBe(true)
  expect(signals[1]?.aborted).toBe(false)

  await setup.renderer.destroy()
  cleanup = null
  expect(signals[1]?.aborted).toBe(true)
})

test("refresh and scope loading block stale details and open actions", async () => {
  const refreshLoad = deferred<Workspace>()
  const scopeLoad = deferred<Workspace>()
  let loadCount = 0
  let openCalls = 0
  const gitLab = testGitLabRuntime({
    loadWorkspace: () => {
      loadCount += 1
      if (loadCount === 1) return Promise.resolve(mockWorkspace)
      return loadCount === 2 ? refreshLoad.promise : scopeLoad.promise
    },
    openWorkItem: async () => {
      openCalls += 1
    },
  })
  const setup = await testRender(() => <App gitLab={gitLab} />, { width: 80, height: 24 })
  cleanup = () => setup.renderer.destroy()
  await setup.renderOnce()
  await setup.waitForFrame((frame) => frame.includes("4 work items synced"))

  setup.mockInput.pressKey("r")
  await setup.waitForFrame((frame) => frame.includes("Syncing My work"))
  setup.mockInput.pressEnter()
  setup.mockInput.pressKey("o")
  await setup.flush()
  expect(openCalls).toBe(0)
  expect(setup.captureCharFrame()).not.toContain("Create one focused place")

  refreshLoad.resolve(mockWorkspace)
  await setup.waitForFrame((frame) => frame.includes("4 work items synced"))
  setup.mockInput.pressTab()
  await setup.waitForFrame((frame) => frame.includes("Syncing Created by me"))
  setup.mockInput.pressEnter()
  setup.mockInput.pressKey("o")
  await setup.flush()
  expect(openCalls).toBe(0)
  expect(setup.captureCharFrame()).not.toContain("Create one focused place")

  scopeLoad.resolve(mockWorkspace)
  await setup.waitForFrame((frame) => frame.includes("4 work items synced"))
})

test("failed moves roll back and pending controls do not submit twice", async () => {
  const moveResult = deferred<WorkItem>()
  let moveCalls = 0
  const gitLab = testGitLabRuntime({
    moveWorkItem: () => {
      moveCalls += 1
      return moveResult.promise
    },
  })
  const setup = await testRender(() => <App gitLab={gitLab} />, { width: 80, height: 24 })
  cleanup = () => setup.renderer.destroy()
  await setup.renderOnce()
  await setup.waitForFrame((frame) => frame.includes("4 work items synced"))

  setup.mockInput.pressKey("]")
  await setup.flush()
  expect(setup.captureCharFrame()).toContain("syncing with GitLab")
  setup.mockInput.pressKey("]")
  await setup.flush()
  expect(moveCalls).toBe(1)

  moveResult.reject(new Error("update rejected"))
  await setup.waitForFrame((frame) => frame.includes("Move failed"))
  const rolledBack = setup.captureCharFrame()
  expect(rolledBack).toContain("Ready")
  expect(rolledBack).toContain("Unify the developer")
})

test("semantic create input stays editable after failure and successful creation reloads Created by me", async () => {
  const createResults = [deferred<WorkItem>(), deferred<WorkItem>()]
  const createdScopeLoad = deferred<Workspace>()
  const loadedScopes: string[] = []
  let createCalls = 0
  const gitLab = testGitLabRuntime({
    loadWorkspace: (scope) => {
      loadedScopes.push(scope)
      return scope === "created" ? createdScopeLoad.promise : Promise.resolve(mockWorkspace)
    },
    createWorkItem: () => {
      const result = createResults[createCalls]
      createCalls += 1
      return result?.promise ?? Promise.reject(new Error("unexpected create"))
    },
  })
  const setup = await testRender(() => <App gitLab={gitLab} />, { width: 80, height: 24 })
  cleanup = () => setup.renderer.destroy()
  await setup.renderOnce()
  await setup.waitForFrame((frame) => frame.includes("4 work items synced"))

  setup.mockInput.pressKey("n")
  await setup.flush()
  await setup.mockInput.typeText("Ship the polished flow")
  setup.mockInput.pressEnter()
  await setup.flush()
  expect(setup.captureCharFrame()).toContain("Creating")
  setup.mockInput.pressEnter()
  expect(createCalls).toBe(1)

  createResults[0]?.reject(new Error("validation failed"))
  await setup.waitForFrame((frame) => frame.includes("Create failed"))
  const failedFrame = setup.captureCharFrame()
  expect(failedFrame).toContain("Ship the polished flow")
  expect(failedFrame).toContain("+ Create work item")

  setup.mockInput.pressEnter()
  await setup.flush()
  createResults[1]?.resolve(createdItem)
  await setup.waitForFrame((frame) => frame.includes("Syncing Created by me"))
  expect(setup.captureCharFrame()).not.toContain(createdItem.title)

  createdScopeLoad.resolve({ user: mockWorkspace.user, items: [createdItem] })
  await setup.waitForFrame((frame) => frame.includes("1 work items synced"))
  const createdFrame = setup.captureCharFrame()
  expect(createdFrame).toContain("● ready")
  expect(createdFrame).toContain(createdItem.title)
  expect(createCalls).toBe(2)
  expect(loadedScopes).toEqual(["assigned", "created"])
})

test("invalid credential-bearing host configuration fails safely without echoing secrets", async () => {
  const previousHost = process.env.GITLAB_HOST
  process.env.GITLAB_HOST = "https://alice:supersecret@gitlab.example.com"
  try {
    const setup = await testRender(() => <App />, { width: 80, height: 24 })
    cleanup = () => setup.renderer.destroy()
    await setup.renderOnce()
    await setup.waitForFrame((frame) => frame.includes("GitLab could not load this workspace"))

    const frame = setup.captureCharFrame()
    expect(frame).toContain("configuration error")
    expect(frame).toContain("GitLab configuration is invalid")
    expect(frame).toContain("Fix GITLAB_HOST or GLWI_GROUP")
    expect(frame).not.toContain("alice")
    expect(frame).not.toContain("supersecret")
  } finally {
    if (previousHost === undefined) delete process.env.GITLAB_HOST
    else process.env.GITLAB_HOST = previousHost
  }
})
