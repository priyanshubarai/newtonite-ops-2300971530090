import { pgEnum } from "drizzle-orm/pg-core";

// Shared PostgreSQL enums for the approved fixed value sets.

export const teamRoleEnum = pgEnum("team_role", ["VIEWER", "MEMBER", "LEAD", "ADMIN"]);

export const workItemTypeEnum = pgEnum("work_item_type", [
  "INCIDENT",
  "CUSTOMER_ISSUE",
  "PAYMENT",
  "COMPLIANCE",
  "TASK",
]);

export const workPriorityEnum = pgEnum("work_priority", ["LOW", "MEDIUM", "HIGH", "CRITICAL"]);

export const workStatusEnum = pgEnum("work_status", [
  "OPEN",
  "IN_PROGRESS",
  "AWAITING_APPROVAL",
  "RESOLVED",
  "CLOSED",
]);

export const activityEventTypeEnum = pgEnum("activity_event_type", [
  "ITEM_CREATED",
  "STATUS_CHANGED",
  "ASSIGNEE_CHANGED",
  "PRIORITY_CHANGED",
  "COMMENT_ADDED",
  // Added in Phase 5 (additive migration 0001) so a work-item field update
  // (title/description/type/dueAt) has an accurate event type alongside the
  // existing priority/assignee-specific types. Appended last so the schema
  // order matches `ALTER TYPE ... ADD VALUE`, which appends.
  "ITEM_UPDATED",
]);

export const idempotencyStateEnum = pgEnum("idempotency_state", [
  "IN_PROGRESS",
  "COMPLETED",
  "FAILED",
]);

export const outboxStatusEnum = pgEnum("outbox_status", ["PENDING", "PROCESSING", "COMPLETED", "FAILED"]);
