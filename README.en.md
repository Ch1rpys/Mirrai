# Mirrai

> *"When they're not beside you, they're still here."*

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![CI](https://github.com/Ch1rpys/Mirrai/actions/workflows/ci.yml/badge.svg)](https://github.com/Ch1rpys/Mirrai/actions/workflows/ci.yml)
[![GitHub Stars](https://img.shields.io/github/stars/Ch1rpys/Mirrai?style=social)](https://github.com/Ch1rpys/Mirrai/stargazers)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.9-3178c6.svg)](https://typescriptlang.org)
[![React](https://img.shields.io/badge/React-19-61dafb.svg)](https://react.dev)
[![Node.js](https://img.shields.io/badge/Node.js-24+-339933.svg)](https://nodejs.org)

<p>
  <a href="https://atomgit.com/Ch1rpys/Mirrai"><img alt="AtomGit" src="https://atomgit.com/Ch1rpys/Mirrai/star/new_badge.svg"></a>
</p>

[简体中文](README.md) | **English**

![Mirrai landing page](docs/images/landing-hero.png)

Mirrai is an open-source, self-hosted AI companion that rebuilds a person's digital persona from real chat history — their tone, their habits, even the moments they go cold. Every byte stays on your machine, 12 LLM providers plug in out of the box, and it ships with something no other companion product has: a **graduation mechanism** — designed not to keep you, but to help you say goodbye.

> ⚠️ The app UI is Chinese-first: Simplified Chinese, plus a machine-converted Traditional Chinese interface. Full localisation into other languages is on the [roadmap](#roadmap). English-speaking users can still set it up, the landing page is bilingual, and the emotion trigger words have English versions.

## Why Mirrai is different

| | |
|---|---|
| 🧬 **Multi-stage persona distillation** | A real pipeline (intake → persona analysis → structured build → merge) produces a 7-layer persona: personality, speaking style, catchphrases, attachment style, love language, conflict style, touching moments. Not a "paste logs into a prompt" wrapper. |
| 🎭 **Dynamic emotion state machine** | 6 emotional states (warm / playful / nostalgic / melancholic / happy / distant) drift with the conversation and change reply tone in real time. The state is inferred by the LLM reading the exchange, with a keyword heuristic as fallback. |
| 🎓 **Graduation mechanism** | Intimacy grows through conversation. When the system detects you're at peace, it offers "graduation": an AI-written farewell letter, then the persona sleeps. Success is measured by graduation rate, not retention. The mechanism is only ever a suggestion — you choose whether the app may raise it (suggest / manual only / off), globally or per persona. An offer is made once and then goes quiet for a while; a refusal is not a closed door. After graduation the persona stops receiving reminders, stops being recommended, and stops answering — but the letter is kept, and waking the persona does not destroy it. There is a third state too: **take a break**, for when you want neither a goodbye nor a conversation. |
| 🧠 **Memory that grows on its own** | After enough has been said, the persona extracts what was worth keeping on its own — no button, and pressing a button twice no longer stores everything twice. Every reply shows which memories it recalled, so a detail from three months ago is visibly *recalled* rather than invented. Memories about you and memories about them are kept apart. |
| ✉️ **Letters, and the distance** | Some things cannot be said into a chat box. Write one and keep it forever, or hand it over — it is answered about a day later, because a person does not reply in three seconds. There is also a list of things to say "when they come back", and a **"we can't reach each other right now"** state that is deliberately *not* a breakup: the reminders stop and the register turns to a letter's. |
| 💬 **They can speak first** | Off by default. The frequency is yours to set, and zero is a real value: an app that speaks first is something you buy, not something you are given. When it is on, it goes out over the channel you have already bound — WeChat, Feishu — and it respects your quiet hours. |
| 🔌 **12 LLM providers** | OpenAI, Claude, DeepSeek, Kimi, Qwen, Doubao, 302.ai, Atlas Cloud, Cheaper Inference, Dify, Xunfei — and Ollama for fully local inference. |
| 💬 **WeChat via official ClawBot** | Connect to WeChat through the official "ClawBot" plugin (Tencent iLink protocol) — scan a QR code, authorize, and chat with your persona in WeChat. Shares persona and memory with the web app. **No ban risk**: this is a first-party WeChat channel, not a third-party protocol. | |
| 🔒 **Local-first** | Uploads stay in `./uploads/`. With Ollama, nothing ever leaves your machine. |

## Comparison

| Capability | Mirrai | Character.AI / Linky | SillyTavern |
|---|---|---|---|
| Persona built from real chat logs | ✅ multi-stage distillation | ❌ manual | ⚠️ manual prompting |
| Emotion states drift with conversation | ✅ 6-state machine | ⚠️ limited | ⚠️ manual |
| Fully local data | ✅ | ❌ cloud | ✅ |
| Swappable LLM backends | ✅ 12 providers / local | ❌ locked | ✅ |
| Designed to help you let go | ✅ graduation | ❌ | ❌ |
| Open source, self-hosted | ✅ MIT | ❌ | ✅ |

## What stage six added

Stage six had two goals: **sound more like them**, and **be useful enough to keep using**. Of the 164 proposals, 80 are implemented and tested, 81 pass every machine check but their effect still needs real records to measure, one was decided against (voice cloning), and two had their preconditions unmet — the local adapter and shallow fusion only got a read-only unlock-check command. The feature list below covers only those first two states; the last two lines say what was not built. A 🟡 line means **effect not yet measured on real records**.

Per-item evidence lives in [`docs/exec-v6-progress.md`](docs/exec-v6-progress.md); the per-work-package status table is [`docs/roadmap-v6.md`](docs/roadmap-v6.md).

**Records and import**

- ✅ One record table for every source — uploads, collectors, screenshots, oral accounts, group chats — carrying message kind, original speaker, source file, line number and per-kind metadata (A1–A4); 17 built-in import formats — WeChat (two TXT shapes, CSV, JSON), QQ (TXT, MHT), Telegram, WhatsApp, LINE, KakaoTalk, Instagram/Messenger, Discord, Android SMS, iMessage database, generic line, column mapping, monologue — plus `.zip` archive unpacking, with a wizard that detects the format, asks who is who and previews the counts before writing, and re-imports that only add the new tail (C1.1–C1.3, C1.5).
- ✅ Stickers, images, voice, video, location, links, transfers, red packets, pats, recalls, calls, files and system messages all enter the table as language-neutral tokens; optional redaction before import, and deleting a source deletes the records it brought in (C1.3, C1.6, C1.7).
- 🟡 Import paths beyond chat logs: interviews (typed or recorded), diaries and articles, screenshots read into records, video (frames plus transcript), and public posts with their own measured register (C1.8, B7.10–B7.12; effect not yet measured on real records).

**Reading and measuring**

- ✅ Chunked distillation: records are split into chunks, only new chunks are re-run, every conclusion carries the line it came from, and each rebuild keeps a version you can look at and restore (B1.1, B1.3, B1.7–B1.9).
- ✅ One clarifying question at a time when the records are not enough; a tone fingerprint (endings, particles, laughter, length, emoji, words they never use), fingerprint distance, micro-rules and per-mood imperfection drafts; memories carry entities and an old, barely-mentioned memory is marked "you don't remember it clearly" in the prompt (B1.6, B3.1, B3.2, B3.5, B3.6, B6.7, B6.8).
- 🟡 Measurements taken from the records: acts conditioned on what you did, act clusters, emotional inertia, conflict scripts, triggers, closings, multi-point messages, in-session openers, reply-delay buckets, sleep window, typing rhythm, quirks, double texts, address history, private words, embedding-based exemplar retrieval, people, likes and dislikes, routine and life events, knowledge boundaries, fact checking, and the ledger of things they said (B2.3, B3.3, B3.4, B3.7, B3.8, B4.1–B4.8, B5.3–B5.7, B6.1–B6.6, B6.9; effect not yet measured on real records).
- 🟡 New ways to measure "does it still sound like them": discriminator AUC, in-app blind sessions, layer-by-layer ablation, drift detection, multi-model auditions, and A/B-chosen rerank weights (B8.1–B8.5, B8.8; effect not yet measured on real records).

**Generation**

- ✅ One generation path: chat and eval call the same `planTurn` / `executePlan`, eval can switch individual layers off, and a persona with no stage-six data keeps its prompt byte-for-byte identical; any measured layer can be switched off from the inference view, and a message's true record lines can be underlined in chat (P0.3, P0.6, C10.6, C10.7).
- 🟡 New prompt layers — seeded turns, ritual replies, style samples and drift reminders, act adjacency, act clusters, triggers, closings — and the expensive or unmeasured ways of generating: two-stage (decide the content first, then the voice), like/unlike contrast rewrites, length caps, fingerprint reranking, punctuation projection and cache-friendly prompt layout (B2.1, B2.2, B2.4–B2.7, B2.9, B3.3, B3.4, B4.1, B4.2, B4.5, B4.6; effect not yet measured on real records).
- 🟡 The persona can call three tools: set a reminder, send a real photo attached to a memory, look up the weather on their side (C9.4; effect not yet measured on real records).

**Time and rhythm**

- ✅ A burst of messages is answered once, a later message takes the turn away, a half reply is never stored; time capsules unlock on their day; reminders keep their quiet hours and stop with the taper and the seal (B5.1, C5.3, C6.1, C6.2).
- 🟡 Replying on their own clock — delay buckets, sleep window, typing indicator, deferred replies, in-session closings, typo fixes / recalls / pats, follow-up lines — and the same rhythm over channels: split bubbles, delayed delivery, one send per message (B5.2–B5.8; effect not yet measured on real records — for the channel half, what is missing is a real WeChat / Feishu account).

**Beyond text**

- 🟡 Stickers: the measured probability of a sticker in each mood is used when generating (B7.1; effect not yet measured on real records).
- 🟡 Voice: imported voice notes become media, optionally transcribed by a local whisper.cpp; real recordings can be played, downloaded and favourited; synthesised voice notes and read-aloud take speed and pauses from the measured prosody, using Edge, local piper or a local HTTP engine (B7.2–B7.6; effect not yet measured on real records).
- 🟡 Photos: EXIF, a photo timeline, avatars only from real photos, in-browser face clustering; generation can send a real photo attached to the recalled memory (B7.8, B7.9; effect not yet measured on real records).
- 🟡 Video (frames plus transcript), phone mode (live speech both ways), call-habit profile, three chat skins (B7.10, B7.13–B7.15; effect not yet measured on real records).

**Looking back at real records**

- ✅ A record reader with paging, jump-to-line from search or a quote, bookmarks and annotations, sticker rendering and harm-line folding; "did they say this", keyword search, your shared vocabulary, on this day, firsts and lasts (C2.1–C2.3, C2.6, C2.7, C2.10).
- 🟡 The yearly report and the relationship heart-rate chart (span, active days, longest silence, heat map, yearly frequent words, turning points you confirm or reject), plus the map and songs, the printable manual and semantic recall on top of the search index (C2.4, C2.5, C2.8, C2.9, C8.6, C8.7; effect not yet measured on real records).

**Bringing it back to the real person — and your side**

- ✅ The exit list: things said only here are collected in one place and you decide whether to say them; "I said it" is recorded, and the system never sends anything (C3.3, C3.5).
- 🟡 Rehearsal room (only action-level possibilities, no promise-shaped conclusions), role reversal (time-boxed, once a day), wording helper (three rewrites, applied only when you take one), "read this line", the wait gauge (C3.1, C3.2, C3.4, C3.6, C4.4; effect not yet measured on real records).
- 🟡 The mirror: your side measured and shown only to you; trends and graduation conditions stated without scores; a printable summary for a counsellor or for yourself (C4.1, C4.3, C4.6; effect not yet measured on real records).
- ✅ A check-in after a long conversation, your own journal and personal timeline; the "no surveillance" rule is a structural test (C4.2, C4.5, C10.4).

**Distance, farewell, memorial**

- ✅ Reunion countdown, their local weather and sunrise/sunset (the city name is sent once, then only coarse coordinates), letter replies by email, a reunion summary, a four-step taper and sealing a persona (name and dates only until the day) (C5.1, C5.2, C5.4–C5.5, C6.1, C6.2).
- ✅ Three kept quotes and a printable memory book with automatic redaction in the shared version (C6.3, C6.4).
- 🟡 Finishing an unfinished sentence for you, reading letters side by side, a post-graduation check-in, and four different endings each with its own letter (C6.5, C6.6; effect not yet measured on real records).
- ✅ Memorial mode (no talk of "now", says it is a reconstruction when asked), family sharing (each member keeps their own side), oral accounts (C7.1–C7.4).

**Daily use and safety**

- ✅ A global inbox, complete backup and restore (a backup is required before encryption can be enabled; restore goes into an empty instance only; local folder / WebDAV / S3), app lock (PIN, passkey, idle lock) and encryption at rest for database text; recycle bin with undo, marks / pins / quoted records, one-click diagnostics (19 checks), accessibility settings, Traditional Chinese UI and English emotion trigger words (C8.2–C8.5, C8.10–C8.12, C8.14).
- 🟡 Web push (notifications while the app is closed), native shells (macOS menu bar, Windows tray, PWA share target), a cost panel (tokens and spend, with prices you enter), the scene panel (talk inside a stretch of records or one day) (C8.1, C8.8, C8.9, C8.13; effect not yet measured on real records).
- ✅ Safety and ethics: harm-line detection and filtering, a consent tool (a "no" purges that persona's records and keeps no content), late-night protection (the chat dims and animations stop), the inference view, provenance underlines (C10.1, C10.3, C10.5–C10.7).
- 🟡 Semantic crisis recognition: indirect wording plus local embedding similarity, alongside the keyword table (C10.2; effect not yet measured on real records).

**Channels and ecosystem**

- 🟡 Telegram, Discord and Matrix bots (paste a token, bind a private chat with a six-digit code) (C9.1; effect not yet measured on real records — what is missing here is a real bot account).
- ✅ An OpenAI-compatible endpoint (other programs use a persona as an OpenAI model), an MCP server (Claude Desktop / Cursor read personas, search records, read the yearly report), a command line (C9.2, C9.3, C9.6).
- ✅ Persona bundles (records, memories and media in one encrypted file, imported as a new persona on another machine), a local plugin system (off by default), and a VitePress docs site (C9.5, C9.7).
- 🟡 Group chat: several personas in one room, a mention is always answered, personas never talk to each other on their own, and nothing is written into their one-to-one data (C9.8; effect not yet measured on real records).

**Model layer**

- 🟡 Per-purpose provider roles (classification / planning / reply / rewrite), per-persona sampling, `extraBody`, `--tune` grid search; `logit_bias` to ban words they would never use, and a grammar to cap lines (B2.8, B9.3; effect not yet measured on real records).
- 🔒 The local adapter and shallow fusion were not built; they only got a read-only unlock check (`pnpm eval -- --unlock-check --persona <id> --user <id>`), which answers whether the conditions are met, not whether to build it (B9.1, B9.2).
- ⛔ Voice cloning (B7.7), a generated face and an animated avatar were decided against in this stage.

## Quick start

### Docker (recommended)

```bash
git clone https://github.com/Ch1rpys/Mirrai.git
cd Mirrai
cp .env.example .env   # set JWT_SECRET and at least one LLM API key
docker compose up -d
```

Then open http://localhost:3000 — PostgreSQL is included.

### From source

Requirements: Node.js 24+, pnpm, PostgreSQL 14+, Python 3.9+ (optional, for the distillation engine)

```bash
git clone https://github.com/Ch1rpys/Mirrai.git
cd Mirrai
pnpm install
pip3 install -r skill-engine/requirements.txt   # optional
cp .env.example .env                            # configure DATABASE_URL, JWT_SECRET, an LLM key
createdb mirrai
pnpm db:push                                    # a fresh install; use pnpm db:migrate to upgrade
pnpm dev
```

Redis is optional: without it the app still runs and the rate limiter counts in process.
To have the limits mean the same thing across instances, `pnpm setup:redis` installs one
and the app takes care of the rest.

### macOS one-click

Download `Mirrai-macOS-arm64.dmg` from [Releases](https://github.com/Ch1rpys/Mirrai/releases) — Node.js and PostgreSQL bundled, zero dependencies (Apple Silicon, macOS 13+).

### Windows one-click

Download `Mirrai-Setup-x64.exe` from [Releases](https://github.com/Ch1rpys/Mirrai/releases) and run the installer — Node.js and PostgreSQL are bundled, so there is no database to install, no administrator rights needed, and nothing is written to the registry (Windows x64).

After the install, start Mirrai from the Start menu (or the desktop). A window with a **progress bar** shows what is happening — "initialising the database", "synchronising the schema", "starting the server", "ready" — so the first launch, which does take a minute or two, never looks like it has hung. Data lives in `%APPDATA%\Mirrai`; uninstalling goes through "Apps & features".

> PostgreSQL refuses to run under an Administrator account on Windows. If you started it from an elevated prompt, run it as a normal user instead.

To build it yourself: `powershell -ExecutionPolicy Bypass -File scripts\build-windows-app.ps1` (Inno Setup is needed for the installer) — see [docs/windows-build-guide.md](docs/windows-build-guide.md).

### WeChat (optional)

Mirrai connects to WeChat through the official **「微信ClawBot」** plugin (Tencent iLink protocol) — no third-party protocol, so no account-ban risk.

1. Update WeChat to **8.0.70+** and open 我 → 设置 → 插件. You need the 「微信ClawBot」 entry to be visible (the feature is rolling out gradually — iOS first).

> ℹ️ The WeChat authorization QR code expires quickly (measured at roughly 90 seconds). Mirrai automatically issues a fresh one whenever it expires, so the code on screen stays valid for as long as the connection window is open — no need to restart.
2. In Mirrai, go to 设置 → 微信 → 连接微信, then scan the QR code with WeChat and confirm.
3. Pick a default persona in 设置 → 微信 → 默认分身.

The channel is 1:1 private chat (an official limit: it cannot be added by other users or to groups), so the counterpart is you. You can switch personas and graduate from inside WeChat:

| Command | Effect |
|---|---|
| `/使用 <persona name>` | Switch the active persona |
| `/分身列表` | List available personas |
| `/当前分身` | Show the active persona |
| `/毕业` | Generate the farewell letter and complete graduation |

Each command also has an English spelling — `/use`, `/personas`, `/current`, `/graduate`
and `/help` — and the reply comes back in the language of the command you typed.

Commands never consume a model call. A switch applies to the current session only; the default persona is restored after a restart.

## Commands

```bash
pnpm dev            # development server with HMR
pnpm build          # production build
pnpm start          # run the production build
pnpm check          # TypeScript type check
pnpm test           # run the test suite
pnpm db:push        # push the current schema (fresh installs)
pnpm db:migrate     # run the migration files in order (upgrades)
pnpm setup:redis    # install a Redis (optional; makes limits shared across instances)
pnpm audit:i18n     # scan for server-side Chinese text without an English counterpart
pnpm i18n:hant      # generate the Traditional Chinese dictionary from the Simplified one
pnpm gate           # the full gate: typecheck, tests, copy audit, structure gate, both builds, doc links
pnpm gate -- --fast # skip the two builds while working; a commit still needs the full run
pnpm mirrai -- import <file> --persona <id> --user <id>
                    # command line: import / distill / measure / export / eval / backup / doctor — see docs/cli.md
pnpm mcp            # MCP stdio server for Claude Desktop / Cursor and similar clients — see docs/mcp.md
pnpm docs:dev       # docs site in development (VitePress)
pnpm docs:build     # build the docs site
pnpm docs:preview   # preview the built docs site
```

## Environment variables (stage six)

The full list, with longer comments, is in `.env.example`. These are the variables added in stage six.

| Variable | What it does | Default |
|---|---|---|
| `MAX_IMPORT_BYTES` | Largest single imported file | 2 GiB |
| `MAX_IMPORT_UNPACKED_BYTES` | Largest unpacked archive | 8 GiB |
| `OLLAMA_EMBED_MODEL` | Local embedding model (exemplar retrieval, semantic crisis recognition) | `bge-m3` |
| `PROMPT_LAYOUT` | System-prompt order: `classic` (current) or `cache` (stable prefix first, for provider prompt caching) | `classic` |
| `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` | Web-push key pair; generated into `vapid.json` in the data directory on first use | generated |
| `VAPID_SUBJECT` | Contact address required by the push service | `mailto:mirrai@localhost` |
| `STT_ENGINE` | Voice transcription: `provider` / `whisper-cpp` / `http` / `off` | `provider` |
| `WHISPER_CPP_BIN` / `WHISPER_CPP_MODEL` | whisper.cpp binary and model (local paths) | empty |
| `STT_HTTP_URL` | Local transcription service (OpenAI-compatible) | empty |
| `STT_HTTP_ALLOW_REMOTE` | Allow that service to be off this machine | `false` |
| `TTS_ENGINE` | Read-aloud engine: `edge` / `piper` / `http` / `off`; `edge` sends the text to Microsoft (existing behaviour) | `edge` |
| `PIPER_BIN` / `PIPER_MODEL` | piper binary and voice model | empty |
| `TTS_HTTP_URL` | Local speech service | empty |
| `MAP_TILE_URL` | Map tiles; only when set does the map switch appear (the tile server can see what you are looking at) | empty |
| `WEATHER_ENABLED` | `false` removes weather from the whole instance (each persona's switch defaults to off anyway) | `true` |
| `OPENAI_COMPAT_ENABLED` | `false` disables the OpenAI-compatible endpoint (it is unusable without a key anyway) | `true` |
| `MIRRAI_PLUGINS` | `on` loads `<data dir>/plugins/*/index.mjs` | empty (off) |
| `MIRRAI_API_KEY` | The key the MCP process uses to identify itself | empty |

## Ethics & boundaries

- Only upload chat logs **you have the right to use**; model real people with their consent.
- Mirrai is **not a replacement for real relationships** — it's a space to finish unfinished conversations. That's why graduation exists.
- **AI transparency**: by default, a persona admits it's an AI when asked in earnest (set `PERSONA_AI_TRANSPARENCY=false` for full immersion mode).
- **Not a substitute for professional help**. If you're struggling, please talk to a professional.

### Rate limiting and multiple instances: Redis works out of the box

Request rate limiting (`server/_core/rate-limit.ts`) uses in-memory token buckets by default.
That is enough for a single self-hosted instance, but with **multiple instances each process
keeps its own counters** — so the effective limit grows with the number of instances. The
scheduler has the same problem: two copies of Mirrai would deliver the same anniversary
reminder twice.

Both are now Redis's problem, and **you do not have to configure anything, or download
anything either**. The app looks for Redis in this order:

1. `REDIS_URL`, if you set it
2. a Redis already listening on the default port
3. **the one that came with the app** (see the table below)
4. **one it starts itself** — it starts a server on a port of its own choosing, and writes
   the port down under `MIRRAI_DATA_ROOT`, so the other copies of Mirrai on this machine
   share it (run two instances and the budget is still one)

**Redis ships inside the installer.**

| How you install it | Where Redis comes from |
|---|---|
| The macOS `.dmg` | Bundled in `Mirrai.app` (`Contents/Resources/redis/`); the app starts it and stops it with itself |
| The Windows `.zip` / `.exe` | Bundled in the `redis\` folder next to the app; same arrangement |
| Docker | The image installs `redis-server`; `docker compose` additionally runs a `redis` container |
| From source | `pnpm setup:redis` — one command, and it works out whether it is brew, apt, apk, dnf or yum |

A machine without `redis-server` still starts: the limiter falls back to counting in
process, and the log says so. Redis makes the limits mean the same thing in every process;
it is not what makes the app run.

To turn the shared store off, put `MIRRAI_REDIS=off` in `.env`.

### Database migrations: which command to use

- **A fresh installation**: `pnpm db:push`. It pushes the current schema straight to the
  database, which is the fastest way in.
- **An existing installation you are upgrading**: `pnpm db:migrate`. It runs the migration
  files in `drizzle/` in order.

`db:migrate` only works on an installation that has already been `db:push`ed: the tool
skips the `0000`/`0001` whole-database dumps, because they assume the base tables are
already there. A fresh installation has no base tables, so the migrations would give you
an empty database — use `db:push` there.

## Documentation

- [docs/roadmap-v2.md](docs/roadmap-v2.md) — the acceptance checklist for the second stage (making the *user* and the *relationship* first-class citizens)
- [docs/roadmap-v4.md](docs/roadmap-v4.md) — the gap analysis for the fourth stage (giving a relationship its own time)
- [docs/roadmap-v5.md](docs/roadmap-v5.md) — the construction plan for the fifth stage (the next line should match what they would *do*)
- [docs/roadmap-v6.md](docs/roadmap-v6.md) — the status table for the sixth stage (one record table, sounding more like them, useful features)
- [docs/cli.md](docs/cli.md) — the command line: every subcommand, `--json`, exit codes
- [docs/mcp.md](docs/mcp.md) — the MCP server: setup, five tools, what leaves the machine
- [docs/plugins.md](docs/plugins.md) — local plugins: the switch, the two plugin shapes, and safety
- [docs/egress.md](docs/egress.md) — everything the app connects to
- [docs/open-items.md](docs/open-items.md) — what is still unfinished, why, and how much work it would be
- [docs/product-concept.md](docs/product-concept.md) — the product concept and its principles
- [docs/creation-story.md](docs/creation-story.md) — the story behind it (in Chinese)

## Roadmap

- [x] Multi-stage persona distillation pipeline
- [x] 6-state emotion engine + intimacy system
- [x] Graduation mechanism (farewell letter + dormancy/awakening)
- [x] 12 LLM providers
- [x] WeChat ClawBot channel integration
- [x] Diary / memory nodes / analytics / TTS
- [x] SillyTavern character card (PNG v2) import/export
- [x] Guided questionnaires (a persona with no chat logs)
- [x] Traditional Chinese UI (machine conversion, `pnpm i18n:hant`) + English emotion trigger words (C8.14)
- [ ] Full UI in other languages (needs human translation)
- [x] Local plugin system + docs site (C9.7; plugins are off by default)
- [ ] Online plugin / template marketplace (needs a hosted service; not built)
- [x] Group chat mode (C9.8; effect not yet measured on real records)
- [x] Docs site (VitePress; `pnpm docs:dev` / `docs:build` / `docs:preview`)
- [x] One record table for every source + 17 built-in import formats (A1–A4, C1.1)
- [x] Chunked distillation, record evidence, persona version history (B1.1–B1.10)
- [x] Record reader / literal search / "did they say this" (C2.2, C2.3, C2.10)
- [x] Ruler extensions: discriminator, blind sessions, ablation, drift, auditions (B8.1–B8.5; effect not yet measured on real records)
- [x] Evaluation stats: confidence intervals, stratified metrics, history, material report (B8.6, B8.7, B8.9, B8.10)
- [x] Time capsules, global inbox, reunion countdown, taper, seal, memory book, memorial mode, family sharing, oral accounts (C5–C7)
- [x] Complete backup / app lock / encryption at rest / recycle bin / diagnostics / accessibility (C8.3–C8.5, C8.10–C8.12, C8.14)
- [x] Safety and ethics: harm filter, consent tool, late-night protection, inference view, provenance underlines, semantic crisis recognition (C10.1–C10.7; effect partly not yet measured on real records)
- [x] Channels and ecosystem: Telegram / Discord / Matrix, OpenAI-compatible endpoint, MCP, CLI, persona bundles, local plugins (C9.1–C9.7; effect partly not yet measured on real records)
- [x] Model layer: per-purpose roles, sampling, `extraBody`, `logit_bias`, grammar (B2.8, B9.3; effect not yet measured on real records)

## The story

Mirrai was written by an NLP student who was terrified of losing someone — so terrified he started writing her into code. The full creation story (in Chinese) is here: [docs/creation-story.md](docs/creation-story.md).

## Tech stack

React 19 + TypeScript + Vite + Tailwind 4 + Radix UI on the client; Express + tRPC 11 (end-to-end type safety) + PostgreSQL/Drizzle on the server; the official WeChat ClawBot channel (Tencent iLink protocol); a Python skill-engine for distillation; Vitest for tests. Full architecture details in the [Chinese README](README.md#技术架构).

## Contributing

Issues and PRs are welcome — see [CONTRIBUTING.md](CONTRIBUTING.md). For security issues, see [SECURITY.md](SECURITY.md).

## License

[MIT](LICENSE) © 2026 Ch1rpys
