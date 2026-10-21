# Blender MCP (live Blender for Claude Code and Chomugiri)

Two MCP servers drive a running Blender through an addon that listens on `localhost:9876`. Both are registered in
`.mcp.json` and start with `uvx`, pinned to a commit; nothing of their code is copied into this repository.

| Name in `.mcp.json` | Project | Licence | Tools |
| --- | --- | --- | --- |
| `blender` | [Gorav22/Blender-mcp](https://github.com/Gorav22/Blender-mcp) @ `1ab8969` | MIT | 13: scene/object info, run Python in Blender, Poly Haven assets, Hyper3D |
| `blender-pro` | [RFingAdam/mcp-blender](https://github.com/RFingAdam/mcp-blender) @ `71724fc` | AGPL-3.0 (runs as its own program) | 218: modelling, materials, modifiers, armatures, animation, baking, rendering, GLB/FBX/USD export |

Only one addon can listen on port 9876 at a time, so use one server per Blender session.

## Start Blender with the addon

- `blender`: `blender --python mcp/blender/start_live.py` (on a headless Linux box: `xvfb-run -a blender --python mcp/blender/start_live.py`).
  The script fetches the addon from the pinned commit into `~/.cache/chomugiri-blender-mcp/` and starts it.
- `blender-pro`: install `blender_mcp_addon.zip` from the project's [releases](https://github.com/RFingAdam/mcp-blender/releases)
  in Blender (Edit → Preferences → Add-ons → Install…), enable it, start its server from its sidebar panel.

The `blender` server is pinned to `mcp[cli]==1.3.0` and `pydantic<2.10`: it uses the mcp 1.x `FastMCP(description=…)` API,
which newer releases removed.

Chomugiri reaches the same servers through its bridge: `node "$CHOMUGIRI_AGENT" blender scene|run|tools … [--pro]`
(`agent/blender.mjs`), and the `/blender` and `/blender-3d` commands use it.

The image-to-3D workflow skill (`.claude/skills/blender-image-to-3d`, MIT, Majid Manzarpour) does not need a live Blender:
it runs Blender headless with its own scripts.
