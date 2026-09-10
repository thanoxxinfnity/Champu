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
