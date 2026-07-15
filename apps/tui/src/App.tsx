import { relativeAge, typeLabel, type WorkItem, type WorkItemScope } from "@github-work-items/domain"
import { gitLabConfigFromEnv, loadWorkspace } from "@github-work-items/gitlab"
import { TextAttributes } from "@opentui/core"
import { useKeyboard, useRenderer, useTerminalDimensions } from "@opentui/react"
import { Effect } from "effect"
import { useCallback, useEffect, useMemo, useState } from "react"

const colors = {
  background: "#0b0e14",
  panel: "#111722",
  border: "#2b3548",
  borderActive: "#7aa2f7",
  text: "#c0caf5",
  muted: "#697386",
  accent: "#7aa2f7",
  selected: "#1d2940",
  success: "#9ece6a",
  warning: "#e0af68",
  epic: "#bb9af7",
  issue: "#7dcfff",
  task: "#73daca",
  error: "#f7768e",
} as const

const scopes: readonly { readonly id: WorkItemScope; readonly label: string }[] = [
  { id: "assigned", label: "My work" },
  { id: "created", label: "Created" },
  { id: "organization", label: "Organization" },
]

const messageOf = (error: unknown) => {
  if (typeof error === "object" && error !== null && "detail" in error && typeof error.detail === "string")
    return error.detail
  return error instanceof Error ? error.message : String(error)
}

const typeColor = (item: WorkItem) => {
  if (item.type === "EPIC") return colors.epic
  if (item.type === "TASK") return colors.task
  return colors.issue
}

const ellipsis = (value: string, width: number) => {
  if (value.length <= width) return value
  return width <= 1 ? "…" : `${value.slice(0, width - 1)}…`
}

export const App = () => {
  const renderer = useRenderer()
  const { width, height } = useTerminalDimensions()
  const [scopeIndex, setScopeIndex] = useState(0)
  const [selectedIndex, setSelectedIndex] = useState(0)
  const [items, setItems] = useState<readonly WorkItem[]>([])
  const [username, setUsername] = useState("GitLab")
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading")
  const [error, setError] = useState<string | null>(null)
  const [refreshKey, setRefreshKey] = useState(0)
  const scope = scopes[scopeIndex]?.id ?? "assigned"
  const selected = items[selectedIndex] ?? null
  const config = useMemo(() => gitLabConfigFromEnv(), [])
  const compact = width < 96

  const refresh = useCallback(() => setRefreshKey((value) => value + 1), [])

  useEffect(() => {
    renderer.setBackgroundColor(colors.background)
  }, [renderer])

  useEffect(() => {
    let cancelled = false
    setStatus("loading")
    setError(null)
    void Effect.runPromise(loadWorkspace(scope)).then(
      (workspace) => {
        if (cancelled) return
        setItems(workspace.items)
        setUsername(workspace.user.username)
        setSelectedIndex(0)
        setStatus("ready")
      },
      (cause) => {
        if (cancelled) return
        setItems([])
        setError(messageOf(cause))
        setStatus("error")
      },
    )
    return () => {
      cancelled = true
    }
  }, [scope, refreshKey])

  useKeyboard((key) => {
    if (key.name === "q" || (key.ctrl && key.name === "c")) {
      renderer.destroy()
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
    if (key.name === "j" || key.name === "down") {
      setSelectedIndex((index) => Math.min(items.length - 1, index + 1))
      return
    }
    if (key.name === "k" || key.name === "up") setSelectedIndex((index) => Math.max(0, index - 1))
  })

  const contentHeight = Math.max(8, height - 4)
  const listWidth = compact ? width : Math.max(38, Math.floor(width * 0.46))
  const detailWidth = Math.max(1, width - listWidth)

  return (
    <box width={width} height={height} flexDirection="column" backgroundColor={colors.background}>
      <box
        height={3}
        paddingLeft={1}
        paddingRight={1}
        flexDirection="row"
        alignItems="center"
        justifyContent="space-between"
      >
        <text fg={colors.text} attributes={TextAttributes.BOLD}>
          work items <span fg={colors.muted}>/ {username}</span>
        </text>
        <text fg={config.mock ? colors.warning : colors.success}>
          {config.mock ? "mock" : config.host.replace(/^https?:\/\//, "")}
        </text>
      </box>

      <box height={1} paddingLeft={1} flexDirection="row">
        {scopes.map((candidate, index) => (
          <text
            key={candidate.id}
            fg={index === scopeIndex ? colors.text : colors.muted}
            bg={index === scopeIndex ? colors.selected : colors.background}
          >
            {` ${candidate.label}${candidate.id === "organization" && config.group ? ` · ${config.group}` : ""} `}
          </text>
        ))}
      </box>

      <box height={contentHeight} flexDirection="row">
        <box
          width={listWidth}
          height={contentHeight}
          border
          borderStyle="single"
          borderColor={colors.borderActive}
          backgroundColor={colors.panel}
          flexDirection="column"
          title={status === "loading" ? " Loading… " : ` ${items.length} open `}
        >
          {status === "error" ? (
            <box padding={1} flexDirection="column">
              <text fg={colors.error} attributes={TextAttributes.BOLD}>
                Authentication needed
              </text>
              <text fg={colors.text}>{error ?? "GitLab request failed"}</text>
              <text fg={colors.muted}>Run `glab auth login` or export `GITLAB_TOKEN`, then press r.</text>
              <text fg={colors.muted}>Use `bun run mock` to explore without credentials.</text>
            </box>
          ) : status === "ready" && scope === "organization" && !config.group ? (
            <box padding={1} flexDirection="column">
              <text fg={colors.warning}>Set GWI_GROUP to a GitLab group full path.</text>
              <text fg={colors.muted}>Example: GWI_GROUP=acme/platform bun start</text>
            </box>
          ) : status === "ready" && items.length === 0 ? (
            <box padding={1}>
              <text fg={colors.muted}>No open work items in this scope.</text>
            </box>
          ) : (
            items.slice(0, Math.max(1, contentHeight - 2)).map((item, index) => {
              const selectedRow = index === selectedIndex
              const available = Math.max(8, listWidth - 15)
              return (
                <box
                  key={item.id}
                  height={2}
                  paddingLeft={1}
                  paddingRight={1}
                  backgroundColor={selectedRow ? colors.selected : colors.panel}
                  flexDirection="column"
                >
                  <text fg={selectedRow ? colors.text : colors.text} attributes={selectedRow ? TextAttributes.BOLD : 0}>
                    <span fg={typeColor(item)}>{typeLabel(item.type)}</span>
                    {`  ${ellipsis(item.title, available)}`}
                  </text>
                  <text
                    fg={colors.muted}
                  >{`${ellipsis(item.reference, Math.max(8, listWidth - 12))}  ${relativeAge(item.updatedAt)}`}</text>
                </box>
              )
            })
          )}
        </box>

        {!compact ? (
          <box
            width={detailWidth}
            height={contentHeight}
            border
            borderStyle="single"
            borderColor={colors.border}
            backgroundColor={colors.background}
            padding={1}
            flexDirection="column"
            title=" Details "
          >
            {selected ? (
              <>
                <text
                  fg={typeColor(selected)}
                  attributes={TextAttributes.BOLD}
                >{`${typeLabel(selected.type)}  ${selected.reference}`}</text>
                <text fg={colors.text} attributes={TextAttributes.BOLD}>
                  {selected.title}
                </text>
                <text
                  fg={colors.muted}
                >{`${selected.namespace}  ·  updated ${relativeAge(selected.updatedAt)} ago`}</text>
                <box height={1} />
                <text fg={colors.text}>{selected.description || "No description."}</text>
                <box height={1} />
                <text fg={colors.muted}>{`author     @${selected.author}`}</text>
                <text
                  fg={colors.muted}
                >{`assignees  ${selected.assignees.map((name) => `@${name}`).join(", ") || "none"}`}</text>
                <text fg={colors.muted}>{`labels     ${selected.labels.join(", ") || "none"}`}</text>
                <box height={1} />
                <text fg={colors.accent}>{selected.webUrl}</text>
              </>
            ) : (
              <text fg={colors.muted}>Select a work item to inspect it.</text>
            )}
          </box>
        ) : null}
      </box>

      <box height={1} paddingLeft={1} paddingRight={1} justifyContent="space-between">
        <text fg={colors.muted}>j/k move tab scope r refresh</text>
        <text fg={colors.muted}>q quit</text>
      </box>
    </box>
  )
}
