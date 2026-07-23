import type { WorkItemScope } from "@gitlab-work-items/domain"

declare const GitLabHostBrand: unique symbol
declare const GitLabHostDisplayBrand: unique symbol

export type GitLabHost = string & { readonly [GitLabHostBrand]: true }
export type GitLabHostDisplay = string & { readonly [GitLabHostDisplayBrand]: true }

export type GitLabConfig = {
  readonly host: GitLabHost
  readonly hostDisplay: GitLabHostDisplay
  readonly token: string | null
  readonly group: string | null
  readonly mock: boolean
}

type ParsedGitLabHost = {
  readonly value: GitLabHost
  readonly display: GitLabHostDisplay
  readonly url: URL
}

const nonEmpty = (value: string | undefined) => {
  const trimmed = value?.trim()
  return trimmed ? trimmed : null
}

const hasTerminalControl = (value: string) =>
  Array.from(value).some((character) => {
    const codePoint = character.codePointAt(0) ?? 0
    return codePoint <= 0x1f || (codePoint >= 0x7f && codePoint <= 0x9f)
  })

const assertNoTraversalSegments = (value: string, label: string) => {
  let decoded = value
  for (let pass = 0; pass < 4; pass += 1) {
    if (decoded.includes("\\") || decoded.split("/").some((segment) => segment === "." || segment === ".."))
      throw new Error(`${label} must not contain traversal segments`)
    let next: string
    try {
      next = decodeURIComponent(decoded)
    } catch {
      throw new Error(`${label} contains invalid percent encoding`)
    }
    if (next === decoded) return
    decoded = next
  }
  throw new Error(`${label} contains excessive percent encoding`)
}

const parseGitLabHost = (host: string): ParsedGitLabHost => {
  if (hasTerminalControl(host)) throw new Error("GITLAB_HOST must not contain control characters")
  assertNoTraversalSegments(host.split(/[?#]/u, 1)[0] ?? host, "GITLAB_HOST")
  let url: URL
  try {
    url = new URL(host)
  } catch {
    throw new Error("GITLAB_HOST must be an absolute HTTP or HTTPS URL")
  }
  if (url.protocol !== "https:" && url.protocol !== "http:")
    throw new Error("GITLAB_HOST must use the https or http protocol")
  if (url.username || url.password) throw new Error("GITLAB_HOST must not contain credentials")
  if (url.search || url.hash) throw new Error("GITLAB_HOST must not contain a query string or fragment")
  const basePath = url.pathname.replace(/\/+$/u, "")
  url.pathname = basePath || "/"
  const value = `${url.origin}${basePath}` as GitLabHost
  const display = `${url.host}${basePath}` as GitLabHostDisplay
  return { value, display, url }
}

const isLoopback = (hostname: string) =>
  hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1" || hostname === "[::1]"

export const gitLabConfigFromEnv = (env: Record<string, string | undefined> = process.env): GitLabConfig => {
  const parsedHost = parseGitLabHost(nonEmpty(env.GITLAB_HOST) ?? "https://gitlab.com")
  const group = nonEmpty(env.GLWI_GROUP)
  if (group && hasTerminalControl(group)) throw new Error("GLWI_GROUP must not contain control characters")
  return {
    host: parsedHost.value,
    hostDisplay: parsedHost.display,
    token: nonEmpty(env.GITLAB_TOKEN) ?? nonEmpty(env.GITLAB_ACCESS_TOKEN),
    group,
    mock: env.GLWI_MOCK === "1" || env.GLWI_MOCK === "true",
  }
}

export const gitLabApiUrl = (host: string, path: string, authenticated = false) => {
  const { url } = parseGitLabHost(host)
  if (authenticated && url.protocol !== "https:" && !isLoopback(url.hostname))
    throw new Error("Refusing to send a GitLab token over an insecure connection; use HTTPS in GITLAB_HOST")
  if (!path || path.startsWith("/") || path.includes("#") || hasTerminalControl(path))
    throw new Error("Invalid GitLab API path")

  const separator = path.indexOf("?")
  const endpoint = separator < 0 ? path : path.slice(0, separator)
  const query = separator < 0 ? "" : path.slice(separator + 1)
  assertNoTraversalSegments(endpoint, "GitLab API path")
  const basePath = url.pathname.replace(/\/+$/, "")
  url.pathname = `${basePath}/api/v4/${endpoint}`
  url.search = query
  return url.toString()
}

export const gitLabHostname = (host: string) => parseGitLabHost(host).url.host

const validateGitLabApiPageUrl = (host: string, currentUrl: string, candidate: string, authenticated: boolean) => {
  if (hasTerminalControl(candidate)) throw new Error("GitLab returned a pagination URL with control characters")
  assertNoTraversalSegments(candidate.split(/[?#]/u, 1)[0] ?? candidate, "GitLab pagination URL")

  const configured = parseGitLabHost(host).url
  const url = new URL(candidate, currentUrl)
  if (url.protocol !== "https:" && url.protocol !== "http:")
    throw new Error("GitLab returned a pagination URL with an unsupported protocol")
  if (authenticated && url.protocol !== "https:" && !isLoopback(url.hostname))
    throw new Error("Refusing to send a GitLab token to an insecure pagination URL")
  if (url.username || url.password) throw new Error("GitLab returned a pagination URL containing credentials")
  if (url.hash) throw new Error("GitLab returned a pagination URL containing a fragment")
  if (url.origin !== configured.origin) throw new Error("GitLab returned a pagination URL for a different host")

  const apiPath = `${configured.pathname.replace(/\/+$/u, "")}/api/v4`
  if (url.pathname !== apiPath && !url.pathname.startsWith(`${apiPath}/`))
    throw new Error("GitLab returned a pagination URL outside the configured API path")
  return url.toString()
}

export const gitLabNextPageUrl = (
  host: string,
  currentUrl: string,
  linkHeader: string | null,
  authenticated = false,
) => {
  if (!linkHeader) return null
  for (const entry of linkHeader.split(/,(?=\s*<)/u)) {
    const match = entry.match(/^\s*<([^>]+)>(.*)$/u)
    if (!match) continue
    const relations = match[2]?.match(/;\s*rel\s*=\s*"?([^";]+)"?/iu)?.[1]?.split(/\s+/u) ?? []
    if (!relations.includes("next")) continue
    return validateGitLabApiPageUrl(host, currentUrl, match[1] ?? "", authenticated)
  }
  return null
}

export const trustedGitLabWebUrl = (host: string, candidate: string) => {
  if (hasTerminalControl(candidate)) throw new Error("GitLab returned a work-item URL with control characters")
  const configured = parseGitLabHost(host).url
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
  if (scope === "organization" && !group)
    throw new Error("Organization scope requires GLWI_GROUP to identify the GitLab group")
  const root = scope === "organization" ? `groups/${encodeURIComponent(group ?? "")}/issues` : "issues"
  const queryScope = scope === "created" ? "created_by_me" : scope === "assigned" ? "assigned_to_me" : "all"
  return `${root}?scope=${queryScope}&state=all&order_by=updated_at&sort=desc&per_page=100&with_labels_details=true`
}
