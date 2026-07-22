# gitlab-work-items

A keyboard-first terminal UI for viewing and managing GitLab work items across your own queue and an organization.

The current vertical slice includes:

- assigned-to-me, created-by-me, and group scopes;
- a primary five-stage Kanban board and filterable work-item inventory;
- mouse drag/drop plus complete keyboard navigation;
- live create, move, close, reopen, and open-in-GitLab actions;
- GitLab-native label and scoped-label colors, assignees, type, reference, and update age on cards;
- live GitLab authentication through environment variables or an existing `glab` login;
- deterministic mock data with an example epic;
- a Bun workspace and Nix development, checks, and package build.

## Usage

With Nix installed and flakes enabled, run the latest `master` directly from GitHub:

```sh
nix run github:0xdsqr/gitlab-work-items
```

To explore the interface with deterministic sample data and no GitLab credentials:

```sh
nix run github:0xdsqr/gitlab-work-items#mock
```

Sample mode never contacts GitLab and will not mirror a real board. Live mode fetches fresh data on every launch and
scope change; `r` is only a manual resync.

Install the command into your current Nix profile when you want `gitlab-work-items` available on `PATH`:

```sh
nix profile install github:0xdsqr/gitlab-work-items
gitlab-work-items
```

For a reproducible release rather than the moving `master` branch, pin a semantic version tag:

```sh
nix run github:0xdsqr/gitlab-work-items/v0.1.0
```

The flake currently publishes tested packages for Apple Silicon macOS and x86-64 Linux. A Homebrew tap can be added
once tagged releases and stable versioning are in place; Nix is the supported installation path for now.

## Local development

The recommended path uses direnv to enter the pinned Nix development shell automatically:

```sh
direnv allow
bun install --frozen-lockfile
bun run dev
```

Without direnv:

```sh
nix develop
bun install --frozen-lockfile
bun run dev
```

Use `nix run .#mock` or `bun run mock` to run local fixtures.

For live data, authenticate once with `glab auth login` or export `GITLAB_TOKEN`. The token needs `api` scope for board
updates and creation (`read_api` is sufficient only for viewing). A separate
username is not required because the app calls GitLab's current-user endpoint. For a self-managed instance, set
`GITLAB_HOST`; direct token authentication requires HTTPS except for loopback development hosts. For the organization
scope, set `GLWI_GROUP` to the group's full path.

For local direnv credentials, create an ignored `.envrc.local`. The tracked `.envrc` loads it automatically:

```sh
export GITLAB_TOKEN="glpat-..."
export GLWI_GROUP="acme/platform"
# export GITLAB_HOST="https://gitlab.example.com"
```

```sh
GLWI_GROUP=acme bun run dev
```

## Commands

Nix is the reproducible CI and packaging interface. Bun is the faster inner loop after entering the development shell.

| Purpose            | Nix                                    | Bun                                                                         |
| ------------------ | -------------------------------------- | --------------------------------------------------------------------------- |
| Run live data      | `nix run .`                            | `bun run start`                                                             |
| Run sample data    | `nix run .#mock`                       | `bun run mock`                                                              |
| Format files       | `nix fmt`                              | `bun run format`                                                            |
| Check formatting   | `nix run .#format-check`               | `bun run format:check`                                                      |
| Audit dependencies | `nix run .#audit`                      | `bun run audit`                                                             |
| Lint               | `nix run .#lint`                       | `bun run lint`                                                              |
| Type-check         | `nix run .#typecheck`                  | `bun run typecheck`                                                         |
| Test               | `nix run .#test`                       | `bun run test`                                                              |
| Run every check    | `nix run .#check` or `nix flake check` | `bun run format:check && bun run lint && bun run typecheck && bun run test` |
| Build the package  | `nix build .#gitlab-work-items`        | `bun run build`                                                             |

The tracked `.oxfmtrc.json` and `.oxlintrc.json` files are authoritative for both workflows. Bun passes them explicitly
to Oxfmt and Oxlint; treefmt and the Nix checks use those same files with Nix-pinned matching tool versions.
The online dependency audit is intentionally separate from the reproducible flake checks; CI runs both, and Dependabot
tracks the Bun lockfile, Nix flake inputs, and pinned GitHub Actions.

The audit narrowly ignores `GHSA-4x5r-pxfx-6jf8`, a low-severity build-time advisory in the Babel 7 release pinned by
`@opentui/solid`. Babel 8 is incompatible with OpenTUI's current Solid transform; remove this exception when OpenTUI
publishes a compatible patched dependency.

## Releases

`package.json` is the single source of truth for the version consumed by the Nix package. Pushing the matching semantic
version tag (for example, `v0.1.0`) runs the full Nix quality gate, builds the package, and publishes a GitHub release
with generated notes. A mismatched tag is rejected before publication. GitHub's source archives plus the tagged flake
are the release artifact; a separate registry is unnecessary for the supported Nix installation path.

Controls:

- `1` / `2` opens Board / Work Items; `tab` changes scope.
- `h` / `l` changes board column; `j` / `k` changes card.
- `[` / `]` moves the selected card; `enter` opens its details from either surface. For mouse drag/drop, hold the left button on a card's
  `⠿` grip, move it over a visible destination column, and release when the column says `Release to move here`; no
  preselection is required.
- Work Items defaults to open items; press `f` to cycle Open, Closed, and All, or click a status filter.
- Press `/` in Work Items to search titles, descriptions, references, projects, people, and labels; press `enter` to
  return to list navigation.
- `n` creates, `x` closes or reopens, `o` opens in GitLab, and `r` refreshes.
- `q` quits.

The cross-project board uses GitLab-compatible scoped labels: `workflow::ready`, `workflow::in progress`, and
`workflow::review`. A move removes the previous workflow label, adds the destination label, and closes or reopens the
issue when crossing the Closed column. GitLab creates a missing project label when the first card is moved into that
stage.

The board shows three columns in a standard 80-column terminal so mouse destinations stay visible. It progressively
scales from one to five visible stages as the terminal grows, keeping the focused stage in view and showing how many
stages are off-screen. The supported minimum is 44 columns by 16 rows; smaller terminals show a resize prompt instead
of clipping controls.

## Workspace

- `apps/tui` — OpenTUI Solid application and interaction shell.
- `packages/domain` — work-item model and pure workflow transition policy.
- `packages/gitlab` — Effect service, authentication, REST queries/mutations, browser opening, and schema decoding.
- `nix` — development shell, formatter, dependency closure, package, and checks.

## Architectural references

[ghui](https://github.com/kitlangton/ghui) is the primary product and code-organization reference. The project also
draws on [Executor](https://github.com/UsefulSoftwareCo/executor) for Effect-oriented workspace conventions,
[OpenCode](https://github.com/anomalyco/opencode) for Bun/Nix packaging patterns, and
[OpenTUI](https://github.com/anomalyco/opentui) for the renderer and Solid host.

GitLab's current work-item direction is GraphQL and widget-based. The bootstrap uses the stable Issues REST API for a
small, reliable live slice while keeping a provider-neutral `WorkItem` model that already represents epics, objectives,
and key results. The next API slice should add group `workItems` GraphQL pagination for complete organization coverage.
