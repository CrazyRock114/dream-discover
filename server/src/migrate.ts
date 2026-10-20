import postgres from "postgres";

/**
 * 迁移分两批执行，互不影响：
 *
 * 1. MIGRATION_SQL —— 建表 / 建索引 / 加列
 * 2. RLS_SQL       —— 行级安全策略
 *
 * 分批的原因：Postgres 的多语句查询在一个隐式事务里执行，任意一条失败会整体回滚。
 * 早期版本把建表和策略混在一批，导致 auth.users 外键失败时连认证表都建不出来，
 * 而 runMigration 又把错误吞掉，服务端对着旧 schema 静默启动。
 */

/** 建表 / 索引 / 加列 —— 幂等 */
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
`;

/**
 * 行级安全策略
 *
 * 服务端是直连 Postgres（不是 PostgREST），连接角色通常是表属主或带 BYPASSRLS，
 * 因此策略里的 current_user 分支保证服务端不受影响；
 * 而 PostgREST 用 anon / authenticated 角色访问时，current_user 分别是 anon / authenticated，
 * auth.uid() 对 anon 为 NULL —— 这条路径被彻底堵死。
 */
const RLS_SQL = `
ALTER TABLE dreamdis_dreams ENABLE ROW LEVEL SECURITY;
ALTER TABLE dreamdis_dream_tags ENABLE ROW LEVEL SECURITY;
ALTER TABLE dreamdis_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE dreamdis_auth_codes ENABLE ROW LEVEL SECURITY;
ALTER TABLE dreamdis_sessions ENABLE ROW LEVEL SECURITY;

-- 旧的宽松策略（USING (true)）必须先删掉，否则会与新策略取并集而失效
DROP POLICY IF EXISTS dreams_select_all ON dreamdis_dreams;
DROP POLICY IF EXISTS dreams_insert_all ON dreamdis_dreams;
DROP POLICY IF EXISTS dreams_update_all ON dreamdis_dreams;
DROP POLICY IF EXISTS dreams_delete_all ON dreamdis_dreams;
DROP POLICY IF EXISTS messages_select_all ON dreamdis_messages;
DROP POLICY IF EXISTS messages_insert_all ON dreamdis_messages;
DROP POLICY IF EXISTS dream_tags_select_all ON dreamdis_dream_tags;
DROP POLICY IF EXISTS dream_tags_insert_all ON dreamdis_dream_tags;
DROP POLICY IF EXISTS dream_tags_delete_all ON dreamdis_dream_tags;

-- 服务端直连角色（表属主 / service_role）保留完整权限
DROP POLICY IF EXISTS dreams_service_all ON dreamdis_dreams;
CREATE POLICY dreams_service_all ON dreamdis_dreams FOR ALL
  USING (current_user IN ('postgres', 'service_role'))
  WITH CHECK (current_user IN ('postgres', 'service_role'));

-- 已认证用户只能读写自己的梦境
DROP POLICY IF EXISTS dreams_own_select ON dreamdis_dreams;
CREATE POLICY dreams_own_select ON dreamdis_dreams FOR SELECT
  USING (auth.uid() = user_id OR current_user IN ('postgres', 'service_role'));
DROP POLICY IF EXISTS dreams_own_insert ON dreamdis_dreams;
CREATE POLICY dreams_own_insert ON dreamdis_dreams FOR INSERT
  WITH CHECK (auth.uid() = user_id OR current_user IN ('postgres', 'service_role'));
DROP POLICY IF EXISTS dreams_own_update ON dreamdis_dreams;
CREATE POLICY dreams_own_update ON dreamdis_dreams FOR UPDATE
  USING (auth.uid() = user_id OR current_user IN ('postgres', 'service_role'))
  WITH CHECK (auth.uid() = user_id OR current_user IN ('postgres', 'service_role'));
DROP POLICY IF EXISTS dreams_own_delete ON dreamdis_dreams;
CREATE POLICY dreams_own_delete ON dreamdis_dreams FOR DELETE
  USING (auth.uid() = user_id OR current_user IN ('postgres', 'service_role'));

-- 标签 / 消息通过所属梦境判定归属
DROP POLICY IF EXISTS dream_tags_own_all ON dreamdis_dream_tags;
CREATE POLICY dream_tags_own_all ON dreamdis_dream_tags FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM dreamdis_dreams d
      WHERE d.id = dreamdis_dream_tags.dream_id
        AND (d.user_id = auth.uid() OR current_user IN ('postgres', 'service_role'))
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM dreamdis_dreams d
      WHERE d.id = dreamdis_dream_tags.dream_id
        AND (d.user_id = auth.uid() OR current_user IN ('postgres', 'service_role'))
    )
  );

DROP POLICY IF EXISTS messages_own_all ON dreamdis_messages;
CREATE POLICY messages_own_all ON dreamdis_messages FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM dreamdis_dreams d
      WHERE d.id = dreamdis_messages.dream_id
        AND (d.user_id = auth.uid() OR current_user IN ('postgres', 'service_role'))
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM dreamdis_dreams d
      WHERE d.id = dreamdis_messages.dream_id
        AND (d.user_id = auth.uid() OR current_user IN ('postgres', 'service_role'))
    )
  );

-- 验证码与会话令牌只允许服务端访问，任何客户端角色都拿不到
DROP POLICY IF EXISTS auth_codes_service_only ON dreamdis_auth_codes;
CREATE POLICY auth_codes_service_only ON dreamdis_auth_codes FOR ALL
  USING (current_user IN ('postgres', 'service_role'))
  WITH CHECK (current_user IN ('postgres', 'service_role'));

DROP POLICY IF EXISTS sessions_service_only ON dreamdis_sessions;
CREATE POLICY sessions_service_only ON dreamdis_sessions FOR ALL
  USING (current_user IN ('postgres', 'service_role'))
  WITH CHECK (current_user IN ('postgres', 'service_role'));

-- Notify PostgREST to reload schema cache
NOTIFY pgrst, 'reload schema';
`;

/** 复用 db.ts 的 IPv4 解析，避免 Railway 上连不上数据库 */
async function connect(dbUrl: string) {
  const dns = await import("dns");
  const options: Record<string, any> = {
    // Supabase PgBouncer (port 6543) 不支持 prepared statements
    prepare: false,
  };
  if (dbUrl.includes("sslmode=require") || dbUrl.includes("supabase.com")) {
    options.ssl = "require";
  }

  // Railway 不支持 IPv6 出站，主动解析 IPv4 并用 host 覆盖（不改 URL，保留 SSL 证书校验）
  try {
    const hostname = new URL(dbUrl).hostname;
    const addresses = await dns.promises.resolve4(hostname);
    if (addresses.length > 0) {
      console.log(`[migrate] Resolved ${hostname} -> ${addresses[0]} (IPv4)`);
      options.host = addresses[0];
    }
  } catch (err: any) {
    console.log(`[migrate] DNS resolve4 failed, falling back to hostname: ${err.message}`);
  }

  return postgres(dbUrl, options);
}

export async function runMigration(): Promise<void> {
  const dbUrl = process.env.DATABASE_URL || process.env.PGDATABASE_URL;
  if (!dbUrl) {
    console.log("[migrate] No DATABASE_URL found, skipping migration");
    return;
  }

  console.log("[migrate] Running database migration...");
  let sql: ReturnType<typeof postgres> | null = null;

  try {
    sql = await connect(dbUrl);

    // 第一批：表结构
    try {
      await sql.unsafe(MIGRATION_SQL);
      console.log("[migrate] Schema migration completed successfully");
    } catch (err: any) {
      console.error("[migrate] Schema migration FAILED:", err.message);
    }

    // 第二批：行级安全策略（与建表解耦，失败不影响上面的结果）
    try {
      await sql.unsafe(RLS_SQL);
      console.log("[migrate] RLS policies applied successfully");
    } catch (err: any) {
      console.error("[migrate] RLS policy migration FAILED:", err.message);
    }

    // 诊断信息：确认服务端连接角色在 RLS 下的行为。
    // 若 rolbypassrls 为 true（或该角色是表属主），RLS 策略对服务端不生效，
    // 策略只约束 PostgREST 的 anon / authenticated 角色 —— 这正是预期。
    try {
      const [roleInfo] = await sql.unsafe(
        `SELECT current_user AS role,
                r.rolbypassrls AS bypass_rls,
                (SELECT count(*)::int FROM pg_class c
                   JOIN pg_roles o ON o.oid = c.relowner
                  WHERE c.relname = 'dreamdis_dreams' AND o.rolname = current_user) AS is_owner
           FROM pg_roles r WHERE r.rolname = current_user`
      );
      console.log(
        `[migrate] DB role=${roleInfo?.role} bypass_rls=${roleInfo?.bypass_rls} is_table_owner=${roleInfo?.is_owner}`
      );
    } catch (err: any) {
      console.warn("[migrate] Could not read DB role info:", err.message);
    }
  } catch (err: any) {
    console.error("[migrate] Migration failed:", err.message);
    // Don't throw - allow server to start anyway
  } finally {
    if (sql) {
      await sql.end();
    }
  }
}
