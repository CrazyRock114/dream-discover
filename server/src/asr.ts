/**
 * ASR (Automatic Speech Recognition) Client
 *
 * 使用火山引擎豆包语音 - 大模型录音文件识别极速版 API
 * 流程：音频 buffer → ffmpeg 转码(MP3) → base64 → 极速版识别 → 直接返回结果
 */
import { spawn } from "child_process";
import { readFile as readFromStorage } from "./r2-storage.js";

const VOLCENGINE_API_KEY = process.env.VOLCENGINE_API_KEY || "";
const VOLCENGINE_RESOURCE_ID = process.env.VOLCENGINE_RESOURCE_ID || "volc.bigasr.auc_turbo";

const FLASH_URL = "https://openspeech.bytedance.com/api/v3/auc/bigmodel/recognize/flash";

console.log(`[asr] Provider: Volcengine Doubao Flash (resource: ${VOLCENGINE_RESOURCE_ID})`);

export interface ASRResult {
  text: string;
}

// 根据文件扩展名判断音频格式
function getAudioFormat(fileName: string): string {
  const ext = fileName.toLowerCase().split(".").pop() || "";
  const formatMap: Record<string, string> = {
    mp3: "mp3",
    wav: "wav",
    ogg: "ogg",
    raw: "raw",
    pcm: "raw",
    m4a: "mp4",
    mp4: "mp4",
    aac: "aac",
  };
  return formatMap[ext] || ext;
}

// 确保文件名有扩展名
function ensureFileExtension(fileName: string, mimeType: string): string {
  const hasExtension = fileName.includes(".");
  if (hasExtension) return fileName;

  const mimeToExt: Record<string, string> = {
    "audio/m4a": ".m4a",
    "audio/mp4": ".m4a",
    "audio/mpeg": ".mp3",
    "audio/wav": ".wav",
    "audio/ogg": ".ogg",
    "audio/opus": ".opus",
    "audio/webm": ".webm",
    "audio/x-m4a": ".m4a",
  };
  const ext = mimeToExt[mimeType] || ".m4a";
  return fileName + ext;
}

/**
 * 使用 ffmpeg 将音频转码为 MP3
 */
async function convertToMp3(inputBuffer: Buffer, inputFormat: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const ffmpeg = spawn("ffmpeg", [
      "-i", "pipe:0",
      "-ar", "16000",
      "-ac", "1",
      "-b:a", "32k",
      "-f", "mp3",
      "pipe:1",
    ], {
      stdio: ["pipe", "pipe", "pipe"],
    });

    const chunks: Buffer[] = [];
    const errChunks: Buffer[] = [];

    ffmpeg.stdout.on("data", (chunk) => chunks.push(chunk));
    ffmpeg.stderr.on("data", (chunk) => errChunks.push(chunk));

    ffmpeg.on("close", (code) => {
      if (code !== 0) {
        const errMsg = Buffer.concat(errChunks).toString("utf-8");
        reject(new Error(`ffmpeg 转码失败 (exit ${code}): ${errMsg}`));
        return;
      }
      resolve(Buffer.concat(chunks));
    });

    ffmpeg.on("error", (err) => reject(err));
    ffmpeg.stdin.write(inputBuffer);
    ffmpeg.stdin.end();
  });
}

/**
 * 调用火山引擎极速版 ASR 接口
 */
async function flashRecognize(audioBase64: string, format: string, taskId: string): Promise<string> {
  const body = {
    user: { uid: "dream-discover-user" },
    audio: {
      data: audioBase64,
    },
    request: {
      model_name: "bigmodel",
      enable_itn: true,
      enable_punc: true,
    },
  };

  const response = await fetch(FLASH_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Api-Key": VOLCENGINE_API_KEY,
      "X-Api-Resource-Id": VOLCENGINE_RESOURCE_ID,
      "X-Api-Request-Id": taskId,
      "X-Api-Sequence": "-1",
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`ASR 请求失败: HTTP ${response.status}, ${text}`);
  }

  const statusCode = response.headers.get("X-Api-Status-Code") || "";
  const statusMsg = response.headers.get("X-Api-Message") || "";

  if (statusCode === "20000003") {
    // 静音音频
    console.log("[asr] Flash result: 未检测到人声");
    return "";
  }

  if (statusCode === "45000002") {
    // 空音频
    console.log("[asr] Flash result: 空音频");
    return "";
  }

  if (statusCode !== "20000000") {
    throw new Error(`ASR 识别失败: ${statusCode} ${statusMsg}`);
  }

  const data = await response.json() as any;
  const resultText = data.result?.text || "";
  return resultText;
}

/**
 * 直接从音频 Buffer 转录（无需长期存储）
 */
export async function transcribeBuffer(
  audioBuffer: Buffer,
  fileName: string = "recording.m4a",
  mimeType: string = "audio/m4a"
): Promise<ASRResult> {
  if (!VOLCENGINE_API_KEY) {
    throw new Error("未配置 VOLCENGINE_API_KEY 环境变量。请在 Railway 中配置火山引擎 API Key");
  }

  const safeFileName = ensureFileExtension(fileName, mimeType);
  const originalFormat = getAudioFormat(safeFileName);
  console.log(`[asr] Transcribing file: ${fileName} -> ${safeFileName}, format: ${originalFormat}, size: ${audioBuffer.length} bytes`);

  let processedBuffer = audioBuffer;
  let outputFormat = originalFormat;

  // 极速版支持格式: wav / mp3 / ogg
  // m4a/mp4/aac 需要先转码为 MP3
  const supportedFormats = ["mp3", "wav", "ogg"];
  if (!supportedFormats.includes(originalFormat)) {
    console.log(`[asr] Format ${originalFormat} not supported by Volcengine Flash, converting to MP3 via ffmpeg...`);
    try {
      processedBuffer = await convertToMp3(audioBuffer, originalFormat);
      outputFormat = "mp3";
      console.log(`[asr] Converted to MP3, new size: ${processedBuffer.length} bytes`);
    } catch (err: any) {
      console.error(`[asr] ffmpeg conversion failed: ${err.message}`);
      throw new Error(`音频格式转换失败: ${err.message}。请确保服务器已安装 ffmpeg。`);
    }
  }

  const taskId = crypto.randomUUID();
  const startTime = Date.now();

  try {
    const audioBase64 = processedBuffer.toString("base64");
    const text = await flashRecognize(audioBase64, outputFormat, taskId);
    const elapsed = Date.now() - startTime;

    const filteredText = filterHallucinations(text);
    console.log(`[asr] Flash recognition complete in ${elapsed}ms, text length: ${filteredText.length}`);
    return { text: filteredText };
  } catch (error: any) {
    const elapsed = Date.now() - startTime;
    console.error(`[asr] Flash transcription error after ${elapsed}ms:`, error.message);
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

/**
 * 过滤 ASR 常见幻觉文本
 */
function filterHallucinations(text: string): string {
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
        console.log(`[asr] Detected hallucination pattern "${pattern}", discarding result`);
        return "";
      }
      text = text
        .split(/[。！？；\n]/)
        .filter((sentence) => !hallucinationPatterns.some((p) => sentence.includes(p)))
        .join("。")
        .trim();
    }
  }

  return text;
}
