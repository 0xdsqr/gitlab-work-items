import { Schema } from "effect"

export class GitLabRequestError extends Schema.TaggedErrorClass<GitLabRequestError>()("GitLabRequestError", {
  operation: Schema.String,
  detail: Schema.String,
  cause: Schema.Defect(),
}) {}

export class GitLabAuthError extends Schema.TaggedErrorClass<GitLabAuthError>()("GitLabAuthError", {
  detail: Schema.String,
  cause: Schema.Defect(),
}) {}
