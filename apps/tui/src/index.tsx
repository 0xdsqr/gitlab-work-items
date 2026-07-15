#!/usr/bin/env bun

import { createCliRenderer } from "@opentui/core"
import { createRoot } from "@opentui/react"
import { App } from "./App.tsx"

process.env.OTUI_USE_ALTERNATE_SCREEN = "true"

const renderer = await createCliRenderer({
  exitOnCtrlC: false,
  screenMode: "alternate-screen",
  onDestroy: () => process.exit(0),
})

createRoot(renderer).render(<App />)
