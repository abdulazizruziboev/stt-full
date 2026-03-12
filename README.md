# Voice to Text -> Gemini (React + Node)

Full-stack demo: user records voice in the browser, backend sends audio to Uzbekvoice STT, then sends the transcript to Gemini and returns the result.

## Requirements
- Node.js 18+
- Gemini API key from Google AI Studio
- Uzbekvoice STT auth token

## Local setup

### 1) Backend
```bash
cd server
cp .env.example .env
# edit .env and set GEMINI_API_KEY + UZBEKVOICE_AUTH
npm install
npm run dev
```

### 2) Frontend
```bash
cd client
cp .env.example .env
npm install
npm run dev
```

Open the frontend URL (usually `http://localhost:5173`).

## API
- `POST /api/stt` (multipart/form-data)
  - fields: `file`, `return_offsets`, `run_diarization`, `language`, `blocking`, `webhook_notification_url`
- `POST /api/generate` (json)
  - body: `{ "text": "...", "systemPrompt": "..." }`
- `POST /api/voice-to-gemini` (multipart/form-data)
  - fields: `file`, `language`, `systemPrompt`

## Netlify deploy (frontend + backend)

This repo is configured to deploy to Netlify with serverless functions.

1. Push the repo to GitHub.
2. In Netlify, create a new site from the repo.
3. Build settings (already in `netlify.toml`):
   - Build command: `npm --prefix client install && npm --prefix client run build`
   - Publish directory: `client/dist`
   - Functions directory: `netlify/functions`
4. Add environment variables in Netlify (Site settings → Environment variables):
   - `GEMINI_API_KEY`
   - `GEMINI_MODEL` (optional, default `gemini-2.5-flash`)
   - `UZBEKVOICE_URL` (optional, default `https://uzbekvoice.ai/api/v1/stt`)
   - `UZBEKVOICE_AUTH`

Notes:
- The frontend calls `/api/*` in production; Netlify redirects it to the function.
- If you need to pin the Node runtime, set `NODE_VERSION` in Netlify.

## Notes
- Browser recording works best in Chrome/Edge.
