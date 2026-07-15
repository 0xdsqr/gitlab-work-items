import type { WorkItemLabel } from "@github-work-items/domain"
import { Fragment } from "react"
import { colors, darkerLabelColor, ellipsis, labelColor, labelTextColor } from "../theme.ts"

const labelWidth = (label: WorkItemLabel) => label.name.length + 2

const LabelChip = ({ label, fittedName }: { label: WorkItemLabel; fittedName: string }) => {
  const separator = fittedName.indexOf("::")
  const background = labelColor(label)
  const foreground = labelTextColor(label)
  if (separator < 1 || separator >= fittedName.length - 2) {
    return <span fg={foreground} bg={background}>{` ${fittedName} `}</span>
  }
  const scope = fittedName.slice(0, separator)
  const value = fittedName.slice(separator + 2)
  return (
    <>
      <span fg={colors.text} bg={darkerLabelColor(label)}>{` ${scope} `}</span>
      <span fg={foreground} bg={background}>{` ${value} `}</span>
    </>
  )
}

export const LabelChips = ({ labels, width }: { labels: readonly WorkItemLabel[]; width: number }) => {
  const visible: Array<{ label: WorkItemLabel; fittedName: string }> = []
  let used = 0
  for (const label of labels) {
    const gap = visible.length > 0 ? 1 : 0
    const available = width - used - gap
    if (available < 5) break
    const fittedName = ellipsis(label.name, Math.max(3, available - 2))
    visible.push({ label, fittedName })
    used += fittedName.length + 2 + gap
    if (labelWidth(label) > available) break
  }

  if (visible.length === 0) return <span fg={colors.subtle}>no labels</span>
  const hidden = labels.length - visible.length
  return (
    <>
      {visible.map(({ label, fittedName }, index) => (
        <Fragment key={`${label.name}-${index}`}>
          {index > 0 ? <span> </span> : null}
          <LabelChip label={label} fittedName={fittedName} />
        </Fragment>
      ))}
      {hidden > 0 ? <span fg={colors.subtle}>{` +${hidden}`}</span> : null}
    </>
  )
}
