import { useEffect, useMemo, useRef, useState } from "react";
import "./App.css";

const apiBase = import.meta.env.VITE_API_BASE || "";

const apiUrl = (path) => {
  if (apiBase) return `${apiBase}${path}`;
  if (import.meta.env.PROD) return `/api${path}`;
  return `http://localhost:5174/api${path}`;
};

const defaultPrompt = `# Role
You are a Professional Restaurant Voice Order Parser. Your goal is to convert messy, spoken waiter commands into a structured, production-ready JSON format.

# Context
The waiter provides order details in Uzbek (often with slang or typos). You must extract table numbers, items, quantities, special requests (descriptions), and add-ons. You must also simulate business logic like service fees and stock status.

# Strict Output Rules
1.  **Output Format:** ONLY return a valid JSON object. Do not include any conversational text before or after the JSON.
2.  **Topic Guardrail:** If the input is NOT related to a food/restaurant order, return exactly: "Mavzudan chiqildi".
3.  **Language:** The values in the JSON (item names, descriptions) must be in Uzbek.

# Data Logic & Calculations
- **Base Prices:** Use realistic random prices (in UZS) if a menu is not provided.
- **Add-ons:** Extract additions (e.g., "qazi", "tuxum") into the \`qoshimchalar\` array. Each add-on must have its own price and be added to the item's \`jami_narxi\`.
- **Service Fee:** Automatically apply a 15% service charge to the \`sub_total\`.
- **Auto-Correction:** Correct common typos (e.g., "stul" -> "stol", "letr" -> "litr").
- **Timestamp:** Generate a realistic ISO timestamp for the current moment in 2026.
- **Stock Simulation:** Mark \`ombor_qoldig_i\` as "yetarli" (sufficient) unless a massive quantity is ordered.

# JSON Schema
{
  "buyurtma_id": "ORD-[Random 4-digit]",
  "stol": number,
  "mijoz": "string (default: Noma'lum)",
  "ofitsiant_id": number (default: 1),
  "vaqt": "ISO-8601 Timestamp",
  "mahsulotlar": [
    {
      "nomi": "string",
      "miqdor": "string",
      "tavsif": "string",
      "qoshimchalar": [
        {"nomi": "string", "narxi": number}
      ],
      "status": "pishirilmoqda",
      "birlik_narxi": number,
      "jami_narxi": number,
      "ombor_qoldig_i": "yetarli/kam"
    }
  ],
  "hisob_kitob": {
    "sub_total": number,
    "xizmat_haqi_foiz": 15,
    "xizmat_haqi_summa": number,
    "umumiy_summa": number
  },
  "taxminiy_tolov_turi": "karta/naqd",
  "ogohlantirish": "string/null"
}`;

const stripMarkdown = (text) => {
  if (!text || typeof text !== "string") return "";
  let cleaned = text;
  cleaned = cleaned.replace(/```/g, "");
  cleaned = cleaned.replace(/`([^`]+)`/g, "$1");
  cleaned = cleaned.replace(/^#{1,6}\s+/gm, "");
  cleaned = cleaned.replace(/^>\s?/gm, "");
  cleaned = cleaned.replace(/^\s*[-*+]\s+/gm, "");
  cleaned = cleaned.replace(/^\s*\d+\.\s+/gm, "");
  cleaned = cleaned.replace(/\*\*([^*]+)\*\*/g, "$1");
  cleaned = cleaned.replace(/__([^_]+)__/g, "$1");
  cleaned = cleaned.replace(/\*([^*]+)\*/g, "$1");
  cleaned = cleaned.replace(/_([^_]+)_/g, "$1");
  cleaned = cleaned.replace(/\[([^\]]+)\]\([^)]*\)/g, "$1");
  return cleaned.trim();
};

const normalizeText = (value) => {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  if (typeof value === "object") {
    return (
      value.text ||
      value.conversation_text ||
      value.result ||
      JSON.stringify(value, null, 2)
    );
  }
  return String(value);
};

const tryParseJson = (value) => {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
};

const extractJson = (value) => {
  if (!value || typeof value !== "string") return null;
  const fence = value.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence?.[1]) {
    const parsed = tryParseJson(fence[1].trim());
    if (parsed) return parsed;
  }

  const first = value.indexOf("{");
  const last = value.lastIndexOf("}");
  if (first !== -1 && last > first) {
    const parsed = tryParseJson(value.slice(first, last + 1));
    if (parsed) return parsed;
  }

  return tryParseJson(value.trim());
};

export default function App() {
  const mediaRecorderRef = useRef(null);
  const chunksRef = useRef([]);
  const shouldSendRef = useRef(false);
  const streamRef = useRef(null);
  const audioContextRef = useRef(null);
  const animationRef = useRef(null);
  const canvasRef = useRef(null);
  const typingRef = useRef(null);

  const [recordingSupported, setRecordingSupported] = useState(true);
  const [isRecording, setIsRecording] = useState(false);
  const [transcript, setTranscript] = useState("");
  const [response, setResponse] = useState("");
  const [displayedResponse, setDisplayedResponse] = useState("");
  const [showTable, setShowTable] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const plainResponse = useMemo(() => stripMarkdown(response), [response]);
  const parsedResponse = useMemo(() => extractJson(response), [response]);
  const canShowTable = parsedResponse && typeof parsedResponse === "object";

  useEffect(() => {
    if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) {
      setRecordingSupported(false);
    }

    return () => {
      stopRecording(false);
      stopVisualizer();
    };
  }, []);

  useEffect(() => {
    if (typingRef.current) {
      clearInterval(typingRef.current);
      typingRef.current = null;
    }

    if (!plainResponse) {
      setDisplayedResponse("");
      return;
    }

    if (showTable) {
      setDisplayedResponse(plainResponse);
      return;
    }

    let index = 0;
    setDisplayedResponse("");
    typingRef.current = window.setInterval(() => {
      index += 1;
      setDisplayedResponse(plainResponse.slice(0, index));
      if (index >= plainResponse.length) {
        clearInterval(typingRef.current);
        typingRef.current = null;
      }
    }, 12);

    return () => {
      if (typingRef.current) {
        clearInterval(typingRef.current);
        typingRef.current = null;
      }
    };
  }, [plainResponse, showTable]);

  const startVisualizer = (stream) => {
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) return;

    const audioContext = new AudioContext();
    const analyser = audioContext.createAnalyser();
    analyser.fftSize = 256;
    const source = audioContext.createMediaStreamSource(stream);
    source.connect(analyser);

    audioContextRef.current = audioContext;

    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!ctx || !canvas) return;

    const bufferLength = analyser.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);

    const draw = () => {
      analyser.getByteFrequencyData(dataArray);
      const { width, height } = canvas;
      ctx.clearRect(0, 0, width, height);
      const barWidth = Math.max(2, width / bufferLength);
      let x = 0;

      for (let i = 0; i < bufferLength; i += 1) {
        const v = dataArray[i] / 255;
        const barHeight = v * height;
        ctx.fillStyle = `rgba(15, 23, 42, ${0.15 + v * 0.6})`;
        ctx.fillRect(x, height - barHeight, barWidth - 1, barHeight);
        x += barWidth;
      }

      animationRef.current = requestAnimationFrame(draw);
    };

    draw();
  };

  const stopVisualizer = async () => {
    if (animationRef.current) {
      cancelAnimationFrame(animationRef.current);
      animationRef.current = null;
    }
    if (audioContextRef.current) {
      await audioContextRef.current.close();
      audioContextRef.current = null;
    }

    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (ctx && canvas) {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
    }
  };

  const startRecording = async () => {
    setError("");
    setResponse("");
    setDisplayedResponse("");

    try {
      if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) {
        setRecordingSupported(false);
        setError("Brauzer ovoz yozishni qo'llamaydi.");
        return;
      }

      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const recorder = new MediaRecorder(stream);
      chunksRef.current = [];
      mediaRecorderRef.current = recorder;
      shouldSendRef.current = false;

      recorder.ondataavailable = (event) => {
        if (event.data && event.data.size > 0) {
          chunksRef.current.push(event.data);
        }
      };

      recorder.onstop = async () => {
        stream.getTracks().forEach((track) => track.stop());
        streamRef.current = null;
        await stopVisualizer();

        if (!shouldSendRef.current) {
          return;
        }

        const blob = new Blob(chunksRef.current, { type: "audio/webm" });
        await processAudio(blob);
      };

      recorder.start();
      setIsRecording(true);
      startVisualizer(stream);
    } catch (err) {
      setError(err.message || "Mikrofonga ruxsat berilmadi");
    }
  };

  const stopRecording = (send) => {
    shouldSendRef.current = send;
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
      mediaRecorderRef.current.stop();
    }
    setIsRecording(false);
  };

  const processAudio = async (blob) => {
    try {
      setLoading(true);

      const sttForm = new FormData();
      sttForm.append("file", blob, "recording.webm");
      sttForm.append("language", "uz");

      const sttRes = await fetch(apiUrl("/stt"), {
        method: "POST",
        body: sttForm
      });

      if (!sttRes.ok) {
        const data = await sttRes.json().catch(() => ({}));
        throw new Error(data.error || "STT so'rovi muvaffaqiyatsiz");
      }

      const sttData = await sttRes.json();
      const sttText = normalizeText(
        sttData.text ?? sttData.result ?? sttData.raw?.text ?? sttData.raw?.conversation_text
      );
      setTranscript(sttText);

      const genRes = await fetch(apiUrl("/generate"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: sttText, systemPrompt: defaultPrompt })
      });

      if (!genRes.ok) {
        const data = await genRes.json().catch(() => ({}));
        throw new Error(data.error || "Gemini so'rovi muvaffaqiyatsiz");
      }

      const genData = await genRes.json();
      setResponse(normalizeText(genData.output));
    } catch (err) {
      setError(err.message || "So'rov muvaffaqiyatsiz");
    } finally {
      setLoading(false);
    }
  };

  const clearAll = () => {
    stopRecording(false);
    setTranscript("");
    setResponse("");
    setDisplayedResponse("");
    setError("");
    setShowTable(false);
  };

  return (
    <div className="page">
      <section className="panel">
        <div className="brand">Ovozli buyurtma</div>

        {!recordingSupported && (
          <div className="warning">
            Brauzeringiz audio yozishni qo'llamaydi. Chrome yoki Edge ishlating.
          </div>
        )}

        <div className={`visual ${isRecording ? "active" : ""}`}>
          <canvas ref={canvasRef} width="720" height="140" />
          {!isRecording && <div className="visual-hint">Ovoz yozish uchun Yozish tugmasini bosing</div>}
        </div>

        {error && <div className="error">{error}</div>}

        <div className="card response-card">
          <div className="card-title row">
            <span>Gemini javobi</span>
            {canShowTable && (
              <button
                className={`chip ${showTable ? "active" : ""}`}
                onClick={() => setShowTable((prev) => !prev)}
                type="button"
              >
                <span className="icon" aria-hidden="true">
                  <svg viewBox="0 0 24 24" fill="none">
                    <rect x="4" y="5" width="16" height="14" rx="2" stroke="currentColor" strokeWidth="1.6" />
                    <path d="M4 10h16M9 5v14" stroke="currentColor" strokeWidth="1.6" />
                  </svg>
                </span>
                Jadval
              </button>
            )}
          </div>

          {loading ? (
            <div className="ai-thinking">
              <div className="loader">
                <span className="loader-dot" />
                <span className="loader-dot" />
                <span className="loader-dot" />
              </div>
              <div>AI o'ylayapti...</div>
            </div>
          ) : showTable && canShowTable ? (
            <div className="table">
              {Object.entries(parsedResponse).map(([key, value]) => (
                <div className="table-row" key={key}>
                  <div className="table-key">{key}</div>
                  <div className="table-value">
                    {typeof value === "string" ? value : JSON.stringify(value)}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="response-body">
              {displayedResponse || "—"}
            </div>
          )}
        </div>

        <div className="controls-simple">
          <button
            className="ghost"
            onClick={clearAll}
            disabled={loading}
          >
            <span className="icon" aria-hidden="true">
              <svg viewBox="0 0 24 24" fill="none">
                <path
                  d="M3 6h18M8 6v12m8-12v12M6 6l1-3h10l1 3M9 21h6"
                  stroke="currentColor"
                  strokeWidth="1.6"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </span>
            Tozalash
          </button>

          <button
            className={`mic ${isRecording ? "live" : ""}`}
            onClick={startRecording}
            disabled={!recordingSupported || isRecording || loading}
          >
            <span className="icon" aria-hidden="true">
              <svg viewBox="0 0 24 24" fill="none">
                <path
                  d="M12 3a3 3 0 0 1 3 3v5a3 3 0 0 1-6 0V6a3 3 0 0 1 3-3Z"
                  stroke="currentColor"
                  strokeWidth="1.6"
                />
                <path
                  d="M5 11a7 7 0 0 0 14 0M12 18v3M8 21h8"
                  stroke="currentColor"
                  strokeWidth="1.6"
                  strokeLinecap="round"
                />
              </svg>
            </span>
            {isRecording ? "Yozilmoqda" : loading ? "Yuborilmoqda..." : "Yozish"}
          </button>

          <button
            className="primary"
            onClick={() => stopRecording(true)}
            disabled={!isRecording || loading}
          >
            <span className="icon" aria-hidden="true" style={{transform:'rotate(180deg)'}}>
              <svg viewBox="0 0 24 24" fill="none" className="icon-send">
                <path
                  d="M4 12l15-7-4 7 4 7-15-7Z"
                  stroke="currentColor"
                  strokeWidth="1.6"
                  strokeLinejoin="round"
                />
              </svg>
            </span>
            Yuborish
          </button>
        </div>
      </section>
    </div>
  );
}
