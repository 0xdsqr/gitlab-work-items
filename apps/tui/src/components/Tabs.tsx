import type { WorkItemScope } from "@github-work-items/domain"
import { TextAttributes } from "@opentui/core"
import { useState } from "react"
import { colors } from "../theme.ts"

export type Surface = "board" | "work-items"

const surfaces: readonly { readonly id: Surface; readonly label: string; readonly key: string }[] = [
  { id: "board", label: "▦ Board", key: "1" },
  { id: "work-items", label: "≡ Work Items", key: "2" },
]

export const scopes: readonly { readonly id: WorkItemScope; readonly label: string }[] = [
  { id: "assigned", label: "My work" },
  { id: "created", label: "Created by me" },
  { id: "organization", label: "Organization" },
]

export const SurfaceTabs = ({ active, onSelect }: { active: Surface; onSelect: (surface: Surface) => void }) => {
  const [hovered, setHovered] = useState<Surface | null>(null)
  return (
    <box height={1} flexDirection="row">
      {surfaces.map((surface, index) => {
        const selected = surface.id === active
        return (
          <box
            key={surface.id}
            height={1}
            onMouseDown={() => onSelect(surface.id)}
            onMouseOver={() => setHovered(surface.id)}
            onMouseOut={() => setHovered((current) => (current === surface.id ? null : current))}
          >
            <text
              fg={selected ? colors.text : colors.muted}
              bg={selected ? colors.panelRaised : hovered === surface.id ? colors.panel : colors.background}
              attributes={selected ? TextAttributes.BOLD : 0}
            >
              <span fg={selected ? colors.active : colors.subtle}>{selected ? "▌" : " "}</span>
              {` ${surface.key} ${surface.label} `}
            </text>
            {index < surfaces.length - 1 ? <text fg={colors.border}> </text> : null}
          </box>
        )
      })}
    </box>
  )
}

export const ScopeTabs = ({
  active,
  group,
  onSelect,
}: {
  active: WorkItemScope
  group: string | null
  onSelect: (scope: WorkItemScope) => void
}) => (
  <box height={1} flexDirection="row">
    <text fg={colors.subtle}>Scope </text>
    {scopes.map((scope) => {
      const selected = scope.id === active
      const suffix = scope.id === "organization" && group ? ` · ${group}` : ""
      return (
        <text
          key={scope.id}
          fg={selected ? colors.text : colors.muted}
          bg={selected ? colors.panel : colors.background}
          attributes={selected ? TextAttributes.BOLD : 0}
          onMouseDown={() => onSelect(scope.id)}
        >
          {` ${selected ? "● " : ""}${scope.label}${suffix} `}
        </text>
      )
    })}
  </box>
)
