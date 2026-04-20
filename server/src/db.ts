import postgres from "postgres";

let sql: ReturnType<typeof postgres> | null = null;

export function getDb(): ReturnType<typeof postgres> {
  if (!sql) {
    const dbUrl = process.env.DATABASE_URL || process.env.PGDATABASE_URL;
    if (!dbUrl) {
      throw new Error("DATABASE_URL is not set");
    }
    sql = postgres(dbUrl, {
      ssl: dbUrl.includes("sslmode=require") ? "require" : undefined,
    });
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
  limit: number;
  cursor?: string;
  mood?: string;
}): Promise<DreamRow[]> {
  const db = getDb();

  if (opts.cursor) {
    if (opts.mood) {
      return db`
        SELECT id, device_id, content, audio_key, interpreter, interpretation, mood, created_at
        FROM dreamdis_dreams
        WHERE device_id = ${opts.deviceId} AND mood = ${opts.mood} AND created_at < ${opts.cursor}
        ORDER BY created_at DESC
        LIMIT ${opts.limit + 1}
      ` as unknown as Promise<DreamRow[]>;
    }
    return db`
      SELECT id, device_id, content, audio_key, interpreter, interpretation, mood, created_at
      FROM dreamdis_dreams
      WHERE device_id = ${opts.deviceId} AND created_at < ${opts.cursor}
      ORDER BY created_at DESC
      LIMIT ${opts.limit + 1}
    ` as unknown as Promise<DreamRow[]>;
  }

  if (opts.mood) {
    return db`
      SELECT id, device_id, content, audio_key, interpreter, interpretation, mood, created_at
      FROM dreamdis_dreams
      WHERE device_id = ${opts.deviceId} AND mood = ${opts.mood}
      ORDER BY created_at DESC
      LIMIT ${opts.limit + 1}
    ` as unknown as Promise<DreamRow[]>;
  }

  return db`
    SELECT id, device_id, content, audio_key, interpreter, interpretation, mood, created_at
    FROM dreamdis_dreams
    WHERE device_id = ${opts.deviceId}
    ORDER BY created_at DESC
    LIMIT ${opts.limit + 1}
  ` as unknown as Promise<DreamRow[]>;
}

export async function findDreamsByTag(dreamIds: number[], tag: string): Promise<number[]> {
  if (dreamIds.length === 0) return [];
  const db = getDb();
  const rows = await db`
    SELECT dream_id FROM dreamdis_dream_tags
    WHERE dream_id = ANY(${dreamIds}) AND tag = ${tag}
  `;
  return rows.map((r: any) => r.dream_id);
}

export async function findTagsByDreamIds(dreamIds: number[]): Promise<DreamTagRow[]> {
  if (dreamIds.length === 0) return [];
  const db = getDb();
  return db`
    SELECT id, dream_id, tag, is_custom
    FROM dreamdis_dream_tags
    WHERE dream_id = ANY(${dreamIds})
  ` as unknown as Promise<DreamTagRow[]>;
}

export async function insertDream(data: {
  device_id: string;
  content: string;
  interpreter?: string | null;
  audio_key?: string | null;
  mood?: string | null;
}): Promise<DreamRow> {
  const db = getDb();
  const rows = await db`
    INSERT INTO dreamdis_dreams (device_id, content, interpreter, audio_key, mood)
    VALUES (${data.device_id}, ${data.content}, ${data.interpreter || null}, ${data.audio_key || null}, ${data.mood || null})
    RETURNING id, device_id, content, audio_key, interpreter, interpretation, mood, created_at
  `;
  return rows[0] as unknown as DreamRow;
}

export async function findDreamById(id: number): Promise<DreamRow | null> {
  const db = getDb();
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
  const db = getDb();
  const rows = await db`
    SELECT id, device_id, content, audio_key, interpreter, interpretation, mood, created_at
    FROM dreamdis_dreams
    WHERE device_id = ${opts.deviceId} AND content = ${opts.content} AND interpreter = ${opts.interpreter}
    ORDER BY created_at DESC LIMIT 1
  `;
  return (rows[0] as unknown as DreamRow) || null;
}

export async function updateDream(id: number, updates: Record<string, any>): Promise<DreamRow | null> {
  const db = getDb();
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
  const db = getDb();
  const result = await db`DELETE FROM dreamdis_dreams WHERE id = ${id}`;
  return result.count > 0;
}

export async function insertTags(tags: Array<{ dream_id: number; tag: string; is_custom: boolean }>): Promise<void> {
  if (tags.length === 0) return;
  const db = getDb();
  for (const t of tags) {
    await db`
      INSERT INTO dreamdis_dream_tags (dream_id, tag, is_custom)
      VALUES (${t.dream_id}, ${t.tag}, ${t.is_custom})
    `;
  }
}

export async function deleteTagsByDreamId(dreamId: number): Promise<void> {
  const db = getDb();
  await db`DELETE FROM dreamdis_dream_tags WHERE dream_id = ${dreamId}`;
}

export async function findMessagesByDreamId(dreamId: number): Promise<MessageRow[]> {
  const db = getDb();
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
  const db = getDb();
  await db`
    INSERT INTO dreamdis_messages (dream_id, role, content)
    VALUES (${data.dream_id}, ${data.role}, ${data.content})
  `;
}
