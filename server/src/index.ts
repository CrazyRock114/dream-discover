import express from "express";
import cors from "cors";
import multer from "multer";
import { getSupabaseClient } from "./storage/database/supabase-client.js";
import { LLMClient, ASRClient, S3Storage, Config, HeaderUtils } from "coze-coding-dev-sdk";
import { FREUD_PROMPT, ZHOUGONG_PROMPT } from "./interpreters.js";

const app = express();
const port = process.env.PORT || 9091;

// Middleware
app.use(cors());
app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ limit: "50mb", extended: true }));

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024 } });

// ─── Supabase client ───
function getClient() {
  return getSupabaseClient();
}

// ─── LLM client ───
function createLLMClient(headers?: Record<string, string>) {
  const config = new Config();
  return new LLMClient(config, headers);
}

// ─── Storage ───
const storage = new S3Storage({
  endpointUrl: process.env.COZE_BUCKET_ENDPOINT_URL,
  accessKey: "",
  secretKey: "",
  bucketName: process.env.COZE_BUCKET_NAME,
  region: "cn-beijing",
});

// ─── Device ID middleware ───
function getDeviceId(req: express.Request): string {
  return req.headers["x-device-id"] as string || req.query.device_id as string || "";
}

// ─── Health ───
app.get("/api/v1/health", (_req, res) => {
  res.status(200).json({ status: "ok" });
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

    const client = getClient();
    const limit = Math.min(parseInt(req.query.limit as string) || 20, 100);
    const cursor = req.query.cursor as string | undefined;
    const mood = req.query.mood as string | undefined;
    const tag = req.query.tag as string | undefined;

    let query = client
      .from("dreams")
      .select("id, device_id, content, audio_key, interpreter, interpretation, mood, created_at")
      .eq("device_id", deviceId)
      .order("created_at", { ascending: false })
      .limit(limit + 1);

    if (cursor) {
      query = query.lt("created_at", cursor);
    }
    if (mood) {
      query = query.eq("mood", mood);
    }

    const { data, error } = await query;
    if (error) throw new Error(`查询失败: ${error.message}`);

    let items = data || [];
    const hasMore = items.length > limit;
    if (hasMore) items = items.slice(0, limit);

    // Filter by tag if specified
    if (tag && items.length > 0) {
      const dreamIds = items.map(d => d.id);
      const { data: tagData } = await client
        .from("dream_tags")
        .select("dream_id")
        .in("dream_id", dreamIds)
        .eq("tag", tag);

      const taggedDreamIds = new Set((tagData || []).map(t => t.dream_id));
      items = items.filter(d => taggedDreamIds.has(d.id));
    }

    // Fetch tags for all dreams
    if (items.length > 0) {
      const dreamIds = items.map(d => d.id);
      const { data: allTags } = await client
        .from("dream_tags")
        .select("id, dream_id, tag, is_custom")
        .in("dream_id", dreamIds);

      const tagMap: Record<number, Array<{ id: number; tag: string; is_custom: boolean }>> = {};
      for (const t of allTags || []) {
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

    const client = getClient();

    // Validate mood
    if (mood && !["good", "bad", "neutral"].includes(mood)) {
      res.status(400).json({ error: "mood 只能是 good/bad/neutral" });
      return;
    }

    const { data, error } = await client
      .from("dreams")
      .insert({
        content: content.trim(),
        device_id: deviceId,
        interpreter: interpreter || null,
        audio_key: audio_key || null,
        mood: mood || null,
      })
      .select("id, device_id, content, audio_key, interpreter, interpretation, mood, created_at")
      .maybeSingle();

    if (error) throw new Error(`创建失败: ${error.message}`);

    if (!data) throw new Error("创建梦境失败：未返回数据");

    // Insert tags if provided
    if (tags && Array.isArray(tags) && tags.length > 0) {
      const presetTags = ["灵感来源", "印象深刻", "有待深度解读"];
      const tagRows = tags.map(tag => ({
        dream_id: data.id,
        tag,
        is_custom: !presetTags.includes(tag),
      }));
      await client.from("dream_tags").insert(tagRows);
    }

    // Re-fetch with tags
    const { data: tagData } = await client
      .from("dream_tags")
      .select("id, tag, is_custom")
      .eq("dream_id", data.id);

    res.status(201).json({ ...data, tags: tagData || [] });
  } catch (err: any) {
    console.error("POST /dreams error:", err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/v1/dreams/:id
 */
app.get("/api/v1/dreams/:id", async (req, res) => {
  try {
    const client = getClient();
    const { data, error } = await client
      .from("dreams")
      .select("id, device_id, content, audio_key, interpreter, interpretation, mood, created_at")
      .eq("id", Number(req.params.id))
      .maybeSingle();

    if (error) throw new Error(`查询失败: ${error.message}`);
    if (!data) {
      res.status(404).json({ error: "梦境不存在" });
      return;
    }

    // Fetch tags
    const { data: tagData } = await client
      .from("dream_tags")
      .select("id, tag, is_custom")
      .eq("dream_id", data.id);

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
    const client = getClient();
    const updates: Record<string, any> = {};
    if (req.body.interpreter !== undefined) updates.interpreter = req.body.interpreter;
    if (req.body.interpretation !== undefined) updates.interpretation = req.body.interpretation;
    if (req.body.mood !== undefined) updates.mood = req.body.mood;

    const { data, error } = await client
      .from("dreams")
      .update(updates)
      .eq("id", Number(req.params.id))
      .select("id, device_id, content, audio_key, interpreter, interpretation, mood, created_at")
      .maybeSingle();

    if (error) throw new Error(`更新失败: ${error.message}`);

    // Update tags if provided
    if (req.body.tags !== undefined) {
      const dreamId = Number(req.params.id);
      // Delete existing tags
      await client.from("dream_tags").delete().eq("dream_id", dreamId);

      // Insert new tags
      if (Array.isArray(req.body.tags) && req.body.tags.length > 0) {
        const presetTags = ["灵感来源", "印象深刻", "有待深度解读"];
        const tagRows = req.body.tags.map((tag: string) => ({
          dream_id: dreamId,
          tag,
          is_custom: !presetTags.includes(tag),
        }));
        await client.from("dream_tags").insert(tagRows);
      }
    }

    // Re-fetch tags
    const { data: tagData } = await client
      .from("dream_tags")
      .select("id, tag, is_custom")
      .eq("dream_id", Number(req.params.id));

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
    const client = getClient();
    const { error } = await client.from("dreams").delete().eq("id", Number(req.params.id));
    if (error) throw new Error(`删除失败: ${error.message}`);
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
    const client = getClient();
    const { data, error } = await client
      .from("messages")
      .select("id, dream_id, role, content, created_at")
      .eq("dream_id", Number(req.params.id))
      .order("created_at", { ascending: true });

    if (error) throw new Error(`查询失败: ${error.message}`);
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
    const key = await storage.uploadFile({
      fileContent: req.file.buffer,
      fileName,
      contentType: req.file.mimetype || "audio/m4a",
    });

    const url = await storage.generatePresignedUrl({ key, expireTime: 86400 });
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

    const customHeaders = HeaderUtils.extractForwardHeaders(req.headers as Record<string, string>);
    const asrClient = new ASRClient(new Config(), customHeaders);

    // Generate signed URL for the audio file
    const audioUrl = await storage.generatePresignedUrl({ key: audio_key, expireTime: 3600 });

    const result = await asrClient.recognize({
      uid: "dream-app",
      url: audioUrl,
    });

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

    const client = getClient();
    const { data: dream, error } = await client
      .from("dreams")
      .select("id, content, mood")
      .eq("id", Number(req.params.id))
      .maybeSingle();

    if (error) throw new Error(`查询失败: ${error.message}`);
    if (!dream) {
      res.status(404).json({ error: "梦境不存在" });
      return;
    }

    // Update dream with interpreter
    await client.from("dreams").update({ interpreter }).eq("id", dream.id);

    const systemPrompt = interpreter === "freud" ? FREUD_PROMPT : ZHOUGONG_PROMPT;
    const conciseSuffix = isConcise
      ? "\n\n【输出模式：精简引导】请遵守以下规则：1. 你的首次回复控制在300字左右，提炼2-3个核心解读要点，适度展开但不必长篇论证；若梦境内容复杂（多场景、多人物、强情绪），可酌情增加至400字；2. 结尾必须用一个简短的追问引导做梦者进一步探索，例如「你对梦中XX的感觉如何？」；3. 后续每轮回复保持精简，200字以内，逐步深入。"
      : "";
    const moodHint = dream.mood ? `\n（做梦者对这个梦的感受是：${dream.mood === "good" ? "好梦" : dream.mood === "bad" ? "噩梦" : "中性"}）` : "";
    const userMessage = `我梦见了这样的场景：\n\n${dream.content}${moodHint}\n\n请为我解析这个梦境。`;

    // Save user message
    await client.from("messages").insert({ dream_id: dream.id, role: "user", content: userMessage });

    // Set SSE headers
    res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
    res.setHeader("Cache-Control", "no-cache, no-store, no-transform, must-revalidate");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders();

    // Call LLM with streaming
    const customHeaders = HeaderUtils.extractForwardHeaders(req.headers as Record<string, string>);
    const llmClient = createLLMClient(customHeaders);
    let fullContent = "";

    const messages = [
      { role: "system" as const, content: systemPrompt + conciseSuffix },
      { role: "user" as const, content: userMessage },
    ];

    const stream = llmClient.stream(messages, { model: "doubao-seed-2-0-pro-260215" });

    for await (const chunk of stream) {
      if (chunk.content) {
        const text = chunk.content.toString();
        fullContent += text;
        res.write(`data: ${JSON.stringify({ content: text })}\n\n`);
      }
    }

    res.write("data: [DONE]\n\n");

    // Save assistant message and update dream interpretation
    await client.from("messages").insert({ dream_id: dream.id, role: "assistant", content: fullContent });
    await client.from("dreams").update({ interpretation: fullContent, interpreter }).eq("id", dream.id);

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
 * Body: { message: string, interpreter: 'freud' | 'zhougong' }
 * SSE streaming response
 */
app.post("/api/v1/dreams/:id/chat", async (req, res) => {
  try {
    const { message, interpreter } = req.body;
    if (!message || !message.trim()) {
      res.status(400).json({ error: "消息不能为空" });
      return;
    }
    if (!interpreter || !["freud", "zhougong"].includes(interpreter)) {
      res.status(400).json({ error: "请选择解梦师：freud 或 zhougong" });
      return;
    }

    const client = getClient();
    const { data: dream, error: dreamError } = await client
      .from("dreams")
      .select("id, content")
      .eq("id", Number(req.params.id))
      .maybeSingle();

    if (dreamError) throw new Error(`查询失败: ${dreamError.message}`);
    if (!dream) {
      res.status(404).json({ error: "梦境不存在" });
      return;
    }

    // Get conversation history
    const { data: history, error: histError } = await client
      .from("messages")
      .select("role, content")
      .eq("dream_id", dream.id)
      .order("created_at", { ascending: true });

    if (histError) throw new Error(`查询历史失败: ${histError.message}`);

    // Save user message
    await client.from("messages").insert({ dream_id: dream.id, role: "user", content: message.trim() });

    // Set SSE headers
    res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
    res.setHeader("Cache-Control", "no-cache, no-store, no-transform, must-revalidate");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders();

    // Build messages array
    const systemPrompt = interpreter === "freud" ? FREUD_PROMPT : ZHOUGONG_PROMPT;
    const llmMessages: Array<{ role: "system" | "user" | "assistant"; content: string }> = [
      { role: "system", content: systemPrompt },
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

    // Call LLM with streaming
    const customHeaders = HeaderUtils.extractForwardHeaders(req.headers as Record<string, string>);
    const llmClient = createLLMClient(customHeaders);
    let fullContent = "";

    const stream = llmClient.stream(llmMessages, { model: "doubao-seed-2-0-pro-260215" });

    for await (const chunk of stream) {
      if (chunk.content) {
        const text = chunk.content.toString();
        fullContent += text;
        res.write(`data: ${JSON.stringify({ content: text })}\n\n`);
      }
    }

    res.write("data: [DONE]\n\n");

    // Save assistant message
    await client.from("messages").insert({ dream_id: dream.id, role: "assistant", content: fullContent });

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
      tagline: "梦是通往潜意识的皇家大道",
      description: "以精神分析理论解读你的梦境，揭示潜意识中被压抑的欲望与冲突。",
    },
    {
      id: "zhougong",
      name: "周公",
      name_en: "Duke of Zhou",
      avatar: "https://coze-coding-project.tos.coze.site/coze_storage_7628874118410108955/image/generate_image_4ad23d7a-5e1a-4f68-9530-16bf23fb6942.jpeg?sign=1807775797-faad9d4411-0-eab185f513ae76adac286fdce9d24e8c3773bc504796ef69ecc9ecb8c12cd1d6",
      title: "中华解梦始祖",
      tagline: "梦境皆有征兆，吉凶自有玄机",
      description: "以《周公解梦》与千年易学智慧，为你揭示梦中的预兆与启示。",
    },
  ]);
});

app.listen(port, () => {
  console.log(`Server listening at http://localhost:${port}/`);
});
