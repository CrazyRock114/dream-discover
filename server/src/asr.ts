/**
 * ASR (Automatic Speech Recognition) Client
 * 
 * 支持两种模式：
 * 1. ASR_API_KEY 设置 → 使用 OpenAI 兼容 Whisper API
 * 2. ASR_API_KEY 未设置 → 回退到 coze-coding-dev-sdk ASRClient（沙箱环境）
 * 
 * 支持两种输入方式：
 * - audio_key/audio_url：从存储读取音频文件
 * - audioBuffer：直接传入音频 Buffer（无需存储，推荐用于外部部署）
 */
import OpenAI from "openai";
import { ASRClient, Config, HeaderUtils } from "coze-coding-dev-sdk";
import { readFile as readFromStorage, generatePresignedUrl } from "./r2-storage.js";

const ASR_API_KEY = process.env.ASR_API_KEY || "";
const ASR_BASE_URL = process.env.ASR_BASE_URL || "https://api.groq.com/openai/v1";
const ASR_MODEL = process.env.ASR_MODEL || "whisper-large-v3";

const useExternalASR = !!ASR_API_KEY;

console.log(`[asr] Provider: ${useExternalASR ? `external (${ASR_BASE_URL}, model: ${ASR_MODEL})` : "coze-sdk"}`);

// External ASR client (lazy init)
let asrClient: OpenAI | null = null;
function getASRClient(): OpenAI {
  if (!asrClient) {
    asrClient = new OpenAI({
      apiKey: ASR_API_KEY,
      baseURL: ASR_BASE_URL,
    });
  }
  return asrClient;
}

export interface ASRResult {
  text: string;
}

/**
 * 直接从音频 Buffer 转录（无需 R2 存储）
 * 推荐用于外部部署环境
 */
export async function transcribeBuffer(audioBuffer: Buffer, fileName: string = "audio.m4a", mimeType: string = "audio/m4a"): Promise<ASRResult> {
  if (!useExternalASR) {
    throw new Error("直接转录需要设置 ASR_API_KEY 环境变量。请在 Railway 中配置 ASR_API_KEY（推荐使用 Groq 免费 Whisper API）");
  }

  const uint8Array = new Uint8Array(audioBuffer);
  const file = new File([uint8Array], fileName, { type: mimeType });

  try {
    const transcription = await getASRClient().audio.transcriptions.create({
      model: ASR_MODEL,
      file,
      language: "zh",
      response_format: "text",
    });

    const text = typeof transcription === "string"
      ? transcription
      : (transcription as any).text || "";

    return { text };
  } catch (error: any) {
    console.error("[asr] Transcription error:", error.message);
    throw new Error(`语音识别失败: ${error.message}`);
  }
}

/**
 * 从存储中的音频文件转录
 * @param params - 音频源参数
 * @param cozeHeaders - 可选的 Coze SDK 请求头
 */
export async function recognize(params: {
  audio_key?: string;
  audio_url?: string;
  uid?: string;
}, cozeHeaders?: Record<string, string>): Promise<ASRResult> {
  if (useExternalASR) {
    // ─── External ASR ───
    let audioBuffer: Buffer;
    let fileName = "audio.m4a";

    if (params.audio_key) {
      audioBuffer = await readFromStorage({ key: params.audio_key });
    } else if (params.audio_url) {
      const response = await fetch(params.audio_url);
      const arrayBuffer = await response.arrayBuffer();
      audioBuffer = Buffer.from(arrayBuffer);
      const urlPath = new URL(params.audio_url).pathname;
      const lastSegment = urlPath.split("/").pop();
      if (lastSegment) fileName = lastSegment;
    } else {
      throw new Error("必须提供 audio_key 或 audio_url");
    }

    return transcribeBuffer(audioBuffer, fileName);
  } else {
    // ─── Coze SDK fallback (sandbox) ───
    const customHeaders = cozeHeaders
      ? HeaderUtils.extractForwardHeaders(cozeHeaders)
      : undefined;
    const cozeASR = new ASRClient(new Config(), customHeaders);
    
    if (!params.audio_key && !params.audio_url) {
      throw new Error("必须提供 audio_key 或 audio_url");
    }

    const audioUrl = params.audio_url || await generatePresignedUrl({
      key: params.audio_key!,
      expireTime: 3600,
    });

    const result = await cozeASR.recognize({
      uid: params.uid || "dream-app",
      url: audioUrl,
    });

    return { text: result.text };
  }
}
