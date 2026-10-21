#!/bin/bash
# Cloud sessions start from a fresh container: put Blender 4.2 LTS on it for the blender-image-to-3d skill and the
# Blender MCP servers in .mcp.json ("blender", "blender-pro"), and download those servers once so they start fast.
set -euo pipefail

if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

BLENDER_VERSION="4.2.3"
BLENDER_SHA256="3a64efd1982465395abab4259b4091d5c8c56054c7267e9633e4f702a71ea3f4"
BLENDER_DIR="/opt/blender-${BLENDER_VERSION}"
BLENDER_URL="https://download.blender.org/release/Blender4.2/blender-${BLENDER_VERSION}-linux-x64.tar.xz"

if [ ! -x "${BLENDER_DIR}/blender" ]; then
  tmp="$(mktemp -d)"
  trap 'rm -rf "$tmp"' EXIT
  curl -fsSL --retry 4 --retry-delay 2 -o "$tmp/blender.tar.xz" "$BLENDER_URL"
  echo "${BLENDER_SHA256}  $tmp/blender.tar.xz" | sha256sum -c --quiet -
  mkdir -p "$BLENDER_DIR"
  tar -xJf "$tmp/blender.tar.xz" -C "$BLENDER_DIR" --strip-components=1
fi

mkdir -p "$HOME/.local/bin"
ln -sf "${BLENDER_DIR}/blender" "$HOME/.local/bin/blender"
if [ -n "${CLAUDE_ENV_FILE:-}" ]; then
  echo "export BLENDER_BIN=\"${BLENDER_DIR}/blender\"" >> "$CLAUDE_ENV_FILE"
  echo "export PATH=\"\$HOME/.local/bin:\$PATH\"" >> "$CLAUDE_ENV_FILE"
fi

# Pre-fetch the two Blender MCP servers (same pinned arguments as .mcp.json); with stdin closed they exit at once.
if command -v uvx >/dev/null 2>&1; then
  timeout 300 uvx --with "mcp[cli]==1.3.0" --with "pydantic<2.10" \
    --from "git+https://github.com/Gorav22/Blender-mcp@1ab896923f94e9194c02944136ffc3f4e3d24d10" blender-mcp </dev/null >/dev/null 2>&1 || true
  timeout 300 uvx --from "git+https://github.com/RFingAdam/mcp-blender@71724fc63d14bef6a08a4ac6dc6361b474b6fd27" mcp-blender </dev/null >/dev/null 2>&1 || true
fi

"${BLENDER_DIR}/blender" --version | head -1
