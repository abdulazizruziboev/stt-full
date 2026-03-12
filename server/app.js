import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import multer from "multer";
import { GoogleGenAI } from "@google/genai";

dotenv.config();

const app = express();

app.use(cors());
app.use(express.json({ limit: "1mb" }));

const apiKey = process.env.GEMINI_API_KEY;
const modelName = process.env.GEMINI_MODEL || "gemini-2.5-flash";
const uzbekvoiceUrl = process.env.UZBEKVOICE_URL || "https://uzbekvoice.ai/api/v1/stt";
const uzbekvoiceAuth = process.env.UZBEKVOICE_AUTH;

if (!apiKey) {
  console.error("Missing GEMINI_API_KEY in environment.");
}

app.get("/health", (req, res) => {
  res.json({ ok: true });
});

app.get("/api/health", (req, res) => {
  res.json({ ok: true });
});

const upload = multer({ storage: multer.memoryStorage() });

async function transcribeWithUzbekvoice({ file, options = {} }) {
  if (!uzbekvoiceAuth) {
    throw new Error("Missing UZBEKVOICE_AUTH");
  }

  if (!file) {
    throw new Error("Missing audio file");
  }

  const form = new FormData();
  const blob = new Blob([file.buffer], {
    type: file.mimetype || "application/octet-stream"
  });
  form.append("file", blob, file.originalname || "audio.wav");

  const {
    return_offsets = "false",
    run_diarization = "false",
    language = "uz",
    blocking,
    webhook_notification_url = ""
  } = options;

  form.append("return_offsets", String(return_offsets));
  form.append("run_diarization", String(run_diarization));
  form.append("language", String(language));
  const effectiveBlocking =
    blocking !== undefined && blocking !== null && blocking !== ""
      ? blocking
      : webhook_notification_url
        ? "false"
        : "true";
  form.append("blocking", String(effectiveBlocking));
  if (webhook_notification_url) {
    form.append("webhook_notification_url", String(webhook_notification_url));
  }

  const response = await fetch(uzbekvoiceUrl, {
    method: "POST",
    headers: {
      Authorization: uzbekvoiceAuth
    },
    body: form
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || `STT request failed with ${response.status}`);
  }

  const raw = await response.json().catch(() => ({}));
  const text = raw.text || raw.transcript || raw.result || raw?.data?.text || "";

  return { text, raw };
}

async function generateWithGemini({ text, systemPrompt }) {
  if (!apiKey) {
    throw new Error("Missing GEMINI_API_KEY");
  }

  let promptText = text;
  if (typeof promptText === "string") {
    const trimmed = promptText.trim();
    // If text is a JSON string, try to extract nested text fields
    if ((trimmed.startsWith("{") && trimmed.endsWith("}")) || (trimmed.startsWith("[") && trimmed.endsWith("]"))) {
      try {
        const parsed = JSON.parse(trimmed);
        if (parsed && typeof parsed === "object") {
          promptText =
            parsed.text ||
            parsed.conversation_text ||
            parsed.result ||
            trimmed;
        }
      } catch {
        // keep as-is
      }
    }
  } else if (promptText && typeof promptText === "object") {
    promptText =
      promptText.text ||
      promptText.conversation_text ||
      promptText.result ||
      "";
  }

  if (!promptText || typeof promptText !== "string" || !promptText.trim()) {
    return "Mavzudan chiqildi";
  }

  const genAI = new GoogleGenAI({ apiKey });
  const promptParts = [];
  if (systemPrompt && typeof systemPrompt === "string") {
    promptParts.push(systemPrompt.trim());
  }
  promptParts.push(promptText.trim());

  const response = await genAI.models.generateContent({
    model: modelName,
    contents: [{ role: "user", parts: [{ text: promptParts.join("\n\n") }] }]
  });

  const outputText =
    response?.text || response?.candidates?.[0]?.content?.parts?.[0]?.text || "";

  return outputText;
}

app.post("/api/stt", upload.single("file"), async (req, res) => {
  try {
    const { text, raw } = await transcribeWithUzbekvoice({
      file: req.file,
      options: req.body || {}
    });
    res.json({ text, raw });
  } catch (err) {
    const message = err?.message || "STT request failed";
    console.error(err?.response?.data || err);
    res.status(500).json({ error: message });
  }
});

app.post("/stt", upload.single("file"), async (req, res) => {
  try {
    const { text, raw } = await transcribeWithUzbekvoice({
      file: req.file,
      options: req.body || {}
    });
    res.json({ text, raw });
  } catch (err) {
    const message = err?.message || "STT request failed";
    console.error(err?.response?.data || err);
    res.status(500).json({ error: message });
  }
});

app.post("/api/generate", async (req, res) => {
  try {
    const { text, systemPrompt } = req.body || {};
    const output = await generateWithGemini({ text, systemPrompt });
    res.json({ output });
  } catch (err) {
    const message = err?.message || "Gemini request failed";
    console.error(err);
    res.status(500).json({ error: message });
  }
});

app.post("/generate", async (req, res) => {
  try {
    const { text, systemPrompt } = req.body || {};
    const output = await generateWithGemini({ text, systemPrompt });
    res.json({ output });
  } catch (err) {
    const message = err?.message || "Gemini request failed";
    console.error(err);
    res.status(500).json({ error: message });
  }
});

app.post("/api/voice-to-gemini", upload.single("file"), async (req, res) => {
  try {
    const { systemPrompt = "", language = "uz" } = req.body || {};
    const { text } = await transcribeWithUzbekvoice({
      file: req.file,
      options: { language }
    });

    if (!text) {
      return res.status(500).json({ error: "Empty transcript from STT" });
    }

    const output = await generateWithGemini({ text, systemPrompt });
    res.json({ text, output });
  } catch (err) {
    const message = err?.message || "Voice to Gemini failed";
    console.error(err?.response?.data || err);
    res.status(500).json({ error: message });
  }
});

app.post("/voice-to-gemini", upload.single("file"), async (req, res) => {
  try {
    const { systemPrompt = "", language = "uz" } = req.body || {};
    const { text } = await transcribeWithUzbekvoice({
      file: req.file,
      options: { language }
    });

    if (!text) {
      return res.status(500).json({ error: "Empty transcript from STT" });
    }

    const output = await generateWithGemini({ text, systemPrompt });
    res.json({ text, output });
  } catch (err) {
    const message = err?.message || "Voice to Gemini failed";
    console.error(err?.response?.data || err);
    res.status(500).json({ error: message });
  }
});

export default app;
