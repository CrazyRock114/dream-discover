import postgres from "postgres";

const MIGRATION_SQL = `
-- Create dreamdis_dreams table if not exists
CREATE TABLE IF NOT EXISTS dreamdis_dreams (
  id SERIAL PRIMARY KEY,
  device_id VARCHAR(64) NOT NULL,
  content TEXT NOT NULL,
  audio_key VARCHAR(512),
  interpreter VARCHAR(20),
  interpretation TEXT,
  mood VARCHAR(20),
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

-- Create dreamdis_dream_tags table if not exists
CREATE TABLE IF NOT EXISTS dreamdis_dream_tags (
  id SERIAL PRIMARY KEY,
  dream_id INTEGER NOT NULL REFERENCES dreamdis_dreams(id) ON DELETE CASCADE,
  tag VARCHAR(50) NOT NULL,
  is_custom BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

-- Create dreamdis_messages table if not exists
CREATE TABLE IF NOT EXISTS dreamdis_messages (
  id SERIAL PRIMARY KEY,
  dream_id INTEGER NOT NULL REFERENCES dreamdis_dreams(id) ON DELETE CASCADE,
  role VARCHAR(20) NOT NULL,
  content TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

-- Create indexes if not exists
CREATE INDEX IF NOT EXISTS dreamdis_dreams_created_at_idx ON dreamdis_dreams(created_at);
CREATE INDEX IF NOT EXISTS dreamdis_dreams_interpreter_idx ON dreamdis_dreams(interpreter);
CREATE INDEX IF NOT EXISTS dreamdis_dreams_device_id_idx ON dreamdis_dreams(device_id);
CREATE INDEX IF NOT EXISTS dreamdis_dreams_mood_idx ON dreamdis_dreams(mood);
-- Composite index for the main list query (device_id + created_at DESC)
CREATE INDEX IF NOT EXISTS dreamdis_dreams_device_created_idx ON dreamdis_dreams(device_id, created_at DESC);
CREATE INDEX IF NOT EXISTS dreamdis_dream_tags_dream_id_idx ON dreamdis_dream_tags(dream_id);
-- Index for tag filtering
CREATE INDEX IF NOT EXISTS dreamdis_dream_tags_tag_idx ON dreamdis_dream_tags(tag);
CREATE INDEX IF NOT EXISTS dreamdis_messages_dream_id_idx ON dreamdis_messages(dream_id);

-- Enable RLS
ALTER TABLE dreamdis_dreams ENABLE ROW LEVEL SECURITY;
ALTER TABLE dreamdis_dream_tags ENABLE ROW LEVEL SECURITY;
ALTER TABLE dreamdis_messages ENABLE ROW LEVEL SECURITY;

-- Create RLS policies (idempotent - use DO block to avoid errors)
DO $$
BEGIN
  -- dreams policies
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'dreams_select_all') THEN
    CREATE POLICY dreams_select_all ON dreamdis_dreams FOR SELECT USING (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'dreams_insert_all') THEN
    CREATE POLICY dreams_insert_all ON dreamdis_dreams FOR INSERT WITH CHECK (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'dreams_update_all') THEN
    CREATE POLICY dreams_update_all ON dreamdis_dreams FOR UPDATE USING (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'dreams_delete_all') THEN
    CREATE POLICY dreams_delete_all ON dreamdis_dreams FOR DELETE USING (true);
  END IF;

  -- messages policies
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'messages_select_all') THEN
    CREATE POLICY messages_select_all ON dreamdis_messages FOR SELECT USING (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'messages_insert_all') THEN
    CREATE POLICY messages_insert_all ON dreamdis_messages FOR INSERT WITH CHECK (true);
  END IF;

  -- dream_tags policies
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'dream_tags_select_all') THEN
    CREATE POLICY dream_tags_select_all ON dreamdis_dream_tags FOR SELECT USING (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'dream_tags_insert_all') THEN
    CREATE POLICY dream_tags_insert_all ON dreamdis_dream_tags FOR INSERT WITH CHECK (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'dream_tags_delete_all') THEN
    CREATE POLICY dream_tags_delete_all ON dreamdis_dream_tags FOR DELETE USING (true);
  END IF;
END
$$;

-- Add user_id to dreams table for auth migration
ALTER TABLE dreamdis_dreams ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS dreamdis_dreams_user_id_idx ON dreamdis_dreams(user_id);

-- Create auth_codes table for email OTP
CREATE TABLE IF NOT EXISTS dreamdis_auth_codes (
  id SERIAL PRIMARY KEY,
  email VARCHAR(255) NOT NULL,
  code VARCHAR(6) NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS dreamdis_auth_codes_email_idx ON dreamdis_auth_codes(email);
CREATE INDEX IF NOT EXISTS dreamdis_auth_codes_expires_at_idx ON dreamdis_auth_codes(expires_at);

-- Create sessions table for token-based auth
CREATE TABLE IF NOT EXISTS dreamdis_sessions (
  id SERIAL PRIMARY KEY,
  token VARCHAR(64) UNIQUE NOT NULL,
  user_id UUID NOT NULL,
  email VARCHAR(255) NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS dreamdis_sessions_token_idx ON dreamdis_sessions(token);
CREATE INDEX IF NOT EXISTS dreamdis_sessions_user_id_idx ON dreamdis_sessions(user_id);

-- Notify PostgREST to reload schema cache
NOTIFY pgrst, 'reload schema';
`;

export async function runMigration(): Promise<void> {
  const dbUrl = process.env.DATABASE_URL || process.env.PGDATABASE_URL;
  if (!dbUrl) {
    console.log("[migrate] No DATABASE_URL found, skipping migration");
    return;
  }

  console.log("[migrate] Running database migration...");
  let sql: ReturnType<typeof postgres> | null = null;

  try {
    sql = postgres(dbUrl, {
      ssl: dbUrl.includes("sslmode=require") ? "require" : undefined,
    });

    await sql.unsafe(MIGRATION_SQL);
    console.log("[migrate] Migration completed successfully");
  } catch (err: any) {
    console.error("[migrate] Migration failed:", err.message);
    // Don't throw - allow server to start anyway
  } finally {
    if (sql) {
      await sql.end();
    }
  }
}
