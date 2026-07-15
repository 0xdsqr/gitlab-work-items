import { describe, expect, it } from "vitest"
import { gitLabConfigFromEnv, issuePathFor } from "../src/config.ts"

describe("GitLab configuration", () => {
  it("prefers the conventional GitLab token", () => {
    expect(gitLabConfigFromEnv({ GITLAB_TOKEN: "primary", GITLAB_ACCESS_TOKEN: "fallback" }).token).toBe("primary")
  })

  it("builds an encoded group endpoint", () => {
    expect(issuePathFor("organization", "acme/platform")).toContain("groups/acme%2Fplatform/issues")
  })

  it("loads open and closed work for board lifecycle actions", () => {
    expect(issuePathFor("assigned", null)).toContain("state=all")
  })
})
