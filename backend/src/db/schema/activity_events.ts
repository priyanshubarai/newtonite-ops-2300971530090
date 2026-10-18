import { pgTable, timestamp, uuid, jsonb, index } from "drizzle-orm/pg-core";
import { workItems } from "./work_items.js";
import { users } from "./users.js";
import { activityEventTypeEnum } from "./enums.js";

export const activityEvents = pgTable(
  "activity_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workItemId: uuid("work_item_id")
      .notNull()
      .references(() => workItems.id, { onDelete: "restrict" }),
    actorId: uuid("actor_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    eventType: activityEventTypeEnum("event_type").notNull(),
    metadata: jsonb("metadata"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    // Activity events by work item, descending creation time.
    workItemCreatedAtDescIdx: index("ae_work_item_created_at_desc_idx").on(table.workItemId, table.createdAt.desc()),
    workItemIdx: index("ae_work_item_idx").on(table.workItemId),
    createdAtIdx: index("ae_created_at_idx").on(table.createdAt),
  }),
);
