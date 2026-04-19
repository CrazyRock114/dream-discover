import { pgTable, serial, varchar, text, timestamp, integer, boolean, index } from "drizzle-orm/pg-core"
import { sql } from "drizzle-orm"

export const healthCheck = pgTable("dreamdis_health_check", {
	id: serial().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow(),
});

export const dreams = pgTable(
	"dreamdis_dreams",
	{
		id: serial().primaryKey(),
		device_id: varchar("device_id", { length: 64 }).notNull(),
		content: text("content").notNull(),
		audio_key: varchar("audio_key", { length: 512 }),
		interpreter: varchar("interpreter", { length: 20 }),
		interpretation: text("interpretation"),
		mood: varchar("mood", { length: 20 }),
		created_at: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
	},
	(table) => [
		index("dreamdis_dreams_created_at_idx").on(table.created_at),
		index("dreamdis_dreams_interpreter_idx").on(table.interpreter),
		index("dreamdis_dreams_device_id_idx").on(table.device_id),
		index("dreamdis_dreams_mood_idx").on(table.mood),
	]
);

export const dream_tags = pgTable(
	"dreamdis_dream_tags",
	{
		id: serial().primaryKey(),
		dream_id: integer("dream_id").notNull().references(() => dreams.id, { onDelete: "cascade" }),
		tag: varchar("tag", { length: 50 }).notNull(),
		is_custom: boolean("is_custom").default(false).notNull(),
		created_at: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
	},
	(table) => [
		index("dreamdis_dream_tags_dream_id_idx").on(table.dream_id),
	]
);

export const messages = pgTable(
	"dreamdis_messages",
	{
		id: serial().primaryKey(),
		dream_id: integer("dream_id").notNull().references(() => dreams.id, { onDelete: "cascade" }),
		role: varchar("role", { length: 20 }).notNull(),
		content: text("content").notNull(),
		created_at: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
	},
	(table) => [
		index("dreamdis_messages_dream_id_idx").on(table.dream_id),
	]
);
