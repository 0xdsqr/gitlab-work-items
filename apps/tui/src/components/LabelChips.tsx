import { Fragment } from "react"
import { colors, ellipsis, labelColor } from "../theme.ts"

export const LabelChips = ({ labels, width }: { labels: readonly string[]; width: number }) => {
  const visible: string[] = []
  let used = 0
  for (const label of labels) {
    const available = Math.max(3, width - used - (visible.length > 0 ? 1 : 0))
    if (available < 3) break
    const fitted = ellipsis(label.replace(/^workflow::/, ""), Math.max(1, available - 2))
    visible.push(fitted)
    used += fitted.length + 2 + (visible.length > 1 ? 1 : 0)
  }

  if (visible.length === 0) return <span fg={colors.muted}>no labels</span>
  return (
    <>
      {visible.map((label, index) => (
        <Fragment key={`${label}-${index}`}>
          {index > 0 ? <span fg={colors.border}> · </span> : null}
          <span fg={labelColor(label)}>●</span>
          <span fg={colors.muted}>{` ${label}`}</span>
        </Fragment>
      ))}
    </>
  )
}
