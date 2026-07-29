import type { WorkItem } from "@gitlab-work-items/domain"
import { Effect, Layer } from "effect"
import { describe, expect, it, vi } from "vitest"
import {
  gitLabApiArguments,
  gitLabGraphqlArguments,
  GitLabClient,
  loadWorkspace,
  makeGitLabClient,
  sanitizeGitLabDescription,
  sanitizeGitLabInlineText,
  type GitLabClientDependencies,
  type GitLabSpawnOptions,
  type GitLabSpawnResult,
} from "../src/client.ts"
import { gitLabConfigFromEnv, type GitLabConfig } from "../src/config.ts"

const rawUser = {
  id: 7,
  username: "alice",
  name: "Alice",
}

const rawIssue = (id: number, title = `Issue ${id}`) => ({
  id,
  project_id: 11,
  iid: id,
  title,
  description: "First line\nSecond line",
  state: "opened",
  labels: [{ name: "workflow::ready", color: "#123456", text_color: "#ffffff" }],
  updated_at: "2026-07-23T12:00:00.000Z",
  issue_type: "issue",
  web_url: `https://gitlab.example.com/acme/project/-/issues/${id}`,
  references: { full: `acme/project#${id}` },
  author: { username: "alice" },
  assignees: [{ username: "bob" }],
})

const rawBoard = {
  id: 3,
  name: "Platform board",
  hide_backlog_list: false,
  hide_closed_list: true,
  group: {
    id: 9,
    name: "Acme",
    web_url: "https://gitlab.example.com/groups/acme",
  },
  lists: [],
  labels: [{ id: 81, name: "team::platform", color: "#123456", description: null }],
  assignee: null,
  milestone: { id: 22, title: "18.0" },
  iteration: null,
  weight: 3,
}

const rawBoardLists = [
  {
    id: 32,
    position: 2,
    label: null,
    assignee: { id: 7, username: "alice", name: "Alice" },
    milestone: null,
    iteration: null,
    status: null,
    list_type: "assignee",
  },
  {
    id: 31,
    position: 1,
    label: { id: 82, name: "workflow::ready", color: "#123456", description: null },
    assignee: null,
    milestone: null,
    iteration: null,
    status: null,
    list_type: "label",
  },
  {
    id: 33,
    position: 3,
    label: null,
    assignee: null,
    milestone: null,
    iteration: null,
    status: { id: "gid://gitlab/WorkItems::Statuses::Status/4", name: "Done", color: "#00ff00" },
    list_type: "status",
  },
]

const rawGraphqlWorkItem = ({
  id,
  iid,
  title,
  type = "Epic",
  projectId = null,
  parentId = null,
  hasChildren = false,
  assigneesTruncated = false,
  labelsTruncated = false,
}: {
  id: number
  iid: number
  title: string
  type?: string
  projectId?: number | null
  parentId?: string | null
  hasChildren?: boolean
  assigneesTruncated?: boolean
  labelsTruncated?: boolean
}) => ({
  id: `gid://gitlab/WorkItem/${id}`,
  iid: String(iid),
  title,
  description: "Description\nsecond line",
  state: "OPEN",
  reference: `${projectId ? "acme/project#" : "acme&"}${iid}`,
  namespace: { fullPath: projectId ? "acme/project" : "acme" },
  project: projectId ? { id: `gid://gitlab/Project/${projectId}` } : null,
  author: { username: "alice" },
  webUrl: `https://gitlab.example.com/acme/-/work_items/${iid}`,
  updatedAt: "2026-07-28T12:00:00.000Z",
  workItemType: { name: type },
  widgets: [
    {
      __typename: "WorkItemWidgetAssignees",
      assignees: {
        nodes: [{ username: "alice" }],
        pageInfo: {
          hasNextPage: assigneesTruncated,
          endCursor: assigneesTruncated ? "assignees-cursor" : null,
        },
      },
    },
    {
      __typename: "WorkItemWidgetLabels",
      labels: {
        nodes: [{ title: "workflow::ready", color: "#123456", textColor: "#ffffff" }],
        pageInfo: {
          hasNextPage: labelsTruncated,
          endCursor: labelsTruncated ? "labels-cursor" : null,
        },
      },
    },
    {
      __typename: "WorkItemWidgetHierarchy",
      parent: parentId ? { id: parentId } : null,
      hasChildren,
    },
  ],
})

const rawGraphqlIssue = ({
  id,
  iid = id,
  title = `Board issue ${id}`,
  state = "opened",
}: {
  id: number
  iid?: number
  title?: string
  state?: "opened" | "closed"
}) => ({
  id: `gid://gitlab/Issue/${id}`,
  iid: String(iid),
  title,
  description: "Board card description",
  state,
  type: "ISSUE",
  reference: `acme/project#${iid}`,
  webUrl: `https://gitlab.example.com/acme/project/-/issues/${iid}`,
  updatedAt: "2026-07-28T12:00:00.000Z",
  projectId: 11,
  author: { username: "alice" },
  assignees: {
    nodes: [{ username: "alice" }],
    pageInfo: { hasNextPage: false, endCursor: null },
  },
  labels: {
    nodes: [{ title: "workflow::ready", color: "#123456", textColor: "#ffffff" }],
    pageInfo: { hasNextPage: false, endCursor: null },
  },
})

const rawGraphqlBoardList = ({
  id,
  listType,
  title,
  position,
  labelId,
}: {
  id: number
  listType: string
  title: string
  position: number | null
  labelId?: number
}) => ({
  id: `gid://gitlab/List/${id}`,
  listType,
  title,
  position,
  label:
    labelId === undefined
      ? null
      : {
          id: `gid://gitlab/GroupLabel/${labelId}`,
          title,
          color: "#123456",
          textColor: "#ffffff",
        },
  assignee: null,
  milestone: null,
  iteration: null,
  status: null,
})

const textStream = (value: string) => new Response(value).body

const processTextResult = (stdout: string, stderr = "", exitCode = 0): GitLabSpawnResult => ({
  exited: Promise.resolve(exitCode),
  stdout: textStream(stdout),
  stderr: textStream(stderr),
  kill: vi.fn(),
})

const processResult = (stdout: unknown, stderr = "", exitCode = 0) =>
  processTextResult(JSON.stringify(stdout), stderr, exitCode)

const paginatedJsonProcessResult = (pages: readonly unknown[][]) =>
  processTextResult(pages.map((page) => JSON.stringify(page)).join(""))

const dependencies = (
  config: GitLabConfig,
  overrides: Partial<Pick<GitLabClientDependencies, "fetch" | "spawn" | "limits">> = {},
): GitLabClientDependencies => ({
  getConfig: () => config,
  fetch:
    overrides.fetch ??
    (vi.fn(async () => {
      throw new Error("Unexpected fetch")
    }) as unknown as typeof fetch),
  spawn:
    overrides.spawn ??
    (() => {
      throw new Error("Unexpected spawn")
    }),
  ...(overrides.limits ? { limits: overrides.limits } : {}),
})

const effectError = <A, E>(effect: Effect.Effect<A, E>) => Effect.runPromise(effect.pipe(Effect.flip))

const issueWorkItem = (overrides: Partial<WorkItem> = {}): WorkItem => ({
  id: "gid://gitlab/WorkItem/900",
  projectId: 11,
  iid: 7,
  type: "ISSUE",
  title: "Stable identity",
  description: "",
  state: "OPEN",
  reference: "acme/project#7",
  namespace: "acme/project",
  author: "alice",
  assignees: [],
  labels: [{ name: "workflow::ready", color: "#123456", textColor: "#ffffff" }],
  webUrl: "https://gitlab.example.com/acme/project/-/issues/7",
  updatedAt: "2026-07-28T12:00:00.000Z",
  ...overrides,
})

describe("GitLab provider text safety", () => {
  it("removes C0/C1 terminal controls while preserving only description newlines", () => {
    expect(sanitizeGitLabInlineText("safe\u001b]52;c;payload\u0007\nnext\u009b31m")).toBe(
      "safe ]52;c;payload  next 31m",
    )
    expect(sanitizeGitLabDescription("first\r\nsecond\u001b[2J\nthird\tvalue\u0085")).toBe(
      "first\nsecond [2J\nthird value ",
    )
  })

  it("sanitizes every server-derived work-item and user string at the provider boundary", async () => {
    const config = gitLabConfigFromEnv({
      GITLAB_HOST: "https://gitlab.example.com",
      GITLAB_TOKEN: "token",
    })
    const issue = {
      ...rawIssue(1, "unsafe\u001b]0;owned\u0007"),
      description: "kept\nline\u001b[2J",
      labels: [{ name: "label\u009b31m", color: "#fff\u0007", text_color: "#000\u001b" }],
      references: { full: "acme/project\u001b#1" },
      author: { username: "alice\u0007" },
      assignees: [{ username: "bob\u001b" }],
    }
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = String(input)
      if (url.endsWith("/user")) return Response.json({ ...rawUser, username: "alice\u001b", name: "Alice\u0007" })
      return Response.json([issue])
    }) as unknown as typeof fetch
    const client = makeGitLabClient(dependencies(config, { fetch: fetchMock }))

    const workspace = await Effect.runPromise(client.loadWorkspace("assigned"))

    expect(workspace.user).toMatchObject({ username: "alice ", name: "Alice " })
    expect(workspace.items[0]).toMatchObject({
      title: "unsafe ]0;owned ",
      description: "kept\nline [2J",
      reference: "acme/project #1",
      author: "alice ",
      assignees: ["bob "],
      labels: [{ name: "label 31m", color: "#fff ", textColor: "#000 " }],
    })
  })
})

describe("GitLab direct transport", () => {
  it("follows and aggregates validated list pagination links", async () => {
    const config = gitLabConfigFromEnv({
      GITLAB_HOST: "https://gitlab.example.com/gitlab",
      GITLAB_TOKEN: "token",
    })
    const requested: string[] = []
    const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input)
      requested.push(url)
      expect(init?.redirect).toBe("error")
      expect(init?.signal).toBeInstanceOf(AbortSignal)
      if (url.endsWith("/user")) return Response.json(rawUser)
      if (url.includes("page=2")) return Response.json([rawIssue(2)])
      return Response.json([rawIssue(1)], {
        headers: {
          link: '<https://gitlab.example.com/gitlab/api/v4/issues?page=2>; rel="next"',
        },
      })
    }) as unknown as typeof fetch
    const client = makeGitLabClient(dependencies(config, { fetch: fetchMock }))

    const workspace = await Effect.runPromise(client.loadWorkspace("assigned"))

    expect(workspace.items.map((item) => item.id)).toEqual(["1", "2"])
    expect(requested.some((url) => url.includes("page=2"))).toBe(true)
  })

  it("rejects individually valid pages when their cumulative body exceeds the aggregate budget", async () => {
    const config = gitLabConfigFromEnv({
      GITLAB_HOST: "https://gitlab.example.com",
      GITLAB_TOKEN: "token",
    })
    const firstPage = JSON.stringify([rawIssue(1)])
    const secondPage = JSON.stringify([rawIssue(2)])
    const aggregateLimit = Buffer.byteLength(firstPage) + Buffer.byteLength(secondPage) - 1
    let issueRequests = 0
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = String(input)
      if (url.endsWith("/user")) return Response.json(rawUser)
      issueRequests += 1
      if (url.includes("page=2")) return new Response(secondPage)
      return new Response(firstPage, {
        headers: {
          link: '<https://gitlab.example.com/api/v4/issues?page=2>; rel="next"',
        },
      })
    }) as unknown as typeof fetch
    const client = makeGitLabClient(
      dependencies(config, {
        fetch: fetchMock,
        limits: { maxPaginatedResponseBytes: aggregateLimit },
      }),
    )

    expect(Math.max(Buffer.byteLength(firstPage), Buffer.byteLength(secondPage))).toBeLessThan(aggregateLimit)
    const error = await effectError(client.loadWorkspace("assigned"))

    expect(error).toMatchObject({ kind: "invalid-response" })
    expect(error.detail).toContain("aggregate response limit")
    expect(error.detail).toContain("no partial results")
    expect(issueRequests).toBe(2)
  })

  it("propagates Effect cancellation to the fetch signal", async () => {
    const config = gitLabConfigFromEnv({
      GITLAB_HOST: "https://gitlab.example.com",
      GITLAB_TOKEN: "token",
    })
    let requestSignal: AbortSignal | undefined
    const fetchMock = vi.fn(
      (_input: string | URL | Request, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          requestSignal = init?.signal ?? undefined
          requestSignal?.addEventListener("abort", () => reject(requestSignal?.reason), { once: true })
        }),
    ) as unknown as typeof fetch
    const client = makeGitLabClient(dependencies(config, { fetch: fetchMock }))
    const controller = new AbortController()
    const pending = Effect.runPromise(client.createWorkItem("acme/project", "title"), {
      signal: controller.signal,
    })
    await vi.waitFor(() => expect(requestSignal).toBeInstanceOf(AbortSignal))

    controller.abort()

    await expect(pending).rejects.toBeDefined()
    expect(requestSignal?.aborted).toBe(true)
  })

  it("classifies HTTP and invalid-schema failures without blanket auth guidance", async () => {
    const config = gitLabConfigFromEnv({
      GITLAB_HOST: "https://gitlab.example.com",
      GITLAB_TOKEN: "token",
    })
    const forbidden = makeGitLabClient(
      dependencies(config, {
        fetch: vi.fn(async () => new Response("denied\u001b[2J", { status: 403 })) as unknown as typeof fetch,
      }),
    )
    const forbiddenError = await effectError(forbidden.createWorkItem("acme/project", "title"))
    expect(forbiddenError).toMatchObject({
      kind: "authorization",
      status: 403,
      remediation: expect.stringContaining("access"),
    })
    expect(forbiddenError.detail).not.toContain("\u001b")
    expect(forbiddenError.remediation).not.toContain("GITLAB_TOKEN")

    const invalid = makeGitLabClient(
      dependencies(config, {
        fetch: vi.fn(async () => Response.json({ unexpected: true })) as unknown as typeof fetch,
      }),
    )
    const schemaError = await effectError(invalid.createWorkItem("acme/project", "title"))
    expect(schemaError).toMatchObject({
      kind: "invalid-response",
      remediation: expect.stringContaining("compatible GitLab API"),
    })
  })
})

describe("GitLab issue mutations", () => {
  it("preserves the caller's stable Work Item ID after a REST mutation", async () => {
    const config = gitLabConfigFromEnv({
      GITLAB_HOST: "https://gitlab.example.com",
      GITLAB_TOKEN: "token",
    })
    const requested: string[] = []
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      requested.push(String(input))
      return Response.json({
        ...rawIssue(999),
        project_id: 11,
        iid: 7,
        state: "closed",
      })
    }) as unknown as typeof fetch
    const client = makeGitLabClient(dependencies(config, { fetch: fetchMock }))
    const item = issueWorkItem()

    const updated = await Effect.runPromise(client.setWorkItemState(item, "CLOSED"))

    expect(updated).toMatchObject({
      id: item.id,
      projectId: 11,
      iid: 7,
      state: "CLOSED",
    })
    expect(requested).toEqual(["https://gitlab.example.com/api/v4/projects/11/issues/7"])
  })

  it("rejects missing or invalid project IDs before mock or live mutation transports", async () => {
    const fetchMock = vi.fn() as unknown as typeof fetch
    const spawnMock = vi.fn()
    const mockClient = makeGitLabClient(
      dependencies(gitLabConfigFromEnv({ GLWI_MOCK: "true" }), {
        fetch: fetchMock,
        spawn: spawnMock,
      }),
    )
    const liveClient = makeGitLabClient(
      dependencies(
        gitLabConfigFromEnv({
          GITLAB_HOST: "https://gitlab.example.com",
          GITLAB_TOKEN: "token",
        }),
        { fetch: fetchMock, spawn: spawnMock },
      ),
    )

    const mockError = await effectError(mockClient.moveWorkItem(issueWorkItem({ projectId: null }), "doing"))
    const liveError = await effectError(liveClient.setWorkItemState(issueWorkItem({ projectId: 0 }), "CLOSED"))

    expect(mockError).toMatchObject({ kind: "request", operation: "moveWorkItem" })
    expect(mockError.detail).toContain("valid GitLab project ID")
    expect(liveError).toMatchObject({ kind: "request", operation: "setWorkItemState" })
    expect(fetchMock).not.toHaveBeenCalled()
    expect(spawnMock).not.toHaveBeenCalled()
  })
})

describe("GitLab group boards", () => {
  it("loads the configured-group catalog and a sanitized, ordered native definition", async () => {
    const config = gitLabConfigFromEnv({
      GITLAB_HOST: "https://gitlab.example.com",
      GITLAB_TOKEN: "token",
      GLWI_GROUP: "acme/platform",
    })
    const requested: string[] = []
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = String(input)
      requested.push(url)
      if (url.includes("/boards/3/lists"))
        return Response.json([
          { ...rawBoardLists[0], assignee: { id: 7, username: "alice", name: "Alice\u001b]0;bad\u0007" } },
          ...rawBoardLists.slice(1),
        ])
      if (url.endsWith("/boards/3")) return Response.json({ ...rawBoard, name: "Platform\u001b board" })
      return Response.json([{ ...rawBoard, name: "Platform\u001b board" }])
    }) as unknown as typeof fetch
    const client = makeGitLabClient(dependencies(config, { fetch: fetchMock }))

    const catalog = await Effect.runPromise(client.listGroupBoards())
    const definition = await Effect.runPromise(client.loadGroupBoard(3))

    expect(catalog).toEqual([
      expect.objectContaining({
        id: 3,
        name: "Platform  board",
        hideBacklogList: false,
        hideClosedList: true,
      }),
    ])
    expect(definition).toMatchObject({
      id: 3,
      filters: {
        labels: ["team::platform"],
        assigneeUsername: null,
        milestoneTitle: "18.0",
        iterationTitle: null,
        weight: 3,
      },
      lists: [
        { id: 31, kind: "label", title: "workflow::ready", valueId: 82 },
        { id: 32, kind: "assignee", title: "Alice ]0;bad ", valueId: 7 },
        {
          id: 33,
          kind: "status",
          title: "Done",
          valueId: "gid://gitlab/WorkItems::Statuses::Status/4",
        },
      ],
    })
    expect(requested).toEqual(
      expect.arrayContaining([
        "https://gitlab.example.com/api/v4/groups/acme%2Fplatform/boards?per_page=100",
        "https://gitlab.example.com/api/v4/groups/acme%2Fplatform/boards/3",
        "https://gitlab.example.com/api/v4/groups/acme%2Fplatform/boards/3/lists?per_page=100",
      ]),
    )
  })

  it("supports a useful mock catalog without requiring a configured group", async () => {
    const client = makeGitLabClient(dependencies(gitLabConfigFromEnv({ GLWI_MOCK: "true" })))

    const catalog = await Effect.runPromise(client.listGroupBoards())
    const definition = await Effect.runPromise(client.loadGroupBoard(1))

    expect(catalog[0]).toMatchObject({ id: 1, name: "Development" })
    expect(definition.lists.map((list) => list.kind)).toEqual(["label", "label", "label"])
  })

  it("loads every native list and its ordered cards while preserving cross-list membership", async () => {
    const config = gitLabConfigFromEnv({
      GITLAB_HOST: "https://gitlab.example.com",
      GITLAB_TOKEN: "token",
      GLWI_GROUP: "acme",
    })
    const backlog = rawGraphqlBoardList({
      id: 10,
      listType: "backlog",
      title: "Open",
      position: null,
    })
    const ready = rawGraphqlBoardList({
      id: 11,
      listType: "label",
      title: "workflow::ready\u001b",
      position: 0,
      labelId: 81,
    })
    const frontend = rawGraphqlBoardList({
      id: 12,
      listType: "label",
      title: "frontend",
      position: 1,
      labelId: 82,
    })
    const closed = rawGraphqlBoardList({
      id: 13,
      listType: "closed",
      title: "Closed",
      position: null,
    })
    const bodies: { query: string; variables: Record<string, string> }[] = []
    const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      if (String(input).endsWith("/boards/3")) return Response.json(rawBoard)
      const body = JSON.parse(String(init?.body)) as { query: string; variables: Record<string, string> }
      bodies.push(body)
      if (body.query.includes("query GroupBoardLists")) {
        const secondPage = body.variables.after === "lists-cursor"
        return Response.json({
          data: {
            group: {
              board: {
                lists: {
                  nodes: secondPage ? [frontend, closed] : [backlog, ready],
                  pageInfo: {
                    hasNextPage: !secondPage,
                    endCursor: secondPage ? null : "lists-cursor",
                  },
                },
              },
            },
          },
        })
      }
      const listId = body.variables.listId
      const secondReadyPage = listId === ready.id && body.variables.after === "ready-cursor"
      const nodes =
        listId === backlog.id
          ? [rawGraphqlIssue({ id: 502 })]
          : listId === ready.id
            ? secondReadyPage
              ? [rawGraphqlIssue({ id: 504 })]
              : [rawGraphqlIssue({ id: 501, title: "Shared\u001b]0;unsafe\u0007 card" })]
            : listId === frontend.id
              ? [rawGraphqlIssue({ id: 501, title: "Shared card" })]
              : [rawGraphqlIssue({ id: 503, state: "closed" })]
      return Response.json({
        data: {
          group: {
            board: {
              lists: {
                nodes: [
                  {
                    id: listId,
                    issues: {
                      nodes,
                      pageInfo: {
                        hasNextPage: listId === ready.id && !secondReadyPage,
                        endCursor: listId === ready.id && !secondReadyPage ? "ready-cursor" : null,
                      },
                    },
                  },
                ],
              },
            },
          },
        },
      })
    }) as unknown as typeof fetch
    const client = makeGitLabClient(dependencies(config, { fetch: fetchMock }))

    const snapshot = await Effect.runPromise(client.loadGroupBoardSnapshot(3))

    expect(snapshot.lists.map((list) => list.kind)).toEqual(["backlog", "label", "label", "closed"])
    expect(snapshot.lists.map((list) => list.position)).toEqual([0, 1, 2, 3])
    expect(snapshot.lists[1]).toMatchObject({
      id: ready.id,
      gitLabListId: 11,
      title: "workflow::ready ",
      valueId: "gid://gitlab/GroupLabel/81",
    })
    expect(snapshot.items).toHaveLength(4)
    expect(snapshot.items.find((item) => item.id === "gid://gitlab/Issue/501")).toMatchObject({
      projectId: 11,
      type: "ISSUE",
      title: "Shared ]0;unsafe  card",
      reference: "acme/project#501",
    })
    expect(snapshot.cards.filter((card) => card.itemId === "gid://gitlab/Issue/501")).toEqual([
      { itemId: "gid://gitlab/Issue/501", listId: ready.id, position: 0 },
      { itemId: "gid://gitlab/Issue/501", listId: frontend.id, position: 0 },
    ])
    expect(snapshot.cards.filter((card) => card.listId === ready.id).map((card) => card.position)).toEqual([0, 1])
    expect(bodies.some((body) => body.variables.after === "lists-cursor")).toBe(true)
    expect(bodies.some((body) => body.variables.after === "ready-cursor")).toBe(true)
    expect(bodies.every((body) => body.variables.boardId === "gid://gitlab/Board/3")).toBe(true)
    expect(bodies.find((body) => body.query.includes("query GroupBoardCards"))?.query).toContain(
      "reference(full: true)",
    )
  })

  it("applies every saved board filter through GraphQL variables without query interpolation", async () => {
    const config = gitLabConfigFromEnv({
      GITLAB_HOST: "https://gitlab.example.com",
      GITLAB_TOKEN: "token",
      GLWI_GROUP: "acme",
    })
    const filterValues = {
      labelOne: 'team::platform") { mutation { injected } } #',
      labelTwo: "comma,label",
      assignee: 'alice") { id } #',
      milestone: '18.0") { id } #',
      iteration: 'Sprint "quoted" \\ path',
    }
    const filteredBoard = {
      ...rawBoard,
      labels: [
        { id: 81, name: filterValues.labelOne, color: "#123456", description: null },
        { id: 82, name: filterValues.labelTwo, color: "#654321", description: null },
      ],
      assignee: { id: 7, username: filterValues.assignee, name: "Alice" },
      milestone: { id: 22, title: filterValues.milestone },
      iteration: { id: 23, title: filterValues.iteration },
      weight: 13,
    }
    const list = rawGraphqlBoardList({
      id: 21,
      listType: "backlog",
      title: "Open",
      position: null,
    })
    let cardsBody: { query: string; variables: Record<string, string> } | undefined
    const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      if (String(input).endsWith("/boards/3")) return Response.json(filteredBoard)
      const body = JSON.parse(String(init?.body)) as { query: string; variables: Record<string, string> }
      if (body.query.includes("query GroupBoardLists"))
        return Response.json({
          data: {
            group: {
              board: {
                lists: {
                  nodes: [list],
                  pageInfo: { hasNextPage: false, endCursor: null },
                },
              },
            },
          },
        })
      cardsBody = body
      return Response.json({
        data: {
          group: {
            board: {
              lists: {
                nodes: [
                  {
                    id: list.id,
                    issues: {
                      nodes: [rawGraphqlIssue({ id: 701 })],
                      pageInfo: { hasNextPage: false, endCursor: null },
                    },
                  },
                ],
              },
            },
          },
        },
      })
    }) as unknown as typeof fetch
    const client = makeGitLabClient(dependencies(config, { fetch: fetchMock }))

    await Effect.runPromise(client.loadGroupBoardSnapshot(3))

    expect(cardsBody).toBeDefined()
    expect(cardsBody?.variables).toMatchObject({
      boardLabel0: filterValues.labelOne,
      boardLabel1: filterValues.labelTwo,
      boardAssigneeUsername: filterValues.assignee,
      boardMilestoneTitle: filterValues.milestone,
      boardIterationTitle: filterValues.iteration,
      boardWeight: "13",
    })
    expect(cardsBody?.query).toContain(
      "issueFilters: { labelName: [$boardLabel0, $boardLabel1], assigneeUsername: [$boardAssigneeUsername]",
    )
    expect(cardsBody?.query).toContain(
      "filters: { labelName: [$boardLabel0, $boardLabel1], assigneeUsername: [$boardAssigneeUsername]",
    )
    expect(Object.values(filterValues).every((value) => !cardsBody?.query.includes(value))).toBe(true)
  })

  it("fails explicitly when board-card labels or assignees are truncated", async () => {
    const config = gitLabConfigFromEnv({
      GITLAB_HOST: "https://gitlab.example.com",
      GITLAB_TOKEN: "token",
      GLWI_GROUP: "acme",
    })
    const list = rawGraphqlBoardList({
      id: 21,
      listType: "backlog",
      title: "Open",
      position: null,
    })
    const issue = rawGraphqlIssue({ id: 702 })
    const truncated = {
      ...issue,
      labels: {
        ...issue.labels,
        pageInfo: { hasNextPage: true, endCursor: "labels-cursor" },
      },
    }
    const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      if (String(input).endsWith("/boards/3")) return Response.json(rawBoard)
      const body = JSON.parse(String(init?.body)) as { query: string }
      if (body.query.includes("query GroupBoardLists"))
        return Response.json({
          data: {
            group: {
              board: {
                lists: {
                  nodes: [list],
                  pageInfo: { hasNextPage: false, endCursor: null },
                },
              },
            },
          },
        })
      return Response.json({
        data: {
          group: {
            board: {
              lists: {
                nodes: [
                  {
                    id: list.id,
                    issues: {
                      nodes: [truncated],
                      pageInfo: { hasNextPage: false, endCursor: null },
                    },
                  },
                ],
              },
            },
          },
        },
      })
    }) as unknown as typeof fetch
    const client = makeGitLabClient(dependencies(config, { fetch: fetchMock }))

    const error = await effectError(client.loadGroupBoardSnapshot(3))

    expect(error).toMatchObject({ kind: "invalid-response" })
    expect(error.detail).toContain("more than 100 labels")
    expect(error.detail).toContain("refusing incomplete metadata")
  })

  it("bounds the complete native-board snapshot operation with one deadline", async () => {
    const config = gitLabConfigFromEnv({
      GITLAB_HOST: "https://gitlab.example.com",
      GITLAB_TOKEN: "token",
      GLWI_GROUP: "acme",
    })
    const fetchMock = vi.fn(
      (_input: string | URL | Request, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(init.signal?.reason), { once: true })
        }),
    ) as unknown as typeof fetch
    const client = makeGitLabClient(
      dependencies(config, {
        fetch: fetchMock,
        limits: { maxOperationDurationMs: 5 },
      }),
    )

    const error = await effectError(client.loadGroupBoardSnapshot(3))

    expect(error).toMatchObject({ kind: "timeout", operation: "loadGroupBoardSnapshot" })
    expect(error.detail).toContain("whole-operation deadline")
    expect(error.detail).toContain("no partial results")
  })

  it("applies item and aggregate-byte limits across list and card pages", async () => {
    const config = gitLabConfigFromEnv({
      GITLAB_HOST: "https://gitlab.example.com",
      GITLAB_TOKEN: "token",
      GLWI_GROUP: "acme",
    })
    const list = rawGraphqlBoardList({
      id: 21,
      listType: "backlog",
      title: "Open",
      position: null,
    })
    const listsPayload = {
      data: {
        group: {
          board: {
            lists: {
              nodes: [list],
              pageInfo: { hasNextPage: false, endCursor: null },
            },
          },
        },
      },
    }
    const cardsPayload = {
      data: {
        group: {
          board: {
            lists: {
              nodes: [
                {
                  id: list.id,
                  issues: {
                    nodes: [rawGraphqlIssue({ id: 601 })],
                    pageInfo: { hasNextPage: false, endCursor: null },
                  },
                },
              ],
            },
          },
        },
      },
    }
    const snapshotFetch = () =>
      vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
        if (String(input).endsWith("/boards/3")) return Response.json(rawBoard)
        const body = JSON.parse(String(init?.body)) as { query: string }
        return Response.json(body.query.includes("query GroupBoardLists") ? listsPayload : cardsPayload)
      }) as unknown as typeof fetch

    const itemLimited = makeGitLabClient(
      dependencies(config, {
        fetch: snapshotFetch(),
        limits: { maxPaginatedItems: 1 },
      }),
    )
    const itemError = await effectError(itemLimited.loadGroupBoardSnapshot(3))
    expect(itemError).toMatchObject({ kind: "invalid-response" })
    expect(itemError.detail).toContain("no partial results")

    const listsText = JSON.stringify(listsPayload)
    const cardsText = JSON.stringify(cardsPayload)
    const aggregateLimit = Buffer.byteLength(listsText) + Buffer.byteLength(cardsText) - 1
    const byteFetch = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      if (String(input).endsWith("/boards/3")) return Response.json(rawBoard)
      const body = JSON.parse(String(init?.body)) as { query: string }
      return new Response(body.query.includes("query GroupBoardLists") ? listsText : cardsText)
    }) as unknown as typeof fetch
    const byteLimited = makeGitLabClient(
      dependencies(config, {
        fetch: byteFetch,
        limits: { maxPaginatedResponseBytes: aggregateLimit },
      }),
    )
    const byteError = await effectError(byteLimited.loadGroupBoardSnapshot(3))
    expect(byteError).toMatchObject({ kind: "invalid-response" })
    expect(byteError.detail).toContain("aggregate response limit")
    expect(byteError.detail).toContain("no partial results")
  })

  it("returns a mock snapshot with Open and Closed columns", async () => {
    const client = makeGitLabClient(dependencies(gitLabConfigFromEnv({ GLWI_MOCK: "true" })))

    const snapshot = await Effect.runPromise(client.loadGroupBoardSnapshot(1))

    expect(snapshot.lists[0]?.kind).toBe("backlog")
    expect(snapshot.lists.at(-1)?.kind).toBe("closed")
    expect(snapshot.items.every((item) => item.projectId !== null && item.type !== "EPIC")).toBe(true)
    expect(snapshot.cards.every((card) => snapshot.items.some((item) => item.id === card.itemId))).toBe(true)
  })
})

describe("GitLab epic Work Item GraphQL", () => {
  it("lists assigned epics with bounded cursor pagination and variables", async () => {
    const config = gitLabConfigFromEnv({
      GITLAB_HOST: "https://gitlab.example.com/gitlab",
      GITLAB_TOKEN: "token",
      GLWI_GROUP: 'acme/"safe-variable',
    })
    const graphqlBodies: { query: string; variables: Record<string, string> }[] = []
    const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input)
      if (url.endsWith("/api/v4/user")) return Response.json(rawUser)
      expect(url).toBe("https://gitlab.example.com/gitlab/api/graphql")
      expect(init?.redirect).toBe("error")
      const body = JSON.parse(String(init?.body)) as { query: string; variables: Record<string, string> }
      graphqlBodies.push(body)
      const secondPage = body.variables.after === "epic-cursor"
      return Response.json({
        data: {
          group: {
            workItems: {
              nodes: [
                rawGraphqlWorkItem({
                  id: secondPage ? 202 : 201,
                  iid: secondPage ? 52 : 51,
                  title: secondPage ? "Second epic" : "First\u001b]0;owned\u0007 epic",
                }),
              ],
              pageInfo: {
                hasNextPage: !secondPage,
                endCursor: secondPage ? null : "epic-cursor",
              },
            },
          },
        },
      })
    }) as unknown as typeof fetch
    const client = makeGitLabClient(dependencies(config, { fetch: fetchMock }))

    const epics = await Effect.runPromise(client.listAssignedEpics())

    expect(epics.map((epic) => epic.id)).toEqual(["gid://gitlab/WorkItem/201", "gid://gitlab/WorkItem/202"])
    expect(epics[0]).toMatchObject({
      projectId: null,
      type: "EPIC",
      title: "First ]0;owned  epic",
      assignees: ["alice"],
      labels: [{ name: "workflow::ready", color: "#123456", textColor: "#ffffff" }],
    })
    expect(graphqlBodies).toHaveLength(2)
    expect(graphqlBodies[0]?.query).toContain("assigneeUsernames: [$username]")
    expect(graphqlBodies[0]?.query).not.toContain(config.group)
    expect(graphqlBodies[0]?.variables).toMatchObject({
      fullPath: config.group,
      username: "alice",
    })
    expect(graphqlBodies[1]?.variables.after).toBe("epic-cursor")
  })

  it("fails explicitly when Work Item labels or assignees are truncated", async () => {
    const config = gitLabConfigFromEnv({
      GITLAB_HOST: "https://gitlab.example.com",
      GITLAB_TOKEN: "token",
      GLWI_GROUP: "acme",
    })
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      if (String(input).endsWith("/api/v4/user")) return Response.json(rawUser)
      return Response.json({
        data: {
          group: {
            workItems: {
              nodes: [
                rawGraphqlWorkItem({
                  id: 205,
                  iid: 55,
                  title: "Truncated epic",
                  assigneesTruncated: true,
                }),
              ],
              pageInfo: { hasNextPage: false, endCursor: null },
            },
          },
        },
      })
    }) as unknown as typeof fetch
    const client = makeGitLabClient(dependencies(config, { fetch: fetchMock }))

    const error = await effectError(client.listAssignedEpics())

    expect(error).toMatchObject({ kind: "invalid-response" })
    expect(error.detail).toContain("more than 100 assignees")
    expect(error.detail).toContain("refusing incomplete metadata")
  })

  it("loads all epic descendants and derives stable parent depths", async () => {
    const config = gitLabConfigFromEnv({
      GITLAB_HOST: "https://gitlab.example.com",
      GITLAB_TOKEN: "token",
      GLWI_GROUP: "acme",
    })
    const root = rawGraphqlWorkItem({ id: 301, iid: 42, title: "Root epic", hasChildren: true })
    const childId = "gid://gitlab/WorkItem/302"
    const queries: string[] = []
    const fetchMock = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as { query: string; variables: Record<string, string> }
      queries.push(body.query)
      if (body.query.includes("query EpicHierarchyRoot")) return Response.json({ data: { root } })
      const parentId = body.variables.parentId
      const secondPage = parentId === root.id && body.variables.after === "child-cursor"
      const nodes =
        parentId === childId
          ? [
              rawGraphqlWorkItem({
                id: 303,
                iid: 9,
                title: "Nested task",
                type: "Task",
                projectId: 11,
                parentId: childId,
              }),
            ]
          : secondPage
            ? [
                {
                  ...rawGraphqlWorkItem({
                    id: 304,
                    iid: 10,
                    title: "Cross-group issue",
                    type: "Issue",
                    projectId: 12,
                    parentId: root.id,
                  }),
                  reference: "other/project#10",
                  namespace: { fullPath: "other/project" },
                },
              ]
            : [
                rawGraphqlWorkItem({
                  id: 302,
                  iid: 8,
                  title: "Child issue",
                  type: "Issue",
                  projectId: 11,
                  parentId: root.id,
                  hasChildren: true,
                }),
              ]
      return Response.json({
        data: {
          parent: {
            id: parentId,
            widgets: [
              {
                __typename: "WorkItemWidgetHierarchy",
                children: {
                  nodes,
                  pageInfo: {
                    hasNextPage: parentId === root.id && !secondPage,
                    endCursor: parentId === root.id && !secondPage ? "child-cursor" : null,
                  },
                },
              },
            ],
          },
        },
      })
    }) as unknown as typeof fetch
    const client = makeGitLabClient(dependencies(config, { fetch: fetchMock }))

    const hierarchy = await Effect.runPromise(client.loadEpicHierarchy(root.id))

    expect(hierarchy.root).toMatchObject({ id: root.id, projectId: null, type: "EPIC" })
    expect(hierarchy.descendants).toEqual([
      expect.objectContaining({
        item: expect.objectContaining({ id: childId, projectId: 11, type: "ISSUE" }),
        parentId: root.id,
        depth: 1,
      }),
      expect.objectContaining({
        item: expect.objectContaining({
          id: "gid://gitlab/WorkItem/304",
          projectId: 12,
          namespace: "other/project",
          type: "ISSUE",
        }),
        parentId: root.id,
        depth: 1,
      }),
      expect.objectContaining({
        item: expect.objectContaining({ id: "gid://gitlab/WorkItem/303", projectId: 11, type: "TASK" }),
        parentId: childId,
        depth: 2,
      }),
    ])
    expect(queries.every((query) => !query.includes("group(fullPath:"))).toBe(true)
  })

  it.each(["duplicate", "cycle"] as const)("rejects %s entries in globally traversed hierarchies", async (kind) => {
    const config = gitLabConfigFromEnv({
      GITLAB_HOST: "https://gitlab.example.com",
      GITLAB_TOKEN: "token",
    })
    const root = rawGraphqlWorkItem({ id: 350, iid: 50, title: "Root", hasChildren: true })
    const child = rawGraphqlWorkItem({
      id: 351,
      iid: 51,
      title: "Child",
      type: "Issue",
      projectId: 11,
      parentId: root.id,
      hasChildren: kind === "cycle",
    })
    const fetchMock = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as { query: string; variables: Record<string, string> }
      if (body.query.includes("query EpicHierarchyRoot")) return Response.json({ data: { root } })
      const parentId = body.variables.parentId
      const nodes =
        kind === "duplicate"
          ? [child, child]
          : parentId === root.id
            ? [child]
            : [
                rawGraphqlWorkItem({
                  id: 350,
                  iid: 50,
                  title: "Root",
                  parentId: child.id,
                  hasChildren: true,
                }),
              ]
      return Response.json({
        data: {
          parent: {
            id: parentId,
            widgets: [
              {
                __typename: "WorkItemWidgetHierarchy",
                children: {
                  nodes,
                  pageInfo: { hasNextPage: false, endCursor: null },
                },
              },
            ],
          },
        },
      })
    }) as unknown as typeof fetch
    const client = makeGitLabClient(dependencies(config, { fetch: fetchMock }))

    const error = await effectError(client.loadEpicHierarchy(root.id))

    expect(error).toMatchObject({ kind: "invalid-response" })
    expect(error.detail.toLowerCase()).toContain(kind)
  })

  it("keeps hierarchy traversal inside page budgets", async () => {
    const config = gitLabConfigFromEnv({
      GITLAB_HOST: "https://gitlab.example.com",
      GITLAB_TOKEN: "token",
    })
    const root = rawGraphqlWorkItem({ id: 360, iid: 60, title: "Root", hasChildren: true })
    const fetchMock = vi.fn(async () => Response.json({ data: { root } })) as unknown as typeof fetch
    const client = makeGitLabClient(
      dependencies(config, {
        fetch: fetchMock,
        limits: { maxPages: 1 },
      }),
    )

    const error = await effectError(client.loadEpicHierarchy(root.id))

    expect(error).toMatchObject({ kind: "invalid-response" })
    expect(error.detail).toContain("page limit")
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it("bounds the complete hierarchy traversal with one deadline", async () => {
    const config = gitLabConfigFromEnv({
      GITLAB_HOST: "https://gitlab.example.com",
      GITLAB_TOKEN: "token",
    })
    const fetchMock = vi.fn(
      (_input: string | URL | Request, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(init.signal?.reason), { once: true })
        }),
    ) as unknown as typeof fetch
    const client = makeGitLabClient(
      dependencies(config, {
        fetch: fetchMock,
        limits: { maxOperationDurationMs: 5 },
      }),
    )

    const error = await effectError(client.loadEpicHierarchy("gid://gitlab/WorkItem/370"))

    expect(error).toMatchObject({ kind: "timeout", operation: "loadEpicHierarchy" })
    expect(error.detail).toContain("whole-operation deadline")
    expect(error.detail).toContain("no partial results")
  })

  it("rejects oversized or unsupported GraphQL catalogs without partial results", async () => {
    const config = gitLabConfigFromEnv({
      GITLAB_HOST: "https://gitlab.example.com",
      GITLAB_TOKEN: "token",
      GLWI_GROUP: "acme",
    })
    const oversizedFetch = vi.fn(async (input: string | URL | Request) => {
      if (String(input).endsWith("/user")) return Response.json(rawUser)
      return Response.json({
        data: {
          group: {
            workItems: {
              nodes: [
                rawGraphqlWorkItem({ id: 401, iid: 1, title: "One" }),
                rawGraphqlWorkItem({ id: 402, iid: 2, title: "Two" }),
              ],
              pageInfo: { hasNextPage: false, endCursor: null },
            },
          },
        },
      })
    }) as unknown as typeof fetch
    const oversized = makeGitLabClient(
      dependencies(config, { fetch: oversizedFetch, limits: { maxPaginatedItems: 1 } }),
    )

    const itemLimitError = await effectError(oversized.listAssignedEpics())
    expect(itemLimitError).toMatchObject({ kind: "invalid-response" })
    expect(itemLimitError.detail).toContain("no partial results")

    const unsupportedFetch = vi.fn(async (input: string | URL | Request) => {
      if (String(input).endsWith("/user")) return Response.json(rawUser)
      return Response.json({
        errors: [{ message: "Field 'workItems' doesn't exist on type 'Group'" }],
      })
    }) as unknown as typeof fetch
    const unsupported = makeGitLabClient(dependencies(config, { fetch: unsupportedFetch }))

    const capabilityError = await effectError(unsupported.listAssignedEpics())
    expect(capabilityError).toMatchObject({
      kind: "invalid-response",
      remediation: expect.stringContaining("GitLab 18.3"),
    })
  })

  it("supports mock assigned epics and hierarchy", async () => {
    const client = makeGitLabClient(dependencies(gitLabConfigFromEnv({ GLWI_MOCK: "true" })))

    const epics = await Effect.runPromise(client.listAssignedEpics())
    const hierarchy = await Effect.runPromise(client.loadEpicHierarchy(epics[0]!.id))

    expect(epics).toHaveLength(1)
    expect(epics[0]?.type).toBe("EPIC")
    expect(hierarchy.root.id).toBe(epics[0]?.id)
    expect(hierarchy.descendants.every((item) => item.parentId === hierarchy.root.id)).toBe(true)
  })
})

describe("glab transport", () => {
  it("uses literal raw fields and enables JSON pagination", async () => {
    const args = gitLabApiArguments(
      "https://gitlab.example.com",
      "issues",
      "POST",
      { title: "@/etc/passwd", weight: "123", confidential: "true" },
      true,
    )
    expect(args).not.toContain("--field")
    expect(args.filter((argument) => argument === "--raw-field")).toHaveLength(3)
    expect(args).toContain("title=@/etc/passwd")
    expect(args).toContain("weight=123")
    expect(args).toContain("confidential=true")
    expect(args).toContain("--paginate")
    expect(args).toContain("json")
  })

  it("passes GraphQL text and scalar variables as literal raw fields", () => {
    const query = "query($fullPath: ID!) { group(fullPath: $fullPath) { id } }"
    const args = gitLabGraphqlArguments("https://gitlab.example.com", query, {
      fullPath: "@/not-a-file",
    })

    expect(args).not.toContain("--field")
    expect(args).toEqual(expect.arrayContaining(["graphql", "--raw-field", `query=${query}`]))
    expect(args).toEqual(expect.arrayContaining(["--raw-field", "fullPath=@/not-a-file"]))
  })

  it("runs noninteractively with a timeout, cancellation signal, bounded pipes, and paginated lists", async () => {
    const config = gitLabConfigFromEnv({ GITLAB_HOST: "https://gitlab.example.com" })
    const calls: GitLabSpawnOptions[] = []
    const spawn = (options: GitLabSpawnOptions) => {
      calls.push(options)
      return options.cmd[2] === "user"
        ? processResult(rawUser)
        : paginatedJsonProcessResult([[rawIssue(1)], [rawIssue(2)]])
    }
    const client = makeGitLabClient(dependencies(config, { spawn }))

    const workspace = await Effect.runPromise(client.loadWorkspace("assigned"))

    expect(workspace.items).toHaveLength(2)
    const listCall = calls.find((call) => call.cmd[2]?.startsWith("issues?"))
    expect(listCall?.cmd).toEqual(expect.arrayContaining(["--paginate", "--output", "json"]))
    expect(listCall).toMatchObject({
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
      timeout: 30_000,
      signal: expect.any(AbortSignal),
      env: expect.objectContaining({
        GIT_TERMINAL_PROMPT: "0",
        GLAB_PROMPT_DISABLED: "1",
        NO_COLOR: "1",
      }),
    })
  })

  it("decodes adjacent and merged paginated JSON arrays without splitting delimiters inside strings", async () => {
    const config = gitLabConfigFromEnv({ GITLAB_HOST: "https://gitlab.example.com" })
    const trickyIssue = rawIssue(2, String.raw`Keep ][ {braces} and an escaped "quote" \ intact`)
    const pageOutput = ` ${JSON.stringify([rawIssue(1)])}\n${JSON.stringify([trickyIssue])} \n`
    const spawn = (options: GitLabSpawnOptions) =>
      options.cmd[2] === "user" ? processResult(rawUser) : processTextResult(pageOutput)
    const client = makeGitLabClient(dependencies(config, { spawn }))

    const workspace = await Effect.runPromise(client.loadWorkspace("assigned"))

    expect(workspace.items.map((item) => item.id)).toEqual(["1", "2"])
    expect(workspace.items[1]?.title).toBe(trickyIssue.title)

    const mergedSpawn = (options: GitLabSpawnOptions) =>
      options.cmd[2] === "user" ? processResult(rawUser) : processResult([rawIssue(1), rawIssue(2)])
    const mergedClient = makeGitLabClient(dependencies(config, { spawn: mergedSpawn }))

    await expect(Effect.runPromise(mergedClient.loadWorkspace("assigned"))).resolves.toMatchObject({
      items: [expect.objectContaining({ id: "1" }), expect.objectContaining({ id: "2" })],
    })
  })

  it("accepts an empty array but rejects blank, malformed, non-array, and trailing paginated output", async () => {
    const config = gitLabConfigFromEnv({ GITLAB_HOST: "https://gitlab.example.com" })
    const loadWithOutput = (output: string) => {
      const spawn = (options: GitLabSpawnOptions) =>
        options.cmd[2] === "user" ? processResult(rawUser) : processTextResult(output)
      return makeGitLabClient(dependencies(config, { spawn })).loadWorkspace("assigned")
    }

    await expect(Effect.runPromise(loadWithOutput("[]"))).resolves.toMatchObject({ items: [] })

    const failures = await Promise.all(
      (
        [
          ["\n", "empty response"],
          [`${JSON.stringify([rawIssue(1)])}\n[not-json]`, "paginated page 2"],
          [JSON.stringify(rawIssue(1)), "non-array result"],
          [`${JSON.stringify([rawIssue(1)])} trailing`, "non-array result"],
        ] as const
      ).map(async ([output, expectedDetail]) => ({
        error: await effectError(loadWithOutput(output)),
        expectedDetail,
      })),
    )
    for (const { error, expectedDetail } of failures) {
      expect(error).toMatchObject({
        kind: "invalid-response",
        remediation: expect.stringContaining("GITLAB_TOKEN"),
      })
      expect(error.detail).toContain(expectedDetail)
      expect(error.remediation).toContain("GitLab CLI output")
      expect(error.remediation).not.toContain("compatible GitLab API")
    }
  })

  it("honors injected page, aggregate item, and byte limits for glab pagination output", async () => {
    const config = gitLabConfigFromEnv({ GITLAB_HOST: "https://gitlab.example.com" })
    const spawn = (options: GitLabSpawnOptions) =>
      options.cmd[2] === "user" ? processResult(rawUser) : paginatedJsonProcessResult([[rawIssue(1)], [rawIssue(2)]])
    const pageLimited = makeGitLabClient(
      dependencies(config, {
        spawn,
        limits: { maxPages: 1 },
      }),
    )

    const pageError = await effectError(pageLimited.loadWorkspace("assigned"))

    expect(pageError).toMatchObject({ kind: "invalid-response" })
    expect(pageError.detail).toContain("1-page limit")
    expect(pageError.detail).toContain("no partial results")

    const itemLimited = makeGitLabClient(
      dependencies(config, {
        spawn,
        limits: { maxPaginatedItems: 1 },
      }),
    )

    const itemError = await effectError(itemLimited.loadWorkspace("assigned"))

    expect(itemError).toMatchObject({ kind: "invalid-response" })
    expect(itemError.detail).toContain("1-item aggregate limit")
    expect(itemError.detail).toContain("no partial results")

    const byteLimited = makeGitLabClient(
      dependencies(config, {
        spawn,
        limits: { maxPaginatedResponseBytes: 32 },
      }),
    )

    const byteError = await effectError(byteLimited.loadWorkspace("assigned"))

    expect(byteError).toMatchObject({ kind: "invalid-response" })
    expect(byteError.detail).toContain("32 bytes")
    expect(byteError.detail).toContain("no partial results")
  })

  it("sends @file-like and scalar-looking mutation titles literally", async () => {
    const config = gitLabConfigFromEnv({ GITLAB_HOST: "https://gitlab.example.com" })
    const calls: GitLabSpawnOptions[] = []
    const spawn = (options: GitLabSpawnOptions) => {
      calls.push(options)
      return processResult(rawIssue(3, "@/etc/passwd"))
    }
    const client = makeGitLabClient(dependencies(config, { spawn }))

    await Effect.runPromise(client.createWorkItem("acme/project", "@/etc/passwd"))

    expect(calls[0]?.cmd).toEqual(expect.arrayContaining(["--raw-field", "title=@/etc/passwd"]))
    expect(calls[0]?.cmd).not.toContain("--field")
  })

  it("propagates Effect cancellation to the spawned glab process", async () => {
    const config = gitLabConfigFromEnv({ GITLAB_HOST: "https://gitlab.example.com" })
    let processSignal: AbortSignal | undefined
    const spawn = (options: GitLabSpawnOptions): GitLabSpawnResult => {
      processSignal = options.signal
      return {
        exited: new Promise((_resolve, reject) => {
          options.signal.addEventListener("abort", () => reject(options.signal.reason), { once: true })
        }),
        stdout: textStream(""),
        stderr: textStream(""),
        kill: vi.fn(),
      }
    }
    const client = makeGitLabClient(dependencies(config, { spawn }))
    const controller = new AbortController()
    const pending = Effect.runPromise(client.createWorkItem("acme/project", "title"), {
      signal: controller.signal,
    })
    await vi.waitFor(() => expect(processSignal).toBeInstanceOf(AbortSignal))

    controller.abort()

    await expect(pending).rejects.toBeDefined()
    expect(processSignal?.aborted).toBe(true)
  })
})

describe("configuration failures", () => {
  it("rejects organization scope without a group before invoking a transport", async () => {
    const config = gitLabConfigFromEnv({ GITLAB_HOST: "https://gitlab.example.com" })
    const fetchMock = vi.fn() as unknown as typeof fetch
    const spawnMock = vi.fn()
    const client = makeGitLabClient(dependencies(config, { fetch: fetchMock, spawn: spawnMock }))

    const error = await effectError(client.loadWorkspace("organization"))

    expect(error).toMatchObject({
      kind: "configuration",
      remediation: expect.stringContaining("environment configuration"),
    })
    expect(fetchMock).not.toHaveBeenCalled()
    expect(spawnMock).not.toHaveBeenCalled()
  })
})

describe("Effect service boundary", () => {
  it("keeps public operations injectable instead of silently providing the live layer", async () => {
    const config = gitLabConfigFromEnv({ GLWI_MOCK: "true" })
    const base = makeGitLabClient(dependencies(config))
    const injected = GitLabClient.of({
      ...base,
      loadWorkspace: () =>
        Effect.succeed({
          user: { id: 99, username: "injected", name: "Injected client" },
          items: [],
        }),
    })

    const workspace = await Effect.runPromise(
      loadWorkspace("assigned").pipe(Effect.provide(Layer.succeed(GitLabClient, injected))),
    )

    expect(workspace).toEqual({
      user: { id: 99, username: "injected", name: "Injected client" },
      items: [],
    })
  })
})
