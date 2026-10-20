/**
 * 极简内存限流器
 *
 * 单实例部署（Railway）足够用，不引入 Redis 等外部依赖。
 * 计数存在进程内存里，重启后清零 —— 对防滥用够用，对精确计费不够用。
 */

export interface RateLimitResult {
  allowed: boolean;
  /** 距离允许再次尝试还有多少秒 */
  retryAfterSeconds: number;
}

export interface RateLimiter {
  /** 检查是否已超限（不计数） */
  peek(key: string, now?: number): RateLimitResult;
  /** 记一次命中 */
  hit(key: string, now?: number): void;
  /** 清空计数（成功时调用） */
  reset(key: string): void;
}

/** 桶数量超过此阈值时清理过期条目，避免长期运行时内存无限增长 */
const PRUNE_THRESHOLD = 1000;

export function createRateLimiter(windowMs: number, max: number): RateLimiter {
  const buckets = new Map<string, number[]>();

  function prune(now: number) {
    for (const [key, hits] of buckets) {
      const kept = hits.filter((t) => now - t < windowMs);
      if (kept.length === 0) {
        buckets.delete(key);
      } else {
        buckets.set(key, kept);
      }
    }
  }

  function liveHits(key: string, now: number): number[] {
    const hits = (buckets.get(key) ?? []).filter((t) => now - t < windowMs);
    if (hits.length > 0) {
      buckets.set(key, hits);
    } else {
      buckets.delete(key);
    }
    return hits;
  }

  return {
    peek(key: string, now = Date.now()): RateLimitResult {
      if (buckets.size > PRUNE_THRESHOLD) prune(now);
      const hits = liveHits(key, now);
      if (hits.length >= max) {
        const oldest = hits[0];
        return {
          allowed: false,
          retryAfterSeconds: Math.max(1, Math.ceil((oldest + windowMs - now) / 1000)),
        };
      }
      return { allowed: true, retryAfterSeconds: 0 };
    },

    hit(key: string, now = Date.now()): void {
      const hits = liveHits(key, now);
      hits.push(now);
      buckets.set(key, hits);
    },

    reset(key: string): void {
      buckets.delete(key);
    },
  };
}

/** 取用于限流的客户端 IP（Railway 会注入 x-forwarded-for） */
export function clientIp(req: { ip?: string; headers: Record<string, unknown> }): string {
  const forwarded = req.headers["x-forwarded-for"];
  if (typeof forwarded === "string" && forwarded.length > 0) {
    return forwarded.split(",")[0].trim();
  }
  return req.ip || "unknown";
}
