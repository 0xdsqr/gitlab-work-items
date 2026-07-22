import type { WorkItemScope } from "@github-work-items/domain"
import { TextAttributes } from "@opentui/core"
import { createSignal, For } from "solid-js"
import { colors } from "../theme.ts"
import { StyledSpan } from "./StyledSpan.tsx"

export type Surface = "board" | "work-items"

const surfaces: readonly {
  readonly id: Surface
  readonly label: string
  readonly compactLabel: string
  readonly key: string
}[] = [
  { id: "board", label: "▦ Board", compactLabel: "Board", key: "1" },
  { id: "work-items", label: "≡ Work Items", compactLabel: "Items", key: "2" },
]

export const scopes: readonly { readonly id: WorkItemScope; readonly label: string }[] = [
  { id: "assigned", label: "My work" },
  { id: "created", label: "Created by me" },
  { id: "organization", label: "Organization" },
]

type SurfaceTabsProps = {
  active: Surface
  compact?: boolean
  onSelect: (surface: Surface) => void
}

export const SurfaceTabs = (props: SurfaceTabsProps) => {
  const [hovered, setHovered] = createSignal<Surface | null>(null)
  return (
    <box height={1} flexDirection="row">
      <For each={surfaces}>
        {(surface, index) => {
          const selected = () => surface.id === props.active
          return (
            <box
              height={1}
              onMouseDown={() => props.onSelect(surface.id)}
              onMouseOver={() => setHovered(surface.id)}
              onMouseOut={() => setHovered((current) => (current === surface.id ? null : current))}
            >
              <text
                fg={selected() ? colors.text : colors.muted}
                bg={selected() ? colors.panelRaised : hovered() === surface.id ? colors.panel : colors.background}
                attributes={selected() ? TextAttributes.BOLD : 0}
              >
                <StyledSpan fg={selected() ? colors.active : colors.subtle}>{selected() ? "▌" : " "}</StyledSpan>
                {` ${surface.key} ${props.compact ? surface.compactLabel : surface.label} `}
              </text>
              {index() < surfaces.length - 1 ? <text fg={colors.border}> </text> : null}
            </box>
          )
        }}
      </For>
    </box>
  )
}

type ScopeTabsProps = {
  active: WorkItemScope
  group: string | null
  compact?: boolean
  onSelect: (scope: WorkItemScope) => void
}

export const ScopeTabs = (props: ScopeTabsProps) => (
  <box height={1} flexDirection="row">
    <text fg={colors.subtle}>Scope </text>
    <For each={scopes}>
      {(scope) => {
        const selected = () => scope.id === props.active
        const label = () => {
          if (!props.compact) return scope.label
          if (scope.id === "assigned") return "Mine"
          if (scope.id === "created") return "Created"
          return "Group"
        }
        const suffix = () => (!props.compact && scope.id === "organization" && props.group ? ` · ${props.group}` : "")
        return (
          <text
            fg={selected() ? colors.text : colors.muted}
            bg={selected() ? colors.panel : colors.background}
            attributes={selected() ? TextAttributes.BOLD : 0}
            onMouseDown={() => props.onSelect(scope.id)}
          >
            {` ${selected() ? "● " : ""}${label()}${suffix()} `}
          </text>
        )
      }}
    </For>
  </box>
)
