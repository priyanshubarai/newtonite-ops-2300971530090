import { authorizeTeamAction, type AuthzResult } from "../auth/authorize.js";
import { getMembershipsForUser, getTeamRole } from "../auth/repository.js";
import { badRequest, conflict, ERROR_CODES, forbidden, notFound } from "../common/errors.js";
import type { TxClient } from "../db/index.js";
import {
  claimWorkItemTx,
  findWorkItemById,
  insertActivityEventTx,
  insertCommentTx,
  insertOutboxJobTx,
  insertWorkItemTx,
  listActivityEvents,
  listCommentsRepo,
  listWorkItems,
  transitionWorkItemTx,
  updateWorkItemTx,
  type WorkItemRow,
  type WorkItemUpdate,
} from "./repository.js";
import {
  assigneeChangedEvent,
  commentAddedEvent,
  deriveUpdateEvents,
  itemCreatedEvent,
  statusChangedEvent,
  type DerivedEvent,
} from "./activity.js";
import { buildOutboxJob, OUTBOX_JOB_TYPES } from "./outbox.js";
import { toWorkItemResponse, type WorkItemResponse } from "./serialize.js";
import {
  CLAIMABLE_STATUSES,
  assertValidTransition,
  isApprovalStep,
} from "./workflow.js";
import type {
  CreateCommentInput,
  CreateItemInput,
  ListActivityQuery,
  ListCommentsQuery,
  ListItemsQuery,
  TransitionItemInput,
  UpdateItemInput,
} from "./validation.js";

/**
 * Work-item domain service.
 *
 * Responsibilities: resolve the caller's team memberships, enforce team-scoped
 * authorization, apply business rules (same-team assignment, workflow),
 * perform the mutation on the caller's transaction, and append the matching
 * activity event + outbox job in that same transaction.
 *
 * Reads run on the shared connection; **every mutation takes a `TxClient`** so
 * the caller (an idempotency-aware route) controls the transaction boundary.
 * Authorization always uses the resource's REAL team id loaded from the
 * database - never a client-supplied team id or role.
 */

export interface PaginatedItems {
  items: WorkItemResponse[];
  pagination: {
    page: number;
    pageSize: number;
    /** Exact count computed with COUNT(*) over the same filters. */
    total: number;
    totalPages: number;
    hasNextPage: boolean;
    hasPrevPage: boolean;
  };
}

function toPage(items: WorkItemRow[], total: number, page: number, pageSize: number): PaginatedItems {
  const totalPages = total === 0 ? 0 : Math.ceil(total / pageSize);
  return {
    items: items.map(toWorkItemResponse),
    pagination: {
      page,
      pageSize,
      total,
      totalPages,
      hasNextPage: page < totalPages,
      hasPrevPage: page > 1,
    },
  };
}

/**
 * Translate an authorization failure into the matching client-safe error:
 * non-membership is concealed as 404, an under-privileged member is 403.
 */
function throwAuthzFailure(result: Extract<AuthzResult, { ok: false }>): never {
  throw result.status === 404 ? notFound() : forbidden();
}

const staleVersion = () =>
  conflict(ERROR_CODES.STALE_VERSION, "Work item was modified by another request");

/**
 * List work items the caller may see.
 *
 * Scoping: the caller only ever sees items whose team they belong to. When an
 * explicit `teamId` filter is supplied it is checked against the caller's
 * memberships; a non-member team yields an empty page rather than disclosing
 * whether that team has items.
 */
export async function listItems(
  userId: string,
  query: ListItemsQuery,
): Promise<PaginatedItems> {
  const memberships = await getMembershipsForUser(userId);
  const memberTeamIds = memberships.map((m) => m.teamId);

  let scopedTeamIds: string[];
  if (query.teamId) {
    if (!memberTeamIds.includes(query.teamId)) {
      // Not a member of the requested team: do not disclose its items.
      return toPage([], 0, query.page, query.pageSize);
    }
    scopedTeamIds = [query.teamId];
  } else {
    scopedTeamIds = memberTeamIds;
  }

  // Handle dashboard presets
  let assigneeId = query.assigneeId;
  let status = query.status;
  let priority = query.priority;
  const preset = query.preset;

  if (preset === "assigned") {
    // Assigned to me: filter by current user's ID
    assigneeId = userId;
    status = undefined;
    priority = undefined;
  } else if (preset === "unassigned_urgent") {
    // Unassigned urgent: unassigned + HIGH/CRITICAL priority
    // Use empty string as a marker for "IS NULL" - will be handled in repository
    assigneeId = "";
    priority = undefined; // Handled by preset in repository
    status = undefined;
  } else if (preset === "awaiting_approval") {
    // Awaiting my approval: only show if user has LEAD/ADMIN in at least one team
    const hasApprovalRole = memberships.some(
      (m) => m.role === "LEAD" || m.role === "ADMIN"
    );
    if (!hasApprovalRole) {
      // User doesn't have approval role in any team - return empty
      return toPage([], 0, query.page, query.pageSize);
    }
    status = "AWAITING_APPROVAL";
    assigneeId = undefined;
    priority = undefined;
  }

  const { rows, total } = await listWorkItems({
    memberTeamIds: scopedTeamIds,
    status,
    priority,
    assigneeId,
    search: query.search,
    preset,
    page: query.page,
    pageSize: query.pageSize,
    sort: query.sort,
    order: query.order,
  });

  return toPage(rows, total, query.page, query.pageSize);
}

/**
 * List activity events for a work item.
 *
 * Authorization: caller must be a member of the item's team.
 */
export async function listActivity(
  userId: string,
  itemId: string,
  page: number,
  pageSize: number,
): Promise<{ items: unknown[]; pagination: { page: number; pageSize: number; total: number; totalPages: number; hasNextPage: boolean; hasPrevPage: boolean } }> {
  // First verify the item exists and user has access
  const item = await getItem(userId, itemId);
  
  const { rows, total } = await listActivityEvents(itemId, page, pageSize);
  const totalPages = total === 0 ? 0 : Math.ceil(total / pageSize);
  
  return {
    items: rows.map((row) => ({
      id: row.id,
      workItemId: row.workItemId,
      actorId: row.actorId,
      eventType: row.eventType,
      metadata: row.metadata,
      createdAt: row.createdAt.toISOString(),
    })),
    pagination: {
      page,
      pageSize,
      total,
      totalPages,
      hasNextPage: page < totalPages,
      hasPrevPage: page > 1,
    },
  };
}

/**
 * List comments for a work item.
 *
 * Authorization: caller must be a member of the item's team.
 */
export async function listComments(
  userId: string,
  itemId: string,
  page: number,
  pageSize: number,
): Promise<{ items: unknown[]; pagination: { page: number; pageSize: number; total: number; totalPages: number; hasNextPage: boolean; hasPrevPage: boolean } }> {
  // First verify the item exists and user has access
  const item = await getItem(userId, itemId);

  const { rows, total } = await listCommentsRepo(itemId, page, pageSize);
  const totalPages = total === 0 ? 0 : Math.ceil(total / pageSize);

  return {
    items: rows.map((row) => ({
      id: row.id,
      workItemId: row.workItemId,
      authorId: row.authorId,
      body: row.body,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    })),
    pagination: {
      page,
      pageSize,
      total,
      totalPages,
      hasNextPage: page < totalPages,
      hasPrevPage: page > 1,
    },
  };
}

/**
 * Create a comment on a work item.
 *
 * Authorization: caller must be a member of the item's team.
 * The comment creation is recorded as an activity event in the same transaction.
 */
export async function createComment(
  tx: TxClient,
  userId: string,
  itemId: string,
  input: CreateCommentInput,
): Promise<{ comment: { id: string; workItemId: string; authorId: string; body: string; createdAt: string; updatedAt: string } }> {
  // First verify the item exists and user has access
  const item = await getItem(userId, itemId);

  const comment = await insertCommentTx(tx, {
    workItemId: itemId,
    authorId: userId,
    body: input.body,
  });

  // Record the comment as an activity event in the same transaction
  await insertActivityEventTx(tx, {
    workItemId: itemId,
    actorId: userId,
    eventType: "COMMENT_ADDED",
    metadata: { commentId: comment.id, authorId: userId },
  });

  // Also insert outbox job for the comment
  await insertOutboxJobTx(tx, buildOutboxJob(item, OUTBOX_JOB_TYPES.ITEM_UPDATED, userId));

  return {
    comment: {
      id: comment.id,
      workItemId: comment.workItemId,
      authorId: comment.authorId,
      body: comment.body,
      createdAt: comment.createdAt.toISOString(),
      updatedAt: comment.updatedAt.toISOString(),
    },
  };
}

/**
 * Fetch one work item, authorizing against its real team.
 *
 * A missing item and an out-of-scope item both return 404 so a caller cannot
 * tell "exists but forbidden" from "does not exist" (no cross-team
 * enumeration).
 */
export async function getItem(userId: string, id: string): Promise<WorkItemResponse> {
  const row = await findWorkItemById(id);
  if (!row) {
    throw notFound();
  }

  const authz = await authorizeTeamAction(userId, row.teamId, "view");
  if (!authz.ok) {
    throw notFound();
  }

  return toWorkItemResponse(row);
}

/**
 * Append every derived activity event and one outbox job for a mutation.
 */
async function recordMutation(
  tx: TxClient,
  row: WorkItemRow,
  actorId: string,
  events: DerivedEvent[],
  jobType: (typeof OUTBOX_JOB_TYPES)[keyof typeof OUTBOX_JOB_TYPES],
): Promise<void> {
  for (const event of events) {
    await insertActivityEventTx(tx, {
      workItemId: row.id,
      actorId,
      eventType: event.eventType,
      metadata: event.metadata,
    });
  }
  await insertOutboxJobTx(tx, buildOutboxJob(row, jobType, actorId));
}

/**
 * Create a work item in a team the caller can write to.
 *
 * `createdBy`, `status`, and `version` are set by the server; the validated
 * input cannot carry them. An optional assignee must belong to the same team.
 * The insert, its `ITEM_CREATED` activity event, and its outbox job are written
 * on the caller's transaction.
 */
export async function createItem(
  tx: TxClient,
  userId: string,
  input: CreateItemInput,
): Promise<WorkItemResponse> {
  const authz = await authorizeTeamAction(userId, input.teamId, "create_item");
  if (!authz.ok) {
    throwAuthzFailure(authz);
  }

  if (input.assigneeId) {
    await assertSameTeamMember(input.assigneeId, input.teamId);
  }

  const row = await insertWorkItemTx(tx, {
    title: input.title,
    description: input.description ?? null,
    type: input.type,
    priority: input.priority,
    teamId: input.teamId,
    assigneeId: input.assigneeId ?? null,
    createdBy: userId,
    dueAt: input.dueAt ?? null,
  });

  await recordMutation(tx, row, userId, [itemCreatedEvent(row)], OUTBOX_JOB_TYPES.ITEM_CREATED);
  return toWorkItemResponse(row);
}

/**
 * Update permitted fields of an existing work item under optimistic
 * concurrency.
 *
 * The write is conditional on `expectedVersion`; a mismatch is a 409
 * `STALE_VERSION` with no side effects. A PATCH whose values already match the
 * stored row is a no-op: it validates the version but performs no write, so no
 * spurious version bump or activity event is produced.
 */
export async function updateItem(
  tx: TxClient,
  userId: string,
  id: string,
  input: UpdateItemInput,
): Promise<WorkItemResponse> {
  const existing = await findWorkItemById(id);
  if (!existing) {
    throw notFound();
  }

  const authz = await authorizeTeamAction(userId, existing.teamId, "edit_item");
  if (!authz.ok) {
    throwAuthzFailure(authz);
  }

  if (input.assigneeId) {
    await assertSameTeamMember(input.assigneeId, existing.teamId);
  }

  const { expectedVersion, ...editable } = input;
  const patch: WorkItemUpdate = {};
  if (editable.title !== undefined) patch.title = editable.title;
  if (editable.description !== undefined) patch.description = editable.description;
  if (editable.type !== undefined) patch.type = editable.type;
  if (editable.priority !== undefined) patch.priority = editable.priority;
  if (editable.assigneeId !== undefined) patch.assigneeId = editable.assigneeId;
  if (editable.dueAt !== undefined) patch.dueAt = editable.dueAt;

  const events = deriveUpdateEvents(existing, patch);
  if (events.length === 0) {
    // Nothing actually changed. Still honour the concurrency precondition.
    if (existing.version !== expectedVersion) {
      throw staleVersion();
    }
    return toWorkItemResponse(existing);
  }

  const row = await updateWorkItemTx(tx, id, expectedVersion, patch);
  if (!row) {
    // Either the item disappeared or another writer moved the version on.
    const current = await findWorkItemById(id);
    if (!current) {
      throw notFound();
    }
    throw staleVersion();
  }

  await recordMutation(tx, row, userId, events, OUTBOX_JOB_TYPES.ITEM_UPDATED);
  return toWorkItemResponse(row);
}

/**
 * Atomically claim an unassigned, claimable work item for the calling user.
 *
 * The assignee is always the authenticated user - never a client-supplied id.
 * The claim is a single conditional `UPDATE` (`assignee_id IS NULL` and status
 * claimable) that increments the version, so under a race exactly one claimant
 * wins and the loser matches zero rows and gets a 409.
 */
export async function claimItem(
  tx: TxClient,
  userId: string,
  id: string,
): Promise<WorkItemResponse> {
  const existing = await findWorkItemById(id);
  if (!existing) {
    throw notFound();
  }

  const authz = await authorizeTeamAction(userId, existing.teamId, "claim_item");
  if (!authz.ok) {
    throwAuthzFailure(authz);
  }

  if (existing.assigneeId !== null) {
    throw conflict(ERROR_CODES.ALREADY_ASSIGNED, "Work item is already assigned");
  }
  if (!CLAIMABLE_STATUSES.includes(existing.status)) {
    throw conflict(
      ERROR_CODES.NOT_CLAIMABLE,
      `A work item in status ${existing.status} cannot be claimed`,
    );
  }

  const row = await claimWorkItemTx(tx, id, userId, CLAIMABLE_STATUSES);
  if (!row) {
    // Lost the race. Classify from the committed row without a second write.
    const current = await findWorkItemById(id);
    if (!current) {
      throw notFound();
    }
    if (current.assigneeId !== null) {
      throw conflict(ERROR_CODES.ALREADY_ASSIGNED, "Work item is already assigned");
    }
    throw conflict(ERROR_CODES.NOT_CLAIMABLE, "Work item is no longer claimable");
  }

  await recordMutation(
    tx,
    row,
    userId,
    [assigneeChangedEvent(null, userId, "claim")],
    OUTBOX_JOB_TYPES.ITEM_CLAIMED,
  );
  return toWorkItemResponse(row);
}

/**
 * Advance a work item along the approved workflow.
 *
 * Authorization precedes transition validation so an unprivileged caller
 * cannot probe the state machine: non-members get 404, members without the
 * required action get 403, and only then is an invalid edge reported as 409.
 * The approval edge (`AWAITING_APPROVAL -> RESOLVED`) requires
 * `approve_transition` (LEAD/ADMIN of the item's own team); every other edge
 * requires ordinary edit rights (MEMBER+).
 */
export async function transitionItem(
  tx: TxClient,
  userId: string,
  id: string,
  input: TransitionItemInput,
): Promise<WorkItemResponse> {
  const existing = await findWorkItemById(id);
  if (!existing) {
    throw notFound();
  }

  const requiredAction = isApprovalStep(existing.status, input.toStatus)
    ? "approve_transition"
    : "edit_item";
  const authz = await authorizeTeamAction(userId, existing.teamId, requiredAction);
  if (!authz.ok) {
    throwAuthzFailure(authz);
  }

  assertValidTransition(existing.status, input.toStatus);

  const row = await transitionWorkItemTx(
    tx,
    id,
    input.expectedVersion,
    existing.status,
    input.toStatus,
  );
  if (!row) {
    const current = await findWorkItemById(id);
    if (!current) {
      throw notFound();
    }
    throw staleVersion();
  }

  await recordMutation(
    tx,
    row,
    userId,
    [statusChangedEvent(existing.status, row.status)],
    OUTBOX_JOB_TYPES.ITEM_TRANSITIONED,
  );
  return toWorkItemResponse(row);
}

/**
 * Reject an assignee who is not a member of the target team. This is the only
 * guard against cross-team assignment; the database has no such constraint.
 */
async function assertSameTeamMember(assigneeId: string, teamId: string): Promise<void> {
  const role = await getTeamRole(assigneeId, teamId);
  if (!role) {
    throw badRequest("assigneeId must reference a member of the item's team");
  }
}