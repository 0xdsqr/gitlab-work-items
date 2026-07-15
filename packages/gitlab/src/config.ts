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

export const gitLabConfigFromEnv = (env: Record<string, string | undefined> = process.env): GitLabConfig => ({
  host: (nonEmpty(env.GITLAB_HOST) ?? "https://gitlab.com").replace(/\/$/, ""),
  token: nonEmpty(env.GITLAB_TOKEN) ?? nonEmpty(env.GITLAB_ACCESS_TOKEN),
  group: nonEmpty(env.GWI_GROUP),
  mock: env.GWI_MOCK === "1" || env.GWI_MOCK === "true",
})

export const issuePathFor = (scope: WorkItemScope, group: string | null) => {
  const root = scope === "organization" && group ? `groups/${encodeURIComponent(group)}/issues` : "issues"
  const queryScope = scope === "created" ? "created_by_me" : scope === "assigned" ? "assigned_to_me" : "all"
  return `${root}?scope=${queryScope}&state=all&order_by=updated_at&sort=desc&per_page=100&with_labels_details=true`
}
