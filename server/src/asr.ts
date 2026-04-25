/**
 * ASR (Automatic Speech Recognition) Client
 *
 * 使用火山引擎豆包语音 - 大模型录音文件识别 API v3
 * 流程：音频 buffer → ffmpeg 转码(MP3) → R2 临时存储 → 提交识别任务 → 轮询结果
 */
import { spawn } from "child_process";
import { promisify } from "util";
import { readFile as readFromStorage, uploadFile, deleteFile, generatePresignedUrl } from "./r2-storage.js";

const VOLCENGINE_API_KEY = process.env.VOLCENGINE_API_KEY || "";
const VOLCENGINE_RESOURCE_ID = process.env.VOLCENGINE_RESOURCE_ID || "volc.seedasr.auc";

const SUBMIT_URL = "https://openspeech.bytedance.com/api/v3/auc/bigmodel/submit";
const QUERY_URL = "https://openspeech.bytedance.com/api/v3/auc/bigmodel/query";

console.log(`[asr] Provider: Volcengine Doubao (resource: ${VOLCENGINE_RESOURCE_ID})`);

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
 * 上传音频到 R2 并获取临时 URL
 */
async function uploadAudioToR2(audioBuffer: Buffer, fileName: string, mimeType: string): Promise<string> {
  let key: string;
  try {
    key = await uploadFile({
      fileContent: audioBuffer,
      fileName: `asr-temp/${Date.now()}-${fileName}`,
      contentType: mimeType,
    });
    console.log(`[asr] Uploaded to R2, key: ${key}`);
  } catch (err: any) {
    console.error(`[asr] R2 upload failed: ${err.message}`);
    throw new Error(`音频临时存储失败: ${err.message}`);
  }

  // 生成 10 分钟有效期的预签名 URL
  try {
    const url = await generatePresignedUrl({ key, expireTime: 600 });
    console.log(`[asr] Generated presigned URL: ${url.substring(0, 120)}...`);
    return url;
  } catch (err: any) {
    console.error(`[asr] Generate presigned URL failed: ${err.message}`);
    throw new Error(`生成音频访问链接失败: ${err.message}`);
  }
}

/**
 * 从 R2 URL 中提取 key
 * 支持两种格式:
 * - 公开/自定义域名: /asr-temp/123-file.mp3
 * - S3 预签名 URL: /bucket-name/asr-temp/123-file.mp3
 */
function extractKeyFromUrl(url: string): string | null {
  try {
    const urlObj = new URL(url);
    const pathParts = urlObj.pathname.split("/").filter(Boolean);

    // 格式1: /asr-temp/123-file.mp3 (公开URL)
    if (pathParts.length >= 2 && pathParts[0] === "asr-temp") {
      return pathParts.join("/");
    }

    // 格式2: /bucket-name/asr-temp/123-file.mp3 (S3预签名URL)
    if (pathParts.length >= 3 && pathParts[1] === "asr-temp") {
      return pathParts.slice(1).join("/");
    }
  } catch {
    // ignore
  }
  return null;
}

/**
 * 提交火山引擎 ASR 任务
 */
async function submitTask(audioUrl: string, format: string, taskId: string): Promise<void> {
  const body = {
    user: { uid: "dream-discover-user" },
    audio: {
      format,
      url: audioUrl,
    },
    request: {
      model_name: "bigmodel",
      enable_itn: true,
      enable_punc: true,
    },
  };

  const response = await fetch(SUBMIT_URL, {
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
    throw new Error(`ASR 任务提交失败: HTTP ${response.status}, ${text}`);
  }

  const statusCode = response.headers.get("X-Api-Status-Code");
  const statusMsg = response.headers.get("X-Api-Message");
  if (statusCode && statusCode !== "20000000") {
    throw new Error(`ASR 任务提交失败: ${statusCode} ${statusMsg}`);
  }
}

/**
 * 查询火山引擎 ASR 任务结果
 */
async function queryTask(taskId: string): Promise<{ done: boolean; text?: string; code: string; message?: string }> {
  const response = await fetch(QUERY_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Api-Key": VOLCENGINE_API_KEY,
      "X-Api-Resource-Id": VOLCENGINE_RESOURCE_ID,
      "X-Api-Request-Id": taskId,
    },
    body: JSON.stringify({}),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`ASR 任务查询失败: HTTP ${response.status}, ${text}`);
  }

  const data = await response.json() as any;
  const statusCode = response.headers.get("X-Api-Status-Code") || "";

  // 20000000 = 成功, 20000001 = 处理中, 20000002 = 队列中
  if (statusCode === "20000000") {
    const resultText = data.result?.text || "";
    return { done: true, text: resultText, code: statusCode };
  }

  if (statusCode === "20000003") {
    // 静音音频
    return { done: true, text: "", code: statusCode, message: "未检测到人声" };
  }

  if (statusCode === "45000002") {
    // 空音频
    return { done: true, text: "", code: statusCode, message: "空音频" };
  }

  // 仍在处理中
  return { done: false, code: statusCode, message: data.message || "处理中" };
}

/**
 * 直接从音频 Buffer 转录（无需长期存储）
 * 推荐用于外部部署环境
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
  let outputMimeType = mimeType;

  // 火山引擎大模型录音文件识别支持的格式: raw / wav / mp3 / ogg
  // M4A/MP4/AAC 需要转码为 MP3
  const supportedFormats = ["mp3", "wav", "ogg", "raw"];
  if (!supportedFormats.includes(originalFormat)) {
    console.log(`[asr] Format ${originalFormat} not supported by Volcengine, converting to MP3 via ffmpeg...`);
    try {
      processedBuffer = await convertToMp3(audioBuffer, originalFormat);
      outputFormat = "mp3";
      outputMimeType = "audio/mpeg";
      console.log(`[asr] Converted to MP3, new size: ${processedBuffer.length} bytes`);
    } catch (err: any) {
      console.error(`[asr] ffmpeg conversion failed: ${err.message}`);
      throw new Error(`音频格式转换失败: ${err.message}。请确保服务器已安装 ffmpeg。`);
    }
  }

  let r2Url: string | null = null;
  const taskId = crypto.randomUUID();

  try {
    // 1. 上传音频到 R2 获取临时 URL
    const tempFileName = safeFileName.replace(/\.[^.]+$/, `.${outputFormat}`);
    r2Url = await uploadAudioToR2(processedBuffer, tempFileName, outputMimeType);
    console.log(`[asr] Uploaded to R2, temp URL: ${r2Url.substring(0, 80)}...`);

    // 2. 提交识别任务
    await submitTask(r2Url, outputFormat, taskId);
    console.log(`[asr] Task submitted, id: ${taskId}`);

    // 3. 轮询查询结果（最多 120 秒）
    const maxWaitMs = 120_000;
    const pollIntervalMs = 500; // 0.5s 轮询，减少等待
    const startTime = Date.now();
    let pollCount = 0;

    while (Date.now() - startTime < maxWaitMs) {
      await sleep(pollIntervalMs);
      pollCount++;
      const result = await queryTask(taskId);
      const elapsed = Date.now() - startTime;
      console.log(`[asr] Poll #${pollCount} (${elapsed}ms): code=${result.code}, done=${result.done}`);

      if (result.done) {
        let text = result.text || "";

        // 火山引擎基本无中文幻觉，但保留过滤逻辑作为兜底
        text = filterHallucinations(text);

        console.log(`[asr] Recognition complete in ${elapsed}ms, text length: ${text.length}`);
        return { text };
      }
    }

    throw new Error(`ASR 识别超时（已等待 ${Math.round((Date.now() - startTime) / 1000)} 秒），请缩短语音后重试`);
  } catch (error: any) {
    console.error("[asr] Transcription error:", error.message);
    throw new Error(`语音识别失败: ${error.message}`);
  } finally {
    // 4. 清理 R2 临时文件
    if (r2Url) {
      const key = extractKeyFromUrl(r2Url);
      if (key) {
        try {
          await deleteFile({ key });
          console.log(`[asr] Cleaned up R2 temp file: ${key}`);
        } catch (e: any) {
          console.warn(`[asr] Failed to cleanup R2 file: ${e.message}`);
        }
      }
    }
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

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
