/**
 * API DTOs mirroring the backend contract.
 *
 * These are hand-written to match the verified Express routes, request
 * validators, and response serializers (`backend/src/items/serialize.ts`,
 * `backend/src/items/validation.ts`, `backend/src/auth/routes.ts`). The
 * frontend never invents fields or endpoints.
 */

export const WORK_ITEM_TYPES = [
  "INCIDENT",
  "CUSTOMER_ISSUE",
  "PAYMENT",
  "COMPLIANCE",
  "TASK",
] as const;
export type WorkItemType = (typeof WORK_ITEM_TYPES)[number];

export const WORK_PRIORITIES = ["LOW", "MEDIUM", "HIGH", "CRITICAL"] as const;
export type WorkPriority = (typeof WORK_PRIORITIES)[number];

export const WORK_STATUSES = [
  "OPEN",
  "IN_PROGRESS",
  "AWAITING_APPROVAL",
  "RESOLVED",
  "CLOSED",
] as const;
export type WorkStatus = (typeof WORK_STATUSES)[number];

export const TEAM_ROLES = ["VIEWER", "MEMBER", "LEAD", "ADMIN"] as const;
export type TeamRole = (typeof TEAM_ROLES)[number];

export const SORT_FIELDS = ["createdAt", "updatedAt", "priority", "dueAt"] as const;
export type SortField = (typeof SORT_FIELDS)[number];

export type SortDirection = "asc" | "desc";

/** Work-item fields returned by the API. Dates arrive as ISO strings. */
export interface WorkItem {
  id: string;
  title: string;
  description: string | null;
  type: WorkItemType;
  priority: WorkPriority;
  status: WorkStatus;
  teamId: string;
  teamName?: string;
  assigneeId: string | null;
  assigneeName?: string | null;
  createdBy: string;
  dueAt: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface Pagination {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
  hasNextPage: boolean;
  hasPrevPage: boolean;
}

export interface WorkItemListResponse {
  items: WorkItem[];
  pagination: Pagination;
}

export interface AuthUser {
  id: string;
  email: string;
  name: string;
  isActive: boolean;
}

export interface Membership {
  teamId: string;
  teamName: string;
  teamSlug: string;
  role: TeamRole;
}

export interface LoginResponse {
  token: string;
  tokenType: string;
  user: AuthUser;
}

export interface MeResponse {
  user: AuthUser;
  memberships: Membership[];
}

/**
 * Filters accepted by `GET /items`. Only defined values are sent, so an
 * undefined filter is simply omitted from the query string.
 */
export interface ItemFilters {
  teamId?: string;
  status?: WorkStatus;
  priority?: WorkPriority;
  assigneeId?: string;
  search?: string;
  preset?: "assigned" | "unassigned_urgent" | "awaiting_approval";
  page?: number;
  pageSize?: number;
  sort?: SortField;
  order?: SortDirection;
}

/** Body for `POST /items`. */
export interface CreateItemInput {
  title: string;
  description?: string | null;
  type: WorkItemType;
  priority: WorkPriority;
  teamId: string;
  assigneeId?: string | null;
  dueAt?: string | null;
}

/** Body for `PATCH /items/:id`. `expectedVersion` is a precondition. */
export interface UpdateItemInput {
  title?: string;
  description?: string | null;
  type?: WorkItemType;
  priority?: WorkPriority;
  assigneeId?: string | null;
  dueAt?: string | null;
  expectedVersion: number;
}

/** Body for `POST /items/:id/transition`. */
export interface TransitionItemInput {
  toStatus: WorkStatus;
  expectedVersion: number;
}

/** Shape of every non-2xx JSON error body produced by the backend. */
export interface ApiErrorBody {
  error: string;
  code?: string;
  details?: unknown;
}
