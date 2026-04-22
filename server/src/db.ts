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
        SELECT id, device_id, content, audio_key, interpreter, interpretation, mood, created_at
        FROM dreamdis_dreams
        WHERE ${idColumn} = $1 AND mood = $2 AND created_at < $3
        ORDER BY created_at DESC
        LIMIT $4
      `, [idValue, opts.mood, opts.cursor, opts.limit + 1]) as unknown as Promise<DreamRow[]>;
    }
    return db.unsafe(`
      SELECT id, device_id, content, audio_key, interpreter, interpretation, mood, created_at
      FROM dreamdis_dreams
      WHERE ${idColumn} = $1 AND created_at < $2
      ORDER BY created_at DESC
      LIMIT $3
    `, [idValue, opts.cursor, opts.limit + 1]) as unknown as Promise<DreamRow[]>;
  }

  if (opts.mood) {
    return db.unsafe(`
      SELECT id, device_id, content, audio_key, interpreter, interpretation, mood, created_at
      FROM dreamdis_dreams
      WHERE ${idColumn} = $1 AND mood = $2
      ORDER BY created_at DESC
      LIMIT $3
    `, [idValue, opts.mood, opts.limit + 1]) as unknown as Promise<DreamRow[]>;
  }

  return db.unsafe(`
    SELECT id, device_id, content, audio_key, interpreter, interpretation, mood, created_at
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
      d.id, d.device_id, d.content, d.audio_key, d.interpreter, d.interpretation, d.mood, d.created_at,
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
    RETURNING id, device_id, content, audio_key, interpreter, interpretation, mood, created_at
  `;
  return rows[0] as unknown as DreamRow;
}

export async function findDreamById(id: number): Promise<DreamRow | null> {
  const db = await getDb();
  const rows = await db`
    SELECT id, device_id, content, audio_key, interpreter, interpretation, mood, created_at
    FROM dreamdis_dreams WHERE id = ${id}
  `;
  return (rows[0] as unknown as DreamRow) || null;
}

export async function findDreamByContent(opts: {
  deviceId: string;
  content: string;
  interpreter: string;
}): Promise<DreamRow | null> {
  const db = await getDb();
  const rows = await db`
    SELECT id, device_id, content, audio_key, interpreter, interpretation, mood, created_at
    FROM dreamdis_dreams
    WHERE device_id = ${opts.deviceId} AND content = ${opts.content} AND interpreter = ${opts.interpreter}
    ORDER BY created_at DESC LIMIT 1
  `;
  return (rows[0] as unknown as DreamRow) || null;
}

export async function updateDream(id: number, updates: Record<string, any>): Promise<DreamRow | null> {
  const db = await getDb();
  const setClauses: string[] = [];
  const values: any[] = [];
  let paramIdx = 1;

  for (const [key, value] of Object.entries(updates)) {
    setClauses.push(`${key} = $${paramIdx}`);
    values.push(value);
    paramIdx++;
  }

  if (setClauses.length === 0) return findDreamById(id);

  values.push(id);
  const query = `UPDATE dreamdis_dreams SET ${setClauses.join(', ')} WHERE id = $${paramIdx} RETURNING id, device_id, content, audio_key, interpreter, interpretation, mood, created_at`;
  const rows = await db.unsafe(query, values);
  return (rows[0] as unknown as DreamRow) || null;
}

export async function deleteDream(id: number): Promise<boolean> {
  const db = await getDb();
  const result = await db`DELETE FROM dreamdis_dreams WHERE id = ${id}`;
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
