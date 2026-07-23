import { Effect, Layer } from "effect"
import { describe, expect, it, vi } from "vitest"
import {
  gitLabApiArguments,
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

const textStream = (value: string) => new Response(value).body

const processResult = (stdout: unknown, stderr = "", exitCode = 0): GitLabSpawnResult => ({
  exited: Promise.resolve(exitCode),
  stdout: textStream(JSON.stringify(stdout)),
  stderr: textStream(stderr),
  kill: vi.fn(),
})

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

  it("runs noninteractively with a timeout, cancellation signal, bounded pipes, and paginated lists", async () => {
    const config = gitLabConfigFromEnv({ GITLAB_HOST: "https://gitlab.example.com" })
    const calls: GitLabSpawnOptions[] = []
    const spawn = (options: GitLabSpawnOptions) => {
      calls.push(options)
      return options.cmd[2] === "user" ? processResult(rawUser) : processResult([rawIssue(1), rawIssue(2)])
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
