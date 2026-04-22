/**
 * Auth Middleware - Session Token 验证
 * 从 Authorization header 中提取 token，查 sessions 表验证
 */
import type { Request, Response, NextFunction } from "express";
import * as db from "./db.js";

// 扩展 Express Request 类型
declare global {
  namespace Express {
    interface Request {
      userId?: string;
      userEmail?: string;
    }
  }
}

/**
 * 可选认证中间件
 * 有 token 就验证，没有也不报错（支持匿名用户）
 */
export async function optionalAuth(req: Request, _res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization;
  if (authHeader?.startsWith("Bearer ")) {
    const token = authHeader.slice(7);
    const session = await db.findSessionByToken(token);
    if (session && new Date(session.expires_at) > new Date()) {
      req.userId = session.user_id;
      req.userEmail = session.email;
    }
  }
  next();
}

/**
 * 必需认证中间件
 * 没有有效 token 返回 401
 */
export async function requireAuth(req: Request, res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith("Bearer ")) {
    res.status(401).json({ error: "请先登录" });
    return;
  }
  const token = authHeader.slice(7);
  const session = await db.findSessionByToken(token);
  if (!session || new Date(session.expires_at) <= new Date()) {
    res.status(401).json({ error: "登录已过期，请重新登录" });
    return;
  }
  req.userId = session.user_id;
  req.userEmail = session.email;
  next();
}
