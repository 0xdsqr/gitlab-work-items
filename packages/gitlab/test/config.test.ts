import { describe, expect, it } from "vitest"
import { gitLabApiUrl, gitLabConfigFromEnv, gitLabHostname, issuePathFor, trustedGitLabWebUrl } from "../src/config.ts"

describe("GitLab configuration", () => {
  it("prefers the conventional GitLab token", () => {
    expect(gitLabConfigFromEnv({ GITLAB_TOKEN: "primary", GITLAB_ACCESS_TOKEN: "fallback" }).token).toBe("primary")
  })

  it("normalizes trailing slashes from the configured host", () => {
    expect(gitLabConfigFromEnv({ GITLAB_HOST: "https://gitlab.example.com///" }).host).toBe(
      "https://gitlab.example.com",
    )
  })

  it("builds an encoded group endpoint", () => {
    expect(issuePathFor("organization", "acme/platform")).toContain("groups/acme%2Fplatform/issues")
  })

  it("loads open and closed work for board lifecycle actions", () => {
    expect(issuePathFor("assigned", null)).toContain("state=all")
  })

  it("requests GitLab label colors", () => {
    expect(issuePathFor("assigned", null)).toContain("with_labels_details=true")
  })

  it("builds API URLs beneath a self-managed base path", () => {
    expect(gitLabApiUrl("https://example.com/gitlab", "issues?state=all", true)).toBe(
      "https://example.com/gitlab/api/v4/issues?state=all",
    )
    expect(gitLabHostname("https://example.com:8443/gitlab")).toBe("example.com:8443")
  })

  it("refuses to send tokens over non-loopback HTTP", () => {
    expect(() => gitLabApiUrl("http://gitlab.example.com", "issues", true)).toThrow("insecure connection")
    expect(gitLabApiUrl("http://localhost:3000", "issues", true)).toBe("http://localhost:3000/api/v4/issues")
  })

  it("rejects credentials embedded in the configured host", () => {
    expect(() => gitLabApiUrl("https://user:secret@gitlab.example.com", "issues", true)).toThrow("credentials")
  })

  it("only opens work-item links from the configured GitLab host", () => {
    expect(trustedGitLabWebUrl("https://gitlab.example.com", "https://gitlab.example.com/acme/-/issues/1")).toBe(
      "https://gitlab.example.com/acme/-/issues/1",
    )
    expect(() => trustedGitLabWebUrl("https://gitlab.example.com", "file:///tmp/payload")).toThrow(
      "unsupported protocol",
    )
    expect(() => trustedGitLabWebUrl("https://gitlab.example.com", "https://example.net/phishing")).toThrow(
      "different host",
    )
  })
})
