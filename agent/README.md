# Chomugiri Terminal Bridge

Zero-dependency daemon that gives the Chomugiri web workspace a real shell on
your machine. Node >= 20, nothing to install.

```bash
node chomugiri-agent.mjs --port 7717 --workspace ~/chomugiri-work
ngrok http 7717                                   # or
cloudflared tunnel --url http://localhost:7717
```

Paste the public URL and the printed token into Chomugiri → Settings.

## Security

Anyone holding the token can run shell commands as you. It is not a sandbox —
running arbitrary commands is the product. Mitigations that are in place:

- Bearer token on every route except `/v1/ping` (a bare liveness check that
  leaks nothing), compared without early exit on mismatch.
- Every filesystem path is resolved and checked against the workspace root
  before any syscall; `..` and absolute paths are rejected.
- `--allow-cmd "npm,git,./gradlew"` restricts execution to a prefix allowlist.
- Runs are killed after `--max-exec-ms` (default 45 min).

Stop the tunnel when you are done.

## API

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/v1/ping` | Unauthenticated liveness |
| `GET` | `/v1/health` | Toolchain detection, workspace, active runs |
| `POST` | `/v1/exec` | `{cmd, cwd, env, timeoutMs}` → `{execId}` |
| `GET` | `/v1/stream/:execId` | SSE stdout/stderr/exit, replays buffered output |
| `POST` | `/v1/kill/:execId` | SIGTERM, then SIGKILL after 5s |
| `POST` | `/v1/fs/write` | `{files:[{path, content \| base64}]}` |
| `GET` | `/v1/fs/read?path=` | Text or base64 |
| `GET` | `/v1/fs/list?path=` | Recursive listing (skips node_modules/.git/.gradle) |
| `POST` | `/v1/fs/delete` | Remove a path (never the workspace root) |
| `POST` | `/v1/fs/zip` | Archive a subtree into `.artifacts/` |
| `POST` | `/v1/collect` | Gather build outputs (.apk/.aab/.zip/.mcpack/.jar) |
| `GET` | `/v1/keys` | Names (and a masked tail) of the API keys this terminal holds — never the keys |
| `POST` | `/v1/keys` | `{env:{NAME:value}}` → replaces everything the terminal holds |
| `POST` | `/v1/keys/delete` | `{names?}` → removes those keys, or all of them |
| `GET` | `/v1/artifacts` | List collected artifacts |
| `GET` | `/v1/artifact/:name` | Download |

CORS is `*` so the browser talks to the tunnel directly. `ngrok-skip-browser-warning`
is accepted so the free ngrok tier does not serve its interstitial.

## API keys on the terminal

Settings → API Keys has **Pull APIs on terminal** and **Delete APIs from terminal**. Pull copies every key the app holds to
`~/.chomugiri/keys.json` on the machine running the bridge (owner-only, outside the workspace; override with
`CHOMUGIRI_KEYS_FILE`). Every command the bridge then runs finds them as environment variables — `GROQ_API_KEY`,
`GROQ_API_KEYS` (several, comma-separated), `GROQ_BASE_URL`, `NVIDIA_API_KEY`, `HF_TOKEN`, … — so background jobs keep going
with the app closed. From the terminal itself: `node chomugiri-agent.mjs keys list` and `keys delete [NAME …]`.

## Browser (Playwright MCP)

The bridge can drive a real browser for the app: open websites, read them, click, type, search the web, take screenshots.
It runs Microsoft's [Playwright MCP](https://github.com/microsoft/playwright-mcp) (pinned, started on first use with
`npx`, stopped after ten idle minutes) and speaks MCP to it over stdio. Nothing else to install except the browser itself:
if it is missing the first command says so and the app runs `npx -y playwright@latest install chromium` once.

Commands run by the bridge get `CHOMUGIRI_AGENT`, `CHOMUGIRI_BRIDGE_URL` and `CHOMUGIRI_BRIDGE_TOKEN`, so inside any
terminal block:

```bash
node "$CHOMUGIRI_AGENT" browse open https://example.com    # page + its elements (refs)
node "$CHOMUGIRI_AGENT" browse click e12 "Learn more"
node "$CHOMUGIRI_AGENT" browse help                        # every verb
```

| Env | Effect |
|---|---|
| `CHOMUGIRI_BROWSER_HEADED=1` | show the browser window instead of running headless |
| `CHOMUGIRI_BROWSER_CHROMIUM=/path/to/chrome` | use this browser binary |
| `CHOMUGIRI_BROWSER_ARGS="--no-sandbox …"` | extra Playwright MCP flags |

Route: `POST /v1/browser` `{tool, args}` → `{ok, text}` (or `{list:true}` for the tool list). The browser has the same
power as you at that keyboard: it can reach anything your machine can, including logged-in sites. Keep the token private.

## Blender (Blender MCP)

`POST /v1/blender` drives a live Blender on this machine through a Blender MCP server, started on first use with `uvx`
(pinned to a commit) and stopped after ten idle minutes. In a terminal block the model runs
`node "$CHOMUGIRI_AGENT" blender scene | run <python> | tools | <tool> '<json>' [--pro]`.

| Server | Project | Tools |
| --- | --- | --- |
| basic (default) | [Gorav22/Blender-mcp](https://github.com/Gorav22/Blender-mcp) (MIT) | scene info, run Python in Blender, Poly Haven assets |
| `--pro` | [RFingAdam/mcp-blender](https://github.com/RFingAdam/mcp-blender) (AGPL-3.0, run as its own program) | 218: modelling, materials, armatures, animation, baking, rendering, export |

Needs [uv](https://docs.astral.sh/uv/) and Blender open with the matching addon started (`blender addon [--pro]` prints the
steps; only one addon at a time, both listen on port 9876). The `/blender` and `/blender-3d` commands use it.

## Webcmd ([agentrhq/webcmd](https://github.com/agentrhq/webcmd))

A second way onto the web, run the same way REA is (below): no bridge code needed, just `npx` in a terminal block,
since `/v1/exec` already runs whatever command the model sends. Webcmd turns a site, or an external CLI it wraps
(`gh`, `vercel`, `docker`, Notion, Discord, Telegram, Obsidian, Lark, Cloudflare), into deterministic commands and
remembers a site's navigation across runs, so repeat visits cost far fewer steps than a fresh Playwright session.

```bash
npx -y @agentrhq/webcmd@latest doctor
npx -y @agentrhq/webcmd@latest list
```

Reach for the plain `browse` commands above for open-ended reading of a page never visited; reach for Webcmd to drive
a named external tool, or to repeat something it has already learned. It only uses a wrapped CLI (`gh`, `vercel`, …)
you are already signed in to on this machine — it does not log in on its own.
