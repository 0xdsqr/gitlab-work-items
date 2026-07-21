#!/usr/bin/env bun

import { render } from "@opentui/solid"
import { App } from "./App.tsx"

process.env.OTUI_USE_ALTERNATE_SCREEN = "true"

await render(() => <App />, {
  exitOnCtrlC: false,
  screenMode: "alternate-screen",
  onDestroy: () => process.exit(0),
})
