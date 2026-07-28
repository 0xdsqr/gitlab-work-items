import { Schema } from "effect"
import { workflowColumns, type WorkflowColumnId } from "./board.ts"
import { WorkItem, WorkItemScope, type WorkItem as WorkItemValue } from "./work-item.ts"

const NonNegativeInt = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))
const PositiveInt = Schema.Int.check(Schema.isGreaterThanOrEqualTo(1))

/**
 * A stable reference to a board without mixing board selection into work-item
 * query scope. Smart and epic boards are projections; GitLab boards represent
 * a persisted group board.
 */
export const SmartBoardRef = Schema.Struct({
  kind: Schema.Literal("smart"),
  scope: WorkItemScope,
})
export type SmartBoardRef = typeof SmartBoardRef.Type

export const GitLabBoardRef = Schema.Struct({
  kind: Schema.Literal("gitlab"),
  groupPath: Schema.NonEmptyString,
  boardId: PositiveInt,
})
export type GitLabBoardRef = typeof GitLabBoardRef.Type

export const EpicBoardRef = Schema.Struct({
  kind: Schema.Literal("epic"),
  epicId: Schema.NonEmptyString,
})
export type EpicBoardRef = typeof EpicBoardRef.Type

export const BoardRef = Schema.Union([SmartBoardRef, GitLabBoardRef, EpicBoardRef])
export type BoardRef = typeof BoardRef.Type

export const boardRefKey = (ref: BoardRef): string => {
  switch (ref.kind) {
    case "smart":
      return `smart:${ref.scope}`
    case "gitlab":
      return `gitlab:${encodeURIComponent(ref.groupPath)}:${ref.boardId}`
    case "epic":
      return `epic:${encodeURIComponent(ref.epicId)}`
  }
}

/**
 * `hierarchy` means a board snapshot can carry validated parent/depth
 * metadata. It does not prescribe a particular visual presentation.
 */
export const BoardCapability = Schema.Literals(["refresh", "filter", "move-cards", "hierarchy"])
export type BoardCapability = typeof BoardCapability.Type

const BoardCatalogEntryStruct = Schema.Struct({
  ref: BoardRef,
  title: Schema.String,
  subtitle: Schema.NullOr(Schema.String),
  itemCount: Schema.NullOr(NonNegativeInt),
  webUrl: Schema.NullOr(Schema.String),
  unavailableReason: Schema.NullOr(Schema.String),
  capabilities: Schema.Array(BoardCapability),
})
export const BoardCatalogEntry = BoardCatalogEntryStruct.check(
  Schema.makeFilter((entry: typeof BoardCatalogEntryStruct.Type) => {
    const seen = new Set<BoardCapability>()
    const issues: Schema.FilterIssue[] = []
    entry.capabilities.forEach((capability, index) => {
      if (seen.has(capability))
        issues.push({
          path: ["capabilities", index],
          issue: `duplicate board capability ${capability}`,
        })
      seen.add(capability)
    })
    return issues
  }),
)
export type BoardCatalogEntry = typeof BoardCatalogEntry.Type

const BoardCatalogArray = Schema.Array(BoardCatalogEntry)
export const BoardCatalog = BoardCatalogArray.check(
  Schema.makeFilter((catalog: typeof BoardCatalogArray.Type) => {
    const seen = new Set<string>()
    const issues: Schema.FilterIssue[] = []
    catalog.forEach((entry, index) => {
      const key = boardRefKey(entry.ref)
      if (seen.has(key))
        issues.push({
          path: [index, "ref"],
          issue: `duplicate board reference ${key}`,
        })
      seen.add(key)
    })
    return issues
  }),
)
export type BoardCatalog = typeof BoardCatalog.Type

export const boardSupports = (entry: BoardCatalogEntry, capability: BoardCapability): boolean =>
  entry.unavailableReason === null && entry.capabilities.includes(capability)

export const WorkflowBoardList = Schema.Struct({
  kind: Schema.Literal("workflow"),
  column: Schema.Literals(["backlog", "ready", "doing", "review", "closed"]),
})

export const BacklogBoardList = Schema.Struct({
  kind: Schema.Literal("backlog"),
})

export const ClosedBoardList = Schema.Struct({
  kind: Schema.Literal("closed"),
})

export const LabelBoardList = Schema.Struct({
  kind: Schema.Literal("label"),
  labelId: PositiveInt,
  labelName: Schema.String,
})

export const AssigneeBoardList = Schema.Struct({
  kind: Schema.Literal("assignee"),
  userId: PositiveInt,
  username: Schema.String,
})

export const MilestoneBoardList = Schema.Struct({
  kind: Schema.Literal("milestone"),
  milestoneId: PositiveInt,
  title: Schema.String,
})

export const IterationBoardList = Schema.Struct({
  kind: Schema.Literal("iteration"),
  iterationId: PositiveInt,
  title: Schema.String,
})

export const StatusBoardList = Schema.Struct({
  kind: Schema.Literal("status"),
  statusId: PositiveInt,
  name: Schema.String,
})

export const UnknownBoardList = Schema.Struct({
  kind: Schema.Literal("unknown"),
  rawKind: Schema.String,
})

/**
 * The list describes the meaning of a column independently of transport
 * support. This lets clients faithfully show every GitLab list while marking
 * an unsupported destination read-only.
 */
export const BoardList = Schema.Union([
  WorkflowBoardList,
  BacklogBoardList,
  ClosedBoardList,
  LabelBoardList,
  AssigneeBoardList,
  MilestoneBoardList,
  IterationBoardList,
  StatusBoardList,
  UnknownBoardList,
])
export type BoardList = typeof BoardList.Type
export type BoardListKind = BoardList["kind"]

export const BoardMoveCapability = Schema.Union([
  Schema.Struct({ kind: Schema.Literal("workflow") }),
  Schema.Struct({ kind: Schema.Literal("native") }),
  Schema.Struct({
    kind: Schema.Literal("read-only"),
    reason: Schema.String,
  }),
])
export type BoardMoveCapability = typeof BoardMoveCapability.Type

export const BoardColumn = Schema.Struct({
  id: Schema.NonEmptyString,
  title: Schema.String,
  hint: Schema.NullOr(Schema.String),
  color: Schema.NullOr(Schema.String),
  position: NonNegativeInt,
  gitLabListId: Schema.NullOr(PositiveInt),
  list: BoardList,
  move: BoardMoveCapability,
})
export type BoardColumn = typeof BoardColumn.Type

export const workflowBoardColumns: readonly BoardColumn[] = workflowColumns.map((column, position) => ({
  id: column.id,
  title: column.label,
  hint: column.hint,
  color: column.color,
  position,
  gitLabListId: null,
  list: { kind: "workflow", column: column.id },
  move: { kind: "workflow" },
}))

export const workflowBoardColumn = (column: WorkflowColumnId): BoardColumn =>
  workflowBoardColumns.find((candidate) => candidate.list.kind === "workflow" && candidate.list.column === column) ??
  workflowBoardColumns[0]!

export const BoardCard = Schema.Struct({
  itemId: Schema.NonEmptyString,
  columnId: Schema.NonEmptyString,
  position: NonNegativeInt,
  parentItemId: Schema.NullOr(Schema.NonEmptyString),
  depth: NonNegativeInt,
})
export type BoardCard = typeof BoardCard.Type

/**
 * A normalized board payload. Cards reference items and columns by ID so an
 * item can appear in more than one native label list without duplicating its
 * work-item data. A card may appear only once per column. Parent/depth carry
 * hierarchy metadata without embedding trees: the selected epic root may be
 * external to `items`, while every other referenced parent is retained as a
 * context item even when it is not rendered as a card.
 */
const BoardSnapshotStruct = Schema.Struct({
  board: BoardCatalogEntry,
  columns: Schema.Array(BoardColumn),
  items: Schema.Array(WorkItem),
  cards: Schema.Array(BoardCard),
  fetchedAt: Schema.String,
})
export const BoardSnapshot = BoardSnapshotStruct.check(
  Schema.makeFilter((snapshot: typeof BoardSnapshotStruct.Type) => {
    const issues: Schema.FilterIssue[] = []
    const columnIds = new Map<string, number>()
    const columnPositions = new Map<number, number>()
    const gitLabListIds = new Map<number, number>()
    const itemIds = new Map<string, number>()

    snapshot.columns.forEach((column, index) => {
      const previousId = columnIds.get(column.id)
      if (previousId !== undefined)
        issues.push({
          path: ["columns", index, "id"],
          issue: `duplicate board column ID ${column.id}`,
        })
      else columnIds.set(column.id, index)

      const previousPosition = columnPositions.get(column.position)
      if (previousPosition !== undefined)
        issues.push({
          path: ["columns", index, "position"],
          issue: `duplicate board column position ${column.position}`,
        })
      else columnPositions.set(column.position, index)

      if (column.gitLabListId !== null) {
        const previousList = gitLabListIds.get(column.gitLabListId)
        if (previousList !== undefined)
          issues.push({
            path: ["columns", index, "gitLabListId"],
            issue: `duplicate GitLab list ID ${column.gitLabListId}`,
          })
        else gitLabListIds.set(column.gitLabListId, index)
      }
    })

    snapshot.items.forEach((item, index) => {
      if (item.id.length === 0)
        issues.push({
          path: ["items", index, "id"],
          issue: "board item IDs must not be empty",
        })
      const previous = itemIds.get(item.id)
      if (previous !== undefined)
        issues.push({
          path: ["items", index, "id"],
          issue: `duplicate board item ID ${item.id}`,
        })
      else itemIds.set(item.id, index)
    })

    const itemMembershipsByColumn = new Map<string, Set<string>>()
    const positionsByColumn = new Map<string, Set<number>>()
    const hierarchyByItem = new Map<
      string,
      { readonly parentItemId: string | null; readonly depth: number; readonly cardIndex: number }
    >()
    const hierarchyEnabled = snapshot.board.capabilities.includes("hierarchy")

    snapshot.cards.forEach((card, index) => {
      if (!columnIds.has(card.columnId))
        issues.push({
          path: ["cards", index, "columnId"],
          issue: `card references unknown board column ${card.columnId}`,
        })
      if (!itemIds.has(card.itemId))
        issues.push({
          path: ["cards", index, "itemId"],
          issue: `card references unknown board item ${card.itemId}`,
        })

      const memberships = itemMembershipsByColumn.get(card.columnId) ?? new Set<string>()
      if (memberships.has(card.itemId))
        issues.push({
          path: ["cards", index, "itemId"],
          issue: `duplicate card membership for item ${card.itemId} in column ${card.columnId}`,
        })
      memberships.add(card.itemId)
      itemMembershipsByColumn.set(card.columnId, memberships)

      const positions = positionsByColumn.get(card.columnId) ?? new Set<number>()
      if (positions.has(card.position))
        issues.push({
          path: ["cards", index, "position"],
          issue: `duplicate card position ${card.position} in column ${card.columnId}`,
        })
      positions.add(card.position)
      positionsByColumn.set(card.columnId, positions)

      const previousHierarchy = hierarchyByItem.get(card.itemId)
      if (
        previousHierarchy &&
        (previousHierarchy.parentItemId !== card.parentItemId || previousHierarchy.depth !== card.depth)
      )
        issues.push({
          path: ["cards", index, "parentItemId"],
          issue: `inconsistent hierarchy metadata for item ${card.itemId}`,
        })
      else if (!previousHierarchy)
        hierarchyByItem.set(card.itemId, {
          parentItemId: card.parentItemId,
          depth: card.depth,
          cardIndex: index,
        })

      if (card.parentItemId === null) {
        if (card.depth !== 0)
          issues.push({
            path: ["cards", index, "depth"],
            issue: "a card without a parent must have depth 0",
          })
        return
      }

      if (!hierarchyEnabled)
        issues.push({
          path: ["cards", index, "parentItemId"],
          issue: "card hierarchy metadata requires the hierarchy capability",
        })
      if (card.depth === 0)
        issues.push({
          path: ["cards", index, "depth"],
          issue: "a card with a parent must have positive depth",
        })
      if (card.parentItemId === card.itemId)
        issues.push({
          path: ["cards", index, "parentItemId"],
          issue: "a card cannot be its own hierarchy parent",
        })

      const referencesEpicRoot = snapshot.board.ref.kind === "epic" && card.parentItemId === snapshot.board.ref.epicId
      if (!referencesEpicRoot && !itemIds.has(card.parentItemId))
        issues.push({
          path: ["cards", index, "parentItemId"],
          issue: `card references unknown hierarchy parent ${card.parentItemId}`,
        })
      if (referencesEpicRoot && card.depth !== 1)
        issues.push({
          path: ["cards", index, "depth"],
          issue: "a direct child of the selected epic must have depth 1",
        })
    })

    for (const [itemId, hierarchy] of hierarchyByItem) {
      if (hierarchy.parentItemId === null) continue
      const parentHierarchy = hierarchyByItem.get(hierarchy.parentItemId)
      if (parentHierarchy && hierarchy.depth !== parentHierarchy.depth + 1)
        issues.push({
          path: ["cards", hierarchy.cardIndex, "depth"],
          issue: `hierarchy depth for item ${itemId} does not follow its parent`,
        })

      const seen = new Set<string>([itemId])
      let parentId: string | null = hierarchy.parentItemId
      while (parentId) {
        if (seen.has(parentId)) {
          issues.push({
            path: ["cards", hierarchy.cardIndex, "parentItemId"],
            issue: `hierarchy cycle detected for item ${itemId}`,
          })
          break
        }
        seen.add(parentId)
        parentId = hierarchyByItem.get(parentId)?.parentItemId ?? null
      }
    }

    return issues
  }),
)
export type BoardSnapshot = typeof BoardSnapshot.Type

export const boardItemsInColumn = (snapshot: BoardSnapshot, columnId: string): readonly WorkItemValue[] => {
  const itemById = new Map(snapshot.items.map((item) => [item.id, item]))
  return [...snapshot.cards]
    .filter((card) => card.columnId === columnId)
    .sort((left, right) => left.position - right.position)
    .flatMap((card) => {
      const item = itemById.get(card.itemId)
      return item ? [item] : []
    })
}
