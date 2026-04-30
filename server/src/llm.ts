/**
 * LLM Client - 纯 OpenAI 兼容 API
 * 
 * 配置优先级：
 * 1. LLM_API_KEY → 使用通用 OpenAI 兼容 API
 * 2. DEEPSEEK_API_KEY → 使用 DeepSeek API（向后兼容）
 */
import OpenAI from "openai";
import type { LLMMessage } from "./llm-types.js";

// 通用 LLM 配置（优先级最高）
const LLM_API_KEY = process.env.LLM_API_KEY || "";
const LLM_BASE_URL = process.env.LLM_BASE_URL || "https://api.deepseek.com";
const LLM_MODEL = process.env.LLM_MODEL || "deepseek-chat";

// DeepSeek 向后兼容
const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY || "";
const DEEPSEEK_BASE_URL = process.env.DEEPSEEK_BASE_URL || "https://api.deepseek.com";

console.log(`[llm] Provider: openai-compatible, Model: ${LLM_MODEL}`);

export interface LLMStreamChunk {
  content: string | null;
}

// OpenAI 兼容客户端（懒初始化）
let openaiClient: OpenAI | null = null;

function getOpenAIClient(): OpenAI {
  if (!openaiClient) {
    const apiKey = LLM_API_KEY || DEEPSEEK_API_KEY;
    const baseURL = LLM_API_KEY ? LLM_BASE_URL : DEEPSEEK_BASE_URL;
    if (!apiKey) {
      throw new Error("未配置 LLM API Key，请设置 LLM_API_KEY 或 DEEPSEEK_API_KEY 环境变量");
    }
    console.log(`[llm] OpenAI client baseURL: ${baseURL}, model: ${LLM_MODEL}`);
    openaiClient = new OpenAI({ apiKey, baseURL, timeout: 120_000, maxRetries: 1 });
  }
  return openaiClient;
}

/**
 * Stream chat completion
 */
export async function* streamChat(
  messages: LLMMessage[],
  options?: { model?: string; temperature?: number }
): AsyncGenerator<LLMStreamChunk> {
  const client = getOpenAIClient();
  const model = options?.model || LLM_MODEL;
  const temperature = options?.temperature ?? 0.55;

  const stream = await client.chat.completions.create({
    model,
    messages,
    temperature,
    stream: true,
  });

  for await (const chunk of stream) {
    const content = chunk.choices[0]?.delta?.content || null;
    if (content !== null) {
      yield { content };
    }
  }
}
