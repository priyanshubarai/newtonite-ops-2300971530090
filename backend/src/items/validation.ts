import { z } from "zod";
import { workItemTypeEnum, workPriorityEnum, workStatusEnum } from "../db/schema/enums.js";

/**
 * Work-item validation contract.
 *
 * The database schema intentionally stores free text without length limits, so
 * explicit, documented bounds are enforced at the API edge instead. These
 * limits (and the list query contract) are documented in the README.
 */

// Enum value unions derived directly from the database enums so validation and
// storage can never drift apart.
export type WorkItemType = (typeof workItemTypeEnum.enumValues)[number];
export type WorkPriority = (typeof workPriorityEnum.enumValues)[number];
export type WorkStatus = (typeof workStatusEnum.enumValues)[number];

export const TITLE_MAX_LENGTH = 200;
export const DESCRIPTION_MAX_LENGTH = 5000;
export const SEARCH_MAX_LENGTH = 200;
export const PAGE_SIZE_DEFAULT = 20;
export const PAGE_SIZE_MAX = 100;

// Explicit allowlist of sortable fields. Anything else is rejected so a client
// can never inject an arbitrary SQL identifier or expression into ORDER BY.
export const SORT_FIELDS = ["createdAt", "updatedAt", "priority", "dueAt"] as const;
export type SortField = (typeof SORT_FIELDS)[number];

export const SORT_DIRECTIONS = ["asc", "desc"] as const;
export type SortDirection = (typeof SORT_DIRECTIONS)[number];

const uuid = (field: string) => z.string().uuid(`${field} must be a valid UUID`);

const workItemType = z.enum(workItemTypeEnum.enumValues);
const workPriority = z.enum(workPriorityEnum.enumValues);
const workStatus = z.enum(workStatusEnum.enumValues);

/** `GET /items` query contract. */
export const listItemsQuerySchema = z.object({
  teamId: uuid("teamId").optional(),
  status: workStatus.optional(),
  priority: workPriority.optional(),
  assigneeId: uuid("assigneeId").optional(),
  search: z
    .string()
    .trim()
    .max(SEARCH_MAX_LENGTH, `search must be at most ${SEARCH_MAX_LENGTH} characters`)
    .optional(),
  page: z.coerce
    .number()
    .int("page must be an integer")
    .min(1, "page must be at least 1")
    // Cap at the largest safe integer. `page` is multiplied by `pageSize` to
    // form the OFFSET; without a bound an absurd value overflows PostgreSQL's
    // bigint and would surface as a 500. Reject it as a 400 instead.
    .max(Number.MAX_SAFE_INTEGER, "page is too large")
    .default(1),
  pageSize: z.coerce
    .number()
    .int("pageSize must be an integer")
    .min(1, "pageSize must be at least 1")
    .max(PAGE_SIZE_MAX, `pageSize must be at most ${PAGE_SIZE_MAX}`)
    .default(PAGE_SIZE_DEFAULT),
  sort: z.enum(SORT_FIELDS).default("updatedAt"),
  order: z.enum(SORT_DIRECTIONS).default("desc"),
});
export type ListItemsQuery = z.infer<typeof listItemsQuerySchema>;

/**
 * `POST /items` body. `.strict()` rejects any unrecognised key, which is how
 * server-managed fields (status, version, createdBy, id, timestamps) are kept
 * out of the client's control: supplying one is a 400, never a silent override.
 */
export const createItemSchema = z
  .object({
    title: z
      .string()
      .trim()
      .min(1, "title is required")
      .max(TITLE_MAX_LENGTH, `title must be at most ${TITLE_MAX_LENGTH} characters`),
    description: z
      .string()
      .max(
        DESCRIPTION_MAX_LENGTH,
        `description must be at most ${DESCRIPTION_MAX_LENGTH} characters`,
      )
      .nullable()
      .optional(),
    type: workItemType,
    priority: workPriority,
    teamId: uuid("teamId"),
    assigneeId: uuid("assigneeId").nullable().optional(),
    dueAt: z.coerce.date().nullable().optional(),
  })
  .strict();
export type CreateItemInput = z.infer<typeof createItemSchema>;

/**
 * `PATCH /items/:id` body. Only editable fields are accepted (plus the
 * concurrency control `expectedVersion`); `.strict()` rejects protected fields
 * (id, teamId, createdBy, status, version, createdAt, updatedAt). The refine
 * rejects a body with no *updatable* field so a no-op PATCH is a 400 rather
 * than a silent 200.
 *
 * `expectedVersion` is the version the client last read. It is a precondition
 * only - the server never accepts it as the new stored version.
 */
export const expectedVersionField = z
  .number({ invalid_type_error: "expectedVersion must be a number" })
  .int("expectedVersion must be an integer")
  .min(1, "expectedVersion must be at least 1");

export const updateItemSchema = z
  .object({
    title: z
      .string()
      .trim()
      .min(1, "title must not be empty")
      .max(TITLE_MAX_LENGTH, `title must be at most ${TITLE_MAX_LENGTH} characters`)
      .optional(),
    description: z
      .string()
      .max(
        DESCRIPTION_MAX_LENGTH,
        `description must be at most ${DESCRIPTION_MAX_LENGTH} characters`,
      )
      .nullable()
      .optional(),
    type: workItemType.optional(),
    priority: workPriority.optional(),
    dueAt: z.coerce.date().nullable().optional(),
    assigneeId: uuid("assigneeId").nullable().optional(),
    expectedVersion: expectedVersionField,
  })
  .strict()
  .refine((value) => Object.keys(value).some((k) => k !== "expectedVersion"), {
    message: "at least one updatable field is required",
    path: ["expectedVersion"],
  });
export type UpdateItemInput = z.infer<typeof updateItemSchema>;

/**
 * `POST /items/:id/transition` body. The target status must be a real status
 * value; the exact edge is validated server-side against the item's current
 * status. `expectedVersion` is the same concurrency precondition as PATCH.
 */
export const transitionItemSchema = z
  .object({
    toStatus: workStatus,
    expectedVersion: expectedVersionField,
  })
  .strict();
export type TransitionItemInput = z.infer<typeof transitionItemSchema>;

/** Route param contract for `/items/:id`. */
export const itemIdSchema = z.string().uuid("id must be a valid UUID");
