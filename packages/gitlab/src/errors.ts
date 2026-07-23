import { Schema } from "effect"

export const GitLabRequestErrorKind = Schema.Literals([
  "authentication",
  "authorization",
  "not-found",
  "rate-limit",
  "network",
  "timeout",
  "cancelled",
  "invalid-response",
  "configuration",
  "request",
])
export type GitLabRequestErrorKind = typeof GitLabRequestErrorKind.Type

export class GitLabRequestError extends Schema.TaggedErrorClass<GitLabRequestError>()("GitLabRequestError", {
  operation: Schema.String,
  kind: GitLabRequestErrorKind,
  detail: Schema.String,
  remediation: Schema.optional(Schema.String),
  status: Schema.optional(Schema.Number),
  cause: Schema.Defect(),
}) {}

export class GitLabAuthError extends Schema.TaggedErrorClass<GitLabAuthError>()("GitLabAuthError", {
  detail: Schema.String,
  cause: Schema.Defect(),
}) {}
