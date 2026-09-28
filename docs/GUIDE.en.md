# 月映卡语

*English · [简体中文](./GUIDE.zh-CN.md)*

A tarot and AI reflection web app for exploring questions and personal perspectives, built with **Next.js 16 (App Router) + React 19 + TypeScript 5 (strict) + Tailwind CSS 4**.

It ships the complete 78-card Rider–Waite–Smith deck, six spreads, deterministic daily draws, a fully agentic reading mode, and streaming AI interpretation from any OpenAI-compatible Chat Completions endpoint.

A WeChat Mini Program shell now embeds the existing website through `web-view`, reusing the React pages, CSS, and APIs. Import this repository root in WeChat DevTools and run `npm run dev:miniapp` for local development. See [Mini Program setup](./MINIAPP.md) for environment URLs, HTTPS business domains, and release checks.

> **Note on language:** the application UI and the AI prompts are written in **Simplified Chinese**. This guide documents the project in English; the Chinese guide lives in [GUIDE.zh-CN.md](./GUIDE.zh-CN.md).

---

Documentation index: [docs/README.md](./README.md). Commands below run from the repository root; listen addresses and ports follow [server configuration](./CONFIG.md).

## Features

| | |
|---|---|
| 🃏 **Full deck** | 78 Rider–Waite–Smith cards (22 Major Arcana + 4 suits × 14), each with upright/reversed keywords and meanings |
| 🖐️ **Touch card selection** | Slide along the fan to preview; pinch to zoom from 75% to 200% and move with two fingers. Tap the highlighted card again, pull outward and release, or use the keyboard to draw |
| 🌙 **Deck-focused selection** | Each drawn card flies out face down, enlarges briefly, and folds into the progress area before the count and small card markers update. Undo restores the last card. The final animation finishes before opening the reveal view; reduced motion uses a brief stationary fade |
| ✨ **Six spreads** | Single Card, Three Card, Two Options, Relationship, Timeline, Celtic Cross |
| 🔮 **Streaming interpretation** | Server-Sent Events straight through to the UI, including `thinking` / reasoning deltas from reasoning models |
| 🤖 **Agent mode** (`/agent`) | Chat-style flow where the LLM picks the spread itself, draws, and interprets — the user only asks a question |
| 💬 **Follow-up questions** | The model decides whether it can answer directly or needs supplementary cards, then draws and re-interprets |
| 🌅 **Daily card** (`/daily`) | Deterministic draw — everyone gets the same card on a given local date — with a personal reflection note and optional AI reading |
| 📖 **Card library** (`/library`) | Browse and filter the whole deck with detail views |
| 🕰️ **History** (`/history`) | Readings, follow-ups and chat messages stored in PostgreSQL per WeChat account, with detail pages and deletion |
| ⚙️ **Shared AI service** | All AI features use server-side model configuration; visitors need no API settings |

---

## Tech stack

- **Framework:** Next.js 16 (App Router, Node.js runtime for the API routes)
- **UI:** React 19, Tailwind CSS 4 (layer-free imports for the existing WeChat DevTools renderer, with `@theme inline`), glassmorphism dark theme
- **Language:** TypeScript 5, `strict` mode — no `any`, no `@ts-ignore`
- **Markdown:** `react-markdown` for rendering interpretations
- **Tests:** Vitest 4 + Testing Library + jsdom
- **Lint:** ESLint 9 flat config (`eslint.config.mjs`, `eslint-config-next`)
- **Node:** 24.x (see `.nvmrc`)

---

## Getting started

```bash
npm install
npm run dev          # http://localhost:3000
```

Other scripts:

```bash
npm run build        # production build
npm run start        # serve the production build
npm run lint         # ESLint
npm run test         # Vitest, single run
npm run test:watch   # Vitest, watch mode
```

Card images are committed under `public/cards/`. To re-fetch them from the public archive source:

```bash
node scripts/download-cards.js
```

---

## Configuring the LLM

The app never talks to the LLM from the browser directly — requests go to `POST /api/interpret`, which forwards them upstream and pipes the SSE stream back.

All backend runtime settings live in the root-level `model.config.json` file. Create it from `model.config.example.json` and fill in your key:

```json
{
  "MODEL_BASE_URL": "https://api.deepseek.com",
  "MODEL_API_KEY": "your-api-key-here",
  "MODEL_ID": "deepseek-v4-flash"
}
```

The JSON snippet above shows only model fields; copy the complete example and fill all required settings before starting.

The file is ignored by Git and read on every AI request, so edits take effect without restarting. Keep it in the server project root when deploying; the Next.js build includes it in API route file tracing. The frontend has no settings controls and receives no provider credentials. Old browser settings and `MODEL_*` environment variables are ignored.

Also configure `DATABASE_URL`, `WECHAT_APP_ID`, and `WECHAT_APP_SECRET` in the same file, then run `npm run db:migrate`. See [database and login setup](./DATABASE.md) for the schema, authentication flow, and integration tests.

All image files are stored in OSS, with URLs registered in PostgreSQL. After configuring OSS in `model.config.json`, run `npm run images:sync` following the database migration. New avatars are uploaded automatically. See [OSS setup and verification](./OSS.md).

AI requests have no application-level hourly quota. Backend environment overrides and request-body provider settings are ignored. Missing numeric settings fail explicitly; the example file is a setup template only. See [backend configuration](./CONFIG.md) for timeouts, connection pool settings, login lifetimes, and server listen addresses.

---

## How it works

### Reading flow (`/reading`)

`question → spread → shuffle → draw → reveal → interpret`

The manual draw table keeps the fan stable while nearby cards spread and lift around the preview. Zoom controls are gestures inside the deck; there is no visible zoom toolbar. Short or cancelled pulls do not draw a card. See [gesture acceptance](./design-qa.md) for evidence and remaining WeChat device checks.

Cards are drawn client-side by a random draw function (`lib/tarot/draw.ts`), each with a 50 % reversal chance; the prompt (`lib/api/prompts.ts`) then describes the question, spread positions, and drawn cards to the model.

### Agent flow (`/agent`)

One agent turn (`lib/agent/agentTurn.ts`) is:

1. **Choose spread** — the model picks one of the six spreads and explains why, returning JSON-only output (`lib/agent/spreadChoice.ts`).
2. **Draw** — client-side random selection, no model involvement.
3. **Interpret** — streamed, reusing the same interpretation prompts as the manual flow.

Follow-up turns run `decide → (optionally draw supplementary cards) → interpret`. Every step is driven by event callbacks so the UI can render each stage as it happens, and turns can be cancelled or regenerated.

### Streaming reliability

Agent conversations and unsent drafts live in the shared authenticated session, so navigating between web routes keeps an active response running. Returning to the same reading reuses its in-memory state and skips reveal animations for existing cards. Refreshing or closing the website is outside this lifetime. Model reasoning is shown only during generation and is hidden when generation ends.

Long-thinking models can stay silent for minutes, so the stream path is hardened at both ends:

- **Server** (`app/api/interpret/route.ts`): `maxDuration = 300`, a 180 s upstream connect timeout, a 180 s inter-chunk idle guard, `: keepalive` SSE heartbeats every 15 s, and `X-Accel-Buffering: no` to stop proxies from buffering.
- **Client** (`lib/api/stream-client.ts`): connect and idle timeouts, `AbortController` cancellation, automatic retries with exponential backoff for retryable errors (surfaced in the UI as "retrying N/M"), and structured error classification (`lib/api/errors.ts`).
- Upstream error bodies are scrubbed of bearer tokens and `sk-…` keys before reaching the client.

---

## Project structure

```text
.
├─ app/
│  ├─ api/
│  │  ├─ interpret/route.ts   # LLM proxy: validation, server config, guarded SSE passthrough
│  │  └─ config/route.ts      # reports service availability without credentials
│  ├─ page.tsx                # landing
│  ├─ reading/page.tsx        # manual reading flow
│  ├─ agent/page.tsx          # agentic chat reading
│  ├─ daily/page.tsx          # daily card + reflection notes
│  ├─ library/page.tsx        # 78-card browser
│  ├─ history/                # timeline list + [id] detail page
│  ├─ layout.tsx
│  └─ globals.css             # theme variables, animations, 3D transforms
├─ docs/                      # project guides, configuration, task records and evidence
├─ miniprogram/               # native WeChat login and web-view shell
├─ components/                # FanDeck, ManualDrawTable, TarotCard, Interpretation, …
├─ hooks/                     # useReading, useAgentChat, useApiConfig, useConfirm
├─ lib/
│  ├─ tarot/                  # cards, spreads, draw, daily, types, SSE parsing
│  ├─ api/                    # prompts, stream client, stream buffer, error classification
│  ├─ agent/                  # turn orchestration, spread-choice decision step
│  ├─ readingStorage.ts       # authenticated database history API client
│  └─ dailyStorage.ts         # authenticated daily records and reflection notes API client
├─ tests/                     # Vitest suites: cards, spreads, daily, SSE utils, stream buffer
├─ public/cards/              # Rider–Waite–Smith imagery
└─ scripts/download-cards.js  # re-download card imagery
```

---

## Data & privacy

- Chat messages and reading history are stored in PostgreSQL and isolated by the authenticated WeChat user. Daily draws, reflection notes and AI interpretations are also stored per account and date. Legacy device notes can be explicitly imported from the daily page.
- The server saves questions before model requests, checkpoints streamed replies, and records completion or interruption independently of the browser.
- The shared API key is stored only in the private server configuration file and sent only to the configured model provider.

---

## Contributing

Conventions used throughout the codebase:

- **Strict TypeScript** — no `any`, no `@ts-ignore`, explicit return types on functions and components
- **Named exports** for components, with a `{ComponentName}Props` interface for props
- `'use client'` on anything using hooks or browser APIs; server components by default
- `@/*` path alias for root-relative imports, ordered React/Next → third-party → `@/lib` → `@/hooks` → `@/components` → relative
- Tailwind utilities over inline styles; `globals.css` only for CSS variables, animations, 3D transforms and scrollbars
- User-facing strings and error messages in Simplified Chinese
- Domain types centralised in `lib/tarot/types.ts`; state via React built-ins, no external store

Run `npm run lint && npm run test` before opening a PR.

---

## License

Source code is released under the [MIT License](../LICENSE).

That covers the code only — **not** the card imagery under `public/cards/`. Those files are derived from the Rider–Waite–Smith deck (Pamela Colman Smith, 1909), public domain in the US and most jurisdictions, but the specific scans come from a third-party archive. Confirm the terms applying to them yourself before redistributing or using them commercially.
