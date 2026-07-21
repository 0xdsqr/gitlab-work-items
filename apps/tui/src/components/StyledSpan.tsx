import type { JSX } from "@opentui/solid"

type StyledSpanProps = {
  fg?: string
  bg?: string
  attributes?: number
  children?: JSX.Element
}

export const StyledSpan = (props: StyledSpanProps) => (
  <span {...{ fg: props.fg, bg: props.bg, attributes: props.attributes }}>{props.children}</span>
)
