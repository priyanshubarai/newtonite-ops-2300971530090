import { pgTable, text, timestamp, uuid, index } from "drizzle-orm/pg-core";
import { workItems } from "./work_items";
import { users } from "./users";

export const comments = pgTable(
  "comments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workItemId: uuid("work_item_id")
      .notNull()
      .references(() => workItems.id, { onDelete: "restrict" }),
    authorId: uuid("author_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    body: text("body").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdateFn(() => new Date()),
  },
  (table) => ({
    workItemCreatedAtIdx: index("c_work_item_created_at_idx").on(table.workItemId, table.createdAt),
    workItemIdx: index("c_work_item_idx").on(table.workItemId),
    authorIdx: index("c_author_idx").on(table.authorId),
  }),
);
