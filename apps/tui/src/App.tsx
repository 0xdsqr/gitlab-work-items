import {
  applyWorkflowTransition,
  boardItemsInColumn,
  boardRefKey,
  workflowBoardColumns,
  workflowColumns,
  workflowColumnOf,
  workItemsByColumn,
  type BoardCatalogEntry,
  type BoardSnapshot,
  type BoardRef,
  type WorkflowColumnId,
  type WorkItem,
  type WorkItemScope,
  type Workspace,
} from "@gitlab-work-items/domain"
import {
  createWorkItem,
  gitLabConfigFromEnv,
  listAssignedEpics,
  listGroupBoards,
  loadEpicHierarchy,
  loadGroupBoardSnapshot,
  loadWorkspace,
  moveWorkItem,
  openWorkItem,
  runGitLabEffect,
  setWorkItemState,
  type GitLabConfig,
  type GitLabEpicHierarchy,
  type GitLabGroupBoardSnapshot,
  type GitLabGroupBoardSummary,
} from "@gitlab-work-items/gitlab"
import { TextAttributes } from "@opentui/core"
import { useKeyboard, useRenderer, useTerminalDimensions } from "@opentui/solid"
import { batch, createEffect, createMemo, createSignal, Match, onCleanup, onMount, Show, Switch } from "solid-js"
import { Board } from "./components/Board.tsx"
import { BoardPicker, type BoardPickerEntry } from "./components/BoardPicker.tsx"
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

const safeDisplayText = (value: string) =>
  Array.from(value, (character) => {
    const codePoint = character.codePointAt(0) ?? 0
    return codePoint <= 0x1f || (codePoint >= 0x7f && codePoint <= 0x9f) ? " " : character
  })
    .join("")
    .replaceAll(/\s+/g, " ")
    .trim()

const messageOf = (error: unknown) => {
  if (typeof error === "object" && error !== null && "detail" in error && typeof error.detail === "string")
    return safeDisplayText(error.detail)
  return safeDisplayText(error instanceof Error ? error.message : String(error))
}

const remediationOf = (error: unknown, requestedScope: WorkItemScope, group: string | null) => {
  if (typeof error === "object" && error !== null && "remediation" in error && typeof error.remediation === "string")
    return safeDisplayText(error.remediation)
  const detail = messageOf(error).toLowerCase()
  if (requestedScope === "organization" && !group) return "Set GLWI_GROUP to a GitLab group, then press r."
  if (/(?:^|\D)(?:401|403)(?:\D|$)|auth|token|credential/.test(detail))
    return "Check GITLAB_TOKEN or `glab auth status`, then press r."
  if (/network|connect|fetch|timed? out|timeout|dns|host/.test(detail))
    return "Check GITLAB_HOST and your network, then press r."
  return "Press r to retry. If it persists, check the GitLab CLI output."
}

export type AppGitLabRuntime = {
  readonly config: GitLabConfig
  readonly configurationInvalid?: boolean
  readonly loadWorkspace: (scope: WorkItemScope, signal: AbortSignal) => Promise<Workspace>
  readonly listGroupBoards: (signal: AbortSignal) => Promise<readonly GitLabGroupBoardSummary[]>
  readonly loadGroupBoardSnapshot: (boardId: number, signal: AbortSignal) => Promise<GitLabGroupBoardSnapshot>
  readonly listAssignedEpics: (signal: AbortSignal) => Promise<readonly WorkItem[]>
  readonly loadEpicHierarchy: (epicId: string, signal: AbortSignal) => Promise<GitLabEpicHierarchy>
  readonly moveWorkItem: (item: WorkItem, target: WorkflowColumnId, signal: AbortSignal) => Promise<WorkItem>
  readonly setWorkItemState: (item: WorkItem, state: WorkItem["state"], signal: AbortSignal) => Promise<WorkItem>
  readonly createWorkItem: (project: string, title: string, signal: AbortSignal) => Promise<WorkItem>
  readonly openWorkItem: (item: WorkItem, signal: AbortSignal) => Promise<void>
}

const runtimeWithConfig = (config: GitLabConfig, configurationInvalid = false): AppGitLabRuntime => ({
  config,
  configurationInvalid,
  loadWorkspace: (scope, signal) => runGitLabEffect(loadWorkspace(scope), { signal }),
  listGroupBoards: (signal) => runGitLabEffect(listGroupBoards(), { signal }),
  loadGroupBoardSnapshot: (boardId, signal) => runGitLabEffect(loadGroupBoardSnapshot(boardId), { signal }),
  listAssignedEpics: (signal) => runGitLabEffect(listAssignedEpics(), { signal }),
  loadEpicHierarchy: (epicId, signal) => runGitLabEffect(loadEpicHierarchy(epicId), { signal }),
  moveWorkItem: (item, target, signal) => runGitLabEffect(moveWorkItem(item, target), { signal }),
  setWorkItemState: (item, state, signal) => runGitLabEffect(setWorkItemState(item, state), { signal }),
  createWorkItem: (project, title, signal) => runGitLabEffect(createWorkItem(project, title), { signal }),
  openWorkItem: (item, signal) => runGitLabEffect(openWorkItem(item), { signal }),
})

export const liveGitLabRuntime = (): AppGitLabRuntime => {
  try {
    return runtimeWithConfig(gitLabConfigFromEnv())
  } catch {
    return runtimeWithConfig(gitLabConfigFromEnv({ GITLAB_HOST: "https://gitlab.com" }), true)
  }
}

type AppProps = {
  readonly gitLab?: AppGitLabRuntime
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

const numericEntityId = (value: number | string | null, fallback: number) => {
  if (typeof value === "number" && Number.isSafeInteger(value) && value > 0) return value
  if (typeof value === "string") {
    const match = value.match(/([1-9][0-9]*)$/u)
    const parsed = match ? Number(match[1]) : Number.NaN
    if (Number.isSafeInteger(parsed)) return parsed
  }
  return fallback
}

const nativeBoardSnapshot = (
  snapshot: GitLabGroupBoardSnapshot,
  entry: BoardCatalogEntry,
  summary: GitLabGroupBoardSummary | null,
): BoardSnapshot => {
  const readOnlyMove = {
    kind: "read-only" as const,
    reason: "Native GitLab board movement is not enabled yet",
  }
  const visibleLists = snapshot.lists.filter(
    (list) =>
      !(list.kind === "backlog" && summary?.hideBacklogList) && !(list.kind === "closed" && summary?.hideClosedList),
  )
  const columns = visibleLists.map((list) => {
    const fallbackId = list.gitLabListId ?? list.position + 1
    const valueId = numericEntityId(list.valueId, fallbackId)
    const target =
      list.kind === "backlog"
        ? ({ kind: "backlog" } as const)
        : list.kind === "closed"
          ? ({ kind: "closed" } as const)
          : list.kind === "label"
            ? ({ kind: "label", labelId: valueId, labelName: list.title } as const)
            : list.kind === "assignee"
              ? ({ kind: "assignee", userId: valueId, username: list.title } as const)
              : list.kind === "milestone"
                ? ({ kind: "milestone", milestoneId: valueId, title: list.title } as const)
                : list.kind === "iteration"
                  ? ({ kind: "iteration", iterationId: valueId, title: list.title } as const)
                  : list.kind === "status"
                    ? ({ kind: "status", statusId: valueId, name: list.title } as const)
                    : ({ kind: "unknown", rawKind: list.rawKind || "unknown" } as const)
    return {
      id: list.id,
      title: list.title,
      hint: "GitLab list · read only",
      color: list.color,
      position: list.position,
      gitLabListId: list.gitLabListId,
      list: target,
      move: readOnlyMove,
    }
  })
  return {
    board: entry,
    columns,
    items: snapshot.items,
    cards: snapshot.cards
      .filter((card) => visibleLists.some((list) => list.id === card.listId))
      .map((card) => ({
        itemId: card.itemId,
        columnId: card.listId,
        position: card.position,
        parentItemId: null,
        depth: 0,
      })),
    fetchedAt: snapshot.fetchedAt,
  }
}

const epicBoardSnapshot = (hierarchy: GitLabEpicHierarchy, entry: BoardCatalogEntry): BoardSnapshot => {
  const descendants = hierarchy.descendants.filter(({ item }) => item.type !== "EPIC")
  return {
    board: {
      ...entry,
      itemCount: descendants.length,
    },
    columns: workflowBoardColumns,
    items: descendants.map(({ item }) => item),
    cards: descendants.map(({ item, parentId, depth }, position) => ({
      itemId: item.id,
      columnId: workflowColumnOf(item),
      position,
      parentItemId: parentId,
      depth,
    })),
    fetchedAt: new Date().toISOString(),
  }
}

export const App = (props: AppProps = {}) => {
  const renderer = useRenderer()
  const dimensions = useTerminalDimensions()
  const gitLab = props.gitLab ?? liveGitLabRuntime()
  const config = gitLab.config
  const [surface, setSurface] = createSignal<Surface>("board")
  const [scopeIndex, setScopeIndex] = createSignal(0)
  const [workItemsIndex, setWorkItemsIndex] = createSignal(0)
  const [workItemFilter, setWorkItemFilter] = createSignal<WorkItemStateFilter>("open")
  const [workItemQuery, setWorkItemQuery] = createSignal("")
  const [workItemQueryEditing, setWorkItemQueryEditing] = createSignal(false)
  const [boardColumnIndex, setBoardColumnIndex] = createSignal(0)
  const [boardCardIndex, setBoardCardIndex] = createSignal(0)
  const [activeBoard, setActiveBoard] = createSignal<BoardRef>({ kind: "smart", scope: "assigned" })
  const [activeSnapshot, setActiveSnapshot] = createSignal<BoardSnapshot | null>(null)
  const [boardPickerOpen, setBoardPickerOpen] = createSignal(false)
  const [groupBoards, setGroupBoards] = createSignal<readonly GitLabGroupBoardSummary[]>([])
  const [assignedEpics, setAssignedEpics] = createSignal<readonly WorkItem[]>([])
  const [catalogStatus, setCatalogStatus] = createSignal<"idle" | "loading" | "ready" | "partial">("idle")
  const [catalogNotice, setCatalogNotice] = createSignal<string | null>(null)
  const [catalogRefreshKey, setCatalogRefreshKey] = createSignal(0)
  const [items, setItems] = createSignal<readonly WorkItem[]>([])
  const [username, setUsername] = createSignal("GitLab")
  const [status, setStatus] = createSignal<"loading" | "ready" | "error">("loading")
  const [error, setError] = createSignal<{ readonly detail: string; readonly remediation: string } | null>(null)
  const [refreshKey, setRefreshKey] = createSignal(0)
  const [pendingItemId, setPendingItemId] = createSignal<string | null>(null)
  const [toast, setToast] = createSignal("Loading your GitLab workspace…")
  const [createForm, setCreateForm] = createSignal<CreateForm | null>(null)
  const [summaryItemId, setSummaryItemId] = createSignal<string | null>(null)
  const [creating, setCreating] = createSignal(false)
  const operationControllers = new Set<AbortController>()
  let disposed = false

  const runOperation = <A,>(operation: (signal: AbortSignal) => Promise<A>) => {
    const controller = new AbortController()
    operationControllers.add(controller)
    const promise = Promise.resolve()
      .then(() => operation(controller.signal))
      .finally(() => operationControllers.delete(controller))
    return { controller, promise }
  }

  onCleanup(() => {
    disposed = true
    for (const controller of operationControllers) controller.abort()
    operationControllers.clear()
  })

  const width = createMemo(() => dimensions().width)
  const height = createMemo(() => dimensions().height)
  const scope = createMemo(() => scopes[scopeIndex()]?.id ?? "assigned")
  const grouped = createMemo(() => workItemsByColumn(items()))
  const filteredItems = createMemo(() => filterWorkItems(items(), workItemFilter(), workItemQuery()))
  const boardColumns = createMemo(() => activeSnapshot()?.columns ?? workflowBoardColumns)
  const boardCards = createMemo(() => {
    const snapshot = activeSnapshot()
    if (!snapshot) return null
    if (snapshot.board.ref.kind !== "epic") return snapshot.cards
    const itemById = new Map(items().map((item) => [item.id, item]))
    return snapshot.cards.map((card) => {
      const item = itemById.get(card.itemId)
      return item ? { ...card, columnId: workflowColumnOf(item) } : card
    })
  })
  const boardColumn = createMemo(() => boardColumns()[boardColumnIndex()] ?? boardColumns()[0] ?? null)
  const boardItems = createMemo(() => {
    const column = boardColumn()
    if (!column) return []
    const snapshot = activeSnapshot()
    if (snapshot)
      return boardItemsInColumn(
        {
          ...snapshot,
          items: items(),
          cards: boardCards() ?? snapshot.cards,
        },
        column.id,
      )
    if (column.list.kind === "workflow") return grouped()[column.list.column]
    return []
  })
  const workItemsSelected = createMemo(() => filteredItems()[workItemsIndex()] ?? null)
  const boardSelected = createMemo(() => boardItems()[boardCardIndex()] ?? null)
  const selected = createMemo(() => (surface() === "work-items" ? workItemsSelected() : boardSelected()))
  const summaryItem = createMemo(() => items().find((item) => item.id === summaryItemId()) ?? null)
  const contentHeight = createMemo(() => Math.max(1, height() - 6))
  const scopeLabel = createMemo(() => scopes[scopeIndex()]?.label ?? "My work")
  const boardCatalog = createMemo<readonly BoardCatalogEntry[]>(() => [
    ...scopes.map((candidate) => ({
      ref: { kind: "smart" as const, scope: candidate.id },
      title: candidate.label,
      subtitle:
        candidate.id === "assigned"
          ? "Assigned to me"
          : candidate.id === "created"
            ? "Created by me"
            : config.group
              ? `All work in ${config.group}`
              : "Set GLWI_GROUP to enable",
      itemCount: candidate.id === scope() && activeBoard().kind === "smart" ? items().length : null,
      webUrl: null,
      unavailableReason: candidate.id === "organization" && !config.group ? "GLWI_GROUP is not configured" : null,
      capabilities: ["refresh", "filter", "move-cards"] as const,
    })),
    ...groupBoards().map((board) => ({
      ref: { kind: "gitlab" as const, groupPath: config.group ?? board.group.name, boardId: board.id },
      title: board.name,
      subtitle: `GitLab board · ${config.group ?? board.group.name}`,
      itemCount: null,
      webUrl: `${board.group.webUrl.replace(/\/+$/u, "")}/-/boards/${board.id}`,
      unavailableReason: null,
      capabilities: ["refresh", "filter"] as const,
    })),
    ...assignedEpics().map((epic) => ({
      ref: { kind: "epic" as const, epicId: epic.id },
      title: epic.title,
      subtitle: `${epic.reference} · assigned epic`,
      itemCount: null,
      webUrl: epic.webUrl,
      unavailableReason: null,
      capabilities: ["refresh", "filter", "move-cards", "hierarchy"] as const,
    })),
  ])
  const activeBoardEntry = createMemo(
    () => boardCatalog().find((entry) => boardRefKey(entry.ref) === boardRefKey(activeBoard())) ?? null,
  )
  const activeBoardTitle = createMemo(() => {
    const entry = activeSnapshot()?.board ?? activeBoardEntry()
    if (!entry) return scopeLabel()
    if (entry.ref.kind === "gitlab") return `GitLab · ${entry.title}`
    if (entry.ref.kind === "epic") return `Epic · ${entry.title}`
    return entry.title
  })
  const activeBoardBadge = createMemo(() => {
    const kind = activeBoard().kind
    return kind === "gitlab" ? "GITLAB" : kind === "epic" ? "EPIC" : "SMART"
  })
  const boardPickerEntries = createMemo<readonly BoardPickerEntry[]>(() =>
    boardCatalog().map((entry) => ({
      id: boardRefKey(entry.ref),
      kind: entry.ref.kind,
      title: entry.title,
      ...(entry.subtitle ? { subtitle: entry.subtitle } : {}),
      ...(entry.itemCount === null ? {} : { badge: String(entry.itemCount) }),
      unavailableReason: entry.unavailableReason,
    })),
  )
  const itemMutationsEnabled = createMemo(() => activeBoard().kind !== "gitlab")
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
    if (activeBoard().kind === "gitlab")
      return width() >= 72 ? "b boards  h/l lists  j/k cards  enter details  r sync" : "b boards  h/l list  j/k card"
    if (width() >= 72) return "b boards  h/l stages  j/k cards  [/] move  enter details  drag with ⠿"
    return "b boards  h/l stage  j/k card  [ ] move"
  })

  const refresh = () => {
    if (pendingItemId() || creating()) {
      setToast("Wait for the current GitLab update to finish")
      return
    }
    setRefreshKey((value) => value + 1)
    setCatalogRefreshKey((value) => value + 1)
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
    catalogRefreshKey()
    if (gitLab.configurationInvalid || !config.group) {
      batch(() => {
        setGroupBoards([])
        setAssignedEpics([])
        setCatalogStatus("idle")
        setCatalogNotice(config.group ? "Board discovery is unavailable until the configuration is fixed." : null)
      })
      return
    }

    batch(() => {
      setCatalogStatus("loading")
      setCatalogNotice(null)
    })
    const operation = runOperation((signal) =>
      Promise.allSettled([gitLab.listGroupBoards(signal), gitLab.listAssignedEpics(signal)]),
    )
    void operation.promise.then((results) => {
      if (disposed || operation.controller.signal.aborted) return
      const [boardsResult, epicsResult] = results
      const failures: string[] = []
      batch(() => {
        if (boardsResult?.status === "fulfilled") setGroupBoards(boardsResult.value)
        else {
          if (boardsResult) failures.push(`boards: ${messageOf(boardsResult.reason)}`)
        }
        if (epicsResult?.status === "fulfilled") setAssignedEpics(epicsResult.value)
        else {
          if (epicsResult) failures.push(`epics: ${messageOf(epicsResult.reason)}`)
        }
        setCatalogStatus(failures.length === 0 ? "ready" : "partial")
        setCatalogNotice(failures.length === 0 ? null : failures.join(" · "))
      })
    })

    onCleanup(() => operation.controller.abort())
  })

  createEffect(() => {
    const requestedBoard = activeBoard()
    const requestedScope = requestedBoard.kind === "smart" ? requestedBoard.scope : scope()
    refreshKey()

    batch(() => {
      setStatus("loading")
      setError(null)
      setSummaryItemId(null)
      setToast("Syncing with GitLab…")
    })

    const operation = runOperation(async (signal) => {
      if (requestedBoard.kind === "smart")
        return { kind: "workspace" as const, workspace: await gitLab.loadWorkspace(requestedBoard.scope, signal) }

      const entry =
        boardCatalog().find((candidate) => boardRefKey(candidate.ref) === boardRefKey(requestedBoard)) ?? null
      if (!entry) throw new Error("The selected board is no longer available")
      if (requestedBoard.kind === "epic") {
        const hierarchy = await gitLab.loadEpicHierarchy(requestedBoard.epicId, signal)
        return { kind: "snapshot" as const, snapshot: epicBoardSnapshot(hierarchy, entry) }
      }
      const snapshot = await gitLab.loadGroupBoardSnapshot(requestedBoard.boardId, signal)
      const summary = groupBoards().find((board) => board.id === requestedBoard.boardId) ?? null
      return { kind: "snapshot" as const, snapshot: nativeBoardSnapshot(snapshot, entry, summary) }
    })
    void operation.promise.then(
      (result) => {
        if (disposed || operation.controller.signal.aborted) return
        const nextItems = result.kind === "workspace" ? result.workspace.items : result.snapshot.items
        const nextSnapshot = result.kind === "snapshot" ? result.snapshot : null
        const initialGroups = workItemsByColumn(nextItems)
        const firstPopulatedColumn =
          nextSnapshot === null
            ? workflowColumns.findIndex((column) => initialGroups[column.id].length > 0)
            : nextSnapshot.columns.findIndex((column) => nextSnapshot.cards.some((card) => card.columnId === column.id))
        batch(() => {
          setItems(nextItems)
          setActiveSnapshot(nextSnapshot)
          if (result.kind === "workspace") setUsername(result.workspace.user.username)
          setWorkItemsIndex(0)
          setBoardColumnIndex(Math.max(0, firstPopulatedColumn))
          setBoardCardIndex(0)
          setStatus("ready")
          setToast(`${nextItems.length} work items synced`)
        })
      },
      (cause) => {
        if (disposed || operation.controller.signal.aborted) return
        batch(() => {
          setItems([])
          setActiveSnapshot(null)
          setError({
            detail: gitLab.configurationInvalid ? "GitLab configuration is invalid." : messageOf(cause),
            remediation: gitLab.configurationInvalid
              ? "Fix GITLAB_HOST or GLWI_GROUP, then restart."
              : remediationOf(cause, requestedScope, config.group),
          })
          setStatus("error")
          setToast("GitLab sync failed")
        })
      },
    )

    onCleanup(() => operation.controller.abort())
  })

  const selectScope = (next: WorkItemScope) => {
    if (pendingItemId() || creating()) {
      setToast("Wait for the current GitLab update to finish")
      return
    }
    const index = scopes.findIndex((candidate) => candidate.id === next)
    if (index >= 0)
      batch(() => {
        setScopeIndex(index)
        setActiveBoard({ kind: "smart", scope: next })
      })
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
    if (activeBoard().kind === "gitlab") {
      setToast("Create from a smart view so the destination project is explicit")
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

    const operation = runOperation((signal) => gitLab.moveWorkItem(item, target, signal))
    void operation.promise.then(
      (updated) => {
        if (disposed || operation.controller.signal.aborted) return
        batch(() => {
          setItems((current) => current.map((candidate) => (candidate.id === item.id ? updated : candidate)))
          setPendingItemId(null)
          setToast(`${item.reference} moved to ${workflowColumns[targetIndex]?.label ?? target}`)
        })
      },
      (cause) => {
        if (disposed || operation.controller.signal.aborted) return
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
    if (activeBoard().kind === "gitlab") {
      setToast("This native GitLab board is read only")
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

    const operation = runOperation((signal) => gitLab.setWorkItemState(item, nextState, signal))
    void operation.promise.then(
      (updated) => {
        if (disposed || operation.controller.signal.aborted) return
        batch(() => {
          setItems((current) => current.map((candidate) => (candidate.id === item.id ? updated : candidate)))
          setPendingItemId(null)
          setToast(`${item.reference} ${nextState === "CLOSED" ? "closed" : "reopened"}`)
        })
      },
      (cause) => {
        if (disposed || operation.controller.signal.aborted) return
        batch(() => {
          setItems((current) => current.map((candidate) => (candidate.id === item.id ? item : candidate)))
          setPendingItemId(null)
          setToast(`Update failed · ${messageOf(cause)}`)
        })
      },
    )
  }

  const openInGitLab = (item: WorkItem) => {
    if (status() !== "ready") {
      setToast("Wait for GitLab sync to finish")
      return
    }
    setToast(`Opening ${item.reference} in GitLab…`)
    const operation = runOperation((signal) => gitLab.openWorkItem(item, signal))
    void operation.promise.then(
      () => {
        if (!disposed && !operation.controller.signal.aborted) setToast(`${item.reference} opened in GitLab`)
      },
      (cause) => {
        if (!disposed && !operation.controller.signal.aborted) setToast(`Open failed · ${messageOf(cause)}`)
      },
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
    const operation = runOperation((signal) => gitLab.createWorkItem(project, title, signal))
    void operation.promise.then(
      (created) => {
        if (disposed || operation.controller.signal.aborted) return
        const createdScopeIndex = scopes.findIndex((candidate) => candidate.id === "created")
        const alreadyShowingCreated = activeBoard().kind === "smart" && scope() === "created"
        batch(() => {
          if (alreadyShowingCreated) setItems((current) => [created, ...current])
          else if (createdScopeIndex >= 0) {
            setScopeIndex(createdScopeIndex)
            setActiveBoard({ kind: "smart", scope: "created" })
          }
          setWorkItemFilter("open")
          setWorkItemQuery("")
          setWorkItemsIndex(0)
          setCreating(false)
          setCreateForm(null)
          setSurface("work-items")
          setToast(
            alreadyShowingCreated
              ? `${created.reference} created`
              : `${created.reference} created · loading Created by me…`,
          )
        })
      },
      (cause) => {
        if (disposed || operation.controller.signal.aborted) return
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

    if (boardPickerOpen()) return

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
    if (key.name === "b") {
      key.preventDefault()
      key.stopPropagation()
      if (pendingItemId() || creating()) {
        setToast("Wait for the current GitLab update to finish")
        return
      }
      if (catalogNotice()) setToast(`Some board sources are unavailable · ${catalogNotice()}`)
      setBoardPickerOpen(true)
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
        if (status() !== "ready") {
          setToast("Wait for GitLab sync to finish")
          return
        }
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
        setBoardColumnIndex((index) => Math.min(Math.max(0, boardColumns().length - 1), index + 1))
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
      if (status() !== "ready") {
        setToast("Wait for GitLab sync to finish")
        return
      }
      setSummaryItemId(currentBoardItem.id)
      return
    }
    if ((key.sequence === "[" || key.name === "[") && currentBoardItem && boardColumnIndex() > 0) {
      const target = boardColumns()[boardColumnIndex() - 1]
      if (target?.list.kind === "workflow") move(currentBoardItem, target.list.column)
      else setToast("This native GitLab board is read only")
      return
    }
    if (
      (key.sequence === "]" || key.name === "]") &&
      currentBoardItem &&
      boardColumnIndex() < boardColumns().length - 1
    ) {
      const target = boardColumns()[boardColumnIndex() + 1]
      if (target?.list.kind === "workflow") move(currentBoardItem, target.list.column)
      else setToast("This native GitLab board is read only")
    }
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
            <StyledSpan fg={gitLab.configurationInvalid ? colors.error : config.mock ? colors.warning : colors.success}>
              ●
            </StyledSpan>{" "}
            {gitLab.configurationInvalid
              ? "configuration error"
              : config.mock
                ? width() < 60
                  ? "sample"
                  : "sample workspace"
                : ellipsis(config.hostDisplay, width() < 72 ? 18 : 36)}
          </text>
        </box>
        <box height={1} paddingLeft={1} paddingRight={1} flexDirection="row" justifyContent="space-between">
          <SurfaceTabs active={surface()} compact={width() < 64} onSelect={setSurface} />
          <text fg={status() === "loading" ? colors.warning : status() === "error" ? colors.error : colors.success}>
            {status() === "loading" ? "◌ syncing" : status() === "error" ? "! error" : "● ready"}
          </text>
        </box>
        <box height={1} paddingLeft={1} paddingRight={1} flexDirection="row" justifyContent="space-between">
          <Show
            when={activeBoard().kind === "smart"}
            fallback={
              <>
                <text fg={colors.muted} wrapMode="none" truncate>
                  <StyledSpan fg={activeBoard().kind === "epic" ? colors.epic : colors.gitlab}>
                    {activeBoard().kind === "epic" ? "◆" : "▦"}
                  </StyledSpan>{" "}
                  {ellipsis(activeBoardTitle(), Math.max(12, width() - 28))}
                </text>
                <Show when={width() >= 64}>
                  <text fg={colors.subtle}>b switch · tab smart views</text>
                </Show>
              </>
            }
          >
            <ScopeTabs active={scope()} group={config.group} compact={width() < 76} onSelect={selectScope} />
            <Show when={width() >= 76}>
              <text fg={colors.subtle}>tab changes scope · b all boards</text>
            </Show>
          </Show>
        </box>
        <text fg={colors.border}>{"─".repeat(Math.max(1, width()))}</text>

        <Switch
          fallback={
            <Board
              width={width()}
              height={contentHeight()}
              items={items()}
              columns={boardColumns()}
              {...(boardCards() ? { cards: boardCards()! } : {})}
              title={activeBoardTitle()}
              badge={activeBoardBadge()}
              {...(activeBoard().kind === "epic" ? { emptyTitle: "No actionable work in this epic yet" } : {})}
              {...(activeBoard().kind === "gitlab"
                ? { emptyHint: "No cards are visible in this board. Press r to sync again." }
                : {})}
              focusedColumnIndex={boardColumnIndex()}
              selectedIndex={boardCardIndex()}
              pendingItemId={pendingItemId()}
              onSelect={(column, index) => {
                const nextColumn = boardColumns().findIndex((candidate) => candidate.id === column.id)
                batch(() => {
                  if (nextColumn >= 0) setBoardColumnIndex(nextColumn)
                  setBoardCardIndex(index)
                })
              }}
              {...(activeBoard().kind === "gitlab"
                ? {}
                : {
                    onMove: (item: WorkItem, column: (typeof workflowBoardColumns)[number]) => {
                      if (column.list.kind === "workflow") move(item, column.list.column)
                    },
                  })}
            />
          }
        >
          <Match when={status() === "loading"}>
            <LoadingWorkspace width={width()} height={contentHeight()} scope={activeBoardTitle()} />
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
                {error()?.detail ?? "The request failed."}
              </text>
              <Show when={width() >= 64}>
                <box height={1} />
              </Show>
              <text fg={colors.muted} height={width() < 64 ? 2 : 1} wrapMode={width() < 64 ? "word" : "none"} truncate>
                {error()?.remediation ?? "Press r to retry."}
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
              mutationEnabled={itemMutationsEnabled()}
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
          <Show when={width() >= 112 && itemMutationsEnabled()}>
            <text fg={colors.muted}>o GitLab x close/reopen r sync q quit</text>
          </Show>
          <Show when={width() >= 112 && !itemMutationsEnabled()}>
            <text fg={colors.muted}>o GitLab · read only · r sync q quit</text>
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
              mutationEnabled={itemMutationsEnabled()}
              onOpen={() => openInGitLab(item())}
              onToggleState={() => toggleState(item())}
              onClose={() => setSummaryItemId(null)}
            />
          )}
        </Show>
        <Show when={boardPickerOpen()}>
          <BoardPicker
            screenWidth={width()}
            screenHeight={height()}
            entries={boardPickerEntries()}
            activeId={boardRefKey(activeBoard())}
            title={catalogStatus() === "loading" ? "Switch board · syncing" : "Switch board"}
            notice={catalogNotice()}
            onSelect={(entry) => {
              const selectedBoard = boardCatalog().find((candidate) => boardRefKey(candidate.ref) === entry.id)
              if (!selectedBoard || selectedBoard.unavailableReason) return
              batch(() => {
                if (selectedBoard.ref.kind === "smart") selectScope(selectedBoard.ref.scope)
                else {
                  setActiveBoard(selectedBoard.ref)
                  setBoardColumnIndex(0)
                  setBoardCardIndex(0)
                  setSurface("board")
                }
                setBoardPickerOpen(false)
              })
            }}
            onClose={() => setBoardPickerOpen(false)}
          />
        </Show>
      </box>
    </Show>
  )
}
