/**
 * LLM Client - 支持 OpenAI 兼容 API
 * 
 * 优先级：
 * 1. LLM_API_KEY 设置 → 使用通用 OpenAI 兼容 API（推荐，可指向任意模型）
 * 2. DEEPSEEK_API_KEY 设置 → 使用 DeepSeek API（向后兼容）
 * 3. 都未设置 → 回退到 coze-coding-dev-sdk（沙箱环境）
 */
import OpenAI from "openai";
import { LLMClient, Config, HeaderUtils } from "coze-coding-dev-sdk";
import type { LLMMessage } from "./llm-types.js";

// 通用 LLM 配置（优先级最高）
const LLM_API_KEY = process.env.LLM_API_KEY || "";
const LLM_BASE_URL = process.env.LLM_BASE_URL || "https://api.deepseek.com";
const LLM_MODEL = process.env.LLM_MODEL || "deepseek-chat";

// DeepSeek 向后兼容
const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY || "";
const DEEPSEEK_BASE_URL = process.env.DEEPSEEK_BASE_URL || "https://api.deepseek.com";

// 决定使用哪个 provider
const LLM_PROVIDER = process.env.LLM_PROVIDER || (
  LLM_API_KEY ? "openai" : (DEEPSEEK_API_KEY ? "deepseek" : "coze")
);

console.log(`[llm] Provider: ${LLM_PROVIDER}, Model: ${LLM_PROVIDER === "coze" ? (process.env.COZE_LLM_MODEL || "deepseek-v3-2-251201") : LLM_MODEL}`);

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
    openaiClient = new OpenAI({ apiKey, baseURL });
  }
  return openaiClient;
}

/**
 * Stream chat completion
 */
export async function* streamChat(
  messages: LLMMessage[],
  options?: { model?: string; temperature?: number },
  cozeHeaders?: Record<string, string>
): AsyncGenerator<LLMStreamChunk> {
  if (LLM_PROVIDER === "coze") {
    // ─── Coze SDK 模式（沙箱环境） ───
    const config = new Config();
    const customHeaders = cozeHeaders
      ? HeaderUtils.extractForwardHeaders(cozeHeaders)
      : undefined;
    const client = new LLMClient(config, customHeaders);
    const model = options?.model || process.env.COZE_LLM_MODEL || "deepseek-v3-2-251201";
    const stream = client.stream(messages, { model });

    for await (const chunk of stream) {
      if (chunk.content) {
        yield { content: chunk.content.toString() };
      }
    }
  } else {
    // ─── OpenAI 兼容 API 模式（DeepSeek / 任意兼容 API） ───
    const client = getOpenAIClient();
    const model = options?.model || LLM_MODEL;
    const temperature = options?.temperature ?? 0.85;

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
}
