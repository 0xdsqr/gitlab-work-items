# gitlab-work-items

A keyboard-first terminal UI for viewing and managing GitLab work items across your own queue and an organization.

The current vertical slice includes:

- assigned-to-me, created-by-me, and group scopes;
- one five-stage smart board across projects, persisted group issue boards, and a focused workflow board for every
  assigned epic;
- a searchable, grouped board switcher plus a filterable work-item inventory shared by every board;
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

Sample mode never contacts GitLab and will not mirror a real board. Live mode fetches fresh, paginated data on every
launch, scope change, and board switch; `r` is only a manual resync. The app also refreshes board discovery on `r`, so
you do not need to restart it when GitLab changes.

Install the command into your current Nix profile when you want `gitlab-work-items` available on `PATH`:

```sh
nix profile install github:0xdsqr/gitlab-work-items
gitlab-work-items
```

After a release is published, use its semantic version tag for a reproducible run rather than the moving `master`
branch:

```sh
TAG=vX.Y.Z
nix run "github:0xdsqr/gitlab-work-items/$TAG"
```

The flake exposes packages for Apple Silicon macOS and x86-64 Linux; CI continuously builds and smoke-tests the Linux
package. A Homebrew tap can be added once tagged releases and stable versioning are in place; Nix is the supported
installation path for now.

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
`GITLAB_HOST`; direct token authentication requires HTTPS except for loopback development hosts. The Organization
scope is unavailable until `GLWI_GROUP` is set to the group's full path; it never falls back to an instance-wide issue
query.

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

| Purpose            | Nix                                    | Bun                    |
| ------------------ | -------------------------------------- | ---------------------- |
| Run live data      | `nix run .`                            | `bun run start`        |
| Run sample data    | `nix run .#mock`                       | `bun run mock`         |
| Format files       | `nix fmt`                              | `bun run format`       |
| Check formatting   | `nix run .#format-check`               | `bun run format:check` |
| Audit dependencies | `nix run .#audit`                      | `bun run audit`        |
| Lint               | `nix run .#lint`                       | `bun run lint`         |
| Smoke-test package | `nix run .#smoke`                      | —                      |
| Type-check         | `nix run .#typecheck`                  | `bun run typecheck`    |
| Test               | `nix run .#test`                       | `bun run test`         |
| Run every check    | `nix run .#check` or `nix flake check` | —                      |
| Build TUI bundle   | —                                      | `bun run build`        |
| Build Nix package  | `nix build .#gitlab-work-items`        | —                      |

The tracked `.oxfmtrc.json` and `.oxlintrc.json` files are authoritative for both workflows. Bun passes them explicitly
to Oxfmt and Oxlint; treefmt and the Nix checks use those same files with Nix-pinned matching tool versions.
The online dependency audit is intentionally separate from the reproducible flake checks; CI runs both, and Dependabot
tracks the Bun lockfile, Nix flake inputs, and pinned GitHub Actions.

The Nix package contains the compiled application bundle plus the exact OpenTUI core and platform-native renderer
needed at runtime. It does not ship workspace sources, test tools, or the development `node_modules` tree.

The audit fails on every known advisory except the explicitly ignored `GHSA-4x5r-pxfx-6jf8`, a low-severity,
build-time advisory. `@opentui/solid@0.4.5` exact-pins the affected `@babel/core@7.28.0` even though patched Babel 7
releases exist. Remove this exception as soon as OpenTUI updates that exact dependency.
The root override also lifts OpenTUI's transitive `brace-expansion` to patched `5.0.8`; builds and tests guard that
major-version override until the upstream dependency chain adopts it directly.

## Releases

`package.json` is the single source of truth for the version consumed by the Nix package. Pushing the matching semantic
version tag runs the full Nix quality gate, builds and starts the packaged executable in deterministic sample mode,
and publishes a GitHub release with generated notes. A mismatched tag is rejected before publication. GitHub's source
archives plus the tagged flake are the release artifact; a separate registry is unnecessary for the supported Nix
installation path.

Controls:

- `1` / `2` opens Board / Work Items; `tab` changes scope.
- `b` opens the searchable board switcher from either surface. It groups smart views, the configured group's persisted
  issue boards, and epics assigned to you.
- `h` / `l` changes board column; `j` / `k` changes card.
- `[` / `]` moves the selected card; `enter` opens its details from either surface. For mouse drag/drop, hold the left button on a card's
  `⠿` grip, move it over a visible destination column, and release when the column says `Release to move here`; no
  preselection is required.
- Work Items defaults to open items; press `f` to cycle Open, Closed, and All, or click a status filter.
- Press `/` in Work Items to search titles, descriptions, references, projects, people, and labels; press `enter` to
  return to list navigation.
- `n` creates, `x` closes or reopens, `o` opens in GitLab, and `r` refreshes.
- `q` quits.

Smart and assigned-epic boards use the five-stage workflow and support card moves. Persisted GitLab issue boards retain
their actual remote lists, saved filters, ordering, and duplicate membership when an issue belongs to more than one
list. They are deliberately read-only in this release: the TUI does not pretend a scoped GitLab list is interchangeable
with the app's workflow labels. Open the item in GitLab for native-board changes.

An epic board flattens the selected epic's accessible child hierarchy into actionable issue/task cards while preserving
parent/depth context. The columns remain the same cross-project workflow stages, so an epic gives you a consistent
delivery view without creating another GitLab board to maintain. GitLab tier/version or permissions can make epic
discovery unavailable; the board switcher reports partial discovery failures while leaving the other sources usable.

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

GitLab's work-item direction is GraphQL and widget-based. This client uses bounded GraphQL connections for assigned
epics, hierarchy traversal, and persisted-board snapshots, while retaining the stable Issues REST API for the personal
smart queues and issue/task mutations. Every response is schema-decoded and terminal text is sanitized; pagination has
aggregate page, item, byte, and operation-time limits. The provider-neutral `WorkItem` and `BoardSnapshot` domain
models keep GitLab transport details out of the Solid UI.
