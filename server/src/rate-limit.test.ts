import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { createRateLimiter, clientIp } from "./rate-limit.js";

describe("createRateLimiter", () => {
  test("未超限时放行", () => {
    const limiter = createRateLimiter(1000, 3);
    assert.equal(limiter.peek("k").allowed, true);
  });

  test("达到上限后拒绝，并给出剩余秒数", () => {
    const limiter = createRateLimiter(10_000, 2);
    limiter.hit("k");
    limiter.hit("k");
    const result = limiter.peek("k");
    assert.equal(result.allowed, false);
    assert.ok(result.retryAfterSeconds > 0 && result.retryAfterSeconds <= 10);
  });

  test("peek 不计数，hit 才计数", () => {
    const limiter = createRateLimiter(10_000, 1);
    limiter.peek("k");
    limiter.peek("k");
    assert.equal(limiter.peek("k").allowed, true);
    limiter.hit("k");
    assert.equal(limiter.peek("k").allowed, false);
  });

  test("不同 key 互不影响", () => {
    const limiter = createRateLimiter(10_000, 1);
    limiter.hit("a");
    assert.equal(limiter.peek("a").allowed, false);
    assert.equal(limiter.peek("b").allowed, true);
  });

  test("reset 清空计数", () => {
    const limiter = createRateLimiter(10_000, 1);
    limiter.hit("k");
    assert.equal(limiter.peek("k").allowed, false);
    limiter.reset("k");
    assert.equal(limiter.peek("k").allowed, true);
  });

  test("窗口过期后自动恢复", () => {
    const limiter = createRateLimiter(1000, 1);
    const t0 = 1_000_000;
    limiter.hit("k", t0);
    assert.equal(limiter.peek("k", t0).allowed, false);
    // 窗口内仍被拒
    assert.equal(limiter.peek("k", t0 + 500).allowed, false);
    // 窗口外恢复
    assert.equal(limiter.peek("k", t0 + 1500).allowed, true);
  });

  test("滑动窗口只统计窗口内的命中", () => {
    const limiter = createRateLimiter(1000, 2);
    const t0 = 2_000_000;
    limiter.hit("k", t0);
    limiter.hit("k", t0 + 900);
    assert.equal(limiter.peek("k", t0 + 950).allowed, false);
    // 第一次命中滑出窗口，只剩一次
    assert.equal(limiter.peek("k", t0 + 1100).allowed, true);
  });
});

describe("clientIp", () => {
  test("优先用 Express 算好的 req.ip", () => {
    assert.equal(
      clientIp({ ip: "1.2.3.4", headers: { "x-forwarded-for": "9.9.9.9, 1.2.3.4" } }),
      "1.2.3.4"
    );
  });

  test("兜底解析 x-forwarded-for 时取最右一项", () => {
    // 最左是客户端可以自己塞的，取最左等于让攻击者自选 IP 绕过限流
    assert.equal(
      clientIp({ headers: { "x-forwarded-for": "6.6.6.6, 5.5.5.5" } }),
      "5.5.5.5"
    );
  });

  test("单条 x-forwarded-for 原样返回", () => {
    assert.equal(clientIp({ headers: { "x-forwarded-for": "7.7.7.7" } }), "7.7.7.7");
  });

  test("没有任何线索时返回 unknown", () => {
    assert.equal(clientIp({ headers: {} }), "unknown");
  });
});
