/**
 * Blender for the bridge: a live Blender on the bridge machine, driven through an MCP server over stdio.
 *
 * Two servers, both started on first use with `uvx` (pinned to a commit) and stopped after ten idle minutes:
 *   basic — github.com/Gorav22/Blender-mcp (MIT): scene info, run Python inside Blender, Poly Haven assets.
 *   pro   — github.com/RFingAdam/mcp-blender (AGPL-3.0, run as a separate program, nothing of it is copied here):
 *           218 tools — objects, materials, modifiers, armatures, animation, baking, rendering, GLB/FBX export.
 * Each one talks to an addon running inside Blender (localhost:9876), so Blender must be open with that addon started.
 *
 * As with the browser, the model never speaks MCP: it runs `node "$CHOMUGIRI_AGENT" blender <verb> …` in a terminal block,
 * which posts to the bridge's /v1/blender, and the result comes back as the command's output.
 */
import { McpStdio, shape } from './browser.mjs';

const IDLE_MS = 10 * 60_000;
const CALL_MS = 120_000;
const START_MS = 240_000;

export const BLENDER_SERVERS = {
  basic: {
    repo: 'https://github.com/Gorav22/Blender-mcp',
    // written for mcp 1.x: FastMCP(description=…) and the pydantic it was built against
    args: ['--with', 'mcp[cli]==1.3.0', '--with', 'pydantic<2.10', '--from', 'git+https://github.com/Gorav22/Blender-mcp@1ab896923f94e9194c02944136ffc3f4e3d24d10', 'blender-mcp'],
    scene: 'get_scene_info',
    python: (code) => ({ tool: 'execute_blender_code', args: { code } }),
    addon: 'Download addon.py from https://github.com/Gorav22/Blender-mcp, then in Blender: Edit > Preferences > Add-ons > Install… > pick addon.py > enable "Interface: Blender MCP". In the 3D view press N, open the BlenderMCP tab, click "Connect to MCP server".',
  },
  pro: {
    repo: 'https://github.com/RFingAdam/mcp-blender',
    args: ['--from', 'git+https://github.com/RFingAdam/mcp-blender@71724fc63d14bef6a08a4ac6dc6361b474b6fd27', 'mcp-blender'],
    scene: 'blender_scene_info',
    python: (code) => ({ tool: 'blender_execute_script', args: { script: code } }),
    addon: 'Download blender_mcp_addon.zip from https://github.com/RFingAdam/mcp-blender/releases, then in Blender: Edit > Preferences > Add-ons > Install… > pick the zip > enable it and start its server from its sidebar panel (port 9876). Only one Blender MCP addon can listen on 9876 at a time.',
  },
};

export function createBlender({ outDir, spawnSpec = null }) {
  const servers = {};
  const timers = {};
  let queue = Promise.resolve();

  const get = (name) => {
    if (!BLENDER_SERVERS[name]) throw Object.assign(new Error(`unknown Blender server "${name}" (use basic or pro)`), { statusCode: 400 });
    servers[name] ??= new McpStdio({ command: spawnSpec?.command ?? 'uvx', args: spawnSpec?.args ?? BLENDER_SERVERS[name].args, cwd: outDir, env: {}, label: 'the Blender MCP server' });
    clearTimeout(timers[name]);
    timers[name] = setTimeout(() => close(name), IDLE_MS);
    timers[name].unref?.();
    return servers[name];
  };
  const close = (name) => {
    for (const n of name ? [name] : Object.keys(servers)) {
      clearTimeout(timers[n]);
      servers[n]?.stop();
      delete servers[n];
    }
  };

  async function run(name, tool, toolArgs) {
    const mcp = get(name);
    try { await mcp.start(); } catch (e) { delete servers[name]; throw e; }
    return shape(await mcp.request('tools/call', { name: tool, arguments: toolArgs ?? {} }, CALL_MS), outDir);
  }

  return {
    /** One call at a time: Blender runs commands on its main thread. */
    call(name, tool, toolArgs) {
      const job = queue.then(() => run(name, tool, toolArgs));
      queue = job.catch(() => undefined);
      return job;
    },
    async tools(name) {
      const mcp = get(name);
      await mcp.start();
      return (await mcp.request('tools/list', {})).tools;
    },
    close,
  };
}

export const BLENDER_HELP = `blender — drive a live Blender on this machine (through a Blender MCP addon running inside it).

  blender scene [--pro]                what is in the open scene
  blender run <python code> [--pro]    run bpy code inside Blender, e.g. blender run "bpy.ops.mesh.primitive_monkey_add()"
  blender tools [--pro]                every tool the server offers
  blender <tool_name> '<json>' [--pro] any raw tool, e.g. blender blender_export_gltf '{"filepath":"/tmp/hero.glb"}' --pro
  blender addon [--pro]                how to install and start the addon in Blender
  blender close                        stop the servers

  basic (default): Gorav22/Blender-mcp — scene info, Python, Poly Haven assets.
  --pro:           RFingAdam/mcp-blender — 218 tools: modelling, materials, rigging, animation, baking, rendering, export.
Blender must be open with the matching addon started (only one of the two at a time, both use port 9876).
For headless batch work (no open Blender) run scripts directly: blender --background --python script.py
`;

/** Words typed on the command line → {server, tool, args}, {local, server} or {error}. */
export function parseBlender(argv) {
  const server = argv.includes('--pro') ? 'pro' : 'basic';
  const words = argv.filter((w) => w !== '--pro' && w !== '--basic');
  const [verb, ...rest] = words;
  const spec = BLENDER_SERVERS[server];
  switch ((verb ?? '').toLowerCase()) {
    case '': case 'help': case '-h': case '--help': return { local: 'help', server };
    case 'addon': case 'setup': return { local: 'addon', server };
    case 'tools': return { local: 'tools', server };
    case 'close': case 'stop': return { local: 'close', server };
    case 'scene': case 'info': return { server, tool: spec.scene, args: {} };
    case 'run': case 'python': case 'py': {
      const code = rest.join(' ').trim();
      if (!code) return { error: 'usage: blender run <python code>' };
      return { server, ...spec.python(code) };
    }
    default: {
      if (/^[a-z][a-z0-9_]+$/.test(verb)) {
        let args = {};
        if (rest.length) { try { args = JSON.parse(rest.join(' ')); } catch { return { error: `the arguments of ${verb} must be JSON, e.g. blender ${verb} '{"name":"Cube"}'` }; } }
        return { server, tool: verb, args };
      }
      return { error: `unknown blender command "${verb}". Run: blender help` };
    }
  }
}

/** `node chomugiri-agent.mjs blender …` — run inside a bridge command, talks to the bridge that started it. */
export async function blenderCli(argv, env = process.env) {
  const parsed = parseBlender(argv);
  if (parsed.local === 'help') { process.stdout.write(BLENDER_HELP); return 0; }
  if (parsed.local === 'addon') { process.stdout.write(`${BLENDER_SERVERS[parsed.server].addon}\n`); return 0; }
  if (parsed.error) { process.stderr.write(`${parsed.error}\n`); return 2; }
  const base = env.CHOMUGIRI_BRIDGE_URL;
  const token = env.CHOMUGIRI_BRIDGE_TOKEN;
  if (!base || !token) { process.stderr.write('blender only works inside a bridge command (CHOMUGIRI_BRIDGE_URL is not set).\n'); return 2; }
  try {
    const body = parsed.local ? { server: parsed.server, [parsed.local]: true } : { server: parsed.server, tool: parsed.tool, args: parsed.args };
    const res = await fetch(`${base}/v1/blender`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(CALL_MS + START_MS),
    });
    const data = await res.json();
    if (!res.ok) { process.stderr.write(`${data.error ?? `bridge answered ${res.status}`}\n`); return 1; }
    process.stdout.write(`${data.text ?? ''}\n`);
    return data.ok === false ? 1 : 0;
  } catch (e) {
    process.stderr.write(`blender failed: ${e.message}\n`);
    return 1;
  }
}

/** Failures the model can act on: what to run or click, not a stack. */
export function explainBlenderError(message, server = 'basic') {
  const m = String(message);
  if (/could not start uvx|ENOENT/i.test(m)) return 'uv (uvx) is not installed on the bridge machine, so the Blender MCP server could not start. Install it: curl -LsSf https://astral.sh/uv/install.sh | sh (Windows: powershell -c "irm https://astral.sh/uv/install.ps1 | iex"), then repeat.';
  if (/ConnectionRefused|Connection refused|connect to Blender|Could not connect|timed out \(127\.0\.0\.1|localhost:9876|9876/i.test(m)) {
    return `Blender is not reachable on port 9876: open Blender and start the ${server} addon. ${BLENDER_SERVERS[server]?.addon ?? ''}`;
  }
  if (/timed out/i.test(m)) return `Blender did not answer in time (${m}). A long render or bake may still be running; check Blender, then try again.`;
  return m.slice(0, 600);
}
