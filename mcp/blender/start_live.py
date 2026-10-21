"""Start a live Blender that the `blender` MCP server (Gorav22/Blender-mcp) can drive.

    blender --python mcp/blender/start_live.py            # a normal Blender window, addon started
    xvfb-run -a blender --python mcp/blender/start_live.py # on a headless Linux box (cloud session)

The addon is fetched from the pinned commit on first run and cached in ~/.cache/chomugiri-blender-mcp/ (it is not kept in
this repository: it carries its author's free-trial Rodin key). It then listens on localhost:9876, where the MCP server
(.mcp.json → "blender") connects. Background mode (-b) does not work: the addon runs commands on Blender's UI timer.
"""
import importlib.util
import os
import urllib.request

import bpy

COMMIT = "1ab896923f94e9194c02944136ffc3f4e3d24d10"
URL = f"https://raw.githubusercontent.com/Gorav22/Blender-mcp/{COMMIT}/addon.py"
CACHE = os.path.join(os.path.expanduser("~"), ".cache", "chomugiri-blender-mcp")
PORT = int(os.environ.get("BLENDER_MCP_PORT", "9876"))

os.makedirs(CACHE, exist_ok=True)
path = os.path.join(CACHE, f"addon-{COMMIT[:12]}.py")
if not os.path.exists(path):
    urllib.request.urlretrieve(URL, path)

spec = importlib.util.spec_from_file_location("blender_mcp_addon", path)
addon = importlib.util.module_from_spec(spec)
spec.loader.exec_module(addon)
addon.register()
server = addon.BlenderMCPServer(port=PORT)
server.start()
bpy.types.blendermcp_server = server
print(f"Blender MCP addon listening on localhost:{PORT}", flush=True)
