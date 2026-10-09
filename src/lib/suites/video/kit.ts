/**
 * The project around a video, and the commands that render it.
 *
 * Tested end to end on a real machine: a HyperFrames project renders a 10 s 1080p MP4 in about 15 s, a Remotion project a 2 s
 * 720p clip in about 15 s, both with no account and no key. The versions are pinned to the ones that were tested.
 */
import type { VideoEngine } from './detect.ts';

export const HYPERFRAMES_VERSION = '0.8.143';
export const REMOTION_VERSION = '4.0.250';

export interface KitFile { path: string; content: string }

const hyperframesFiles = (dir: string, name: string): KitFile[] => [
  {
    path: `${dir}/package.json`,
    content: JSON.stringify(
      {
        name,
        private: true,
        type: 'module',
        scripts: {
          check: `npx --yes hyperframes@${HYPERFRAMES_VERSION} check`,
          render: `npx --yes hyperframes@${HYPERFRAMES_VERSION} render --output renders/${name}.mp4`,
        },
      },
      null,
      2,
    ),
  },
  {
    path: `${dir}/hyperframes.json`,
    content: JSON.stringify(
      {
        $schema: 'https://hyperframes.heygen.com/schema/hyperframes.json',
        registry: 'https://raw.githubusercontent.com/heygen-com/hyperframes/main/registry',
        paths: { blocks: 'compositions', components: 'compositions/components', assets: 'assets' },
        media: { autoProxy: true },
      },
      null,
      2,
    ),
  },
  { path: `${dir}/meta.json`, content: JSON.stringify({ id: name, name, createdAt: new Date(0).toISOString() }, null, 2) },
];

const remotionFiles = (dir: string, name: string): KitFile[] => [
  {
    path: `${dir}/package.json`,
    content: JSON.stringify(
      {
        name,
        private: true,
        type: 'module',
        scripts: { render: `remotion render src/index.ts Main renders/${name}.mp4` },
        dependencies: { remotion: REMOTION_VERSION, '@remotion/cli': REMOTION_VERSION, react: '18.3.1', 'react-dom': '18.3.1' },
        devDependencies: { '@types/react': '18.3.1', typescript: '5.5.4' },
      },
      null,
      2,
    ),
  },
  {
    path: `${dir}/tsconfig.json`,
    content: JSON.stringify({ compilerOptions: { target: 'ES2022', module: 'ESNext', moduleResolution: 'bundler', jsx: 'react-jsx', strict: true, skipLibCheck: true, noEmit: true }, include: ['src'] }, null, 2),
  },
  // Whatever the model named the root component (Root, RemotionRoot, default), that is what is registered.
  { path: `${dir}/src/index.ts`, content: `import { registerRoot } from 'remotion';\nimport * as RootModule from './Root';\n\nconst m = RootModule as unknown as Record<string, React.FC>;\nregisterRoot(m.Root ?? m.RemotionRoot ?? m.default ?? Object.values(m).find((v) => typeof v === 'function')!);\n` },
];

/**
 * The package files around the model's composition (package.json and the rest), which replace anything the model wrote under those names.
 * Returns nothing when there is no video project in the files.
 */
export function videoKitFor(engine: VideoEngine, files: Array<{ path: string }>, extra: { gsap?: string | null } = {}): KitFile[] {
  const has = (p: string) => files.some((f) => f.path === p);
  const dirOf = (suffix: string): string | null => {
    const hit = files.find((f) => f.path === suffix || f.path.endsWith(`/${suffix}`));
    return hit ? hit.path.slice(0, hit.path.length - suffix.length).replace(/\/$/, '') : null;
  };
  const dir = engine === 'hyperframes' ? dirOf('index.html') : dirOf('src/Root.tsx');
  if (dir == null) return [];
  const base = dir || '.';
  const name = (dir.split('/').pop() || 'video').replace(/[^a-z0-9-]/gi, '-').toLowerCase() || 'video';
  const wanted = engine === 'hyperframes' ? hyperframesFiles(base, name) : remotionFiles(base, name);
  // GSAP is shipped beside the composition, not loaded from a CDN: a render that needs the network for its animation library fails
  // on a locked-down machine and offline, and a CDN that is blocked looks like a broken composition.
  if (engine === 'hyperframes' && extra.gsap) wanted.push({ path: `${base}/gsap.min.js`, content: extra.gsap });
  // The package files are ours, always: a model that writes its own invents versions and packages that do not exist, and a render
  // that fails on `npm install` is not a video. Only the composition itself (index.html, src/Root.tsx, scenes) is the model's.
  return wanted;
}

/** The commands that turn the project into an MP4, as the system prompt states them. */
export function renderCommands(engine: VideoEngine, dir = 'video'): string[] {
  // One command for HyperFrames: render lints the composition itself and fails on a real error, while the separate `check` also
  // reports style warnings as a failure on some machines and would stop the sequence before anything was rendered.
  return engine === 'hyperframes'
    ? [`cd ${dir} && npx --yes hyperframes@${HYPERFRAMES_VERSION} render --output renders/${dir.split('/').pop()}.mp4`]
    : [`cd ${dir} && npm install --no-audit --no-fund`, `cd ${dir} && npx remotion render src/index.ts Main renders/${dir.split('/').pop()}.mp4`];
}

/** Is the composition itself in these files (the one thing the kit cannot write for the model)? */
export function hasComposition(engine: VideoEngine, files: Array<{ path: string }>): boolean {
  return files.some((f) => (engine === 'hyperframes' ? /(^|\/)index\.html$/ : /(^|\/)src\/Root\.tsx$/).test(f.path));
}

/** A composition that loads GSAP from a CDN is pointed at the copy beside it. */
export function localGsap(html: string): string {
  return html.replace(/<script\s+src=["']https?:\/\/[^"']*gsap[^"']*["']\s*>/gi, '<script src="gsap.min.js">');
}
