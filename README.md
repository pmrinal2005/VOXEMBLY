# VOXEMBLY — The Voice-Native Cognition OS

**Tagline:** *Voice is the new compiler.*

Every 5–120s dictation becomes a typed, versioned, executable **Thoughtform** that mutates your Cognitive Twin, dispatches specialist agents, and time-travels like Git for your mind.

Built on **AssemblyAI Universal-3.5 Pro Sync STT** (`POST https://sync.assemblyai.com/transcribe`, `X-AAI-Model: universal-3-5-pro`) with dynamically composed `prompt` + `keyterms_prompt`, `GET /warm` pre-warm, and GroqCloud cleanup + Agent Council.

## Stack

- Next.js (App Router) + TypeScript + Tailwind
- PostgreSQL via Drizzle ORM (published Thoughtforms + health)
- IndexedDB (local Cognitive Twin, offline drafts)
- AssemblyAI Sync STT / Dictation
- GroqCloud (compile + 5 specialist agents)

## Local setup

```bash
cp .env.example .env.local
# fill ASSEMBLYAI_API_KEY and GROQ_API_KEY (optional — simulated path works without them)

npm install
npx drizzle-kit push
npm run dev
```

Open `/studio`. Hold **Space** (or the Orb) to dictate. `?seed=demo` loads a pre-built Twin.

Without `ASSEMBLYAI_API_KEY` the transcribe route returns labeled **simulated** clips so the rest of the loop (compile → graph → council → publish) still demos.

## Manual Vercel deploy

1. Push this repo to GitHub.
2. Import the project in [Vercel](https://vercel.com/new). Framework preset: **Next.js**.
3. Set environment variables (Production + Preview):

   | Key | Required | Notes |
   |---|---|---|
   | `DATABASE_URL` | yes | Neon / Supabase Postgres / any Postgres 15 |
   | `ASSEMBLYAI_API_KEY` | for live STT | [assemblyai.com/app](https://www.assemblyai.com/app) |
   | `GROQ_API_KEY` | for compile + council | [console.groq.com/keys](https://console.groq.com/keys) |
   | `NEXT_PUBLIC_AAI_REGION` | no | `global` (default), `us`, or `eu` |
   | `JINA_API_KEY` | no | embeddings; hash fallback if unset |
   | `NEXT_PUBLIC_SITE_URL` | no | used in share URLs |

4. After first deploy, apply schema:

   ```bash
   npx drizzle-kit push
   ```

   or run the equivalent SQL against `DATABASE_URL` (tables: `profiles`, `thoughtforms`, `branches`, `published_thoughtforms`, `audit_events`).

5. Redeploy. Health: `GET /api/health` → `{ ok: true, dictation, llm, … }`.

## AssemblyAI usage (verified against official docs)

- **Transcribe:** `POST https://sync[.us|.eu].assemblyai.com/transcribe`
  - Header `Authorization: <API_KEY>` (raw, not Bearer)
  - Header `X-AAI-Model: universal-3-5-pro`
  - Multipart: `audio` (WAV 16 kHz mono or raw PCM) + `config` JSON (`prompt`, `keyterms_prompt`, `language_code`)
- **Pre-warm:** `GET https://sync.assemblyai.com/warm` on key-down
- Consumed fields: `text`, `words[].confidence`, `confidence`, `audio_duration_ms`, `session_id`, `request_time_ms`

The Prompt Composer rebuilds `prompt` (≤50 words) and `keyterms_prompt` (≤2048 chars) from the live Twin before every request — the bi-directional memory loop.

## Routes

| Path | What |
|---|---|
| `/studio` | Push-to-Think canvas (Orb, Twin, Timeline, Council) |
| `/t/[hash]` | Public Thoughtform artifact |
| `/api/transcribe` | Sync STT proxy |
| `/api/warm` | TLS pre-warm |
| `/api/compile` | Groq Intent Kernel |
| `/api/agents` | NDJSON Agent Council |
| `/api/embed` | Embeddings |
| `/api/publish` | Persist public artifact |
| `/api/translate` | Locale rewrite |
| `/api/search` | Researcher web search |
| `/api/health` | Config + DB ping |

## Keyboard / voice grammar

- Hold **Space** / Orb — Push-to-Think
- **Esc** — cancel
- **A** — Ambient Mode
- **C** — Convene Council
- **B** / **M** — fork / merge
- Voice: *“checkout my Tuesday brain”*, *“branch this into Plan A and Plan B”*, *“convene the council”*, *“publish this”*
