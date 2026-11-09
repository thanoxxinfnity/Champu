# Craft Anything (on the bridge)

Craft Anything studies a target, has a coding agent build a version of it, and checks the result against the original. It is open source. It needs a coding agent signed in on the bridge computer (Claude Code, Copilot CLI or Grok Build). Needs bridge 5.1 or newer.

## Is this allowed? Check first
Use it on sites, apps and files the user owns or has said **in this conversation** they may study. A public page being viewable is not permission to copy it. For someone else's product, prefer clean-room mode (works only from what a visitor sees: text, layout, behaviour; no copied code, images, brand marks or data) and tell the user the result must be their own design and content. Never use it to bypass a login, a licence check, DRM or bot protection, and never to copy a company's code or assets.

## Commands
- `node "$CHOMUGIRI_AGENT" craft install craft-anything` once.
- `node "$CHOMUGIRI_AGENT" craft anything doctor` shows what is missing (the coding agent, a browser).
- `node "$CHOMUGIRI_AGENT" craft anything commands` lists the verbs of this release.
- `node "$CHOMUGIRI_AGENT" craft anything rebuild <url> "<what to build>"` runs the loop. Run it in a workspace folder of its own.
- `node "$CHOMUGIRI_AGENT" craft anything mcp` starts its MCP server for other agents.

## Rules
1. Run `doctor` first and report what it says. If no coding agent is signed in, stop and tell the user which one to sign in to.
2. Say what will be built and where (a new workspace folder) before running `rebuild`; it can take long.
3. After it finishes, show the user the comparison it produced. Do not claim a match it did not print.