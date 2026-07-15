import {
  applyWorkflowTransition,
  workflowColumns,
  workItemsByColumn,
  type WorkflowColumnId,
  type WorkItem,
  type WorkItemScope,
} from "@github-work-items/domain"
import {
  createWorkItem,
  gitLabConfigFromEnv,
  loadWorkspace,
  moveWorkItem,
  openWorkItem,
  setWorkItemState,
} from "@github-work-items/gitlab"
import { TextAttributes } from "@opentui/core"
import { useKeyboard, useRenderer, useTerminalDimensions } from "@opentui/react"
import { Effect } from "effect"
import { useCallback, useEffect, useMemo, useState } from "react"
import { Board } from "./components/Board.tsx"
import { CreateWorkItemModal } from "./components/CreateWorkItemModal.tsx"
import { Overview } from "./components/Overview.tsx"
import { ScopeTabs, scopes, SurfaceTabs, type Surface } from "./components/Tabs.tsx"
import { colors } from "./theme.ts"

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

export const App = () => {
  const renderer = useRenderer()
  const { width, height } = useTerminalDimensions()
  const config = useMemo(() => gitLabConfigFromEnv(), [])
  const [surface, setSurface] = useState<Surface>("overview")
  const [scopeIndex, setScopeIndex] = useState(0)
  const [overviewIndex, setOverviewIndex] = useState(0)
  const [boardColumnIndex, setBoardColumnIndex] = useState(0)
  const [boardCardIndex, setBoardCardIndex] = useState(0)
  const [items, setItems] = useState<readonly WorkItem[]>([])
  const [username, setUsername] = useState("GitLab")
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading")
  const [error, setError] = useState<string | null>(null)
  const [refreshKey, setRefreshKey] = useState(0)
  const [pendingItemId, setPendingItemId] = useState<string | null>(null)
  const [toast, setToast] = useState("Loading your GitLab workspace…")
  const [createForm, setCreateForm] = useState<CreateForm | null>(null)
  const [creating, setCreating] = useState(false)
  const scope = scopes[scopeIndex]?.id ?? "assigned"
  const grouped = useMemo(() => workItemsByColumn(items), [items])
  const boardColumn = workflowColumns[boardColumnIndex] ?? workflowColumns[0]
  const boardItems = grouped[boardColumn.id]
  const overviewSelected = items[overviewIndex] ?? null
  const boardSelected = boardItems[boardCardIndex] ?? null
  const selected = surface === "overview" ? overviewSelected : boardSelected

  const refresh = useCallback(() => setRefreshKey((value) => value + 1), [])

  useEffect(() => {
    renderer.setBackgroundColor(colors.background)
  }, [renderer])

  useEffect(() => {
    let cancelled = false
    setStatus("loading")
    setError(null)
    setToast("Syncing with GitLab…")
    void Effect.runPromise(loadWorkspace(scope)).then(
      (workspace) => {
        if (cancelled) return
        setItems(workspace.items)
        setUsername(workspace.user.username)
        setOverviewIndex(0)
        const firstPopulatedColumn = workflowColumns.findIndex(
          (column) => workItemsByColumn(workspace.items)[column.id].length > 0,
        )
        setBoardColumnIndex(Math.max(0, firstPopulatedColumn))
        setBoardCardIndex(0)
        setStatus("ready")
        setToast(`${workspace.items.length} work items synced`)
      },
      (cause) => {
        if (cancelled) return
        setItems([])
        setError(messageOf(cause))
        setStatus("error")
        setToast("GitLab sync failed")
      },
    )
    return () => {
      cancelled = true
    }
  }, [scope, refreshKey])

  const selectScope = useCallback((next: WorkItemScope) => {
    const index = scopes.findIndex((candidate) => candidate.id === next)
    if (index >= 0) setScopeIndex(index)
  }, [])

  const openCreate = useCallback(() => {
    setCreateForm({
      project: selected?.namespace ?? config.group ?? "",
      title: "",
      field: selected ? "title" : "project",
    })
  }, [config.group, selected])

  const move = useCallback(
    (item: WorkItem, target: WorkflowColumnId) => {
      if (pendingItemId) return
      const optimistic = applyWorkflowTransition(item, target)
      const optimisticItems = items.map((candidate) => (candidate.id === item.id ? optimistic : candidate))
      const targetIndex = workflowColumns.findIndex((column) => column.id === target)
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
      void Effect.runPromise(moveWorkItem(item, target)).then(
        (updated) => {
          setItems((current) => current.map((candidate) => (candidate.id === item.id ? updated : candidate)))
          setPendingItemId(null)
          setToast(`${item.reference} moved to ${workflowColumns[targetIndex]?.label ?? target}`)
        },
        (cause) => {
          setItems((current) => current.map((candidate) => (candidate.id === item.id ? item : candidate)))
          setPendingItemId(null)
          setToast(`Move failed · ${messageOf(cause)}`)
        },
      )
    },
    [items, pendingItemId],
  )

  const toggleState = useCallback(
    (item: WorkItem) => {
      if (pendingItemId) return
      const nextState = item.state === "OPEN" ? "CLOSED" : "OPEN"
      setPendingItemId(item.id)
      setItems((current) =>
        current.map((candidate) => (candidate.id === item.id ? { ...candidate, state: nextState } : candidate)),
      )
      setToast(`${nextState === "CLOSED" ? "Closing" : "Reopening"} ${item.reference}…`)
      void Effect.runPromise(setWorkItemState(item, nextState)).then(
        (updated) => {
          setItems((current) => current.map((candidate) => (candidate.id === item.id ? updated : candidate)))
          setPendingItemId(null)
          setToast(`${item.reference} ${nextState === "CLOSED" ? "closed" : "reopened"}`)
        },
        (cause) => {
          setItems((current) => current.map((candidate) => (candidate.id === item.id ? item : candidate)))
          setPendingItemId(null)
          setToast(`Update failed · ${messageOf(cause)}`)
        },
      )
    },
    [pendingItemId],
  )

  const openInGitLab = useCallback((item: WorkItem) => {
    setToast(`Opening ${item.reference} in GitLab…`)
    void Effect.runPromise(openWorkItem(item)).then(
      () => setToast(`${item.reference} opened in GitLab`),
      (cause) => setToast(`Open failed · ${messageOf(cause)}`),
    )
  }, [])

  const submitCreate = useCallback(() => {
    if (!createForm || creating) return
    const project = createForm.project.trim()
    const title = createForm.title.trim()
    if (!project) {
      setCreateForm({ ...createForm, field: "project" })
      setToast("Choose a GitLab project path")
      return
    }
    if (!title) {
      setCreateForm({ ...createForm, field: "title" })
      setToast("Give the work item a title")
      return
    }
    setCreating(true)
    setToast(`Creating work item in ${project}…`)
    void Effect.runPromise(createWorkItem(project, title)).then(
      (created) => {
        setItems((current) => [created, ...current])
        setOverviewIndex(0)
        setCreating(false)
        setCreateForm(null)
        setSurface("overview")
        setToast(`${created.reference} created`)
      },
      (cause) => {
        setCreating(false)
        setToast(`Create failed · ${messageOf(cause)}`)
      },
    )
  }, [createForm, creating])

  useKeyboard((key) => {
    if (createForm) {
      if (key.name === "escape") setCreateForm(null)
      if (key.name === "tab")
        setCreateForm((current) =>
          current ? { ...current, field: current.field === "project" ? "title" : "project" } : null,
        )
      return
    }
    if (key.name === "q" || (key.ctrl && key.name === "c")) {
      renderer.destroy()
      return
    }
    if (key.name === "1") {
      setSurface("overview")
      return
    }
    if (key.name === "2") {
      setSurface("board")
      return
    }
    if (key.name === "tab") {
      setScopeIndex((index) => (key.shift ? (index + scopes.length - 1) % scopes.length : (index + 1) % scopes.length))
      return
    }
    if (key.name === "r") {
      refresh()
      return
    }
    if (key.name === "n") {
      openCreate()
      return
    }
    if (key.name === "o" && selected) {
      openInGitLab(selected)
      return
    }
    if (key.name === "x" && selected) {
      toggleState(selected)
      return
    }
    if (surface === "overview") {
      if (key.name === "j" || key.name === "down") setOverviewIndex((index) => Math.min(items.length - 1, index + 1))
      if (key.name === "k" || key.name === "up") setOverviewIndex((index) => Math.max(0, index - 1))
      return
    }

    if (key.name === "h" || key.name === "left") {
      setBoardColumnIndex((index) => Math.max(0, index - 1))
      setBoardCardIndex(0)
      return
    }
    if (key.name === "l" || key.name === "right") {
      setBoardColumnIndex((index) => Math.min(workflowColumns.length - 1, index + 1))
      setBoardCardIndex(0)
      return
    }
    if (key.name === "j" || key.name === "down") {
      setBoardCardIndex((index) => Math.min(boardItems.length - 1, index + 1))
      return
    }
    if (key.name === "k" || key.name === "up") {
      setBoardCardIndex((index) => Math.max(0, index - 1))
      return
    }
    if ((key.sequence === "[" || key.name === "[") && boardSelected && boardColumnIndex > 0) {
      move(boardSelected, workflowColumns[boardColumnIndex - 1]?.id ?? "backlog")
      return
    }
    if ((key.sequence === "]" || key.name === "]") && boardSelected && boardColumnIndex < workflowColumns.length - 1)
      move(boardSelected, workflowColumns[boardColumnIndex + 1]?.id ?? "closed")
  })

  const contentHeight = Math.max(8, height - 7)
  const authError = status === "error"

  return (
    <box width={width} height={height} flexDirection="column" backgroundColor={colors.background}>
      <box height={2} paddingLeft={1} paddingRight={1} justifyContent="space-between" alignItems="center">
        <text fg={colors.text} attributes={TextAttributes.BOLD}>
          <span fg={colors.accent}>◆</span> work items <span fg={colors.muted}>/ @{username}</span>
        </text>
        <text fg={config.mock ? colors.warning : colors.success}>
          <span fg={colors.gitlab}>●</span> {config.mock ? "sample workspace" : config.host.replace(/^https?:\/\//, "")}
        </text>
      </box>
      <box height={1} paddingLeft={1} paddingRight={1} justifyContent="space-between">
        <SurfaceTabs active={surface} onSelect={setSurface} />
        <text fg={status === "loading" ? colors.warning : status === "error" ? colors.error : colors.success}>
          {status === "loading" ? "syncing" : status}
        </text>
      </box>
      <box height={1} paddingLeft={1}>
        <ScopeTabs active={scope} group={config.group} onSelect={selectScope} />
      </box>

      {authError ? (
        <box
          width={width}
          height={contentHeight}
          border
          borderStyle="single"
          borderColor={colors.error}
          backgroundColor={colors.panel}
          padding={2}
          flexDirection="column"
          title=" GitLab connection "
        >
          <text fg={colors.error} attributes={TextAttributes.BOLD}>
            GitLab could not load this workspace
          </text>
          <text fg={colors.text}>{error ?? "The request failed."}</text>
          <box height={1} />
          <text fg={colors.muted}>Set GITLAB_TOKEN or run `glab auth login`, then press r.</text>
          <text fg={colors.muted}>For organization scope, set GWI_GROUP to the full group path.</text>
        </box>
      ) : surface === "overview" ? (
        <Overview
          width={width}
          height={contentHeight}
          items={items}
          selectedIndex={overviewIndex}
          onSelect={setOverviewIndex}
          onCreate={openCreate}
        />
      ) : (
        <Board
          width={width}
          height={contentHeight}
          items={items}
          focusedColumnIndex={boardColumnIndex}
          selectedIndex={boardCardIndex}
          pendingItemId={pendingItemId}
          onSelect={(column, index) => {
            const nextColumn = workflowColumns.findIndex((candidate) => candidate.id === column)
            if (nextColumn >= 0) setBoardColumnIndex(nextColumn)
            setBoardCardIndex(index)
          }}
          onMove={move}
        />
      )}

      <box height={1} paddingLeft={1} paddingRight={1} backgroundColor={colors.panel}>
        <text fg={toast.includes("failed") ? colors.error : colors.muted}>{toast}</text>
      </box>
      <box height={2} paddingLeft={1} paddingRight={1} justifyContent="space-between" alignItems="center">
        <text fg={colors.muted}>
          {surface === "board" ? "h/l columns  j/k cards  [/] move  drag/drop" : "j/k select  n create"}
        </text>
        <text fg={colors.muted}>o GitLab x close/reopen tab scope r sync q quit</text>
      </box>

      {createForm ? (
        <CreateWorkItemModal
          screenWidth={width}
          screenHeight={height}
          project={createForm.project}
          title={createForm.title}
          field={createForm.field}
          busy={creating}
          onProjectChange={(project) => setCreateForm((current) => (current ? { ...current, project } : null))}
          onTitleChange={(title) => setCreateForm((current) => (current ? { ...current, title } : null))}
          onFieldChange={(field) => setCreateForm((current) => (current ? { ...current, field } : null))}
          onSubmit={submitCreate}
          onClose={() => setCreateForm(null)}
        />
      ) : null}
    </box>
  )
}
