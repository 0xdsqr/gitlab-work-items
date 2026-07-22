import type { WorkItemLabel } from "@gitlab-work-items/domain"
import { createMemo, For, Show } from "solid-js"
import { cellWidth, colors, darkerLabelColor, ellipsis, labelColor, labelTextColor } from "../theme.ts"
import { StyledSpan } from "./StyledSpan.tsx"

const labelWidth = (label: WorkItemLabel) => cellWidth(label.name) + 2

type LabelChipProps = {
  label: WorkItemLabel
  fittedName: string
}

const LabelChip = (props: LabelChipProps) => {
  const separator = () => props.fittedName.indexOf("::")
  const background = () => labelColor(props.label)
  const foreground = () => labelTextColor(props.label)
  return (
    <Show
      when={separator() >= 1 && separator() < props.fittedName.length - 2}
      fallback={<StyledSpan fg={foreground()} bg={background()}>{` ${props.fittedName} `}</StyledSpan>}
    >
      <StyledSpan fg={colors.text} bg={darkerLabelColor(props.label)}>
        {` ${props.fittedName.slice(0, separator())} `}
      </StyledSpan>
      <StyledSpan fg={foreground()} bg={background()}>
        {` ${props.fittedName.slice(separator() + 2)} `}
      </StyledSpan>
    </Show>
  )
}

type LabelChipsProps = {
  labels: readonly WorkItemLabel[]
  width: number
}

export const LabelChips = (props: LabelChipsProps) => {
  const visible = createMemo(() => {
    const result: Array<{ label: WorkItemLabel; fittedName: string }> = []
    let used = 0
    for (const [index, label] of props.labels.entries()) {
      const gap = result.length > 0 ? 1 : 0
      const remaining = props.labels.length - index - 1
      const hiddenReserve = remaining > 0 ? cellWidth(` +${remaining}`) : 0
      const available = props.width - used - gap - hiddenReserve
      if (available < 5) break
      const fittedName = ellipsis(label.name, Math.max(3, available - 2))
      result.push({ label, fittedName })
      used += cellWidth(fittedName) + 2 + gap
      if (labelWidth(label) > available) break
    }
    return result
  })
  const hidden = createMemo(() => props.labels.length - visible().length)

  return (
    <Show
      when={props.labels.length > 0}
      fallback={<StyledSpan fg={colors.subtle}>{ellipsis("no labels", props.width)}</StyledSpan>}
    >
      <Show
        when={visible().length > 0}
        fallback={<StyledSpan fg={colors.subtle}>{ellipsis(`+${props.labels.length}`, props.width)}</StyledSpan>}
      >
        <For each={visible()}>
          {(entry, index) => (
            <>
              {index() > 0 ? <span> </span> : null}
              <LabelChip label={entry.label} fittedName={entry.fittedName} />
            </>
          )}
        </For>
        <Show when={hidden() > 0}>
          <StyledSpan fg={colors.subtle}>{` +${hidden()}`}</StyledSpan>
        </Show>
      </Show>
    </Show>
  )
}
