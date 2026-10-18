import { authorizeTeamAction, type AuthzResult } from "../auth/authorize.js";
import { getMembershipsForUser, getTeamRole } from "../auth/repository.js";
import { badRequest, forbidden, notFound } from "../common/errors.js";
import {
  findWorkItemById,
  insertWorkItem,
  listWorkItems,
  updateWorkItem,
  type WorkItemRow,
} from "./repository.js";
import { toWorkItemResponse, type WorkItemResponse } from "./serialize.js";
import type { CreateItemInput, ListItemsQuery, UpdateItemInput } from "./validation.js";

/**
 * Work-item domain service.
 *
 * Responsibilities: resolve the caller's team memberships from the database,
 * enforce team-scoped authorization, apply business rules (same-team
 * assignment, server-owned fields), and delegate persistence to the repository.
 * Route handlers stay thin and only translate this layer's results (or thrown
 * `ApiError`s) into HTTP responses.
 *
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

  const { rows, total } = await listWorkItems({
    memberTeamIds: scopedTeamIds,
    status: query.status,
    priority: query.priority,
    assigneeId: query.assigneeId,
    search: query.search,
    page: query.page,
    pageSize: query.pageSize,
    sort: query.sort,
    order: query.order,
  });

  return toPage(rows, total, query.page, query.pageSize);
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
 * Create a work item in a team the caller can write to.
 *
 * `createdBy`, `status`, and `version` are set by the server; the validated
 * input cannot carry them. An optional assignee must belong to the same team.
 */
export async function createItem(
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

  const row = await insertWorkItem({
    title: input.title,
    description: input.description ?? null,
    type: input.type,
    priority: input.priority,
    teamId: input.teamId,
    assigneeId: input.assigneeId ?? null,
    createdBy: userId,
    dueAt: input.dueAt ?? null,
  });

  return toWorkItemResponse(row);
}

/**
 * Update permitted fields of an existing work item.
 *
 * Authorization is resolved against the item's actual team. Protected and
 * server-managed fields are rejected by the schema before reaching here; this
 * function never touches `status` or `version`.
 */
export async function updateItem(
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

  const patch: Parameters<typeof updateWorkItem>[1] = {};
  if (input.title !== undefined) patch.title = input.title;
  if (input.description !== undefined) patch.description = input.description;
  if (input.type !== undefined) patch.type = input.type;
  if (input.priority !== undefined) patch.priority = input.priority;
  if (input.assigneeId !== undefined) patch.assigneeId = input.assigneeId;
  if (input.dueAt !== undefined) patch.dueAt = input.dueAt;

  const row = await updateWorkItem(id, patch);
  if (!row) {
    throw notFound();
  }

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
