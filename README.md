# Chomugiri

Autonomous developer workspace. Two lanes, one dock: **Lane A** answers technical
questions with no filler; **Lane B** decomposes a build request into an atomic
checklist, emits complete files, and compiles them for real over a terminal
tunnel to your own machine.

No Puter.js. Model access is NVIDIA NIM + Pollinations.ai + any OpenAI-compatible
endpoint you point it at.

---

## What it actually does

| | |
|---|---|
| **Models** | NVIDIA NIM (Kimi, GLM, DeepSeek-R1/V3, Nemotron, Qwen3-Coder), Pollinations.ai (zero-key), any OpenAI-compatible base URL with custom headers |
| **Reasoning** | `reasoning_content` deltas stream into a collapsible drawer |
| **Execution** | Terminal bridge daemon on your machine, exposed via ngrok / Cloudflare Tunnel — real `gradlew assembleDebug`, real APKs |
| **Android** | Desktop-source analysis → Compose/Gradle project → compiled APK + source ZIP |
| **Minecraft** | Bedrock addon generator, Java-mod converter with a coverage report, in-browser Blockbench voxel editor |
| **Studio** | Animated HTML5 decks, print-ready documents, spreadsheets, multi-provider image generation |
| **MCP** | Visual scaffolder for spec-compliant MCP servers (TypeScript / Python) + client configs |
| **Workdrive** | Search → fetch → embed → rerank → cited synthesis, with milestones and browser alerts |
| **Skills** | `/` command palette, custom skills, AI-authored skills, multimodal attachments |
| **Deploy** | One-click Vercel deployment with preflight validation |
| **Storage** | Per-suite IndexedDB history — independent, searchable, exportable |

---

## Quick start

```bash
npm install
cp .env.example .env.local     # optional — Pollinations needs no key
npm run dev                    # http://localhost:3000
```

Pollinations works with zero configuration. Add `NVIDIA_NIM_API_KEY` (free at
[build.nvidia.com](https://build.nvidia.com)) to unlock the NIM catalogue, the
retrieval stack, and NIM image pipelines.

### Terminal bridge — required for compilation

The browser cannot run the Android SDK. The bridge is a zero-dependency daemon
you run yourself:

```bash
npm run agent                              # prints a token
ngrok http 7717                            # or: cloudflared tunnel --url http://localhost:7717
```

Paste the public URL and token into **Settings → Terminal Bridge**.

```
Options:
  --port 7717            listen port
  --workspace <dir>      jail root for all file operations
  --token <secret>       fixed token instead of a generated one
  --allow-cmd "npm,git"  restrict execution to these command prefixes
```

**The token grants shell access as your user.** Treat it like an SSH key and stop
the tunnel when you are done. All filesystem operations are jailed to the
workspace root; `..` and absolute paths are rejected before any syscall.

Without the bridge, Chomugiri still generates every artifact in the browser and
marks compile/package steps **blocked** rather than failing the run.

---

## Architecture

```
browser                          server (Next.js routes)         external
────────────────────────────     ─────────────────────────       ─────────────────
CommandDock  ──prompt──►  runtime.ts
                            │
                     classifyLocal()  Lane A / Lane B
                            │
                     planner ─► TodoHud
                            │
                            ├──────►  /api/chat  ──────────────►  NVIDIA NIM
                            │         normalises every upstream    Pollinations
                            │         to one SSE frame shape       custom endpoint
                            │
                     artifacts.ts ─► FileManager
                            │
                            └──────►  bridge/client.ts ─────────►  your machine
                                      (direct; /api/bridge/proxy    via ngrok /
                                       when a tunnel strips CORS)   cloudflared
```

**Why a server hop at all?** NVIDIA NIM and api.vercel.com send no CORS headers,
so a browser cannot call them directly, and the NIM key must never reach the
client bundle. The bridge is the opposite case — the daemon sends
`Access-Control-Allow-Origin: *`, so terminal output streams straight to the
browser at tunnel latency instead of tunnel + server latency.

### Key modules

| Path | Role |
|---|---|
| `src/lib/providers/` | NIM / Pollinations / custom adapters over one OpenAI-compatible transport |
| `src/lib/agent/router.ts` | Deterministic Lane A/B scorer; escalates to a model only when genuinely ambiguous |
| `src/lib/agent/fingerprint.ts` | Error normalisation + anti-loop guard |
| `src/lib/agent/planner.ts` | Atomic task decomposition; bridge-bound steps park instead of failing |
| `src/lib/agent/artifacts.ts` | Streaming extraction of `path=`-tagged fenced blocks |
| `src/lib/suites/` | Android, Minecraft, Studio, MCP engines |
| `agent/chomugiri-agent.mjs` | The terminal bridge daemon (zero dependencies) |

### Anti-looping

Every failure is normalised — absolute paths, line/column numbers, hex addresses,
UUIDs, timings and sizes all stripped — then hashed. The **second identical
signature is a hard stop**: that command is banned for the rest of the run and
the agent receives a root-cause directive keyed to the failure class (missing
toolchain, unlicensed SDK, rejected credentials, rate limit, broken generated
code) instead of permission to retry. Inspect the ledger in
**Settings → Anti-Loop Ledger**.

### Bridge heartbeat

Polled every 6s. One dropped beat is `degraded`, not `offline` — tunnels hiccup,
and tearing down an in-flight build on a single 502 is worse than riding it out.
Two consecutive failures is offline; polling backs off to 30s so a dead tunnel
does not generate a request storm. On recovery, parked tasks return to `pending`
automatically.

---

## Honest limits

These are real constraints, not roadmap items:

- **A compiled `.exe` is not decompiled.** The analyser reads the PE header,
  identifies the runtime (Electron / PyInstaller / .NET / Qt / JVM), and tells you
  the exact command to recover source. Feed it source and the migration is real.
- **Java mods do not fully convert.** Only the declarative registry translates —
  blocks, items, entity attributes, recipes, lang. Capabilities, mixins, block
  entities, custom dimensions, GUIs and renderers have no Bedrock equivalent. The
  converter reports coverage and names every construct it could not carry across.
- **Model ids rotate.** `/api/models` probes NIM's live catalogue at runtime.
  Names the brief asked for that NVIDIA does not publish (Kimi K3, GLM-5) are kept
  as *aliases* that resolve to the newest shipping build in that family and say so
  in the UI, rather than 404-ing at request time.
- **Pollinations' keyless tier is rate-limited.** It returns `402` inside an
  HTTP 500. Chomugiri surfaces that as an actionable message and points at
  `POLLINATIONS_TOKEN` or another provider instead of retrying into the wall.
- **PDFs come from the browser's print engine.** Higher fidelity for type and
  vector graphics than any JS PDF library, and zero dependency weight.

---

## Verification

```bash
npm run typecheck
npm run build
```

The suite engines were validated by generating real artifacts and checking them
with external tools: `.mcaddon` archives open in Python's `zipfile` with every
JSON parsing and manifests cross-referencing by UUID; the Android generator emits
a complete AGP 8.7 / Kotlin 2.1 project; MCP scaffolds parse and carry valid
draft-07 schemas; decks are self-contained HTML with zero external references.

---

## Configuration

All keys are server-side except the bridge URL/token, which live in the browser's
IndexedDB because the browser is what talks to your tunnel. See `.env.example`.

---

## Keyboard

| | |
|---|---|
| `/` | command palette |
| `⌘/Ctrl + B` | toggle sidebar |
| `⌘/Ctrl + ,` | settings |
| `Shift + Enter` | newline |
| `↑ / ↓` | terminal history |
