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
| `GET` | `/v1/artifacts` | List collected artifacts |
| `GET` | `/v1/artifact/:name` | Download |

CORS is `*` so the browser talks to the tunnel directly. `ngrok-skip-browser-warning`
is accepted so the free ngrok tier does not serve its interstitial.

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
