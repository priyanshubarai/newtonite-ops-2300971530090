import { pgTable, timestamp, uuid, uniqueIndex, index } from "drizzle-orm/pg-core";
import { users } from "./users.js";
import { teams } from "./teams.js";
import { teamRoleEnum } from "./enums.js";

export const userTeamMemberships = pgTable(
  "user_team_memberships",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    teamId: uuid("team_id")
      .notNull()
      .references(() => teams.id, { onDelete: "restrict" }),
    role: teamRoleEnum("role").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdateFn(() => new Date()),
  },
  (table) => ({
    // One membership per user/team pair.
    userTeamUnique: uniqueIndex("user_team_unique").on(table.userId, table.teamId),
    userIdx: index("utm_user_idx").on(table.userId),
    teamIdx: index("utm_team_idx").on(table.teamId),
  }),
);
