import postgres from "postgres";
import dns from "dns";

// Railway 不支持 IPv6 出站，需要主动将主机名解析为 IPv4 地址
// 只返回 IPv4 地址，不修改 URL，通过 postgres 的 host 选项覆盖连接目标
async function resolveToIPv4(hostname: string): Promise<string | null> {
  try {
    const addresses = await dns.promises.resolve4(hostname);
    if (addresses.length > 0) {
      console.log(`[db] Resolved ${hostname} -> ${addresses[0]} (IPv4)`);
      return addresses[0];
    }
  } catch (err: any) {
    console.log(`[db] DNS resolve4 failed for ${hostname}: ${err.message}`);
  }
  return null;
}

let sql: ReturnType<typeof postgres> | null = null;

export async function getDb(): Promise<ReturnType<typeof postgres>> {
  if (!sql) {
    const dbUrl = process.env.DATABASE_URL || process.env.PGDATABASE_URL;
    if (!dbUrl) {
      throw new Error("DATABASE_URL is not set");
    }
    const needSsl = dbUrl.includes("sslmode=require") || dbUrl.includes("supabase.com") || dbUrl.includes("pooler.supabase.com");
    console.log("[db] Connecting to database, ssl:", needSsl);

    // 解析 IPv4 地址（Railway 不支持 IPv6 出站）
    // 关键：不修改 URL，通过 host 选项覆盖连接目标，SSL 证书校验仍使用原始 hostname
    const parsedUrl = new URL(dbUrl);
    const ipv4 = await resolveToIPv4(parsedUrl.hostname);

    const options: Record<string, any> = {
      // Supabase PgBouncer (port 6543) 不支持 prepared statements
      prepare: false,
    };

    if (needSsl) {
      options.ssl = "require";
    }

    // 如果解析到 IPv4，通过 host 选项覆盖连接目标（不修改 URL）
    // 这样 SSL 证书校验仍基于原始 URL 中的 hostname
    if (ipv4) {
      options.host = ipv4;
    }

    sql = postgres(dbUrl, options);
  }
  return sql;
}

// ─── Types ───

export interface DreamRow {
  id: number;
  device_id: string;
  user_id: string | null;
  content: string;
  audio_key: string | null;
  interpreter: string | null;
  interpretation: string | null;
  mood: string | null;
  created_at: string;
}

export interface DreamTagRow {
  id: number;
  dream_id: number;
  tag: string;
  is_custom: boolean;
  created_at: string;
}

export interface MessageRow {
  id: number;
  dream_id: number;
  role: string;
  content: string;
  created_at: string;
}

// ─── Query helpers ───

export async function findDreamsByDeviceId(opts: {
  deviceId: string;
  userId?: string;
  limit: number;
  cursor?: string;
  mood?: string;
}): Promise<DreamRow[]> {
  const db = await getDb();

  // If user is logged in, query by user_id; otherwise by device_id
  const idColumn = opts.userId ? 'user_id' : 'device_id';
  const idValue = opts.userId || opts.deviceId;

  if (opts.cursor) {
    if (opts.mood) {
      return db.unsafe(`
        SELECT id, device_id, user_id, content, audio_key, interpreter, interpretation, mood, created_at
        FROM dreamdis_dreams
        WHERE ${idColumn} = $1 AND mood = $2 AND created_at < $3
        ORDER BY created_at DESC
        LIMIT $4
      `, [idValue, opts.mood, opts.cursor, opts.limit + 1]) as unknown as Promise<DreamRow[]>;
    }
    return db.unsafe(`
      SELECT id, device_id, user_id, content, audio_key, interpreter, interpretation, mood, created_at
      FROM dreamdis_dreams
      WHERE ${idColumn} = $1 AND created_at < $2
      ORDER BY created_at DESC
      LIMIT $3
    `, [idValue, opts.cursor, opts.limit + 1]) as unknown as Promise<DreamRow[]>;
  }

  if (opts.mood) {
    return db.unsafe(`
      SELECT id, device_id, user_id, content, audio_key, interpreter, interpretation, mood, created_at
      FROM dreamdis_dreams
      WHERE ${idColumn} = $1 AND mood = $2
      ORDER BY created_at DESC
      LIMIT $3
    `, [idValue, opts.mood, opts.limit + 1]) as unknown as Promise<DreamRow[]>;
  }

  return db.unsafe(`
    SELECT id, device_id, user_id, content, audio_key, interpreter, interpretation, mood, created_at
    FROM dreamdis_dreams
    WHERE ${idColumn} = $1
    ORDER BY created_at DESC
    LIMIT $2
  `, [idValue, opts.limit + 1]) as unknown as Promise<DreamRow[]>;
}

export async function findDreamsByTag(dreamIds: number[], tag: string): Promise<number[]> {
  if (dreamIds.length === 0) return [];
  const db = await getDb();
  const rows = await db`
    SELECT dream_id FROM dreamdis_dream_tags
    WHERE dream_id = ANY(${dreamIds}) AND tag = ${tag}
  `;
  return rows.map((r: any) => r.dream_id);
}

export async function findTagsByDreamIds(dreamIds: number[]): Promise<DreamTagRow[]> {
  if (dreamIds.length === 0) return [];
  const db = await getDb();
  return db`
    SELECT id, dream_id, tag, is_custom
    FROM dreamdis_dream_tags
    WHERE dream_id = ANY(${dreamIds})
  ` as unknown as Promise<DreamTagRow[]>;
}

/**
 * Optimized single-query fetch: dreams + tags via JOIN with jsonb_agg.
 * Replaces 2-3 round trips with 1 query.
 */
export async function findDreamsWithTags(opts: {
  deviceId: string;
  userId?: string;
  limit: number;
  cursor?: string;
  mood?: string;
  tag?: string;
}): Promise<Array<DreamRow & { tags: Array<{ id: number; tag: string; is_custom: boolean }> }>> {
  const db = await getDb();

  // If user is logged in, query by user_id; otherwise by device_id
  const idColumn = opts.userId ? 'user_id' : 'device_id';
  const idValue = opts.userId || opts.deviceId;

  const params: any[] = [idValue, opts.limit + 1];
  let paramIdx = 3;

  let cursorCondition = '';
  if (opts.cursor) {
    cursorCondition = `AND d.created_at < $${paramIdx++}::timestamptz`;
    params.push(opts.cursor);
  }

  let moodCondition = '';
  if (opts.mood) {
    moodCondition = `AND d.mood = $${paramIdx++}`;
    params.push(opts.mood);
  }

  let tagCondition = '';
  if (opts.tag) {
    tagCondition = `AND EXISTS (SELECT 1 FROM dreamdis_dream_tags tt WHERE tt.dream_id = d.id AND tt.tag = $${paramIdx++})`;
    params.push(opts.tag);
  }

  const query = `
    SELECT
      d.id, d.device_id, d.user_id, d.content, d.audio_key, d.interpreter, d.interpretation, d.mood, d.created_at,
      COALESCE(jsonb_agg(
        jsonb_build_object('id', t.id, 'tag', t.tag, 'is_custom', t.is_custom)
        ORDER BY t.id
      ) FILTER (WHERE t.id IS NOT NULL), '[]') as tags
    FROM dreamdis_dreams d
    LEFT JOIN dreamdis_dream_tags t ON t.dream_id = d.id
    WHERE d.${idColumn} = $1
      ${cursorCondition}
      ${moodCondition}
      ${tagCondition}
    GROUP BY d.id
    ORDER BY d.created_at DESC
    LIMIT $2
  `;

  const rows = await db.unsafe(query, params);

  return rows.map((r: any) => ({
    id: r.id,
    device_id: r.device_id,
    user_id: r.user_id ?? null,
    content: r.content,
    audio_key: r.audio_key,
    interpreter: r.interpreter,
    interpretation: r.interpretation,
    mood: r.mood,
    created_at: r.created_at,
    tags: Array.isArray(r.tags) ? r.tags : (typeof r.tags === 'string' ? JSON.parse(r.tags) : []),
  }));
}

export async function insertDream(data: {
  device_id: string;
  user_id?: string | null;
  content: string;
  interpreter?: string | null;
  audio_key?: string | null;
  mood?: string | null;
}): Promise<DreamRow> {
  const db = await getDb();
  const rows = await db`
    INSERT INTO dreamdis_dreams (device_id, user_id, content, interpreter, audio_key, mood)
    VALUES (${data.device_id}, ${data.user_id || null}, ${data.content}, ${data.interpreter || null}, ${data.audio_key || null}, ${data.mood || null})
    RETURNING id, device_id, user_id, content, audio_key, interpreter, interpretation, mood, created_at
  `;
  return rows[0] as unknown as DreamRow;
}

export async function findDreamById(id: number): Promise<DreamRow | null> {
  const db = await getDb();
  const rows = await db`
    SELECT id, device_id, user_id, content, audio_key, interpreter, interpretation, mood, created_at
    FROM dreamdis_dreams WHERE id = ${id}
  `;
  return (rows[0] as unknown as DreamRow) || null;
}

/**
 * 归属判定 SQL 片段
 *
 * @param userParam   userId 的参数占位符序号
 * @param deviceParam deviceId 的参数占位符序号
 *
 * 两个标识都为 NULL 时整个条件为 NULL（不成立），查不到任何记录。
 */
export function ownershipSql(userParam: number, deviceParam: number): string {
  return `(
    ($${userParam}::uuid IS NOT NULL AND user_id = $${userParam}::uuid)
    OR ($${deviceParam}::text IS NOT NULL AND device_id = $${deviceParam}::text)
  )`;
}

export interface SqlQuery {
  text: string;
  params: any[];
}

const DREAM_COLUMNS =
  "id, device_id, user_id, content, audio_key, interpreter, interpretation, mood, created_at";

/**
 * 构造「按归属查询单条梦境」的 SQL —— 所有按 id 访问单条资源的入口都必须用它。
 *
 * 归属判定：
 * - 传了 userId（已登录）：匹配 user_id = userId，或 device_id = 本次请求的设备 id
 *   （后者用于覆盖「登录前以匿名设备身份创建、登录后迁移过」的记录）
 * - 没传 userId（匿名）：仅匹配 device_id
 *
 * 两个标识都不匹配时查不到记录，调用方应转 404（不区分「不存在」与「无权访问」，
 * 避免泄露 id 是否存在）。
 */
export function buildFindDreamByIdForUser(
  id: number,
  userId?: string | null,
  deviceId?: string | null
): SqlQuery {
  return {
    text: `SELECT ${DREAM_COLUMNS}
           FROM dreamdis_dreams
           WHERE id = $1
             AND ${ownershipSql(2, 3)}
           LIMIT 1`,
    params: [id, userId || null, deviceId || null],
  };
}

export async function findDreamByIdForUser(
  id: number,
  userId?: string | null,
  deviceId?: string | null
): Promise<DreamRow | null> {
  const db = await getDb();
  const q = buildFindDreamByIdForUser(id, userId, deviceId);
  const rows = await db.unsafe(q.text, q.params);
  return (rows[0] as unknown as DreamRow) || null;
}

/**
 * 按「内容 + 解梦师」查找已有梦境记录（用于「换解梦师」时复用已有对话）。
 *
 * 归属口径与 findDreamsWithTags 保持一致：已登录按 user_id，匿名按 device_id。
 * 否则登录用户每次换解梦师都会因查不到旧记录而重复创建。
 */
export function buildFindDreamByContent(opts: {
  deviceId: string;
  userId?: string | null;
  content: string;
  interpreter: string;
}): SqlQuery {
  const idColumn = opts.userId ? "user_id" : "device_id";
  const idValue = opts.userId || opts.deviceId;
  return {
    text: `SELECT ${DREAM_COLUMNS}
           FROM dreamdis_dreams
           WHERE ${idColumn} = $1 AND content = $2 AND interpreter = $3
           ORDER BY created_at DESC LIMIT 1`,
    params: [idValue, opts.content, opts.interpreter],
  };
}

export async function findDreamByContent(opts: {
  deviceId: string;
  userId?: string | null;
  content: string;
  interpreter: string;
}): Promise<DreamRow | null> {
  const db = await getDb();
  const q = buildFindDreamByContent(opts);
  const rows = await db.unsafe(q.text, q.params);
  return (rows[0] as unknown as DreamRow) || null;
}

/**
 * 归属判定：调用方身份（userId / deviceId）到 SQL 谓词的映射。
 * - userId 存在 → 匹配 user_id（跨设备同步的记录）
 * - deviceId 存在 → 匹配 device_id（匿名设备 或 登录前创建的记录）
 * 两者都不匹配 → 查不到记录，调用方转 404。
 */
export interface DreamOwner {
  userId?: string | null;
  deviceId?: string | null;
}

/**
 * 可被 updateDream 修改的列白名单。
 * 列名会拼进 SQL 文本，因此必须在函数内部锁定，不能依赖调用方传入的键名。
 */
const UPDATABLE_DREAM_COLUMNS = [
  "interpreter",
  "interpretation",
  "mood",
  "audio_key",
] as const;

/**
 * 构造「按归属更新梦境」的 SQL。
 * 非白名单列会被忽略（并打日志），因此列名永远来自内部常量。
 */
export function buildUpdateDream(
  id: number,
  updates: Record<string, any>,
  owner: DreamOwner
): SqlQuery | null {
  const setClauses: string[] = [];
  const values: any[] = [];
  let paramIdx = 1;

  for (const [key, value] of Object.entries(updates)) {
    if (!UPDATABLE_DREAM_COLUMNS.includes(key as (typeof UPDATABLE_DREAM_COLUMNS)[number])) {
      console.warn(`[db] updateDream ignored non-whitelisted column: ${key}`);
      continue;
    }
    setClauses.push(`${key} = $${paramIdx}`);
    values.push(value);
    paramIdx++;
  }

  if (setClauses.length === 0) return null;

  values.push(id, owner.userId || null, owner.deviceId || null);
  const idParam = paramIdx;
  const userParam = paramIdx + 1;
  const deviceParam = paramIdx + 2;

  return {
    text: `UPDATE dreamdis_dreams
           SET ${setClauses.join(", ")}
           WHERE id = $${idParam}
             AND ${ownershipSql(userParam, deviceParam)}
           RETURNING ${DREAM_COLUMNS}`,
    params: values,
  };
}

export async function updateDream(
  id: number,
  updates: Record<string, any>,
  owner: DreamOwner
): Promise<DreamRow | null> {
  const db = await getDb();
  const q = buildUpdateDream(id, updates, owner);
  if (!q) {
    // 没有可更新列时，仍需按归属返回记录，避免绕过归属校验
    return findDreamByIdForUser(id, owner.userId, owner.deviceId);
  }
  const rows = await db.unsafe(q.text, q.params);
  return (rows[0] as unknown as DreamRow) || null;
}

export function buildDeleteDream(id: number, owner: DreamOwner): SqlQuery {
  return {
    text: `DELETE FROM dreamdis_dreams
           WHERE id = $1
             AND ${ownershipSql(2, 3)}`,
    params: [id, owner.userId || null, owner.deviceId || null],
  };
}

export async function deleteDream(id: number, owner: DreamOwner): Promise<boolean> {
  const db = await getDb();
  const q = buildDeleteDream(id, owner);
  const result = await db.unsafe(q.text, q.params);
  return result.count > 0;
}

export async function insertTags(tags: Array<{ dream_id: number; tag: string; is_custom: boolean }>): Promise<void> {
  if (tags.length === 0) return;
  const db = await getDb();
  for (const t of tags) {
    await db`
      INSERT INTO dreamdis_dream_tags (dream_id, tag, is_custom)
      VALUES (${t.dream_id}, ${t.tag}, ${t.is_custom})
    `;
  }
}

export async function deleteTagsByDreamId(dreamId: number): Promise<void> {
  const db = await getDb();
  await db`DELETE FROM dreamdis_dream_tags WHERE dream_id = ${dreamId}`;
}

export async function findMessagesByDreamId(dreamId: number): Promise<MessageRow[]> {
  const db = await getDb();
  return db`
    SELECT id, dream_id, role, content, created_at
    FROM dreamdis_messages
    WHERE dream_id = ${dreamId}
    ORDER BY created_at ASC
  ` as unknown as Promise<MessageRow[]>;
}

export async function insertMessage(data: {
  dream_id: number;
  role: string;
  content: string;
}): Promise<void> {
  const db = await getDb();
  await db`
    INSERT INTO dreamdis_messages (dream_id, role, content)
    VALUES (${data.dream_id}, ${data.role}, ${data.content})
  `;
}

// ─── Auth: email codes ───

export async function insertAuthCode(email: string, code: string, expiresAt: Date): Promise<void> {
  const db = await getDb();
  await db`
    INSERT INTO dreamdis_auth_codes (email, code, expires_at)
    VALUES (${email}, ${code}, ${expiresAt})
  `;
}

export async function findValidAuthCode(email: string, code: string): Promise<{ id: number } | null> {
  const db = await getDb();
  const rows = await db`
    SELECT id FROM dreamdis_auth_codes
    WHERE email = ${email} AND code = ${code} AND expires_at > NOW()
    ORDER BY created_at DESC
    LIMIT 1
  `;
  return (rows[0] as unknown as { id: number }) || null;
}

export async function deleteAuthCode(id: number): Promise<void> {
  const db = await getDb();
  await db`DELETE FROM dreamdis_auth_codes WHERE id = ${id}`;
}

// ─── Auth: sessions ───

export interface SessionRow {
  id: number;
  token: string;
  user_id: string;
  email: string;
  expires_at: string;
  created_at: string;
}

export async function createSession(token: string, userId: string, email: string, expiresAt: Date): Promise<void> {
  const db = await getDb();
  await db`
    INSERT INTO dreamdis_sessions (token, user_id, email, expires_at)
    VALUES (${token}, ${userId}, ${email}, ${expiresAt})
  `;
}

export async function findSessionByToken(token: string): Promise<SessionRow | null> {
  const db = await getDb();
  const rows = await db`
    SELECT id, token, user_id, email, expires_at, created_at
    FROM dreamdis_sessions
    WHERE token = ${token}
    LIMIT 1
  `;
  return (rows[0] as unknown as SessionRow) || null;
}

export async function deleteSessionByToken(token: string): Promise<void> {
  const db = await getDb();
  await db`DELETE FROM dreamdis_sessions WHERE token = ${token}`;
}
