/**
 * Playing the game in the chat, without installing anything.
 *
 * Godot exports to WebAssembly, and the whole build of a real game comes to
 * about 16MB over the wire against 31MB for the APK — but the number that
 * matters is not the size. It is that there is nothing to install, no "unknown
 * source" warning to click past, and no wait: the game the model just built
 * appears under the message that asked for it.
 *
 * ── The problem, and why this file is not just an iframe ────────────────────
 *
 * Godot's web export is five files that fetch each other by relative path.
 * `index.js` derives `index.wasm` from a configured *base name* — it appends
 * the extension itself — so an object URL cannot be handed to it directly:
 * `blob:…/abc` becomes `blob:…/abc.wasm`, which is nothing.
 *
 * The usual answer is to serve the files from a real path, which means a server
 * route here and the same route again in `ApiRouter.kt` for the Android build.
 * Two implementations of a file server, for files that are already in memory.
 *
 * So instead the player page **patches the loader's idea of fetching**. Every
 * request for a name in the build is answered from an object URL made in the
 * parent document. A `blob:` iframe inherits its creator's origin, so those
 * URLs resolve inside it with no server, no service worker, and no copy: the
 * 39MB of WebAssembly is referenced, not duplicated.
 *
 * Three transports have to be covered, because emscripten uses all three
 * depending on the browser:
 *   - `fetch`, for `WebAssembly.instantiateStreaming`;
 *   - `XMLHttpRequest`, for the pack file on older paths;
 *   - `AudioWorklet.addModule`, which takes a URL and never goes near either.
 */

import type { BridgeRunner } from './bridge-build.ts';
import { findGodot, versionFrom } from './bridge-build.ts';

export interface WebFile {
  /** The name the loader will ask for, e.g. `index.wasm`. */
  path: string;
  bytes: Uint8Array;
}

export interface WebBuild {
  files?: WebFile[];
  error?: string;
  log: string;
  godot?: string;
  /** Total bytes, for telling someone what they are about to load. */
  size: number;
}

/**
 * The export preset.
 *
 * `variant/thread_support=false` on purpose. The threaded build is faster and
 * needs `SharedArrayBuffer`, which needs cross-origin isolation headers, which
 * a `blob:` document cannot have and a WebView will not give you. A game that
 * runs is worth more than a game that would have run 20% faster.
 */
export function webExportPreset(name: string): string {
  return `[preset.0]

name="Web"
platform="Web"
runnable=true
advanced_options=false
dedicated_server=false
custom_features=""
export_filter="all_resources"
include_filter=""
exclude_filter=""
export_path="build/index.html"
encryption_include_filters=""
encryption_exclude_filters=""
encrypt_pck=false
encrypt_directory=false

[preset.0.options]

custom_template/debug=""
custom_template/release=""
variant/extensions_support=false
variant/thread_support=false
vram_texture_compression/for_desktop=true
vram_texture_compression/for_mobile=true
html/export_icon=true
html/custom_html_shell=""
html/head_include=""
html/canvas_resize_policy=2
html/focus_canvas_on_start=true
html/experimental_virtual_keyboard=false
progressive_web_app/enabled=false
progressive_web_app/name="${name.replace(/"/g, '\\"')}"
`;
}

/** The files a Godot web export produces, in the order they are needed. */
export const WEB_OUTPUTS = [
  'index.html',
  'index.js',
  'index.wasm',
  'index.pck',
  'index.audio.worklet.js',
  'index.audio.position.worklet.js',
] as const;

/**
 * Export the project to WebAssembly on the bridge machine.
 *
 * Same rule as the APK path: **Godot exits 0 when it exports nothing**, so the
 * check is whether the files came back, never the exit code.
 */
export async function buildWebOnBridge(
  bridge: BridgeRunner,
  files: Array<{ path: string; content: string }>,
  options: { name: string; godotPath?: string; onStage?: (message: string) => void },
): Promise<WebBuild> {
  let log = '';
  options.onStage?.('Looking for Godot on the bridge machine.');
  const engine = await findGodot(bridge, options.godotPath);
  if (!engine.path) return { error: engine.error ?? 'No Godot on the bridge machine.', log, size: 0 };

  const version = await bridge.run(`"${engine.path}" --version`, { timeoutMs: 30_000 });
  options.onStage?.(`Godot ${versionFrom(version.stdout) ?? '4'} at ${engine.path}.`);

  const dir = 'chomugiri-web/game';
  // Resolved to an absolute path before it is used: Godot resolves the export
  // output against its own working directory, not against --path, and answers
  // "target folder does not exist" — while still exiting 0.
  await bridge.run(`mkdir -p "${dir}/build"`, { timeoutMs: 30_000 });
  const resolved = await bridge.run(`cd "${dir}" && pwd`, { timeoutMs: 30_000 });
  const projectDir = resolved.stdout.trim();
  if (!projectDir) return { error: `Could not create a build directory at "${dir}".`, log, size: 0 };

  options.onStage?.('Writing the project to the bridge.');
  await bridge.writeFiles([
    ...files.map((f) => asWritable(f, dir)),
    { path: `${dir}/export_presets.cfg`, content: webExportPreset(options.name) },
  ]);

  options.onStage?.('Compiling to WebAssembly.');
  const out = `${projectDir}/build/index.html`;
  const cmd = `"${engine.path}" --headless --path "${projectDir}" --export-release "Web" "${out}"`;
  const run = await bridge.run(cmd, {
    timeoutMs: 20 * 60_000,
    onOutput: (chunk) => {
      log += chunk;
    },
  });
  log += run.stdout + run.stderr;

  const collected: WebFile[] = [];
  for (const name of WEB_OUTPUTS) {
    try {
      const read = await bridge.readFile(`${dir}/build/${name}`);
      if (read.base64) collected.push({ path: name, bytes: fromBase64(read.base64) });
      else if (read.content) collected.push({ path: name, bytes: new TextEncoder().encode(read.content) });
    } catch {
      // The audio worklets are only emitted when the project has audio. A
      // missing one is not a failed build.
    }
  }

  const essential = ['index.html', 'index.js', 'index.wasm', 'index.pck'];
  const missing = essential.filter((name) => !collected.some((f) => f.path === name));
  if (missing.length) {
    return { error: `The export produced no ${missing.join(', ')}.`, log, godot: engine.path, size: 0 };
  }

  const size = collected.reduce((total, f) => total + f.bytes.byteLength, 0);
  return { files: collected, log, godot: engine.path, size };
}

function asWritable(file: { path: string; content: string }, dir: string): { path: string; content?: string; base64?: string } {
  const path = `${dir}/${file.path}`;
  const match = /^data:[^;]*;base64,(.*)$/s.exec(file.content);
  return match ? { path, base64: match[1] } : { path, content: file.content };
}

function fromBase64(b64: string): Uint8Array {
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
}

/** What each file has to claim to be, or the browser refuses to run it. */
export function contentType(path: string): string {
  if (path.endsWith('.wasm')) return 'application/wasm';
  if (path.endsWith('.js')) return 'text/javascript';
  if (path.endsWith('.html')) return 'text/html';
  if (path.endsWith('.png')) return 'image/png';
  return 'application/octet-stream';
}

/**
 * The script that makes the loader ask us instead of the network.
 *
 * Injected ahead of everything else in the page. `resolve` matches on the file
 * name alone: the loader asks for `index.wasm`, a relative path, an absolute
 * one, or the same with a cache-busting query, and every one of those ends in
 * the name we have.
 */
export function shimScript(urls: Record<string, string>): string {
  return `<script>
(function () {
  var FILES = ${JSON.stringify(urls)};
  function resolve(input) {
    try {
      var url = typeof input === 'string' ? input : (input && input.url) || '';
      var name = String(url).split('?')[0].split('#')[0].split('/').pop();
      return FILES[name] || null;
    } catch (e) { return null; }
  }

  // fetch, for WebAssembly.instantiateStreaming.
  var realFetch = window.fetch.bind(window);
  window.fetch = function (input, init) {
    var hit = resolve(input);
    return hit ? realFetch(hit, init) : realFetch(input, init);
  };

  // XMLHttpRequest, which emscripten still uses for the pack on some paths.
  var realOpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function (method, url) {
    var hit = resolve(url);
    var args = Array.prototype.slice.call(arguments);
    if (hit) args[1] = hit;
    return realOpen.apply(this, args);
  };

  // addModule, which takes a URL and goes near neither of the above.
  if (window.AudioWorklet && AudioWorklet.prototype.addModule) {
    var realAdd = AudioWorklet.prototype.addModule;
    AudioWorklet.prototype.addModule = function (url) {
      return realAdd.call(this, resolve(url) || url);
    };
  }
})();
</script>`;
}

/**
 * The page to drop into an iframe.
 *
 * Takes Godot's own shell and does two things to it: puts the shim in front of
 * every other script, and inlines `index.js` so the loader itself does not have
 * to be resolved before the shim that would resolve it is running.
 */
export function playerPage(html: string, loaderJs: string, urls: Record<string, string>): string {
  let page = html;

  // Inlined rather than mapped. The shim is in place by the time anything runs,
  // but a <script src> for the loader is a request the browser may start
  // before it, and a race that is usually won is still a race.
  page = page.replace(
    /<script src="index\.js"><\/script>/,
    `<script>\n${loaderJs}\n</script>`,
  );

  // First thing in <head>, ahead of GODOT_CONFIG and everything after it.
  page = page.replace(/<head>/i, `<head>\n${shimScript(urls)}`);

  // The status overlay's "click to play" relies on a gesture the iframe may not
  // have had. Godot starts muted until one arrives, which is correct, and
  // nothing here should pretend otherwise.
  return page;
}

/** One line for the chat: what someone is about to load. */
export function describeBuild(build: WebBuild): string {
  if (!build.files) return build.error ?? 'No build.';
  const mb = (build.size / 1_048_576).toFixed(1);
  return `Playable here — ${mb} MB of WebAssembly, nothing to install.`;
}

// ── The browser side ────────────────────────────────────────────────────────

/**
 * Builds the page and hands back something an `<iframe src>` will take.
 *
 * The object URLs are made in the calling document on purpose: a `blob:` iframe
 * inherits its creator's origin, so they resolve inside it, and the 39MB of
 * WebAssembly is referenced rather than copied into the frame.
 *
 * **Godot refuses to start outside a secure context**, and it is right to. That
 * is satisfied by the page this is called from — https on the site, or
 * `localhost` for the Android build, which serves itself over the phone's own
 * loopback interface. Both are secure contexts and a blob: child inherits that.
 * Calling this from an `about:blank` document produces a game that loads
 * everything and then reports missing features, which is how the first version
 * of the test was wrong.
 */
export function playerFrameSrc(files: WebFile[]): { src: string; revoke: () => void } {
  const urls: Record<string, string> = {};
  const made: string[] = [];

  for (const file of files) {
    // A Uint8Array can be backed by a SharedArrayBuffer, which Blob will not
    // take — so the bytes are copied into a plain one first.
    const buffer = new ArrayBuffer(file.bytes.byteLength);
    new Uint8Array(buffer).set(file.bytes);
    const url = URL.createObjectURL(new Blob([buffer], { type: contentType(file.path) }));
    urls[file.path] = url;
    made.push(url);
  }

  const decode = (name: string): string => {
    const found = files.find((f) => f.path === name);
    return found ? new TextDecoder().decode(found.bytes) : '';
  };

  const page = playerPage(decode('index.html'), decode('index.js'), urls);
  const src = URL.createObjectURL(new Blob([page], { type: 'text/html' }));
  made.push(src);

  return { src, revoke: () => made.forEach((url) => URL.revokeObjectURL(url)) };
}

/**
 * Builds live only as long as the session does.
 *
 * Forty-five megabytes per game is not something to put in IndexedDB next to
 * the chat history: it is the one artifact that is cheap to make again and
 * expensive to keep. A reload rebuilds it, which takes as long as it took the
 * first time and costs nothing that was worth saving.
 */
const PLAYABLE = new Map<string, WebFile[]>();

export function keepPlayable(id: string, files: WebFile[]): void {
  PLAYABLE.set(id, files);
}

export function takePlayable(id: string): WebFile[] | undefined {
  return PLAYABLE.get(id);
}
