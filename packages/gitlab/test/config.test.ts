import { describe, expect, it } from "vitest"
import {
  gitLabApiUrl,
  gitLabConfigFromEnv,
  gitLabHostname,
  gitLabNextPageUrl,
  issuePathFor,
  trustedGitLabWebUrl,
} from "../src/config.ts"

describe("GitLab configuration", () => {
  it("prefers the conventional GitLab token", () => {
    expect(gitLabConfigFromEnv({ GITLAB_TOKEN: "primary", GITLAB_ACCESS_TOKEN: "fallback" }).token).toBe("primary")
  })

  it("normalizes trailing slashes from the configured host", () => {
    const config = gitLabConfigFromEnv({ GITLAB_HOST: "https://gitlab.example.com///" })
    expect(config.host).toBe("https://gitlab.example.com")
    expect(config.hostDisplay).toBe("gitlab.example.com")
  })

  it("loads GitLab Work Items group and mock settings", () => {
    expect(gitLabConfigFromEnv({ GLWI_GROUP: "acme/platform", GLWI_MOCK: "true" })).toMatchObject({
      group: "acme/platform",
      mock: true,
    })
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
    expect(gitLabApiUrl("http://[::1]:3000", "issues", true)).toBe("http://[::1]:3000/api/v4/issues")
  })

  it("rejects credentials embedded in the configured host", () => {
    expect(() => gitLabApiUrl("https://user:secret@gitlab.example.com", "issues", true)).toThrow("credentials")
    expect(() => gitLabConfigFromEnv({ GITLAB_HOST: "https://user:secret@gitlab.example.com" })).toThrow("credentials")
  })

  it("rejects encoded and multiply encoded API traversal", () => {
    for (const path of [
      "projects/%2e%2e/user",
      "projects/%2E%2E/user",
      "projects/%252e%252e/user",
      "projects/%5c..%5cuser",
    ])
      expect(() => gitLabApiUrl("https://gitlab.example.com/gitlab", path, true)).toThrow(/traversal|encoding/u)
  })

  it("requires an explicit group for organization scope", () => {
    expect(() => issuePathFor("organization", null)).toThrow("requires GLWI_GROUP")
  })

  it("accepts only same-origin pagination URLs beneath the configured API path", () => {
    const current = "https://gitlab.example.com/gitlab/api/v4/issues?page=1"
    expect(
      gitLabNextPageUrl(
        "https://gitlab.example.com/gitlab",
        current,
        '<https://gitlab.example.com/gitlab/api/v4/issues?page=2>; rel="next"',
        true,
      ),
    ).toBe("https://gitlab.example.com/gitlab/api/v4/issues?page=2")
    expect(() =>
      gitLabNextPageUrl(
        "https://gitlab.example.com/gitlab",
        current,
        '<https://attacker.example/api/v4/issues?page=2>; rel="next"',
        true,
      ),
    ).toThrow("different host")
    expect(() =>
      gitLabNextPageUrl(
        "https://gitlab.example.com/gitlab",
        current,
        '<https://gitlab.example.com/gitlab/api/v4/projects/%2e%2e/user>; rel="next"',
        true,
      ),
    ).toThrow("traversal")
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
