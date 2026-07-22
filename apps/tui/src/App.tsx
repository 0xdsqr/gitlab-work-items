import {
  applyWorkflowTransition,
  workflowColumns,
  workflowColumnOf,
  workItemsByColumn,
  type WorkflowColumnId,
  type WorkItem,
  type WorkItemScope,
} from "@gitlab-work-items/domain"
import {
  createWorkItem,
  gitLabConfigFromEnv,
  loadWorkspace,
  moveWorkItem,
  openWorkItem,
  setWorkItemState,
} from "@gitlab-work-items/gitlab"
import { TextAttributes } from "@opentui/core"
import { useKeyboard, useRenderer, useTerminalDimensions } from "@opentui/solid"
import { Effect } from "effect"
import { batch, createEffect, createMemo, createSignal, Match, onCleanup, onMount, Show, Switch } from "solid-js"
import { Board } from "./components/Board.tsx"
import { CreateWorkItemModal } from "./components/CreateWorkItemModal.tsx"
import { WorkItems } from "./components/WorkItems.tsx"
import { ScopeTabs, scopes, SurfaceTabs, type Surface } from "./components/Tabs.tsx"
import { StyledSpan } from "./components/StyledSpan.tsx"
import { WorkItemSummaryModal } from "./components/WorkItemSummaryModal.tsx"
import { colors, ellipsis } from "./theme.ts"
import {
  filterWorkItems,
  nextWorkItemStateFilter,
  terminalSizeSupported,
  type WorkItemStateFilter,
} from "./ui-state.ts"

const messageOf = (error: unknown) => {
  if (typeof error === "object" && error !== null && "detail" in error && typeof error.detail === "string")
    return error.detail
  return error instanceof Error ? error.message : String(error)
}

type CreateForm = {
  readonly project: string
  readonly title: string
  readonly field: "project" | "title"
}

const LoadingWorkspace = (props: { width: number; height: number; scope: string }) => (
  <box width={props.width} height={props.height} alignItems="center" justifyContent="center" flexDirection="column">
    <text fg={colors.text} attributes={TextAttributes.BOLD}>
      <StyledSpan fg={colors.warning}>◌</StyledSpan> Syncing {props.scope}
    </text>
    <text fg={colors.muted}>Fetching the latest work items from GitLab…</text>
  </box>
)

const TerminalTooSmall = (props: { width: number; height: number }) => (
  <box
    width={props.width}
    height={props.height}
    backgroundColor={colors.background}
    alignItems="center"
    justifyContent="center"
    flexDirection="column"
  >
    <text width={Math.max(1, props.width)} fg={colors.text} attributes={TextAttributes.BOLD} wrapMode="none" truncate>
      Resize the terminal
    </text>
    <text width={Math.max(1, props.width)} fg={colors.muted} wrapMode="none" truncate>
      {`Need 44×16 · now ${props.width}×${props.height}`}
    </text>
    <text width={Math.max(1, props.width)} fg={colors.subtle} wrapMode="none" truncate>
      ctrl-c quits
    </text>
  </box>
)

export const App = () => {
  const renderer = useRenderer()
  const dimensions = useTerminalDimensions()
  const config = gitLabConfigFromEnv()
  const [surface, setSurface] = createSignal<Surface>("board")
  const [scopeIndex, setScopeIndex] = createSignal(0)
  const [workItemsIndex, setWorkItemsIndex] = createSignal(0)
  const [workItemFilter, setWorkItemFilter] = createSignal<WorkItemStateFilter>("open")
  const [workItemQuery, setWorkItemQuery] = createSignal("")
  const [workItemQueryEditing, setWorkItemQueryEditing] = createSignal(false)
  const [boardColumnIndex, setBoardColumnIndex] = createSignal(0)
  const [boardCardIndex, setBoardCardIndex] = createSignal(0)
  const [items, setItems] = createSignal<readonly WorkItem[]>([])
  const [username, setUsername] = createSignal("GitLab")
  const [status, setStatus] = createSignal<"loading" | "ready" | "error">("loading")
  const [error, setError] = createSignal<string | null>(null)
  const [refreshKey, setRefreshKey] = createSignal(0)
  const [pendingItemId, setPendingItemId] = createSignal<string | null>(null)
  const [toast, setToast] = createSignal("Loading your GitLab workspace…")
  const [createForm, setCreateForm] = createSignal<CreateForm | null>(null)
  const [summaryItemId, setSummaryItemId] = createSignal<string | null>(null)
  const [creating, setCreating] = createSignal(false)

  const width = createMemo(() => dimensions().width)
  const height = createMemo(() => dimensions().height)
  const scope = createMemo(() => scopes[scopeIndex()]?.id ?? "assigned")
  const grouped = createMemo(() => workItemsByColumn(items()))
  const filteredItems = createMemo(() => filterWorkItems(items(), workItemFilter(), workItemQuery()))
  const boardColumn = createMemo(() => workflowColumns[boardColumnIndex()] ?? workflowColumns[0])
  const boardItems = createMemo(() => grouped()[boardColumn().id])
  const workItemsSelected = createMemo(() => filteredItems()[workItemsIndex()] ?? null)
  const boardSelected = createMemo(() => boardItems()[boardCardIndex()] ?? null)
  const selected = createMemo(() => (surface() === "work-items" ? workItemsSelected() : boardSelected()))
  const summaryItem = createMemo(() => items().find((item) => item.id === summaryItemId()) ?? null)
  const contentHeight = createMemo(() => Math.max(1, height() - 6))
  const scopeLabel = createMemo(() => scopes[scopeIndex()]?.label ?? "My work")
  const toastColor = createMemo(() => {
    const message = toast().toLowerCase()
    if (message.includes("failed") || message.includes("could not")) return colors.error
    if (message.endsWith("…")) return colors.warning
    if (message.startsWith("wait") || message.startsWith("choose") || message.startsWith("give")) return colors.warning
    if (/synced|moved|created|closed|reopened|opened/.test(message)) return colors.success
    return colors.muted
  })
  const toastGlyph = createMemo(() => {
    if (toastColor() === colors.error) return "!"
    if (toastColor() === colors.warning) return "◌"
    if (toastColor() === colors.success) return "✓"
    return "·"
  })
  const primaryHelp = createMemo(() => {
    if (surface() === "work-items")
      return width() >= 72
        ? "j/k select  / search  f status  enter details  n create"
        : "j/k select  / search  enter details"
    if (width() >= 72) return "h/l stages  j/k cards  [/] move  enter details  drag with ⠿"
    return "h/l stages  j/k cards  enter details"
  })

  const refresh = () => {
    if (pendingItemId() || creating()) {
      setToast("Wait for the current GitLab update to finish")
      return
    }
    setRefreshKey((value) => value + 1)
  }

  onMount(() => renderer.setBackgroundColor(colors.background))

  createEffect(() => {
    const lastIndex = Math.max(0, filteredItems().length - 1)
    if (workItemsIndex() > lastIndex) setWorkItemsIndex(lastIndex)
  })

  createEffect(() => {
    const lastIndex = Math.max(0, boardItems().length - 1)
    if (boardCardIndex() > lastIndex) setBoardCardIndex(lastIndex)
  })

  createEffect(() => {
    const requestedScope = scope()
    refreshKey()
    let cancelled = false

    batch(() => {
      setStatus("loading")
      setError(null)
      setToast("Syncing with GitLab…")
    })

    void Effect.runPromise(loadWorkspace(requestedScope)).then(
      (workspace) => {
        if (cancelled) return
        const initialGroups = workItemsByColumn(workspace.items)
        const firstPopulatedColumn = workflowColumns.findIndex((column) => initialGroups[column.id].length > 0)
        batch(() => {
          setItems(workspace.items)
          setUsername(workspace.user.username)
          setWorkItemsIndex(0)
          setBoardColumnIndex(Math.max(0, firstPopulatedColumn))
          setBoardCardIndex(0)
          setStatus("ready")
          setToast(`${workspace.items.length} work items synced`)
        })
      },
      (cause) => {
        if (cancelled) return
        batch(() => {
          setItems([])
          setError(messageOf(cause))
          setStatus("error")
          setToast("GitLab sync failed")
        })
      },
    )

    onCleanup(() => {
      cancelled = true
    })
  })

  const selectScope = (next: WorkItemScope) => {
    if (pendingItemId() || creating()) {
      setToast("Wait for the current GitLab update to finish")
      return
    }
    const index = scopes.findIndex((candidate) => candidate.id === next)
    if (index >= 0) setScopeIndex(index)
  }

  const selectWorkItemFilter = (next: WorkItemStateFilter) => {
    batch(() => {
      setWorkItemFilter(next)
      setWorkItemsIndex(0)
    })
  }

  const updateWorkItemQuery = (query: string) => {
    batch(() => {
      setWorkItemQuery(query)
      setWorkItemsIndex(0)
    })
  }

  const openCreate = () => {
    if (status() !== "ready" || pendingItemId()) {
      setToast("Wait for GitLab sync to finish")
      return
    }
    const current = selected()
    setCreateForm({
      project: current?.namespace ?? config.group ?? "",
      title: "",
      field: current ? "title" : "project",
    })
  }

  const move = (item: WorkItem, target: WorkflowColumnId) => {
    if (status() !== "ready" || pendingItemId()) {
      setToast("Wait for the current GitLab update to finish")
      return
    }
    const source = workflowColumnOf(item)
    const sourceColumnIndex = workflowColumns.findIndex((column) => column.id === source)
    const sourceItemIndex = workItemsByColumn(items())[source].findIndex((candidate) => candidate.id === item.id)
    const optimistic = applyWorkflowTransition(item, target)
    const optimisticItems = items().map((candidate) => (candidate.id === item.id ? optimistic : candidate))
    const targetIndex = workflowColumns.findIndex((column) => column.id === target)

    batch(() => {
      setPendingItemId(item.id)
      setToast(`Moving ${item.reference} to ${workflowColumns[targetIndex]?.label ?? target}…`)
      setItems(optimisticItems)
      if (targetIndex >= 0) {
        setBoardColumnIndex(targetIndex)
        setBoardCardIndex(
          Math.max(
            0,
            workItemsByColumn(optimisticItems)[target].findIndex((candidate) => candidate.id === item.id),
          ),
        )
      }
    })

    void Effect.runPromise(moveWorkItem(item, target)).then(
      (updated) => {
        batch(() => {
          setItems((current) => current.map((candidate) => (candidate.id === item.id ? updated : candidate)))
          setPendingItemId(null)
          setToast(`${item.reference} moved to ${workflowColumns[targetIndex]?.label ?? target}`)
        })
      },
      (cause) => {
        batch(() => {
          setItems((current) => current.map((candidate) => (candidate.id === item.id ? item : candidate)))
          setPendingItemId(null)
          if (sourceColumnIndex >= 0) setBoardColumnIndex(sourceColumnIndex)
          setBoardCardIndex(Math.max(0, sourceItemIndex))
          setToast(`Move failed · ${messageOf(cause)}`)
        })
      },
    )
  }

  const toggleState = (item: WorkItem) => {
    if (status() !== "ready" || pendingItemId()) {
      setToast("Wait for the current GitLab update to finish")
      return
    }
    const nextState = item.state === "OPEN" ? "CLOSED" : "OPEN"
    batch(() => {
      setPendingItemId(item.id)
      setItems((current) =>
        current.map((candidate) => (candidate.id === item.id ? { ...candidate, state: nextState } : candidate)),
      )
      setToast(`${nextState === "CLOSED" ? "Closing" : "Reopening"} ${item.reference}…`)
    })

    void Effect.runPromise(setWorkItemState(item, nextState)).then(
      (updated) => {
        batch(() => {
          setItems((current) => current.map((candidate) => (candidate.id === item.id ? updated : candidate)))
          setPendingItemId(null)
          setToast(`${item.reference} ${nextState === "CLOSED" ? "closed" : "reopened"}`)
        })
      },
      (cause) => {
        batch(() => {
          setItems((current) => current.map((candidate) => (candidate.id === item.id ? item : candidate)))
          setPendingItemId(null)
          setToast(`Update failed · ${messageOf(cause)}`)
        })
      },
    )
  }

  const openInGitLab = (item: WorkItem) => {
    setToast(`Opening ${item.reference} in GitLab…`)
    void Effect.runPromise(openWorkItem(item)).then(
      () => setToast(`${item.reference} opened in GitLab`),
      (cause) => setToast(`Open failed · ${messageOf(cause)}`),
    )
  }

  const submitCreate = () => {
    const form = createForm()
    if (!form || creating()) return
    const project = form.project.trim()
    const title = form.title.trim()
    if (!project) {
      setCreateForm({ ...form, field: "project" })
      setToast("Choose a GitLab project path")
      return
    }
    if (!title) {
      setCreateForm({ ...form, field: "title" })
      setToast("Give the work item a title")
      return
    }

    batch(() => {
      setCreating(true)
      setToast(`Creating work item in ${project}…`)
    })
    void Effect.runPromise(createWorkItem(project, title)).then(
      (created) => {
        batch(() => {
          setItems((current) => [created, ...current])
          setWorkItemsIndex(0)
          setCreating(false)
          setCreateForm(null)
          setSurface("work-items")
          setToast(`${created.reference} created`)
        })
      },
      (cause) => {
        batch(() => {
          setCreating(false)
          setToast(`Create failed · ${messageOf(cause)}`)
        })
      },
    )
  }

  useKeyboard((key) => {
    if (key.ctrl && key.name === "c") {
      key.preventDefault()
      key.stopPropagation()
      renderer.destroy()
      return
    }

    const form = createForm()
    if (form) {
      if (key.name === "escape") {
        key.preventDefault()
        key.stopPropagation()
        if (!creating()) setCreateForm(null)
      }
      if (key.name === "tab" && !creating()) {
        key.preventDefault()
        key.stopPropagation()
        setCreateForm({ ...form, field: form.field === "project" ? "title" : "project" })
      }
      return
    }

    const summary = summaryItem()
    if (summary) {
      if (key.name === "escape" || key.name === "enter" || key.name === "return") {
        key.preventDefault()
        key.stopPropagation()
        setSummaryItemId(null)
      }
      if (key.name === "o") openInGitLab(summary)
      if (key.name === "x") toggleState(summary)
      return
    }
    if (workItemQueryEditing()) {
      if (key.name === "escape" || key.name === "enter" || key.name === "return") {
        key.preventDefault()
        key.stopPropagation()
        setWorkItemQueryEditing(false)
      }
      return
    }
    if (key.name === "q") {
      key.preventDefault()
      renderer.destroy()
      return
    }
    if (key.name === "1") {
      setSurface("board")
      return
    }
    if (key.name === "2") {
      setSurface("work-items")
      return
    }
    if (key.name === "tab") {
      key.preventDefault()
      key.stopPropagation()
      const index = key.shift ? (scopeIndex() + scopes.length - 1) % scopes.length : (scopeIndex() + 1) % scopes.length
      selectScope(scopes[index]?.id ?? "assigned")
      return
    }
    if (key.name === "r") {
      refresh()
      return
    }
    if (key.name === "n") {
      key.preventDefault()
      key.stopPropagation()
      openCreate()
      return
    }

    const currentSelected = selected()
    if (key.name === "o" && currentSelected) {
      openInGitLab(currentSelected)
      return
    }
    if (key.name === "x" && currentSelected) {
      toggleState(currentSelected)
      return
    }
    if (surface() === "work-items") {
      if (key.sequence === "/" || key.name === "/") {
        key.preventDefault()
        key.stopPropagation()
        setWorkItemQueryEditing(true)
        return
      }
      if (key.name === "f") {
        selectWorkItemFilter(nextWorkItemStateFilter(workItemFilter()))
        return
      }
      if ((key.name === "enter" || key.name === "return") && currentSelected) {
        key.preventDefault()
        key.stopPropagation()
        setSummaryItemId(currentSelected.id)
        return
      }
      if (key.name === "j" || key.name === "down")
        setWorkItemsIndex((index) => Math.min(Math.max(0, filteredItems().length - 1), index + 1))
      if (key.name === "k" || key.name === "up") setWorkItemsIndex((index) => Math.max(0, index - 1))
      return
    }

    if (key.name === "h" || key.name === "left") {
      batch(() => {
        setBoardColumnIndex((index) => Math.max(0, index - 1))
        setBoardCardIndex(0)
      })
      return
    }
    if (key.name === "l" || key.name === "right") {
      batch(() => {
        setBoardColumnIndex((index) => Math.min(workflowColumns.length - 1, index + 1))
        setBoardCardIndex(0)
      })
      return
    }
    if (key.name === "j" || key.name === "down") {
      setBoardCardIndex((index) => Math.min(Math.max(0, boardItems().length - 1), index + 1))
      return
    }
    if (key.name === "k" || key.name === "up") {
      setBoardCardIndex((index) => Math.max(0, index - 1))
      return
    }

    const currentBoardItem = boardSelected()
    if ((key.name === "enter" || key.name === "return") && currentBoardItem) {
      setSummaryItemId(currentBoardItem.id)
      return
    }
    if ((key.sequence === "[" || key.name === "[") && currentBoardItem && boardColumnIndex() > 0) {
      move(currentBoardItem, workflowColumns[boardColumnIndex() - 1]?.id ?? "backlog")
      return
    }
    if (
      (key.sequence === "]" || key.name === "]") &&
      currentBoardItem &&
      boardColumnIndex() < workflowColumns.length - 1
    )
      move(currentBoardItem, workflowColumns[boardColumnIndex() + 1]?.id ?? "closed")
  })

  return (
    <Show
      when={terminalSizeSupported(width(), height())}
      fallback={<TerminalTooSmall width={width()} height={height()} />}
    >
      <box width={width()} height={height()} flexDirection="column" backgroundColor={colors.background}>
        <box
          height={1}
          paddingLeft={1}
          paddingRight={1}
          flexDirection="row"
          justifyContent="space-between"
          backgroundColor={colors.panel}
        >
          <text fg={colors.text} attributes={TextAttributes.BOLD}>
            <StyledSpan fg={colors.gitlab}>▲</StyledSpan> {width() < 58 ? "Work items" : "GitLab work items"}
            <Show when={width() >= 68}>
              <StyledSpan fg={colors.muted}>{` / @${ellipsis(username(), 20)}`}</StyledSpan>
            </Show>
          </text>
          <text fg={colors.muted}>
            <StyledSpan fg={config.mock ? colors.warning : colors.success}>●</StyledSpan>{" "}
            {config.mock
              ? width() < 60
                ? "sample"
                : "sample workspace"
              : ellipsis(config.host.replace(/^https?:\/\//, ""), width() < 72 ? 18 : 36)}
          </text>
        </box>
        <box height={1} paddingLeft={1} paddingRight={1} flexDirection="row" justifyContent="space-between">
          <SurfaceTabs active={surface()} compact={width() < 64} onSelect={setSurface} />
          <text fg={status() === "loading" ? colors.warning : status() === "error" ? colors.error : colors.success}>
            {status() === "loading" ? "◌ syncing" : status() === "error" ? "! error" : "● ready"}
          </text>
        </box>
        <box height={1} paddingLeft={1} paddingRight={1} flexDirection="row" justifyContent="space-between">
          <ScopeTabs active={scope()} group={config.group} compact={width() < 76} onSelect={selectScope} />
          <Show when={width() >= 76}>
            <text fg={colors.subtle}>tab changes scope</text>
          </Show>
        </box>
        <text fg={colors.border}>{"─".repeat(Math.max(1, width()))}</text>

        <Switch
          fallback={
            <Board
              width={width()}
              height={contentHeight()}
              items={items()}
              focusedColumnIndex={boardColumnIndex()}
              selectedIndex={boardCardIndex()}
              pendingItemId={pendingItemId()}
              onSelect={(column, index) => {
                const nextColumn = workflowColumns.findIndex((candidate) => candidate.id === column)
                batch(() => {
                  if (nextColumn >= 0) setBoardColumnIndex(nextColumn)
                  setBoardCardIndex(index)
                })
              }}
              onMove={move}
            />
          }
        >
          <Match when={status() === "loading"}>
            <LoadingWorkspace width={width()} height={contentHeight()} scope={scopeLabel()} />
          </Match>
          <Match when={status() === "error"}>
            <box
              width={width()}
              height={contentHeight()}
              border
              borderStyle="single"
              borderColor={colors.error}
              backgroundColor={colors.panel}
              padding={1}
              flexDirection="column"
              title=" GitLab connection "
            >
              <text fg={colors.error} attributes={TextAttributes.BOLD}>
                GitLab could not load this workspace
              </text>
              <text fg={colors.text} height={2} wrapMode="word" truncate>
                {error() ?? "The request failed."}
              </text>
              <box height={1} />
              <text fg={colors.muted} wrapMode="none" truncate>
                Set GITLAB_TOKEN or run `glab auth login`, then press r.
              </text>
              <text fg={colors.muted} wrapMode="none" truncate>
                Organization scope also needs GLWI_GROUP.
              </text>
            </box>
          </Match>
          <Match when={surface() === "work-items"}>
            <WorkItems
              width={width()}
              height={contentHeight()}
              items={filteredItems()}
              allItems={items()}
              filter={workItemFilter()}
              query={workItemQuery()}
              queryEditing={workItemQueryEditing()}
              selectedIndex={workItemsIndex()}
              onSelect={setWorkItemsIndex}
              onFilterChange={selectWorkItemFilter}
              onQueryChange={updateWorkItemQuery}
              onQueryEditingChange={setWorkItemQueryEditing}
              onCreate={openCreate}
            />
          </Match>
        </Switch>

        <box height={1} paddingLeft={1} paddingRight={1} backgroundColor={colors.panel}>
          <text fg={colors.muted} wrapMode="none" truncate>
            <StyledSpan fg={toastColor()}>{toastGlyph()}</StyledSpan> {ellipsis(toast(), Math.max(1, width() - 4))}
          </text>
        </box>
        <box height={1} paddingLeft={1} paddingRight={1} flexDirection="row" justifyContent="space-between">
          <text fg={colors.muted} wrapMode="none" truncate>
            {ellipsis(primaryHelp(), Math.max(8, width() - (width() >= 112 ? 42 : 2)))}
          </text>
          <Show when={width() >= 112}>
            <text fg={colors.muted}>o GitLab x close/reopen r sync q quit</text>
          </Show>
        </box>

        <Show when={createForm()}>
          {(form) => (
            <CreateWorkItemModal
              screenWidth={width()}
              screenHeight={height()}
              project={form().project}
              title={form().title}
              field={form().field}
              busy={creating()}
              onProjectChange={(project) => setCreateForm((current) => (current ? { ...current, project } : null))}
              onTitleChange={(title) => setCreateForm((current) => (current ? { ...current, title } : null))}
              onFieldChange={(field) => setCreateForm((current) => (current ? { ...current, field } : null))}
              onSubmit={submitCreate}
              onClose={() => setCreateForm(null)}
            />
          )}
        </Show>
        <Show when={summaryItem()}>
          {(item) => (
            <WorkItemSummaryModal
              screenWidth={width()}
              screenHeight={height()}
              item={item()}
              pending={pendingItemId() === item().id}
              onOpen={() => openInGitLab(item())}
              onToggleState={() => toggleState(item())}
              onClose={() => setSummaryItemId(null)}
            />
          )}
        </Show>
      </box>
    </Show>
  )
}
