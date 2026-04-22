/**
 * Supabase Admin Client
 * 用于后端验证 JWT token、操作用户数据
 * 使用 Service Role Key，拥有最高权限
 */
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.SUPABASE_URL || "";
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.warn("[supabase] SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY not set. Auth features will be disabled.");
}

export const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: {
    autoRefreshToken: false,
    persistSession: false,
  },
});

/**
 * 验证 JWT token，返回用户信息
 */
export async function verifyAuthToken(token: string): Promise<{ userId: string; email?: string } | null> {
  try {
    const { data, error } = await supabaseAdmin.auth.getUser(token);
    if (error || !data.user) return null;
    return { userId: data.user.id, email: data.user.email };
  } catch {
    return null;
  }
}
