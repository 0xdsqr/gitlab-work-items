import type { JSX } from "@opentui/solid"

type StyledSpanProps = {
  fg?: string | undefined
  bg?: string | undefined
  children?: JSX.Element
}

export const StyledSpan = (props: StyledSpanProps) => (
  <span style={{ fg: props.fg, bg: props.bg }}>{props.children}</span>
)
