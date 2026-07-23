import solidPlugin from "@opentui/solid/bun-plugin"

const result = await Bun.build({
  entrypoints: ["./src/index.tsx"],
  target: "bun",
  outdir: "./dist",
  plugins: [solidPlugin],
  external: ["@opentui/core"],
})

if (!result.success) {
  for (const log of result.logs) console.error(log)
  process.exit(1)
}
