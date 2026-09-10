/**
 * Desktop → Android source analyser.
 *
 * Scope, stated plainly: a compiled `.exe` is machine code. It is not decompiled
 * here, and any tool claiming to turn an arbitrary Windows binary into an Android
 * app is lying. What this does:
 *
 *   * For a **source tree** (Electron, Python/Tk/PyQt, .NET WinForms/WPF, Java
 *     Swing/JavaFX, Qt/C++): parse the UI declaration and the entry points, and
 *     produce a concrete Android module plan.
 *   * For a **raw .exe**: read the PE header for architecture, subsystem, linked
 *     DLLs and embedded strings, then report what stack it was built with and
 *     what the migration actually requires. That is a triage report, not a port.
 */

export type DesktopStack =
  | 'electron'
  | 'tauri'
  | 'python-tk'
  | 'python-qt'
  | 'python-kivy'
  | 'dotnet-winforms'
  | 'dotnet-wpf'
  | 'java-swing'
  | 'javafx'
  | 'qt-cpp'
  | 'web'
  | 'unknown';

export type AndroidTarget = 'compose-native' | 'webview-wrapper' | 'kotlin-mvvm';

export interface UiElement {
  id: string;
  kind: 'button' | 'text' | 'input' | 'list' | 'table' | 'menu' | 'image' | 'checkbox' | 'select' | 'container' | 'canvas' | 'unknown';
  label?: string;
  /** Handler / callback name found in the source. */
  action?: string;
  children?: UiElement[];
  source: string;
}

export interface AnalysisResult {
  stack: DesktopStack;
  confidence: number;
  target: AndroidTarget;
  appName: string;
  packageName: string;
  entryPoints: string[];
  ui: UiElement[];
  /** Business logic units worth porting rather than rewriting. */
  logicModules: Array<{ file: string; kind: string; symbols: string[] }>;
  dependencies: string[];
  /** Desktop-only assumptions that break on a phone. */
  blockers: Array<{ severity: 'blocker' | 'warning'; issue: string; remedy: string }>;
  notes: string[];
}

interface SourceFile {
  path: string;
  content: string;
}

// ── Stack detection ─────────────────────────────────────────────────────────

const STACK_SIGNALS: Array<{ stack: DesktopStack; weight: number; test: (files: SourceFile[]) => boolean }> = [
  { stack: 'electron', weight: 5, test: (f) => f.some((x) => /require\(['"]electron['"]\)|from ['"]electron['"]/.test(x.content)) },
  { stack: 'electron', weight: 3, test: (f) => f.some((x) => x.path.endsWith('package.json') && /"electron"/.test(x.content)) },
  { stack: 'tauri', weight: 5, test: (f) => f.some((x) => x.path.endsWith('tauri.conf.json') || /@tauri-apps\//.test(x.content)) },
  { stack: 'python-tk', weight: 5, test: (f) => f.some((x) => /^\s*(import\s+tkinter|from\s+tkinter\s+import)/m.test(x.content)) },
  { stack: 'python-qt', weight: 5, test: (f) => f.some((x) => /from\s+(PyQt[56]|PySide[26])/.test(x.content)) },
  { stack: 'python-kivy', weight: 5, test: (f) => f.some((x) => /from\s+kivy/.test(x.content)) },
  { stack: 'dotnet-wpf', weight: 5, test: (f) => f.some((x) => x.path.endsWith('.xaml') && /<Window|<UserControl/.test(x.content)) },
  { stack: 'dotnet-winforms', weight: 5, test: (f) => f.some((x) => /System\.Windows\.Forms/.test(x.content)) },
  { stack: 'javafx', weight: 5, test: (f) => f.some((x) => /javafx\.(application|scene)/.test(x.content)) },
  { stack: 'java-swing', weight: 4, test: (f) => f.some((x) => /javax\.swing\./.test(x.content)) },
  { stack: 'qt-cpp', weight: 4, test: (f) => f.some((x) => /#include\s+<Q(Application|Widget|MainWindow)>/.test(x.content)) },
  { stack: 'web', weight: 2, test: (f) => f.some((x) => x.path.endsWith('index.html')) },
];

export function detectStack(files: SourceFile[]): { stack: DesktopStack; confidence: number } {
  const scores = new Map<DesktopStack, number>();
  for (const signal of STACK_SIGNALS) {
    if (signal.test(files)) scores.set(signal.stack, (scores.get(signal.stack) ?? 0) + signal.weight);
  }
  if (!scores.size) return { stack: 'unknown', confidence: 0 };

  const [stack, score] = [...scores.entries()].sort((a, b) => b[1] - a[1])[0];
  return { stack, confidence: Math.min(1, score / 6) };
}

// ── UI extraction ───────────────────────────────────────────────────────────

/** Tkinter/PyQt widget constructors → semantic kinds. */
const PY_WIDGETS: Array<[RegExp, UiElement['kind']]> = [
  [/\b(?:tk\.|ttk\.)?Button\s*\(/g, 'button'],
  [/\bQPushButton\s*\(/g, 'button'],
  [/\b(?:tk\.|ttk\.)?Label\s*\(/g, 'text'],
  [/\bQLabel\s*\(/g, 'text'],
  [/\b(?:tk\.|ttk\.)?Entry\s*\(/g, 'input'],
  [/\bQLineEdit\s*\(|\bQTextEdit\s*\(/g, 'input'],
  [/\b(?:tk\.|ttk\.)?Listbox\s*\(/g, 'list'],
  [/\bQListWidget\s*\(/g, 'list'],
  [/\bQTableWidget\s*\(|\bTreeview\s*\(/g, 'table'],
  [/\b(?:tk\.|ttk\.)?Checkbutton\s*\(|\bQCheckBox\s*\(/g, 'checkbox'],
  [/\b(?:tk\.|ttk\.)?Combobox\s*\(|\bQComboBox\s*\(/g, 'select'],
  [/\b(?:tk\.|ttk\.)?Canvas\s*\(/g, 'canvas'],
  [/\b(?:tk\.|ttk\.)?Frame\s*\(|\bQWidget\s*\(|\bQGroupBox\s*\(/g, 'container'],
  [/\bMenu\s*\(|\bQMenuBar\s*\(/g, 'menu'],
];

const XAML_WIDGETS: Array<[RegExp, UiElement['kind']]> = [
  [/<Button\b/g, 'button'],
  [/<(?:TextBlock|Label)\b/g, 'text'],
  [/<TextBox\b|<PasswordBox\b/g, 'input'],
  [/<(?:ListBox|ListView|ItemsControl)\b/g, 'list'],
  [/<DataGrid\b/g, 'table'],
  [/<CheckBox\b/g, 'checkbox'],
  [/<ComboBox\b/g, 'select'],
  [/<(?:Image)\b/g, 'image'],
  [/<(?:Grid|StackPanel|DockPanel|Canvas|Border)\b/g, 'container'],
  [/<Menu\b/g, 'menu'],
];

const HTML_WIDGETS: Array<[RegExp, UiElement['kind']]> = [
  [/<button\b|<input[^>]+type=["'](?:button|submit)["']/gi, 'button'],
  [/<(?:h[1-6]|p|span|label)\b/gi, 'text'],
  [/<input\b(?![^>]+type=["'](?:button|submit|checkbox)["'])|<textarea\b/gi, 'input'],
  [/<(?:ul|ol)\b/gi, 'list'],
  [/<table\b/gi, 'table'],
  [/<input[^>]+type=["']checkbox["']/gi, 'checkbox'],
  [/<select\b/gi, 'select'],
  [/<img\b/gi, 'image'],
  [/<canvas\b/gi, 'canvas'],
  [/<(?:div|section|main|nav|form)\b/gi, 'container'],
];

function extractUi(files: SourceFile[], stack: DesktopStack): UiElement[] {
  const elements: UiElement[] = [];
  let counter = 0;

  const table =
    stack.startsWith('python') ? PY_WIDGETS
      : stack.startsWith('dotnet') ? XAML_WIDGETS
        : stack === 'electron' || stack === 'tauri' || stack === 'web' ? HTML_WIDGETS
          : [...PY_WIDGETS, ...XAML_WIDGETS, ...HTML_WIDGETS];

  for (const file of files) {
    for (const [pattern, kind] of table) {
      const re = new RegExp(pattern.source, pattern.flags);
      let m: RegExpExecArray | null;
      while ((m = re.exec(file.content)) !== null && counter < 400) {
        // Pull a nearby label/text= / Content= attribute for the element name.
        const window = file.content.slice(m.index, m.index + 400);
        const label =
          /(?:text|Content|label|title|placeholder)\s*[=:]\s*["']([^"']{1,60})["']/i.exec(window)?.[1] ??
          />([^<>{}\n]{2,50})</.exec(window)?.[1]?.trim();
        const action =
          /(?:command|onclick|onClick|Click|clicked\.connect|addEventListener\(['"]click['"],)\s*[=(]?\s*["']?(\w+)/i.exec(window)?.[1];

        elements.push({
          id: `el_${counter++}`,
          kind,
          label: label?.trim(),
          action,
          source: file.path,
        });
      }
    }
  }

  return elements;
}

// ── Blocker analysis ────────────────────────────────────────────────────────

/**
 * Desktop assumptions that do not survive the move to Android. These are the
 * things that turn a "done" port into a crash on first launch, so they are
 * surfaced before a single line of Kotlin is generated.
 */
const BLOCKER_RULES: Array<{ pattern: RegExp; severity: 'blocker' | 'warning'; issue: string; remedy: string }> = [
  {
    pattern: /\b(?:open|fopen|File\()\s*\(\s*["'][A-Za-z]:\\|["']\/(?:home|usr|etc)\//,
    severity: 'blocker',
    issue: 'Hardcoded absolute filesystem paths.',
    remedy: 'Android sandboxes app storage. Route every path through Context.filesDir / getExternalFilesDir(), or the Storage Access Framework for user-picked files.',
  },
  {
    pattern: /\bsubprocess\.|child_process|Process\.Start|Runtime\.getRuntime\(\)\.exec/,
    severity: 'blocker',
    issue: 'Spawns external processes.',
    remedy: 'Android apps cannot fork arbitrary binaries. Reimplement the logic in-process, or ship a native library through the NDK.',
  },
  {
    pattern: /\b(?:win32api|win32com|pywin32|ctypes\.windll|System\.Windows\.Interop|user32\.dll)/i,
    severity: 'blocker',
    issue: 'Win32 API dependency.',
    remedy: 'No equivalent exists. Identify the capability behind each call and map it to an Android API, or drop the feature.',
  },
  {
    pattern: /\b(?:sqlite3|System\.Data\.SQLite)\b/,
    severity: 'warning',
    issue: 'Direct SQLite usage.',
    remedy: 'Port to Room. The schema carries over; the access layer does not.',
  },
  {
    pattern: /\bthreading\.Thread|new Thread\(|Task\.Run/,
    severity: 'warning',
    issue: 'Raw thread usage.',
    remedy: 'Move to coroutines with a lifecycle-aware scope. Raw threads leak across configuration changes on Android.',
  },
  {
    pattern: /\bprint\(|Console\.WriteLine|System\.out\.println/,
    severity: 'warning',
    issue: 'Console output as the UI channel.',
    remedy: 'Nothing reads stdout on Android. Route status into the UI state or android.util.Log.',
  },
  {
    pattern: /\b(?:messagebox|MessageBox|showinfo|QMessageBox)/,
    severity: 'warning',
    issue: 'Blocking modal dialogs.',
    remedy: 'Blocking dialogs stall the main thread on Android. Use AlertDialog / Compose AlertDialog driven by state.',
  },
  {
    pattern: /\bwindow\.(?:setFixedSize|resizable\(False)|\.geometry\(["']\d+x\d+/,
    severity: 'warning',
    issue: 'Fixed window geometry.',
    remedy: 'Phone layouts must reflow. Replace absolute sizing with constraint/flex layout and dp-based spacing.',
  },
];

function findBlockers(files: SourceFile[]): AnalysisResult['blockers'] {
  const found = new Map<string, AnalysisResult['blockers'][number]>();
  for (const file of files) {
    for (const rule of BLOCKER_RULES) {
      if (rule.pattern.test(file.content) && !found.has(rule.issue)) {
        found.set(rule.issue, { severity: rule.severity, issue: rule.issue, remedy: rule.remedy });
      }
    }
  }
  return [...found.values()];
}

// ── Logic extraction ────────────────────────────────────────────────────────

function extractLogic(files: SourceFile[]): AnalysisResult['logicModules'] {
  const modules: AnalysisResult['logicModules'] = [];

  for (const file of files) {
    // Skip anything that is predominantly UI wiring.
    if (/\.(xaml|html|css|ui)$/.test(file.path)) continue;

    const symbols: string[] = [];
    const patterns = [
      /^\s*(?:def|async def)\s+(\w+)/gm,
      /^\s*(?:export\s+)?(?:async\s+)?function\s+(\w+)/gm,
      /^\s*(?:public|private|protected|internal)?\s*(?:static\s+)?[\w<>,\[\]]+\s+(\w+)\s*\([^)]*\)\s*\{/gm,
      /^\s*class\s+(\w+)/gm,
    ];

    for (const p of patterns) {
      let m: RegExpExecArray | null;
      while ((m = p.exec(file.content)) !== null) {
        if (!/^(?:on|handle|render|draw|paint|setup|init)?[A-Z_]?/.test(m[1])) continue;
        if (symbols.length < 40) symbols.push(m[1]);
      }
    }

    if (symbols.length >= 2) {
      const uiRatio = (file.content.match(/Button|Label|Widget|Window|Frame/g) ?? []).length / symbols.length;
      modules.push({
        file: file.path,
        kind: uiRatio > 2 ? 'ui-heavy' : 'business-logic',
        symbols,
      });
    }
  }

  return modules.sort((a, b) => (a.kind === 'business-logic' ? -1 : 1)).slice(0, 30);
}

// ── Public entry point ──────────────────────────────────────────────────────

export function analyzeSource(files: SourceFile[], appNameHint?: string): AnalysisResult {
  const { stack, confidence } = detectStack(files);
  const ui = extractUi(files, stack);
  const blockers = findBlockers(files);
  const logicModules = extractLogic(files);
  const notes: string[] = [];

  const pkg = files.find((f) => f.path.endsWith('package.json'));
  let appName = appNameHint ?? 'MigratedApp';
  const dependencies: string[] = [];

  if (pkg) {
    try {
      const parsed = JSON.parse(pkg.content) as { name?: string; dependencies?: Record<string, string> };
      appName = appNameHint ?? parsed.name ?? appName;
      dependencies.push(...Object.keys(parsed.dependencies ?? {}));
    } catch {
      notes.push('package.json is present but not parseable — dependency list may be incomplete.');
    }
  }

  const requirements = files.find((f) => f.path.endsWith('requirements.txt'));
  if (requirements) dependencies.push(...requirements.content.split('\n').map((l) => l.split(/[=<>]/)[0].trim()).filter(Boolean));

  const entryPoints = files
    .filter((f) => /(?:^|\/)(?:main|index|app|program|Program|Main|__main__)\.(?:py|js|ts|cs|java|cpp)$/.test(f.path))
    .map((f) => f.path);

  /**
   * Target selection.
   * Rewriting an Electron app's entire renderer as Compose is weeks of work for
   * a result that is usually worse. A WebView wrapper preserves the working UI
   * and is the correct call unless the app is small or heavily native.
   */
  let target: AndroidTarget;
  if (stack === 'electron' || stack === 'tauri' || stack === 'web') {
    target = ui.length > 60 ? 'webview-wrapper' : 'compose-native';
    if (target === 'webview-wrapper') {
      notes.push(
        `${ui.length} UI elements detected in a web-rendered stack. Wrapping the existing renderer in a WebView preserves behaviour; a full Compose rewrite of this surface is not justified. Switch the target manually if native feel matters more than fidelity.`,
      );
    }
  } else if (logicModules.filter((m) => m.kind === 'business-logic').length > 8) {
    target = 'kotlin-mvvm';
  } else {
    target = 'compose-native';
  }

  if (stack === 'unknown') {
    notes.push('No known desktop stack signature matched. Generation falls back to a generic Compose scaffold; supply the UI source files for a real mapping.');
  }
  if (!ui.length) {
    notes.push('No UI widgets were extracted. The generated screen will be a placeholder shell.');
  }

  const packageName = `com.chomugiri.${appName.toLowerCase().replace(/[^a-z0-9]/g, '')}`.slice(0, 60);

  return {
    stack,
    confidence,
    target,
    appName: appName.replace(/[^A-Za-z0-9 ]/g, '').trim() || 'MigratedApp',
    packageName,
    entryPoints,
    ui,
    logicModules,
    dependencies: [...new Set(dependencies)].slice(0, 60),
    blockers,
    notes,
  };
}

// ── PE binary triage ────────────────────────────────────────────────────────

export interface ExeInspection {
  isPE: boolean;
  architecture: 'x86' | 'x64' | 'arm64' | 'unknown';
  subsystem: string;
  imports: string[];
  likelyStack: DesktopStack;
  strings: string[];
  verdict: string;
}

/**
 * Read a Windows PE header. This is triage, not decompilation — it identifies
 * which runtime the binary was built with so the user knows what source to go
 * find, and says so directly instead of pretending to port the binary.
 */
export function inspectExe(bytes: Uint8Array): ExeInspection {
  const fail = (verdict: string): ExeInspection => ({
    isPE: false, architecture: 'unknown', subsystem: 'unknown', imports: [], likelyStack: 'unknown', strings: [], verdict,
  });

  if (bytes.length < 0x40 || bytes[0] !== 0x4d || bytes[1] !== 0x5a) {
    return fail('Not a Windows PE executable (no MZ signature). If this is an ELF or Mach-O binary, the same limitation applies: binaries are not portable to Android.');
  }

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const peOffset = view.getUint32(0x3c, true);
  if (peOffset + 24 > bytes.length || view.getUint32(peOffset, true) !== 0x00004550) {
    return fail('MZ header present but the PE signature is missing or truncated.');
  }

  const machine = view.getUint16(peOffset + 4, true);
  const architecture = machine === 0x8664 ? 'x64' : machine === 0x014c ? 'x86' : machine === 0xaa64 ? 'arm64' : 'unknown';

  const optionalHeaderOffset = peOffset + 24;
  const magic = view.getUint16(optionalHeaderOffset, true);
  const subsystemOffset = optionalHeaderOffset + (magic === 0x20b ? 68 : 68);
  const subsystemCode = subsystemOffset + 2 <= bytes.length ? view.getUint16(subsystemOffset, true) : 0;
  const subsystem = subsystemCode === 2 ? 'Windows GUI' : subsystemCode === 3 ? 'Windows Console' : `code ${subsystemCode}`;

  // Extract printable ASCII runs — enough to spot the packaging runtime.
  const strings: string[] = [];
  let current = '';
  for (let i = 0; i < Math.min(bytes.length, 6_000_000); i++) {
    const b = bytes[i];
    if (b >= 0x20 && b <= 0x7e) {
      current += String.fromCharCode(b);
    } else {
      if (current.length >= 6) strings.push(current);
      current = '';
    }
  }
  if (current.length >= 6) strings.push(current);

  const imports = [...new Set(strings.filter((s) => /\.dll$/i.test(s)))].slice(0, 60);
  const blob = strings.join('\n');

  let likelyStack: DesktopStack = 'unknown';
  let hint = '';
  if (/electron|chrome_child|app\.asar/i.test(blob)) {
    likelyStack = 'electron';
    hint = 'Electron bundle detected. Extract app.asar (`npx asar extract app.asar out/`) and feed the JavaScript source in — that source converts well.';
  } else if (/python\d*\.dll|PYTHONHOME|_MEIPASS|pyinstaller/i.test(blob)) {
    likelyStack = 'python-tk';
    hint = 'PyInstaller/Python bundle. Unpack with pyinstxtractor, decompile the .pyc back to source, then feed the .py files in.';
  } else if (/mscoree\.dll|\.NETFramework|System\.Windows\.Forms/i.test(blob)) {
    likelyStack = /PresentationFramework/i.test(blob) ? 'dotnet-wpf' : 'dotnet-winforms';
    hint = '.NET assembly. ILSpy or dnSpy recovers near-original C#, which converts cleanly.';
  } else if (/Qt\dCore|Qt\dWidgets/i.test(blob)) {
    likelyStack = 'qt-cpp';
    hint = 'Qt/C++ binary. No practical decompilation path — the original source is required.';
  } else if (/jvm\.dll|java\.exe|JavaFX/i.test(blob)) {
    likelyStack = 'javafx';
    hint = 'JVM launcher. If a bundled .jar exists, CFR or Procyon recovers usable Java.';
  }

  return {
    isPE: true,
    architecture,
    subsystem,
    imports,
    likelyStack,
    strings: strings.filter((s) => s.length > 12 && /[a-z]{4}/i.test(s)).slice(0, 200),
    verdict: [
      `${architecture.toUpperCase()} ${subsystem} PE binary.`,
      hint || 'No recognisable runtime signature. Without source, there is no migration path — machine code targeting x86 Windows does not translate to Android.',
      'This tool converts source, not binaries. Recover the source with the step above and re-run the analysis on it.',
    ].join(' '),
  };
}
