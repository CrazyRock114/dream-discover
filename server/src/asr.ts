/**
 * ASR (Automatic Speech Recognition) Client
 * Supports two modes:
 * 1. ASR_API_KEY is set → use OpenAI-compatible Whisper API
 * 2. ASR_API_KEY is not set → fall back to coze-coding-dev-sdk ASRClient (sandbox)
 */
import OpenAI from "openai";
import { ASRClient, Config, HeaderUtils } from "coze-coding-dev-sdk";
import { readFile as readFromStorage, generatePresignedUrl } from "./r2-storage.js";

const ASR_API_KEY = process.env.ASR_API_KEY || process.env.DEEPSEEK_API_KEY || "";
const ASR_BASE_URL = process.env.ASR_BASE_URL || "https://api.openai.com/v1";
const ASR_MODEL = process.env.ASR_MODEL || "whisper-1";

const useExternalASR = !!ASR_API_KEY;

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
 * Recognize speech from an audio file stored in R2
 * @param params - Audio source parameters
 * @param cozeHeaders - Optional forwarded headers for coze SDK fallback
 */
export async function recognize(params: {
  audio_key?: string;
  audio_url?: string;
  uid?: string;
}, cozeHeaders?: Record<string, string>): Promise<ASRResult> {
  if (useExternalASR) {
    // ─── External ASR (OpenAI Whisper or compatible) ───
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

    const uint8Array = new Uint8Array(audioBuffer);
    const file = new File([uint8Array], fileName, { type: "audio/m4a" });

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
      console.error("ASR transcription error:", error.message);
      throw new Error(`语音识别失败: ${error.message}`);
    }
  } else {
    // ─── Coze SDK fallback (sandbox) ───
    const customHeaders = cozeHeaders
      ? HeaderUtils.extractForwardHeaders(cozeHeaders)
      : undefined;
    const cozeASR = new ASRClient(new Config(), customHeaders);
    
    if (!params.audio_key && !params.audio_url) {
      throw new Error("必须提供 audio_key 或 audio_url");
    }

    // Get audio URL from storage
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
