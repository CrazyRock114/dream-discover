import { createFormDataFile } from '@/utils';

/**
 * API 服务 - 梦境录后端接口调用
 */

const BASE_URL = process.env.EXPO_PUBLIC_BACKEND_BASE_URL;

export interface Dream {
  id: number;
  content: string;
  audio_key: string | null;
  interpreter: string | null;
  interpretation: string | null;
  created_at: string;
}

export interface Interpreter {
  id: string;
  name: string;
  name_en: string;
  avatar: string;
  title: string;
  tagline: string;
  description: string;
}

export interface Message {
  id: number;
  dream_id: number;
  role: 'user' | 'assistant';
  content: string;
  created_at: string;
}

/**
 * 服务端文件：server/src/index.ts
 * 接口：GET /api/v1/dreams
 * Query 参数：limit?: number, cursor?: string
 */
export async function fetchDreams(limit = 20, cursor?: string): Promise<{ data: Dream[]; nextCursor: string | null }> {
  const params = new URLSearchParams({ limit: String(limit) });
  if (cursor) params.set('cursor', cursor);
  const res = await fetch(`${BASE_URL}/api/v1/dreams?${params}`);
  if (!res.ok) throw new Error('获取梦境列表失败');
  return res.json();
}

/**
 * 服务端文件：server/src/index.ts
 * 接口：POST /api/v1/dreams
 * Body 参数：content: string, interpreter?: string, audio_key?: string
 */
export async function createDream(data: { content: string; interpreter?: string; audio_key?: string }): Promise<Dream> {
  const res = await fetch(`${BASE_URL}/api/v1/dreams`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error('创建梦境失败');
  return res.json();
}

/**
 * 服务端文件：server/src/index.ts
 * 接口：GET /api/v1/dreams/:id
 * Path 参数：id: number
 */
export async function fetchDream(id: number): Promise<Dream> {
  const res = await fetch(`${BASE_URL}/api/v1/dreams/${id}`);
  if (!res.ok) throw new Error('获取梦境详情失败');
  return res.json();
}

/**
 * 服务端文件：server/src/index.ts
 * 接口：DELETE /api/v1/dreams/:id
 * Path 参数：id: number
 */
export async function deleteDream(id: number): Promise<void> {
  const res = await fetch(`${BASE_URL}/api/v1/dreams/${id}`, { method: 'DELETE' });
  if (!res.ok) throw new Error('删除梦境失败');
}

/**
 * 服务端文件：server/src/index.ts
 * 接口：GET /api/v1/interpreters
 */
export async function fetchInterpreters(): Promise<Interpreter[]> {
  const res = await fetch(`${BASE_URL}/api/v1/interpreters`);
  if (!res.ok) throw new Error('获取解梦师列表失败');
  return res.json();
}

/**
 * 服务端文件：server/src/index.ts
 * 接口：GET /api/v1/dreams/:id/messages
 * Path 参数：id: number
 */
export async function fetchMessages(dreamId: number): Promise<Message[]> {
  const res = await fetch(`${BASE_URL}/api/v1/dreams/${dreamId}/messages`);
  if (!res.ok) throw new Error('获取消息记录失败');
  return res.json();
}

/**
 * 服务端文件：server/src/index.ts
 * 接口：POST /api/v1/upload/audio
 * FormData: file: audio blob
 */
export async function uploadAudio(fileUri: string, mimeType: string): Promise<{ key: string; url: string }> {
  const formData = new FormData();
  const filename = fileUri.split('/').pop() || 'recording.m4a';
  const file = await createFormDataFile(fileUri, filename, mimeType);
  formData.append('file', file as any);

  const res = await fetch(`${BASE_URL}/api/v1/upload/audio`, {
    method: 'POST',
    body: formData,
  });
  if (!res.ok) throw new Error('上传音频失败');
  return res.json();
}

/**
 * 服务端文件：server/src/index.ts
 * 接口：POST /api/v1/asr
 * Body 参数：audio_key: string
 */
export async function transcribeAudio(audio_key: string): Promise<{ text: string }> {
  const res = await fetch(`${BASE_URL}/api/v1/asr`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ audio_key }),
  });
  if (!res.ok) throw new Error('语音转文字失败');
  return res.json();
}
