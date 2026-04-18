/**
 * DeepSeek LLM Client - OpenAI compatible API
 * Replaces coze-coding-dev-sdk LLMClient
 * 
 * Supports two modes:
 * 1. DEEPSEEK_API_KEY is set → use DeepSeek API directly
 * 2. DEEPSEEK_API_KEY is not set → fall back to coze-coding-dev-sdk (sandbox)
 */
import OpenAI from "openai";
import { LLMClient, Config, HeaderUtils } from "coze-coding-dev-sdk";
import type { LLMMessage } from "./llm-types.js";

const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY;
const DEEPSEEK_BASE_URL = process.env.DEEPSEEK_BASE_URL || "https://api.deepseek.com";

export interface LLMStreamChunk {
  content: string | null;
}

// DeepSeek client (only instantiated when DEEPSEEK_API_KEY is set)
let deepseekClient: OpenAI | null = null;

function getDeepseekClient(): OpenAI {
  if (!deepseekClient) {
    deepseekClient = new OpenAI({
      apiKey: DEEPSEEK_API_KEY,
      baseURL: DEEPSEEK_BASE_URL,
    });
  }
  return deepseekClient;
}

/**
 * Stream chat completion
 * Uses DeepSeek API when DEEPSEEK_API_KEY is set, otherwise falls back to coze SDK
 * 
 * @param messages - Chat messages
 * @param options - Model options
 * @param cozeHeaders - Optional forwarded headers for coze SDK fallback (from HTTP request)
 */
export async function* streamChat(
  messages: LLMMessage[],
  options?: { model?: string; temperature?: number },
  cozeHeaders?: Record<string, string>
): AsyncGenerator<LLMStreamChunk> {
  if (DEEPSEEK_API_KEY) {
    // ─── DeepSeek API mode ───
    const client = getDeepseekClient();
    const model = options?.model || process.env.LLM_MODEL || "deepseek-chat";
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
  } else {
    // ─── Coze SDK fallback (sandbox) ───
    const config = new Config();
    const customHeaders = cozeHeaders
      ? HeaderUtils.extractForwardHeaders(cozeHeaders)
      : undefined;
    const client = new LLMClient(config, customHeaders);
    // Coze SDK uses different model names than DeepSeek API
    const model = options?.model || process.env.COZE_LLM_MODEL || "deepseek-v3-2-251201";
    const stream = client.stream(messages, { model });

    for await (const chunk of stream) {
      if (chunk.content) {
        yield { content: chunk.content.toString() };
      }
    }
  }
}
