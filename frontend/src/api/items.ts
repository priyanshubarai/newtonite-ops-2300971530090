import { request } from "./client";
import type {
  CreateItemInput,
  ItemFilters,
  TransitionItemInput,
  UpdateItemInput,
  WorkItem,
  WorkItemListResponse,
} from "./types";

/**
 * Work-item API calls. Each function maps 1:1 onto a verified Express route and
 * passes the backend's own field names straight through, so there is no
 * translation layer to drift out of sync.
 */

/** `GET /items` - filtered, paginated, team-scoped list. */
export function listItems(
  filters: ItemFilters,
  signal?: AbortSignal,
): Promise<WorkItemListResponse> {
  return request<WorkItemListResponse>("/items", {
    query: {
      teamId: filters.teamId,
      status: filters.status,
      priority: filters.priority,
      assigneeId: filters.assigneeId,
      search: filters.search,
      preset: filters.preset,
      page: filters.page,
      pageSize: filters.pageSize,
      sort: filters.sort,
      order: filters.order,
    },
    signal,
  });
}

/** `GET /items/:id` - a single work item. */
export function getItem(id: string, signal?: AbortSignal): Promise<WorkItem> {
  return request<WorkItem>(`/items/${encodeURIComponent(id)}`, { signal });
}

/** `GET /items/:id/activity` - activity history for a work item. */
export interface ActivityItem {
  id: string;
  workItemId: string;
  actorId: string;
  eventType: string;
  metadata: Record<string, unknown>;
  createdAt: string;
}

export interface ActivityListResponse {
  items: ActivityItem[];
  pagination: {
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
    hasNextPage: boolean;
    hasPrevPage: boolean;
  };
}

export function listActivity(
  id: string,
  page: number = 1,
  pageSize: number = 20,
  signal?: AbortSignal,
): Promise<ActivityListResponse> {
  return request<ActivityListResponse>(`/items/${encodeURIComponent(id)}/activity`, {
    query: { page, pageSize },
    signal,
  });
}

/** `POST /items` - create a work item. */
export function createItem(
  input: CreateItemInput,
  idempotencyKey: string,
): Promise<WorkItem> {
  return request<WorkItem>("/items", {
    method: "POST",
    body: input,
    idempotencyKey,
  });
}

/** `PATCH /items/:id` - update editable fields under optimistic concurrency. */
export function updateItem(
  id: string,
  input: UpdateItemInput,
  idempotencyKey: string,
): Promise<WorkItem> {
  return request<WorkItem>(`/items/${encodeURIComponent(id)}`, {
    method: "PATCH",
    body: input,
    idempotencyKey,
  });
}

/** `POST /items/:id/claim` - atomically claim an unassigned item. */
export function claimItem(id: string, idempotencyKey: string): Promise<WorkItem> {
  return request<WorkItem>(`/items/${encodeURIComponent(id)}/claim`, {
    method: "POST",
    idempotencyKey,
  });
}

/** `POST /items/:id/transition` - advance along the approved workflow. */
export function transitionItem(
  id: string,
  input: TransitionItemInput,
  idempotencyKey: string,
): Promise<WorkItem> {
  return request<WorkItem>(`/items/${encodeURIComponent(id)}/transition`, {
    method: "POST",
    body: input,
    idempotencyKey,
  });
}

/** `GET /items/:id/comments` - comments for a work item. */
export interface CommentItem {
  id: string;
  workItemId: string;
  authorId: string;
  body: string;
  createdAt: string;
  updatedAt: string;
}

export interface CommentListResponse {
  items: CommentItem[];
  pagination: {
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
    hasNextPage: boolean;
    hasPrevPage: boolean;
  };
}

export function listComments(
  id: string,
  page: number = 1,
  pageSize: number = 20,
  signal?: AbortSignal,
): Promise<CommentListResponse> {
  return request<CommentListResponse>(`/items/${encodeURIComponent(id)}/comments`, {
    query: { page, pageSize },
    signal,
  });
}

/** `POST /items/:id/comments` - create a comment on a work item. */
export interface CreateCommentInput {
  body: string;
}

export interface CreateCommentResponse {
  comment: CommentItem;
}

export function createComment(
  id: string,
  input: CreateCommentInput,
  idempotencyKey: string,
): Promise<CreateCommentResponse> {
  return request<CreateCommentResponse>(`/items/${encodeURIComponent(id)}/comments`, {
    method: "POST",
    body: input,
    idempotencyKey,
  });
}
