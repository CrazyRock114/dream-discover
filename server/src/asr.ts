/**
 * ASR (Automatic Speech Recognition) Client
 * 
 * 使用外部 OpenAI 兼容 Whisper API
 * 支持两种输入方式：
 * - audio_key/audio_url：从存储读取音频文件
 * - audioBuffer：直接传入音频 Buffer（无需存储，推荐用于外部部署）
 */
import OpenAI from "openai";
import { readFile as readFromStorage } from "./r2-storage.js";

const ASR_API_KEY = process.env.ASR_API_KEY || "";
const ASR_BASE_URL = process.env.ASR_BASE_URL || "https://api.groq.com/openai/v1";
const ASR_MODEL = process.env.ASR_MODEL || "whisper-large-v3";

console.log(`[asr] Provider: external (${ASR_BASE_URL}, model: ${ASR_MODEL})`);

// External ASR client (lazy init)
let asrClient: OpenAI | null = null;

function getASRClient(): OpenAI {
  if (!asrClient) {
    if (!ASR_API_KEY) {
      throw new Error("未配置 ASR_API_KEY 环境变量。请在 Railway 中配置 ASR_API_KEY（推荐使用 Groq 免费 Whisper API）");
    }
    asrClient = new OpenAI({
      apiKey: ASR_API_KEY,
      baseURL: ASR_BASE_URL,
      timeout: 60_000,
      maxRetries: 2,
    });
  }
  return asrClient;
}

export interface ASRResult {
  text: string;
}

// 根据文件扩展名映射 Groq Whisper 能识别的标准 MIME 类型
function normalizeAudioMimeType(fileName: string, fallbackMimeType: string): string {
  const ext = fileName.toLowerCase().split('.').pop() || '';
  const mimeMap: Record<string, string> = {
    'm4a': 'audio/m4a',
    'mp3': 'audio/mpeg',
    'mp4': 'audio/mp4',
    'wav': 'audio/wav',
    'flac': 'audio/flac',
    'ogg': 'audio/ogg',
    'opus': 'audio/opus',
    'webm': 'audio/webm',
    'mpeg': 'audio/mpeg',
  };
  return mimeMap[ext] || fallbackMimeType;
}

// 确保文件名有扩展名（Expo 录音 URI 可能不带扩展名）
function ensureFileExtension(fileName: string, mimeType: string): string {
  const hasExtension = fileName.includes('.');
  if (hasExtension) return fileName;

  const mimeToExt: Record<string, string> = {
    'audio/m4a': '.m4a',
    'audio/mpeg': '.mp3',
    'audio/mp4': '.mp4',
    'audio/wav': '.wav',
    'audio/flac': '.flac',
    'audio/ogg': '.ogg',
    'audio/opus': '.opus',
    'audio/webm': '.webm',
    'audio/x-m4a': '.m4a',
  };
  const ext = mimeToExt[mimeType] || '.m4a';
  return fileName + ext;
}

/**
 * 直接从音频 Buffer 转录（无需 R2 存储）
 * 推荐用于外部部署环境
 */
export async function transcribeBuffer(audioBuffer: Buffer, fileName: string = "recording.m4a", mimeType: string = "audio/m4a"): Promise<ASRResult> {
  const safeFileName = ensureFileExtension(fileName, mimeType);
  const normalizedMime = normalizeAudioMimeType(safeFileName, mimeType);
  console.log(`[asr] Transcribing file: ${fileName} -> ${safeFileName}, mime: ${mimeType} -> ${normalizedMime}, size: ${audioBuffer.length} bytes`);

  const uint8Array = new Uint8Array(audioBuffer);
  const file = new File([uint8Array], safeFileName, { type: normalizedMime });

  try {
    const transcriptionParams: Record<string, any> = {
      model: ASR_MODEL,
      file,
      language: "zh",
      response_format: "text",
      prompt: "以下是中文语音转文字内容：",
      temperature: 0.0,
    };

    const transcription = await getASRClient().audio.transcriptions.create(
      transcriptionParams as any
    );

    let text = "";
    if (typeof transcription === "string") {
      text = transcription;
    } else if ((transcription as any).text) {
      text = (transcription as any).text;
    } else if (Array.isArray((transcription as any).segments)) {
      text = (transcription as any).segments
        .map((s: any) => s.text || "")
        .join("")
        .trim();
    }

    // 过滤掉 Whisper 常见的幻觉文本
    const hallucinationPatterns = [
      "请不吝点赞",
      "订阅 转发",
      "大赏支持",
      "感谢收看",
      "谢谢观看",
      "字幕制作",
      "仅供参考",
    ];
    for (const pattern of hallucinationPatterns) {
      if (text.includes(pattern)) {
        if (text.length < 200) {
          console.log(`[asr] Detected hallucination pattern "${pattern}", discarding result: "${text.substring(0, 100)}"`);
          text = "";
          break;
        }
        text = text.split(/[。！？；\n]/).filter(sentence => !hallucinationPatterns.some(p => sentence.includes(p))).join("。").trim();
      }
    }

    return { text };
  } catch (error: any) {
    console.error("[asr] Transcription error:", error.message);
    throw new Error(`语音识别失败: ${error.message}`);
  }
}

/**
 * 从存储中的音频文件转录
 */
export async function recognize(params: {
  audio_key?: string;
  audio_url?: string;
  uid?: string;
}): Promise<ASRResult> {
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
}
