import type { WorkItemScope } from "@github-work-items/domain"

export type GitLabConfig = {
  readonly host: string
  readonly token: string | null
  readonly group: string | null
  readonly mock: boolean
}

const nonEmpty = (value: string | undefined) => {
  const trimmed = value?.trim()
  return trimmed ? trimmed : null
}

const parseGitLabHost = (host: string) => {
  const url = new URL(host)
  if (url.protocol !== "https:" && url.protocol !== "http:")
    throw new Error("GITLAB_HOST must use the https or http protocol")
  if (url.username || url.password) throw new Error("GITLAB_HOST must not contain credentials")
  if (url.search || url.hash) throw new Error("GITLAB_HOST must not contain a query string or fragment")
  return url
}

const isLoopback = (hostname: string) => hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1"

export const gitLabConfigFromEnv = (env: Record<string, string | undefined> = process.env): GitLabConfig => ({
  host: (nonEmpty(env.GITLAB_HOST) ?? "https://gitlab.com").replace(/\/+$/, ""),
  token: nonEmpty(env.GITLAB_TOKEN) ?? nonEmpty(env.GITLAB_ACCESS_TOKEN),
  group: nonEmpty(env.GWI_GROUP),
  mock: env.GWI_MOCK === "1" || env.GWI_MOCK === "true",
})

export const gitLabApiUrl = (host: string, path: string, authenticated = false) => {
  const url = parseGitLabHost(host)
  if (authenticated && url.protocol !== "https:" && !isLoopback(url.hostname))
    throw new Error("Refusing to send a GitLab token over an insecure connection; use HTTPS in GITLAB_HOST")
  if (!path || path.startsWith("/") || path.includes("\\") || path.split(/[/?]/).includes(".."))
    throw new Error("Invalid GitLab API path")

  const separator = path.indexOf("?")
  const endpoint = separator < 0 ? path : path.slice(0, separator)
  const query = separator < 0 ? "" : path.slice(separator + 1)
  const basePath = url.pathname.replace(/\/+$/, "")
  url.pathname = `${basePath}/api/v4/${endpoint}`
  url.search = query
  return url.toString()
}

export const gitLabHostname = (host: string) => parseGitLabHost(host).host

export const trustedGitLabWebUrl = (host: string, candidate: string) => {
  const configured = parseGitLabHost(host)
  const url = new URL(candidate)
  if (url.protocol !== "https:" && url.protocol !== "http:")
    throw new Error("GitLab returned a work-item URL with an unsupported protocol")
  if (url.username || url.password) throw new Error("GitLab returned a work-item URL containing credentials")
  if (url.origin !== configured.origin) throw new Error("GitLab returned a work-item URL for a different host")

  const basePath = configured.pathname.replace(/\/+$/, "")
  if (basePath && url.pathname !== basePath && !url.pathname.startsWith(`${basePath}/`))
    throw new Error("GitLab returned a work-item URL outside the configured base path")
  return url.toString()
}

export const issuePathFor = (scope: WorkItemScope, group: string | null) => {
  const root = scope === "organization" && group ? `groups/${encodeURIComponent(group)}/issues` : "issues"
  const queryScope = scope === "created" ? "created_by_me" : scope === "assigned" ? "assigned_to_me" : "all"
  return `${root}?scope=${queryScope}&state=all&order_by=updated_at&sort=desc&per_page=100&with_labels_details=true`
}
