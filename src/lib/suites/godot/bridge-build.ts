/**
 * Compiling the generated project into an APK, on the terminal bridge.
 *
 * A browser tab cannot produce an APK — it is a zip of compiled native code,
 * signed, and Godot's exporter is a native binary. So the project is written to
 * the machine the bridge is running on, exported there, and the bytes are read
 * back. Nothing is guessed about that machine: the engine is located, the
 * templates are checked, and each failure is reported as the specific thing it
 * is rather than as "the build failed".
 *
 * The one rule that shapes all of this: **Godot exits 0 when it exports
 * nothing.** Missing templates, a preset name that does not match, an SDK it
 * cannot find — all of them print a line and return success. So the exit code
 * is never the check. The file is.
 */

import { exportCommand, exportFailure, exportPresets, apkName, type ApkOptions } from './apk.ts';
import type { GodotFile } from './project.ts';

export interface BridgeRunner {
  writeFiles(files: Array<{ path: string; content?: string; base64?: string }>): Promise<unknown>;
  readFile(path: string): Promise<{ bytes: number; content?: string; base64?: string; binary: boolean }>;
  run(
    cmd: string,
    opts?: { cwd?: string; timeoutMs?: number; onOutput?: (chunk: string, stream: 'stdout' | 'stderr') => void },
  ): Promise<{ exitCode: number | null; stdout: string; stderr: string }>;
}

export interface ApkBuild {
  bytes?: Uint8Array;
  filename: string;
  /** Why there is no APK, in words worth showing. */
  error?: string;
  /** Everything Godot said, for the times the reason is not one of the known ones. */
  log: string;
  /** Where the engine was found, so a wrong one is visible. */
  godot?: string;
}

/** Names a Godot 4 binary goes by, most specific first. */
const GODOT_NAMES = ['godot4', 'godot-4', 'godot', 'Godot'];

/**
 * Finds the engine.
 *
 * `command -v` rather than a hardcoded path, because the bridge runs on
 * whatever machine the user has: a Mac with Homebrew, a Linux box with a
 * tarball in /opt, a Windows shell. An explicit path always wins.
 */
export async function findGodot(bridge: BridgeRunner, explicit?: string): Promise<{ path?: string; error?: string }> {
  if (explicit?.trim()) {
    const probe = await bridge.run(`"${explicit.trim()}" --version`, { timeoutMs: 30_000 });
    if (probe.exitCode === 0 && /^4\./m.test(probe.stdout)) return { path: explicit.trim() };
    return { error: `"${explicit.trim()}" is not a Godot 4 binary: ${(probe.stdout + probe.stderr).trim().slice(0, 160)}` };
  }

  for (const name of GODOT_NAMES) {
    const found = await bridge.run(`command -v ${name} || true`, { timeoutMs: 20_000 });
    const path = found.stdout.trim().split('\n')[0];
    if (!path) continue;
    const version = await bridge.run(`"${path}" --version`, { timeoutMs: 30_000 });
    // Godot 3 is a different engine with a different scene format; exporting a
    // Godot 4 project with it produces a broken APK rather than an error.
    if (/^4\./m.test(version.stdout)) return { path };
  }

  return {
    error:
      'No Godot 4 on the bridge machine. Install it and make sure `godot` is on the PATH, or set the engine path in Settings.',
  };
}

/** The version Godot reports, trimmed to something worth printing. */
export function versionFrom(output: string): string {
  const match = /^(4\.[\d.]+)\.(\w+)/m.exec(output.trim());
  return match ? `${match[1]} ${match[2]}` : output.trim().split('\n')[0] ?? 'unknown';
}

/**
 * Whether the export templates for this engine are installed.
 *
 * Checked before exporting rather than after, because the failure afterwards is
 * a zero exit code and no file, which reads as a mystery.
 */
export async function templatesInstalled(bridge: BridgeRunner, version: string): Promise<boolean> {
  const short = version.split(' ')[0];
  const probe = await bridge.run(
    `ls "$HOME/.local/share/godot/export_templates/${short}.stable/android_debug.apk" ` +
      `"$HOME/Library/Application Support/Godot/export_templates/${short}.stable/android_debug.apk" 2>/dev/null || true`,
    { timeoutMs: 20_000 },
  );
  return probe.stdout.trim().length > 0;
}

/** Turns a workspace file into something the bridge's write endpoint takes. */
export function asWritable(file: GodotFile, dir: string): { path: string; content?: string; base64?: string } {
  const path = `${dir}/${file.path}`;
  // Binary assets travel as data: URLs through the workspace. The bridge wants
  // the base64 on its own, without the mime prefix.
  if (file.content.startsWith('data:')) {
    const comma = file.content.indexOf(',');
    return { path, base64: file.content.slice(comma + 1) };
  }
  return { path, content: file.content };
}

/**
 * Builds the APK.
 *
 * Never throws: every failure comes back as `error` with the log attached, so
 * the caller can put both in front of the user rather than swallowing one.
 */
export async function buildApkOnBridge(
  bridge: BridgeRunner,
  files: GodotFile[],
  options: ApkOptions & { godotPath?: string; dir?: string; onStage?: (message: string) => void },
): Promise<ApkBuild> {
  const filename = apkName(options.name, options.versionName ?? '1.0');
  const dir = options.dir ?? `chomugiri-build/${options.name.replace(/[^A-Za-z0-9]+/g, '-').toLowerCase() || 'game'}`;
  let log = '';

  options.onStage?.('Looking for Godot on the bridge machine.');
  const engine = await findGodot(bridge, options.godotPath);
  if (!engine.path) return { filename, error: engine.error, log };

  const versionOut = await bridge.run(`"${engine.path}" --version`, { timeoutMs: 30_000 });
  const version = versionFrom(versionOut.stdout);
  options.onStage?.(`Godot ${version} at ${engine.path}.`);

  if (!(await templatesInstalled(bridge, version))) {
    return {
      filename,
      godot: engine.path,
      log,
      error: `Godot ${version} has no Android export templates installed. Open Godot → Editor → Manage Export Templates → Download, or drop the .tpz for ${version} into the templates folder. Without them the export silently produces nothing.`,
    };
  }

  options.onStage?.('Writing the project to the bridge.');
  // A previous build's output in the same folder would be read back as this
  // build's APK if this one exports nothing.
  await bridge.run(`rm -rf "${dir}"`, { timeoutMs: 60_000 });
  await bridge.run(`mkdir -p "${dir}"`, { timeoutMs: 60_000 });

  // Resolved to an absolute path before anything is exported.
  //
  // Godot resolves the export's output path against its own working directory,
  // not against `--path`. With both given relatively they point at different
  // places, and the export fails with "Target folder does not exist or is
  // inaccessible" after doing all the work — which is also one of the cases
  // where it still exits 0.
  const resolved = await bridge.run(`cd "${dir}" && pwd`, { timeoutMs: 30_000 });
  const projectDir = resolved.stdout.trim();
  if (!projectDir) {
    return { filename, godot: engine.path, log, error: `Could not create a build directory at "${dir}" on the bridge machine.` };
  }

  let presets: string;
  try {
    presets = exportPresets(options);
  } catch (err) {
    return { filename, godot: engine.path, log, error: (err as Error).message };
  }

  await bridge.writeFiles([
    ...files.map((f) => asWritable(f, dir)),
    { path: `${dir}/export_presets.cfg`, content: presets },
  ]);

  options.onStage?.('Exporting. This is the slow part.');
  const outPath = `${projectDir}/${filename}`;
  const argv = exportCommand(engine.path, projectDir, outPath, { release: options.release ?? false });
  // Quoted per argument, so a path with a space in it stays one argument.
  const cmd = argv.map((a) => (/[\s"]/.test(a) ? `"${a.replace(/"/g, '\\"')}"` : a)).join(' ');

  const run = await bridge.run(cmd, {
    // An export of a project with real assets takes minutes on a laptop.
    timeoutMs: 20 * 60_000,
    onOutput: (chunk) => {
      log += chunk;
    },
  });
  log += run.stdout + run.stderr;

  // The exit code says nothing. Read the file.
  let read: Awaited<ReturnType<BridgeRunner['readFile']>> | null = null;
  try {
    read = await bridge.readFile(`${dir}/${filename}`);
  } catch {
    read = null;
  }

  const failure = exportFailure(log, read !== null, read?.bytes ?? 0);
  if (failure || !read?.base64) {
    return { filename, godot: engine.path, log, error: failure ?? 'The export produced no readable APK.' };
  }

  const binary = Uint8Array.from(atob(read.base64), (c) => c.charCodeAt(0));
  // A zip, and an APK is a zip: "PK". Anything else is an error page or a
  // partial write, and handing it over as an APK wastes the user's install.
  if (binary[0] !== 0x50 || binary[1] !== 0x4b) {
    return { filename, godot: engine.path, log, error: 'What came back is not an APK — it does not even start with a zip header.' };
  }

  return { bytes: binary, filename, godot: engine.path, log };
}
