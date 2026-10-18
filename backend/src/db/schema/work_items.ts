import { pgTable, text, timestamp, uuid, integer, index, foreignKey } from "drizzle-orm/pg-core";
import { users } from "./users.js";
import { teams } from "./teams.js";
import { workItemTypeEnum, workPriorityEnum, workStatusEnum } from "./enums.js";

export const workItems = pgTable(
  "work_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    title: text("title").notNull(),
    description: text("description"),
    type: workItemTypeEnum("type").notNull(),
    priority: workPriorityEnum("priority").notNull(),
    status: workStatusEnum("status").notNull().default("OPEN"),
    teamId: uuid("team_id")
      .notNull()
      .references(() => teams.id, { onDelete: "restrict" }),
    assigneeId: uuid("assignee_id").references(() => users.id, { onDelete: "set null" }),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    dueAt: timestamp("due_at", { withTimezone: true }),
    version: integer("version").notNull().default(1),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdateFn(() => new Date()),
  },
  (table) => ({
    // Approved indexes: team/status/updatedAt/id (composite to match predicates/sort)
    teamStatusUpdatedIdx: index("wi_team_status_updated_idx").on(table.teamId, table.status, table.updatedAt, table.id),
    teamPriorityStatusUpdatedIdx: index("wi_team_priority_status_updated_idx").on(
      table.teamId,
      table.priority,
      table.status,
      table.updatedAt,
      table.id,
    ),
    assigneeStatusUpdatedIdx: index("wi_assignee_status_updated_idx").on(table.assigneeId, table.status, table.updatedAt),
    teamIdx: index("wi_team_idx").on(table.teamId),
    assigneeIdx: index("wi_assignee_idx").on(table.assigneeId),
    statusIdx: index("wi_status_idx").on(table.status),
    updatedAtIdx: index("wi_updated_at_idx").on(table.updatedAt),
  }),
);
