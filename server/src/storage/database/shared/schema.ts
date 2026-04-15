import { pgTable, serial, varchar, text, timestamp, integer, index } from "drizzle-orm/pg-core"
import { sql } from "drizzle-orm"

export const healthCheck = pgTable("health_check", {
	id: serial().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow(),
});

export const dreams = pgTable(
	"dreams",
	{
		id: serial().primaryKey(),
		content: text("content").notNull(),
		audio_key: varchar("audio_key", { length: 512 }),
		interpreter: varchar("interpreter", { length: 20 }),
		interpretation: text("interpretation"),
		created_at: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
	},
	(table) => [
		index("dreams_created_at_idx").on(table.created_at),
		index("dreams_interpreter_idx").on(table.interpreter),
	]
);

export const messages = pgTable(
	"messages",
	{
		id: serial().primaryKey(),
		dream_id: integer("dream_id").notNull().references(() => dreams.id, { onDelete: "cascade" }),
		role: varchar("role", { length: 20 }).notNull(),
		content: text("content").notNull(),
		created_at: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
	},
	(table) => [
		index("messages_dream_id_idx").on(table.dream_id),
	]
);
