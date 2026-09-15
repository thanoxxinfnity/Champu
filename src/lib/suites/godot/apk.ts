/**
 * Exporting a generated project to an Android APK.
 *
 * Godot's own exporter does the work; this writes the two files it needs and
 * the command that drives it. Nothing here compiles anything — that happens on
 * the terminal bridge, because an APK is a zip full of compiled native code and
 * a browser tab cannot produce one.
 *
 * ── What Godot needs before `--export-release` does anything ────────────────
 *
 *   1. **Export templates** for the exact engine version, in
 *      `~/.local/share/godot/export_templates/<version>.stable/`. Without them
 *      the export prints "No export template found" and exits 0 — a success
 *      code and no file, which is the worst possible combination.
 *   2. **`export_presets.cfg`** in the project root, naming a preset. The
 *      `--export-release "Android"` argument matches the preset's `name`, not
 *      the platform.
 *   3. **A keystore**, or `--export-debug`. A release export with no signing
 *      keys produces an unsigned APK that Android refuses to install.
 */

export interface ApkOptions {
  /** Shown under the launcher icon. */
  name: string;
  /** Reverse-DNS, and the one field Android will not let you change later. */
  packageName?: string;
  versionCode?: number;
  versionName?: string;
  /** Debug builds are signed with Godot's throwaway key and install fine. */
  release?: boolean;
  keystore?: { path: string; user: string; password: string };
}

/**
 * Java's reserved words.
 *
 * A package segment that is one of these is rejected by aapt, because the
 * manifest becomes a Java identifier. "Class", "Native" and "Package" are all
 * plausible game names, so this is not theoretical.
 */
const JAVA_KEYWORDS = new Set([
  'abstract', 'assert', 'boolean', 'break', 'byte', 'case', 'catch', 'char', 'class', 'const',
  'continue', 'default', 'do', 'double', 'else', 'enum', 'extends', 'final', 'finally', 'float',
  'for', 'goto', 'if', 'implements', 'import', 'instanceof', 'int', 'interface', 'long', 'native',
  'new', 'package', 'private', 'protected', 'public', 'return', 'short', 'static', 'strictfp',
  'super', 'switch', 'synchronized', 'this', 'throw', 'throws', 'transient', 'try', 'void',
  'volatile', 'while', 'true', 'false', 'null', '_',
]);

/** A package name Android accepts: reverse-DNS, no keywords, no leading digits. */
export function packageNameFor(gameName: string): string {
  const slug = gameName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '')
    .slice(0, 24);
  // Android rejects a segment that starts with a digit, is a Java keyword, or
  // is empty. All three get the same prefix rather than three different ones,
  // so the rule is one line to read.
  const safe = /^[a-z]/.test(slug) && !JAVA_KEYWORDS.has(slug) ? slug : `game${slug}`;
  return `com.chomugiri.${safe || 'game'}`;
}

/**
 * A value that survives being written into `export_presets.cfg`.
 *
 * The file is quoted-string config with no escape syntax worth trusting, so a
 * password containing a double quote does not error — it ends the string early
 * and Godot signs with a truncated password, which fails at install time with
 * a message about the certificate.
 */
function cfgString(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

/**
 * `export_presets.cfg`.
 *
 * The architecture list matters: `arm64-v8a` alone covers every phone sold for
 * years and halves the APK. Adding `x86_64` is for emulators, and it is off
 * because the people who need it know to turn it on.
 */
export function exportPresets(options: ApkOptions): string {
  const pkg = options.packageName ?? packageNameFor(options.name);
  const release = options.release ?? false;
  const keystore = options.keystore;

  // Refused rather than quietly downgraded. Writing debug keystore keys for a
  // release preset produces an APK that Android will not install, and the
  // reason only shows up on the phone, long after the build said it worked.
  if (release && !keystore) {
    throw new Error(
      'A release export needs a keystore. Pass one, or build a debug APK — a debug build signs itself and installs fine.',
    );
  }

  return `[preset.0]

name="Android"
platform="Android"
runnable=true
advanced_options=false
dedicated_server=false
custom_features=""
export_filter="all_resources"
include_filter=""
exclude_filter=""
export_path=""
encryption_include_filters=""
encryption_exclude_filters=""
encrypt_pck=false
encrypt_directory=false
script_export_mode=2

[preset.0.options]

custom_template/debug=""
custom_template/release=""
gradle_build/use_gradle_build=false
gradle_build/gradle_build_directory=""
gradle_build/android_source_template=""
gradle_build/compress_native_libraries=false
gradle_build/export_format=0
gradle_build/min_sdk=""
gradle_build/target_sdk=""
architectures/armeabi-v7a=false
architectures/arm64-v8a=true
architectures/x86=false
architectures/x86_64=false
version/code=${options.versionCode ?? 1}
version/name="${options.versionName ?? '1.0'}"
package/unique_name="${pkg}"
package/name="${cfgString(options.name)}"
package/signed=true
package/app_category=2
package/retain_data_on_uninstall=false
package/exclude_from_recents=false
package/show_in_android_tv=false
package/show_in_app_library=true
package/show_as_launcher_app=false
launcher_icons/main_192x192=""
launcher_icons/adaptive_foreground_432x432=""
launcher_icons/adaptive_background_432x432=""
graphics/opengl_debug=false
xr_features/xr_mode=0
screen/immersive_mode=true
screen/support_small=true
screen/support_normal=true
screen/support_large=true
screen/support_xlarge=true
user_data_backup/allow=false
command_line/extra_args=""
apk_expansion/enable=false
apk_expansion/SALT=""
apk_expansion/public_key=""
permissions/custom_permissions=PackedStringArray()
${
    release && keystore
      ? `keystore/release="${cfgString(keystore.path)}"
keystore/release_user="${cfgString(keystore.user)}"
keystore/release_password="${cfgString(keystore.password)}"`
      : `keystore/debug=""
keystore/debug_user=""
keystore/debug_password=""`
  }
`;
}

/**
 * The command that produces the APK.
 *
 * Split into argv rather than a string so a project path with a space in it
 * cannot turn into two arguments — which is exactly how the first version of
 * this failed, silently, with Godot exporting an empty project.
 */
export function exportCommand(
  godot: string,
  projectDir: string,
  outputApk: string,
  options: { release?: boolean; preset?: string } = {},
): string[] {
  return [
    godot,
    '--headless',
    '--path',
    projectDir,
    options.release ? '--export-release' : '--export-debug',
    options.preset ?? 'Android',
    outputApk,
  ];
}

/**
 * Whether Godot's export actually produced something.
 *
 * Godot exits 0 when the export templates are missing and when the preset does
 * not match, printing the reason and writing no file. So the exit code is not
 * the check — the file is, and this reads the reason out of the log so the user
 * is told which of the two it was.
 */
export function exportFailure(log: string, apkExists: boolean, apkBytes: number): string | null {
  if (apkExists && apkBytes > 1_000_000) return null;

  if (/No export template found|export templates.*not.*(found|installed)/i.test(log)) {
    return 'Godot has no Android export templates for this version. Install them from Editor → Manage Export Templates, or drop the .tpz into the templates folder.';
  }
  if (/Target folder does not exist or is inaccessible/i.test(log)) {
    return 'Godot could not write the APK where it was told to. It resolves the output path against its own working directory rather than against --path, so the output has to be absolute.';
  }
  if (/Could not find preset|No preset with the name/i.test(log)) {
    return 'The export preset named in the command is not in export_presets.cfg.';
  }
  if (/ANDROID_HOME|Android SDK|sdk path/i.test(log)) {
    return 'Godot cannot find the Android SDK. Set the SDK path in Editor Settings → Export → Android.';
  }
  if (/is not a valid Java package|not a valid package name|reserved word/i.test(log)) {
    return 'Android rejected the package name. A segment cannot start with a digit or be a Java keyword — rename the game, or pass packageName explicitly.';
  }
  if (/keystore/i.test(log)) {
    return 'The release keystore was rejected. Check the path, the alias and the password — or export a debug build, which signs itself.';
  }
  if (apkExists) {
    return `The export wrote only ${apkBytes} bytes, which is not an APK. Godot reported: ${log.slice(-300).trim()}`;
  }
  return `Godot exported nothing and did not say why. Last of its output: ${log.slice(-300).trim()}`;
}

/** A filename that is obviously this build, in a downloads folder full of them. */
export function apkName(gameName: string, versionName = '1.0'): string {
  const slug = gameName.replace(/[^A-Za-z0-9]+/g, '') || 'Game';
  return `${slug}-${versionName}.apk`;
}
