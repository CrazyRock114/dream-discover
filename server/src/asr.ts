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

  // 根据 MIME 类型补充扩展名
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
  const ext = mimeToExt[mimeType] || '.m4a'; // 默认 m4a（Expo 录音格式）
  return fileName + ext;
}

/**
 * 直接从音频 Buffer 转录（无需 R2 存储）
 * 推荐用于外部部署环境
 */
export async function transcribeBuffer(audioBuffer: Buffer, fileName: string = "recording.m4a", mimeType: string = "audio/m4a"): Promise<ASRResult> {
  if (!useExternalASR) {
    throw new Error("直接转录需要设置 ASR_API_KEY 环境变量。请在 Railway 中配置 ASR_API_KEY（推荐使用 Groq 免费 Whisper API）");
  }

  // 确保文件名有扩展名，并强制使用标准 MIME 类型
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
      response_format: "verbose_json",
      // 提供初始 prompt 引导模型产出正常对话内容，减少幻觉
      prompt: "以下是中文语音转文字内容：",
      // 限制温度降低幻觉概率
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
      // verbose_json 返回 segments，取所有 segment 的 text 拼接
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
        // 如果整段文本很短且包含幻觉关键词，大概率整段都是幻觉
        if (text.length < 200) {
          console.log(`[asr] Detected hallucination pattern "${pattern}", discarding result: "${text.substring(0, 100)}"`);
          text = "";
          break;
        }
        // 如果文本较长，只移除包含幻觉关键词的句子
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
