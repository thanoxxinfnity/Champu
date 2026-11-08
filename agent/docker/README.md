# Bridge in Docker (computer use on a server)

`Dockerfile` builds one image with the bridge, Chromium, a private virtual screen (Xvfb), `xdotool` and ImageMagick. It runs as a normal
user, so the browser starts without tricks, and each person gets their own container (one container, one workspace, one token).

| Piece | What does it |
|---|---|
| The agent loop | the app (it calls the model, decides every step, asks you before anything risky) |
| The browser | Playwright MCP, driven by the bridge, as a real Chromium window |
| The screen | Xvfb, started by the bridge (`desktop start`); the app shows it as the live view and lets you take over |
| Passwords and keys | the encrypted vault in the app and the secure form; the model only sees names, never values |

Environment: `CHOMUGIRI_TOKEN` (required for anything public), `CHOMUGIRI_PORT` (7860), `CHOMUGIRI_WORKSPACE`, `CHOMUGIRI_ALLOW_CMD`.

Not built or run in the session that wrote it (no Docker daemon there): the pieces were run natively instead (the bridge, the Xvfb screen,
Chromium visible on it, and a screenshot of it). Build it once and read the first start-up lines.
