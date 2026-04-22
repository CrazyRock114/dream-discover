import { createFormDataFile } from '@/utils';
import { getDeviceId } from '@/hooks/useDeviceId';
import { supabase } from './supabase';

/**
 * API 服务 - 梦境录后端接口调用
 */

export const BASE_URL = process.env.EXPO_PUBLIC_BACKEND_BASE_URL || '';

export interface DreamTag {
  id: number;
  tag: string;
  is_custom: boolean;
}

export interface Dream {
  id: number;
  device_id: string;
  content: string;
  audio_key: string | null;
  interpreter: string | null;
  interpretation: string | null;
  mood: string | null;
  created_at: string;
  tags?: DreamTag[];
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
 * 获取带 device_id 的 headers
 */
async function getHeaders(): Promise<Record<string, string>> {
  const deviceId = await getDeviceId();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'x-device-id': deviceId,
  };

  // Add auth token if user is logged in
  try {
    const session = await supabase.auth.getSession();
    const token = session.data.session?.access_token;
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }
  } catch {
    // ignore auth errors
  }

  return headers;
}

/**
 * 服务端文件：server/src/index.ts
 * 接口：GET /api/v1/dreams
 * Query 参数：limit?: number, cursor?: string, mood?: string, tag?: string
 * Header: x-device-id: string
 */
export async function fetchDreams(limit = 20, cursor?: string, mood?: string, tag?: string): Promise<{ data: Dream[]; nextCursor: string | null }> {
  const params = new URLSearchParams({ limit: String(limit) });
  if (cursor) params.set('cursor', cursor);
  if (mood) params.set('mood', mood);
  if (tag) params.set('tag', tag);
  const headers = await getHeaders();
  const res = await fetch(`${BASE_URL}/api/v1/dreams?${params}`, { headers });
  if (!res.ok) throw new Error('获取梦境列表失败');
  return res.json();
}

/**
 * 服务端文件：server/src/index.ts
 * 接口：POST /api/v1/dreams
 * Body 参数：content: string, interpreter?: string, audio_key?: string, mood?: string, tags?: string[]
 * Header: x-device-id: string
 */
export async function createDream(data: {
  content: string;
  interpreter?: string;
  audio_key?: string;
  mood?: string;
  tags?: string[];
}): Promise<Dream> {
  const deviceId = await getDeviceId();
  const headers = await getHeaders();
  const res = await fetch(`${BASE_URL}/api/v1/dreams`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ ...data, device_id: deviceId }),
  });
  if (!res.ok) {
    const errBody = await res.json().catch(() => ({}));
    throw new Error(errBody.error || '创建梦境失败');
  }
  return res.json();
}

/**
 * 服务端文件：server/src/index.ts
 * 接口：GET /api/v1/dreams/:id
 * Path 参数：id: number
 */
export async function fetchDream(id: number): Promise<Dream> {
  const headers = await getHeaders();
  const res = await fetch(`${BASE_URL}/api/v1/dreams/${id}`, { headers });
  if (!res.ok) throw new Error('获取梦境详情失败');
  return res.json();
}

/**
 * 服务端文件：server/src/index.ts
 * 接口：PATCH /api/v1/dreams/:id
 * Body 参数：interpreter?: string, interpretation?: string, mood?: string, tags?: string[]
 */
export async function updateDream(id: number, data: {
  interpreter?: string;
  interpretation?: string;
  mood?: string;
  tags?: string[];
}): Promise<Dream> {
  const headers = await getHeaders();
  const res = await fetch(`${BASE_URL}/api/v1/dreams/${id}`, {
    method: 'PATCH',
    headers,
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error('更新梦境失败');
  return res.json();
}

/**
 * 服务端文件：server/src/index.ts
 * 接口：DELETE /api/v1/dreams/:id
 * Path 参数：id: number
 */
export async function deleteDream(id: number): Promise<void> {
  const headers = await getHeaders();
  const res = await fetch(`${BASE_URL}/api/v1/dreams/${id}`, { method: 'DELETE', headers });
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
  const headers = await getHeaders();
  const res = await fetch(`${BASE_URL}/api/v1/dreams/${dreamId}/messages`, { headers });
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

  const headers = await getHeaders();
  delete headers['Content-Type']; // Let FormData set its own Content-Type

  const res = await fetch(`${BASE_URL}/api/v1/upload/audio`, {
    method: 'POST',
    headers,
    body: formData,
  });
  if (!res.ok) throw new Error('上传音频失败');
  return res.json();
}

/**
 * 服务端文件：server/src/index.ts
 * 接口：POST /api/v1/asr/transcribe
 * FormData: file: audio blob
 * 直接转录音频，无需先上传到 R2 存储
 */
export async function transcribeAudioDirect(fileUri: string, mimeType: string): Promise<{ text: string }> {
  const formData = new FormData();
  const filename = fileUri.split('/').pop() || 'recording.m4a';
  const file = await createFormDataFile(fileUri, filename, mimeType);
  formData.append('file', file as any);

  const headers = await getHeaders();
  delete headers['Content-Type']; // Let FormData set its own Content-Type

  const res = await fetch(`${BASE_URL}/api/v1/asr/transcribe`, {
    method: 'POST',
    headers,
    body: formData,
    // ASR 转写可能需要较长时间，设置 90 秒超时
    signal: AbortSignal.timeout(90_000),
  });
  if (!res.ok) {
    const errBody = await res.json().catch(() => ({}));
    throw new Error(errBody.error || '语音转文字失败');
  }
  return res.json();
}

/**
 * 服务端文件：server/src/index.ts
 * 接口：POST /api/v1/asr
 * Body 参数：audio_key: string
 * @deprecated 使用 transcribeAudioDirect 代替，无需先上传到 R2
 */
export async function transcribeAudio(audio_key: string): Promise<{ text: string }> {
  const headers = await getHeaders();
  const res = await fetch(`${BASE_URL}/api/v1/asr`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ audio_key }),
  });
  if (!res.ok) {
    const errBody = await res.json().catch(() => ({}));
    throw new Error(errBody.error || '语音转文字失败');
  }
  return res.json();
}

/**
 * 服务端文件：server/src/index.ts
 * 接口：GET /api/v1/dreams/find
 * Query 参数：content: string (exact match), interpreter: string
 * Header: x-device-id: string
 * 返回：已有的 Dream 记录或 null
 */
export async function findDream(content: string, interpreter: string): Promise<Dream | null> {
  const headers = await getHeaders();
  const params = new URLSearchParams({
    content: content.trim(),
    interpreter,
  });
  const res = await fetch(`${BASE_URL}/api/v1/dreams/find?${params}`, { headers });
  if (!res.ok) {
    const errBody = await res.json().catch(() => ({}));
    throw new Error(errBody.error || '查找梦境失败');
  }
  const data = await res.json();
  return data; // null or Dream object
}
