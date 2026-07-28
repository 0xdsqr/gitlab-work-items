import { Schema } from "effect"
import { describe, expect, it } from "vitest"
import {
  BoardCard,
  BoardCatalog,
  BoardColumn,
  BoardRef,
  BoardSnapshot,
  boardItemsInColumn,
  boardRefKey,
  boardSupports,
  mockWorkspace,
  workflowBoardColumn,
  workflowBoardColumns,
  workflowColumns,
} from "../src/index.ts"

describe("board references", () => {
  it("decodes every supported board source", () => {
    expect(Schema.decodeUnknownSync(BoardRef)({ kind: "smart", scope: "assigned" })).toEqual({
      kind: "smart",
      scope: "assigned",
    })
    expect(
      Schema.decodeUnknownSync(BoardRef)({
        kind: "gitlab",
        groupPath: "acme/platform",
        boardId: 17,
      }),
    ).toEqual({ kind: "gitlab", groupPath: "acme/platform", boardId: 17 })
    expect(Schema.decodeUnknownSync(BoardRef)({ kind: "epic", epicId: "gid://gitlab/WorkItem/42" })).toEqual({
      kind: "epic",
      epicId: "gid://gitlab/WorkItem/42",
    })
  })

  it("produces stable, collision-resistant picker keys", () => {
    expect(boardRefKey({ kind: "smart", scope: "organization" })).toBe("smart:organization")
    expect(boardRefKey({ kind: "gitlab", groupPath: "acme/platform", boardId: 17 })).toBe("gitlab:acme%2Fplatform:17")
    expect(boardRefKey({ kind: "epic", epicId: "gid://gitlab/WorkItem/42" })).toBe(
      "epic:gid%3A%2F%2Fgitlab%2FWorkItem%2F42",
    )
  })

  it("rejects empty and non-positive persisted references", () => {
    expect(() =>
      Schema.decodeUnknownSync(BoardRef)({
        kind: "gitlab",
        groupPath: "",
        boardId: 17,
      }),
    ).toThrow("length of at least 1")
    expect(() =>
      Schema.decodeUnknownSync(BoardRef)({
        kind: "gitlab",
        groupPath: "acme/platform",
        boardId: 0,
      }),
    ).toThrow("greater than or equal to 1")
    expect(() => Schema.decodeUnknownSync(BoardRef)({ kind: "epic", epicId: "" })).toThrow("length of at least 1")
  })
})

describe("board columns", () => {
  it("adapts the established workflow without changing its IDs or order", () => {
    expect(workflowBoardColumns.map(({ id }) => id)).toEqual(workflowColumns.map(({ id }) => id))
    expect(workflowBoardColumn("doing")).toMatchObject({
      id: "doing",
      list: { kind: "workflow", column: "doing" },
      move: { kind: "workflow" },
    })
  })

  it("models native destinations independently from move support", () => {
    const decoded = Schema.decodeUnknownSync(BoardColumn)({
      id: "label:9",
      title: "Backend",
      hint: null,
      color: "#336699",
      position: 2,
      gitLabListId: 91,
      list: { kind: "label", labelId: 9, labelName: "backend" },
      move: { kind: "read-only", reason: "Label moves are unavailable for this token" },
    })

    expect(decoded.list.kind).toBe("label")
    expect(decoded.move.kind).toBe("read-only")
  })

  it("preserves unknown native list kinds as safe read-only columns", () => {
    const decoded = Schema.decodeUnknownSync(BoardColumn)({
      id: "native:future-list",
      title: "Future list",
      hint: null,
      color: null,
      position: 3,
      gitLabListId: 92,
      list: { kind: "unknown", rawKind: "future_list" },
      move: { kind: "read-only", reason: "This GitLab list type is not supported yet" },
    })

    expect(decoded.list).toEqual({ kind: "unknown", rawKind: "future_list" })
  })

  it.each([-1, 1.5, Number.POSITIVE_INFINITY])("rejects the invalid column position %s", (position) => {
    expect(() =>
      Schema.decodeUnknownSync(BoardColumn)({
        ...workflowBoardColumns[0],
        position,
      }),
    ).toThrow()
  })

  it.each([-1, 0.5, Number.POSITIVE_INFINITY])("rejects the invalid card position and depth %s", (value) => {
    expect(() =>
      Schema.decodeUnknownSync(BoardCard)({
        itemId: "gid://gitlab/WorkItem/1",
        columnId: "ready",
        position: value,
        parentItemId: null,
        depth: 0,
      }),
    ).toThrow()
    expect(() =>
      Schema.decodeUnknownSync(BoardCard)({
        itemId: "gid://gitlab/WorkItem/1",
        columnId: "ready",
        position: 0,
        parentItemId: null,
        depth: value,
      }),
    ).toThrow()
  })
})

describe("board catalog and snapshots", () => {
  const board = {
    ref: { kind: "epic" as const, epicId: mockWorkspace.items[0]!.id },
    title: mockWorkspace.items[0]!.title,
    subtitle: "Assigned epic",
    itemCount: 2,
    webUrl: mockWorkspace.items[0]!.webUrl,
    unavailableReason: null,
    capabilities: ["refresh", "filter", "move-cards", "hierarchy"] as const,
  }
  const snapshotInput = () => ({
    board,
    columns: workflowBoardColumns.slice(0, 2),
    items: mockWorkspace.items.slice(1, 3),
    cards: [
      {
        itemId: mockWorkspace.items[1]!.id,
        columnId: workflowBoardColumns[0]!.id,
        position: 0,
        parentItemId: mockWorkspace.items[0]!.id,
        depth: 1,
      },
      {
        itemId: mockWorkspace.items[2]!.id,
        columnId: workflowBoardColumns[1]!.id,
        position: 0,
        parentItemId: mockWorkspace.items[0]!.id,
        depth: 1,
      },
    ],
    fetchedAt: "2026-07-28T12:00:00.000Z",
  })

  it("gates capabilities when a catalog entry is unavailable", () => {
    expect(boardSupports(board, "hierarchy")).toBe(true)
    expect(boardSupports({ ...board, unavailableReason: "Requires GitLab Premium" }, "hierarchy")).toBe(false)
  })

  it("rejects duplicate catalog references and capabilities", () => {
    expect(() => Schema.decodeUnknownSync(BoardCatalog)([board, board])).toThrow("duplicate board reference")
    expect(() =>
      Schema.decodeUnknownSync(BoardCatalog)([
        {
          ...board,
          capabilities: ["refresh", "refresh"],
        },
      ]),
    ).toThrow("duplicate board capability")
  })

  it("keeps card ordering and epic hierarchy metadata separate from items", () => {
    const snapshot = Schema.decodeUnknownSync(BoardSnapshot)({
      board,
      columns: workflowBoardColumns,
      items: mockWorkspace.items.slice(1, 3),
      cards: [
        {
          itemId: mockWorkspace.items[2]!.id,
          columnId: "doing",
          position: 2,
          parentItemId: mockWorkspace.items[0]!.id,
          depth: 1,
        },
        {
          itemId: mockWorkspace.items[1]!.id,
          columnId: "doing",
          position: 1,
          parentItemId: mockWorkspace.items[0]!.id,
          depth: 1,
        },
      ],
      fetchedAt: "2026-07-28T12:00:00.000Z",
    })

    expect(boardItemsInColumn(snapshot, "doing").map(({ id }) => id)).toEqual([
      mockWorkspace.items[1]!.id,
      mockWorkspace.items[2]!.id,
    ])
    expect(snapshot.cards.every(({ parentItemId }) => parentItemId === mockWorkspace.items[0]!.id)).toBe(true)
  })

  it("allows one item in multiple columns while rejecting duplicate membership in one column", () => {
    const input = snapshotInput()
    const crossList = BoardSnapshot.make({
      ...input,
      cards: [
        input.cards[0]!,
        {
          ...input.cards[0]!,
          columnId: workflowBoardColumns[1]!.id,
        },
      ],
    })

    expect(crossList.cards).toHaveLength(2)
    expect(() =>
      BoardSnapshot.make({
        ...input,
        cards: [
          input.cards[0]!,
          {
            ...input.cards[0]!,
            position: 1,
          },
        ],
      }),
    ).toThrow("duplicate card membership")
  })

  it("rejects duplicate column, item, remote-list, and card-position identities", () => {
    const input = snapshotInput()
    expect(() =>
      BoardSnapshot.make({
        ...input,
        columns: [input.columns[0]!, { ...input.columns[1]!, id: input.columns[0]!.id }],
      }),
    ).toThrow("duplicate board column ID")
    expect(() =>
      BoardSnapshot.make({
        ...input,
        columns: [input.columns[0]!, { ...input.columns[1]!, position: input.columns[0]!.position }],
      }),
    ).toThrow("duplicate board column position")
    expect(() =>
      BoardSnapshot.make({
        ...input,
        columns: [
          { ...input.columns[0]!, gitLabListId: 91 },
          { ...input.columns[1]!, gitLabListId: 91 },
        ],
      }),
    ).toThrow("duplicate GitLab list ID")
    expect(() =>
      BoardSnapshot.make({
        ...input,
        items: [input.items[0]!, { ...input.items[1]!, id: input.items[0]!.id }],
      }),
    ).toThrow("duplicate board item ID")
    expect(() =>
      BoardSnapshot.make({
        ...input,
        cards: [
          input.cards[0]!,
          {
            ...input.cards[1]!,
            columnId: input.cards[0]!.columnId,
            position: input.cards[0]!.position,
          },
        ],
      }),
    ).toThrow("duplicate card position")
  })

  it("rejects dangling card item and column references", () => {
    const input = snapshotInput()
    expect(() =>
      BoardSnapshot.make({
        ...input,
        cards: [{ ...input.cards[0]!, itemId: "missing-item" }],
      }),
    ).toThrow("unknown board item")
    expect(() =>
      BoardSnapshot.make({
        ...input,
        cards: [{ ...input.cards[0]!, columnId: "missing-column" }],
      }),
    ).toThrow("unknown board column")
  })

  it("keeps nested epic context items and rejects dangling or incoherent hierarchy metadata", () => {
    const input = snapshotInput()
    const nestedEpic = {
      ...mockWorkspace.items[0]!,
      id: "gid://gitlab/WorkItem/999",
      iid: 999,
      title: "Nested epic context",
    }
    const nested = BoardSnapshot.make({
      ...input,
      items: [nestedEpic, input.items[0]!],
      cards: [
        {
          ...input.cards[0]!,
          parentItemId: nestedEpic.id,
          depth: 2,
        },
      ],
    })

    expect(nested.items).toContainEqual(nestedEpic)
    expect(() =>
      BoardSnapshot.make({
        ...input,
        cards: [{ ...input.cards[0]!, parentItemId: "missing-parent", depth: 2 }],
      }),
    ).toThrow("unknown hierarchy parent")
    expect(() =>
      BoardSnapshot.make({
        ...input,
        cards: [{ ...input.cards[0]!, depth: 2 }],
      }),
    ).toThrow("direct child of the selected epic")
    expect(() =>
      BoardSnapshot.make({
        ...input,
        cards: [{ ...input.cards[0]!, parentItemId: input.cards[0]!.itemId }],
      }),
    ).toThrow("cannot be its own hierarchy parent")
  })

  it("rejects hierarchy cycles and metadata on boards without hierarchy support", () => {
    const input = snapshotInput()
    expect(() =>
      BoardSnapshot.make({
        ...input,
        cards: [
          {
            ...input.cards[0]!,
            parentItemId: input.cards[1]!.itemId,
            depth: 2,
          },
          {
            ...input.cards[1]!,
            parentItemId: input.cards[0]!.itemId,
            depth: 1,
          },
        ],
      }),
    ).toThrow("hierarchy cycle")
    expect(() =>
      BoardSnapshot.make({
        ...input,
        board: {
          ...board,
          capabilities: ["refresh"],
        },
      }),
    ).toThrow("requires the hierarchy capability")
  })
})
