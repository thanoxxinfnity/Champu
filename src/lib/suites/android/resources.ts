/**
 * The resources an Android project names but does not define.
 *
 * A model writing an app in chat reliably writes `android:icon="@mipmap/ic_launcher"`
 * and `R.drawable.ic_star`, and just as reliably forgets that nothing creates
 * either. Resource linking then fails outright — "resource mipmap/ic_launcher
 * not found" — and a project that looked complete never builds. The generator
 * has always emitted a launcher icon for projects it writes itself; this gives
 * the same guarantee to projects the model wrote.
 *
 * Pure: file lists in, file lists out, so it can be checked without a build.
 */

export interface ProjectFile {
  path: string;
  content: string;
}

export interface MissingResource {
  kind: 'drawable' | 'mipmap';
  name: string;
  /** The file that named it. */
  from: string;
  /** Whether the app's own manifest uses it as the launcher icon. */
  launcher: boolean;
}

const RES_FILE = /(?:^|\/)res\/(drawable|mipmap)[^/]*\/([^/.]+)\.[A-Za-z0-9]+$/;
const XML_REF = /@(drawable|mipmap)\/([A-Za-z0-9_]+)/g;
const CODE_REF = /\bR\.(drawable|mipmap)\.([A-Za-z0-9_]+)/g;
const MANIFEST = /(?:^|\/)AndroidManifest\.xml$/;

function definedNames(files: ProjectFile[]): Set<string> {
  const out = new Set<string>();
  for (const f of files) {
    const m = RES_FILE.exec(f.path);
    if (m) out.add(`${m[1]}/${m[2]}`);
  }
  return out;
}

/** Everything named but not defined, each once. */
export function findMissingResources(files: ProjectFile[]): MissingResource[] {
  const defined = definedNames(files);
  const manifests = files.filter((f) => MANIFEST.test(f.path));
  const seen = new Set<string>();
  const out: MissingResource[] = [];

  for (const f of files) {
    const isXml = /\.xml$/i.test(f.path);
    const isCode = /\.(kt|java)$/i.test(f.path);
    if (!isXml && !isCode) continue;

    for (const m of f.content.matchAll(new RegExp((isCode ? CODE_REF : XML_REF).source, 'g'))) {
      const key = `${m[1]}/${m[2]}`;
      if (defined.has(key) || seen.has(key)) continue;
      seen.add(key);

      // Checked against the manifest directly rather than against the file
      // that happened to be scanned first, so the answer does not depend on
      // the order the files arrived in.
      const launcherRef = new RegExp(`android:(?:icon|roundIcon)\\s*=\\s*"@${m[1]}/${m[2]}"`);
      out.push({
        kind: m[1] as 'drawable' | 'mipmap',
        name: m[2],
        from: f.path,
        launcher: manifests.some((mf) => launcherRef.test(mf.content)),
      });
    }
  }
  return out;
}

/** The module's res directory, found from wherever its manifest is. */
function resDirFor(files: ProjectFile[]): string {
  const manifest = files.find((f) => MANIFEST.test(f.path));
  if (!manifest) return 'app/src/main/res';
  return manifest.path.replace(/AndroidManifest\.xml$/, 'res').replace(/^\//, '');
}

/** A hue from the app's name, so two generated apps do not share an icon. */
function hueOf(name: string): number {
  let h = 0;
  for (const c of name) h = (h * 31 + c.charCodeAt(0)) % 360;
  return h;
}

function hsl(h: number, s: number, l: number): string {
  const a = (s / 100) * Math.min(l / 100, 1 - l / 100);
  const f = (n: number) => {
    const k = (n + h / 30) % 12;
    const c = l / 100 - a * Math.max(-1, Math.min(k - 3, Math.min(9 - k, 1)));
    return Math.round(255 * c).toString(16).padStart(2, '0');
  };
  return `#${f(0)}${f(8)}${f(4)}`.toUpperCase();
}

const VECTOR_OPEN = `<?xml version="1.0" encoding="utf-8"?>
<vector xmlns:android="http://schemas.android.com/apk/res/android"
    android:width="108dp"
    android:height="108dp"
    android:viewportWidth="108"
    android:viewportHeight="108">`;

/**
 * A launcher icon for an app that named one and never drew it: an adaptive
 * icon (so the launcher can mask it) over a legacy vector for API 24-25,
 * coloured from the app's name. A placeholder, and reported as one — but a
 * placeholder that builds beats a project that does not.
 */
function launcherIconFiles(resDir: string, name: string, appName: string): ProjectFile[] {
  const hue = hueOf(appName || name);
  const bg = hsl(hue, 62, 22);
  const fg = hsl(hue, 85, 68);
  const bgName = `${name}_bg`;
  const fgName = `${name}_fg`;
  // A four-point spark: distinctive at launcher size, and plain geometry so
  // there is nothing here for a renderer to get wrong.
  const spark = 'M54,26 L61,47 L82,54 L61,61 L54,82 L47,61 L26,54 L47,47 Z';

  return [
    {
      path: `${resDir}/drawable/${bgName}.xml`,
      content: `${VECTOR_OPEN}
    <path android:pathData="M0,0 H108 V108 H0 Z" android:fillColor="${bg}" />
</vector>
`,
    },
    {
      path: `${resDir}/drawable/${fgName}.xml`,
      content: `${VECTOR_OPEN}
    <path android:pathData="${spark}" android:fillColor="${fg}" />
</vector>
`,
    },
    {
      path: `${resDir}/mipmap-anydpi-v26/${name}.xml`,
      content: `<?xml version="1.0" encoding="utf-8"?>
<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">
    <background android:drawable="@drawable/${bgName}" />
    <foreground android:drawable="@drawable/${fgName}" />
    <monochrome android:drawable="@drawable/${fgName}" />
</adaptive-icon>
`,
    },
    {
      path: `${resDir}/mipmap-anydpi/${name}.xml`,
      content: `${VECTOR_OPEN}
    <path android:pathData="M12,12 H96 V96 H12 Z" android:fillColor="${bg}" />
    <path android:pathData="${spark}" android:fillColor="${fg}" />
</vector>
`,
    },
  ];
}

/** A neutral stand-in for a drawable the code uses and nothing defines. */
function placeholderDrawable(resDir: string, name: string): ProjectFile {
  return {
    path: `${resDir}/drawable/${name}.xml`,
    content: `<?xml version="1.0" encoding="utf-8"?>
<vector xmlns:android="http://schemas.android.com/apk/res/android"
    android:width="24dp"
    android:height="24dp"
    android:viewportWidth="24"
    android:viewportHeight="24"
    android:tint="?attr/colorControlNormal">
    <path
        android:pathData="M12,4 A8,8 0 1,0 12,20 A8,8 0 1,0 12,4 Z"
        android:strokeColor="#FF757575"
        android:strokeWidth="2"
        android:fillColor="#00000000" />
</vector>
`,
  };
}

export interface ResourceRepair {
  /** New files to add to the project. */
  files: ProjectFile[];
  launcherIcons: string[];
  placeholders: string[];
}

/**
 * The files that make a project's resource references resolve. Empty when
 * nothing is missing, so a complete project is left exactly as it was written.
 */
export function repairResources(files: ProjectFile[], appName = ''): ResourceRepair {
  const manifest = files.find((f) => MANIFEST.test(f.path));
  // Not an Android project — a stray `@drawable/` in a web page is not ours.
  if (!manifest) return { files: [], launcherIcons: [], placeholders: [] };

  const resDir = resDirFor(files);
  const out: ProjectFile[] = [];
  const launcherIcons: string[] = [];
  const placeholders: string[] = [];

  for (const missing of findMissingResources(files)) {
    if (missing.launcher) {
      out.push(...launcherIconFiles(resDir, missing.name, appName));
      launcherIcons.push(`${missing.kind}/${missing.name}`);
    } else if (missing.kind === 'drawable') {
      out.push(placeholderDrawable(resDir, missing.name));
      placeholders.push(`drawable/${missing.name}`);
    } else {
      // A mipmap that is not the launcher icon: the same art serves.
      out.push(...launcherIconFiles(resDir, missing.name, appName));
      placeholders.push(`mipmap/${missing.name}`);
    }
  }

  // A launcher icon and its round twin often share one set of files.
  const unique = new Map(out.map((f) => [f.path, f]));
  return { files: [...unique.values()], launcherIcons, placeholders };
}
