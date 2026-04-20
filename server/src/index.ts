import express from "express";
import cors from "cors";
import multer from "multer";
import { streamChat } from "./llm.js";
import * as r2Storage from "./r2-storage.js";
import { recognize as asrRecognize } from "./asr.js";
import { FREUD_PROMPT, ZHOUGONG_PROMPT } from "./interpreters.js";
import { runMigration } from "./migrate.js";
import * as db from "./db.js";

const app = express();
const port = process.env.PORT || 9091;

// Middleware
app.use(cors());
app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ limit: "50mb", extended: true }));

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024 } });

// ─── Device ID middleware ───
function getDeviceId(req: express.Request): string {
  return req.headers["x-device-id"] as string || req.query.device_id as string || "";
}

// ─── Health ───
app.get("/api/v1/health", async (_req, res) => {
  try {
    const pg = db.getDb();
    const result = await pg`SELECT 1 AS ok`;
    res.status(200).json({ status: "ok", db: "connected" });
  } catch (err: any) {
    console.error("[health] DB connection failed:", err.message);
    res.status(200).json({ status: "ok", db: "error", error: err.message });
  }
});

// ─── Dreams CRUD ───

/**
 * GET /api/v1/dreams
 * Query: limit (default 20), cursor (created_at for pagination), mood?, tag?
 * Header: x-device-id
 */
app.get("/api/v1/dreams", async (req, res) => {
  try {
    const deviceId = getDeviceId(req);
    if (!deviceId) {
      res.status(400).json({ error: "缺少设备标识" });
      return;
    }

    const limit = Math.min(parseInt(req.query.limit as string) || 20, 100);
    const cursor = req.query.cursor as string | undefined;
    const mood = req.query.mood as string | undefined;
    const tag = req.query.tag as string | undefined;

    let items = await db.findDreamsByDeviceId({
      deviceId,
      limit,
      cursor,
      mood,
    });

    const hasMore = items.length > limit;
    if (hasMore) items = items.slice(0, limit);

    // Filter by tag if specified
    if (tag && items.length > 0) {
      const dreamIds = items.map(d => d.id);
      const taggedDreamIds = await db.findDreamsByTag(dreamIds, tag);
      const taggedSet = new Set(taggedDreamIds);
      items = items.filter(d => taggedSet.has(d.id));
    }

    // Fetch tags for all dreams
    if (items.length > 0) {
      const dreamIds = items.map(d => d.id);
      const allTags = await db.findTagsByDreamIds(dreamIds);

      const tagMap: Record<number, Array<{ id: number; tag: string; is_custom: boolean }>> = {};
      for (const t of allTags) {
        if (!tagMap[t.dream_id]) tagMap[t.dream_id] = [];
        tagMap[t.dream_id].push({ id: t.id, tag: t.tag, is_custom: t.is_custom });
      }

      items = items.map(d => ({
        ...d,
        tags: tagMap[d.id] || [],
      }));
    }

    const nextCursor = hasMore && items.length > 0 ? items[items.length - 1].created_at : null;
    res.json({ data: items, nextCursor });
  } catch (err: any) {
    console.error("GET /dreams error:", err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/v1/dreams
 * Body: { content: string, device_id: string, interpreter?: string, audio_key?: string, mood?: string, tags?: string[] }
 */
app.post("/api/v1/dreams", async (req, res) => {
  try {
    const deviceId = getDeviceId(req) || req.body.device_id;
    const { content, interpreter, audio_key, mood, tags } = req.body;
    if (!content || !content.trim()) {
      res.status(400).json({ error: "梦境内容不能为空" });
      return;
    }
    if (!deviceId) {
      res.status(400).json({ error: "缺少设备标识" });
      return;
    }

    // Validate mood
    if (mood && !["good", "bad", "neutral"].includes(mood)) {
      res.status(400).json({ error: "mood 只能是 good/bad/neutral" });
      return;
    }

    const data = await db.insertDream({
      device_id: deviceId,
      content: content.trim(),
      interpreter: interpreter || null,
      audio_key: audio_key || null,
      mood: mood || null,
    });

    // Insert tags if provided
    if (tags && Array.isArray(tags) && tags.length > 0) {
      const presetTags = ["灵感来源", "印象深刻", "有待深度解读"];
      const tagRows = tags.map((tag: string) => ({
        dream_id: data.id,
        tag,
        is_custom: !presetTags.includes(tag),
      }));
      await db.insertTags(tagRows);
    }

    // Re-fetch with tags
    const tagData = await db.findTagsByDreamIds([data.id]);

    res.status(201).json({ ...data, tags: tagData || [] });
  } catch (err: any) {
    console.error("POST /dreams error:", err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/v1/dreams/find
 * Query: content (exact match), interpreter
 * Header: x-device-id
 * Returns: existing dream record or null
 */
app.get("/api/v1/dreams/find", async (req, res) => {
  try {
    const deviceId = getDeviceId(req);
    if (!deviceId) {
      res.status(400).json({ error: "缺少设备标识" });
      return;
    }
    const content = req.query.content as string;
    const interpreter = req.query.interpreter as string;
    if (!content || !interpreter) {
      res.status(400).json({ error: "content 和 interpreter 不能为空" });
      return;
    }

    const data = await db.findDreamByContent({
      deviceId,
      content: content.trim(),
      interpreter,
    });

    if (data) {
      const tagData = await db.findTagsByDreamIds([data.id]);
      res.json({ ...data, tags: tagData || [] });
    } else {
      res.json(null);
    }
  } catch (err: any) {
    console.error("GET /dreams/find error:", err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/v1/dreams/:id
 */
app.get("/api/v1/dreams/:id", async (req, res) => {
  try {
    const data = await db.findDreamById(Number(req.params.id));
    if (!data) {
      res.status(404).json({ error: "梦境不存在" });
      return;
    }

    const tagData = await db.findTagsByDreamIds([data.id]);
    res.json({ ...data, tags: tagData || [] });
  } catch (err: any) {
    console.error("GET /dreams/:id error:", err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * PATCH /api/v1/dreams/:id
 * Body: { interpreter?: string, interpretation?: string, mood?: string, tags?: string[] }
 */
app.patch("/api/v1/dreams/:id", async (req, res) => {
  try {
    const updates: Record<string, any> = {};
    if (req.body.interpreter !== undefined) updates.interpreter = req.body.interpreter;
    if (req.body.interpretation !== undefined) updates.interpretation = req.body.interpretation;
    if (req.body.mood !== undefined) updates.mood = req.body.mood;

    let data = await db.findDreamById(Number(req.params.id));
    if (!data) {
      res.status(404).json({ error: "梦境不存在" });
      return;
    }

    if (Object.keys(updates).length > 0) {
      data = await db.updateDream(Number(req.params.id), updates);
    }

    // Update tags if provided
    if (req.body.tags !== undefined) {
      const dreamId = Number(req.params.id);
      await db.deleteTagsByDreamId(dreamId);

      if (Array.isArray(req.body.tags) && req.body.tags.length > 0) {
        const presetTags = ["灵感来源", "印象深刻", "有待深度解读"];
        const tagRows = req.body.tags.map((tag: string) => ({
          dream_id: dreamId,
          tag,
          is_custom: !presetTags.includes(tag),
        }));
        await db.insertTags(tagRows);
      }
    }

    // Re-fetch tags
    const tagData = await db.findTagsByDreamIds([Number(req.params.id)]);
    res.json({ ...data, tags: tagData || [] });
  } catch (err: any) {
    console.error("PATCH /dreams/:id error:", err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * DELETE /api/v1/dreams/:id
 */
app.delete("/api/v1/dreams/:id", async (req, res) => {
  try {
    await db.deleteDream(Number(req.params.id));
    res.json({ success: true });
  } catch (err: any) {
    console.error("DELETE /dreams/:id error:", err);
    res.status(500).json({ error: err.message });
  }
});

// ─── Messages ───

/**
 * GET /api/v1/dreams/:id/messages
 */
app.get("/api/v1/dreams/:id/messages", async (req, res) => {
  try {
    const data = await db.findMessagesByDreamId(Number(req.params.id));
    res.json(data);
  } catch (err: any) {
    console.error("GET /dreams/:id/messages error:", err);
    res.status(500).json({ error: err.message });
  }
});

// ─── Audio Upload ───

/**
 * POST /api/v1/upload/audio
 * FormData: file (audio file)
 */
app.post("/api/v1/upload/audio", upload.single("file"), async (req, res) => {
  try {
    if (!req.file) {
      res.status(400).json({ error: "未提供音频文件" });
      return;
    }

    const fileName = `dream-audio/${Date.now()}-${req.file.originalname || "recording.m4a"}`;
    const key = await r2Storage.uploadFile({
      fileContent: req.file.buffer,
      fileName,
      contentType: req.file.mimetype || "audio/m4a",
    });

    const url = await r2Storage.generatePresignedUrl({ key, expireTime: 86400 });
    res.json({ key, url });
  } catch (err: any) {
    console.error("POST /upload/audio error:", err);
    res.status(500).json({ error: err.message });
  }
});

// ─── ASR (Speech-to-Text) ───

/**
 * POST /api/v1/asr
 * Body: { audio_key: string }
 */
app.post("/api/v1/asr", async (req, res) => {
  try {
    const { audio_key } = req.body;
    if (!audio_key) {
      res.status(400).json({ error: "audio_key 不能为空" });
      return;
    }

    const reqHeaders = req.headers as Record<string, string>;
    const result = await asrRecognize({ audio_key }, reqHeaders);

    res.json({ text: result.text });
  } catch (err: any) {
    console.error("POST /asr error:", err);
    res.status(500).json({ error: err.message });
  }
});

// ─── Dream Interpretation (SSE) ───

/**
 * POST /api/v1/dreams/:id/interpret
 * Body: { interpreter: 'freud' | 'zhougong', mode?: 'verbose' | 'concise' }
 * SSE streaming response
 */
app.post("/api/v1/dreams/:id/interpret", async (req, res) => {
  try {
    const { interpreter, mode } = req.body;
    if (!interpreter || !["freud", "zhougong"].includes(interpreter)) {
      res.status(400).json({ error: "请选择解梦师：freud 或 zhougong" });
      return;
    }
    const isConcise = mode === "concise";

    const dream = await db.findDreamById(Number(req.params.id));
    if (!dream) {
      res.status(404).json({ error: "梦境不存在" });
      return;
    }

    // Update dream with interpreter
    await db.updateDream(dream.id, { interpreter });

    const systemPrompt = interpreter === "freud" ? FREUD_PROMPT : ZHOUGONG_PROMPT;
    const conciseSuffix = isConcise
      ? "\n\n【输出模式：精简引导】请遵守以下规则：1. 你的首次回复控制在300字左右，提炼2-3个核心解读要点，适度展开但不必长篇论证；若梦境内容复杂（多场景、多人物、强情绪），可酌情增加至400字；2. 结尾必须用一个简短的追问引导做梦者进一步探索，例如「你对梦中XX的感觉如何？」；3. 后续每轮回复保持精简，200字以内，逐步深入。"
      : "";
    const moodHint = dream.mood ? `\n（做梦者对这个梦的感受是：${dream.mood === "good" ? "好梦" : dream.mood === "bad" ? "噩梦" : "中性"}）` : "";
    const userMessage = `我梦见了这样的场景：\n\n${dream.content}${moodHint}\n\n请为我解析这个梦境。`;

    // Save user message
    await db.insertMessage({ dream_id: dream.id, role: "user", content: userMessage });

    // Set SSE headers
    res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
    res.setHeader("Cache-Control", "no-cache, no-store, no-transform, must-revalidate");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders();

    // Call LLM with streaming (pass request headers for coze SDK fallback)
    let fullContent = "";

    const messages = [
      { role: "system" as const, content: systemPrompt + conciseSuffix },
      { role: "user" as const, content: userMessage },
    ];

    const reqHeaders = req.headers as Record<string, string>;
    const stream = streamChat(messages, {
      temperature: 0.85,
    }, reqHeaders);

    for await (const chunk of stream) {
      if (chunk.content) {
        fullContent += chunk.content;
        res.write(`data: ${JSON.stringify({ content: chunk.content })}\n\n`);
      }
    }

    res.write("data: [DONE]\n\n");

    // Save assistant message and update dream interpretation
    await db.insertMessage({ dream_id: dream.id, role: "assistant", content: fullContent });
    await db.updateDream(dream.id, { interpretation: fullContent, interpreter });

    res.end();
  } catch (err: any) {
    console.error("POST /dreams/:id/interpret error:", err);
    if (!res.headersSent) {
      res.status(500).json({ error: err.message });
    } else {
      res.write(`data: ${JSON.stringify({ error: err.message })}\n\n`);
      res.end();
    }
  }
});

// ─── Chat with Interpreter (SSE) ───

/**
 * POST /api/v1/dreams/:id/chat
 * Body: { message: string, interpreter: 'freud' | 'zhougong', mode?: 'verbose' | 'concise' }
 * SSE streaming response
 */
app.post("/api/v1/dreams/:id/chat", async (req, res) => {
  try {
    const { message, interpreter, mode } = req.body;
    if (!message || !message.trim()) {
      res.status(400).json({ error: "消息不能为空" });
      return;
    }
    if (!interpreter || !["freud", "zhougong"].includes(interpreter)) {
      res.status(400).json({ error: "请选择解梦师：freud 或 zhougong" });
      return;
    }
    const isConcise = mode === "concise";

    const dream = await db.findDreamById(Number(req.params.id));
    if (!dream) {
      res.status(404).json({ error: "梦境不存在" });
      return;
    }

    // Get conversation history
    const history = await db.findMessagesByDreamId(dream.id);

    // Save user message
    await db.insertMessage({ dream_id: dream.id, role: "user", content: message.trim() });

    // Set SSE headers
    res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
    res.setHeader("Cache-Control", "no-cache, no-store, no-transform, must-revalidate");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders();

    // Build messages array
    const systemPrompt = interpreter === "freud" ? FREUD_PROMPT : ZHOUGONG_PROMPT;
    const conciseSuffix = isConcise
      ? "\n\n【输出模式：精简引导】请遵守以下规则：1. 你的首次回复控制在300字左右，提炼2-3个核心解读要点，适度展开但不必长篇论证；若梦境内容复杂（多场景、多人物、强情绪），可酌情增加至400字；2. 结尾必须用一个简短的追问引导做梦者进一步探索，例如「你对梦中XX的感觉如何？」；3. 后续每轮回复保持精简，200字以内，逐步深入。"
      : "";
    const llmMessages: Array<{ role: "system" | "user" | "assistant"; content: string }> = [
      { role: "system", content: systemPrompt + conciseSuffix },
      { role: "user", content: `我梦见了这样的场景：\n\n${dream.content}\n\n请为我解析这个梦境。` },
    ];

    // Add conversation history (skip first user message which is the initial dream)
    if (history && history.length > 1) {
      for (let i = 1; i < history.length; i++) {
        llmMessages.push({
          role: history[i].role as "user" | "assistant",
          content: history[i].content,
        });
      }
    }

    // Add current message
    llmMessages.push({ role: "user", content: message.trim() });

    // Call LLM with streaming (pass request headers for coze SDK fallback)
    let fullContent = "";

    const reqHeaders = req.headers as Record<string, string>;
    const stream = streamChat(llmMessages, {
      temperature: 0.85,
    }, reqHeaders);

    for await (const chunk of stream) {
      if (chunk.content) {
        fullContent += chunk.content;
        res.write(`data: ${JSON.stringify({ content: chunk.content })}\n\n`);
      }
    }

    res.write("data: [DONE]\n\n");

    // Save assistant message
    await db.insertMessage({ dream_id: dream.id, role: "assistant", content: fullContent });

    res.end();
  } catch (err: any) {
    console.error("POST /dreams/:id/chat error:", err);
    if (!res.headersSent) {
      res.status(500).json({ error: err.message });
    } else {
      res.write(`data: ${JSON.stringify({ error: err.message })}\n\n`);
      res.end();
    }
  }
});

// ─── Interpreters info ───
app.get("/api/v1/interpreters", (_req, res) => {
  res.json([
    {
      id: "freud",
      name: "弗洛伊德",
      name_en: "Sigmund Freud",
      avatar: "https://coze-coding-project.tos.coze.site/coze_storage_7628874118410108955/image/generate_image_4f7b123e-d886-4846-96b2-d667a6318239.jpeg?sign=1807775792-a75f4a8b07-0-a3824f0ee068879735b86b086b946bf24dd11121b3c8a5345989dc9c23ce6832",
      title: "精神分析学派创始人",
      tagline: "梦是潜意识欲望的满足",
      description: "西格蒙德·弗洛伊德，精神分析学派创始人。他将用自由联想、象征解读等经典精神分析技术，为你揭示梦境背后隐藏的潜意识欲望与冲突。",
    },
    {
      id: "zhougong",
      name: "周公",
      name_en: "Duke of Zhou",
      avatar: "https://coze-coding-project.tos.coze.site/coze_storage_7628874118410108955/image/generate_image_d7a5b9cf-cb90-45dc-bcf2-b2e62ac9583e.jpeg?sign=1807775792-a75f4a8b07-0-a3824f0ee068879735b86b086b946bf24dd11121b3c8a5345989dc9c23ce6832",
      title: "千年解梦圣贤",
      tagline: "梦者，心之影也",
      description: "以《周公解梦》与千年易学智慧，为你揭示梦中的预兆与启示。",
    },
  ]);
});

// Run migration then start server
runMigration().then(() => {
  app.listen(port, () => {
    console.log(`Server listening at http://localhost:${port}/`);
  });
});
