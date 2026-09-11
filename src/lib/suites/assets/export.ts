import type { ZipEntry } from '@/lib/zip';
import { canvasToBytes, resizeSquare } from './matte';

/**
 * Turn one transparent asset into the full set a platform actually needs.
 *
 * Shipping a single PNG is the usual half-measure: Android then upscales one
 * bitmap across five densities and it looks soft on every device that is not the
 * one it was authored for. These are the buckets and safe zones the platforms
 * really specify.
 */

export type AssetTarget = 'android-icon' | 'android-drawable' | 'web-favicon' | 'web-image';

/** Android density buckets. The multiplier is relative to mdpi (160dpi). */
export const ANDROID_DENSITIES = [
  { name: 'mdpi', scale: 1 },
  { name: 'hdpi', scale: 1.5 },
  { name: 'xhdpi', scale: 2 },
  { name: 'xxhdpi', scale: 3 },
  { name: 'xxxhdpi', scale: 4 },
] as const;

/** Launcher icon edge length per bucket, in pixels. */
const LAUNCHER_SIZES: Record<string, number> = {
  mdpi: 48,
  hdpi: 72,
  xhdpi: 96,
  xxhdpi: 144,
  xxxhdpi: 192,
};

export interface AssetBundle {
  entries: ZipEntry[];
  notes: string[];
}

const slug = (name: string) =>
  name.toLowerCase().replace(/[^a-z0-9_]+/g, '_').replace(/^_+|_+$/g, '').replace(/^(\d)/, 'a$1') || 'asset';

/**
 * Launcher icon set.
 *
 * The adaptive foreground is drawn on a 432px canvas with the subject inside the
 * central 66% — outside that ring the launcher's mask can crop anything away,
 * which is why so many third-party icons lose their edges on Pixel launchers.
 */
export function androidIconBundle(source: HTMLCanvasElement, name = 'ic_launcher', background = '#09090B'): AssetBundle {
  const id = slug(name);
  const entries: ZipEntry[] = [];
  const notes: string[] = [];

  for (const { name: density } of ANDROID_DENSITIES) {
    const size = LAUNCHER_SIZES[density];
    entries.push({
      path: `res/mipmap-${density}/${id}.png`,
      content: canvasToBytes(resizeSquare(source, size, 0.08)),
    });
    entries.push({
      path: `res/mipmap-${density}/${id}_round.png`,
      content: canvasToBytes(resizeSquare(source, size, 0.12)),
    });
  }

  // 432 canvas, 0.17 inset ⇒ the subject sits inside the 264px safe circle.
  entries.push({
    path: `res/drawable/${id}_foreground.png`,
    content: canvasToBytes(resizeSquare(source, 432, 0.17)),
  });

  entries.push({
    path: `res/values/${id}_colors.xml`,
    content: `<?xml version="1.0" encoding="utf-8"?>
<resources>
    <color name="${id}_background">${background}</color>
</resources>
`,
  });

  const adaptive = `<?xml version="1.0" encoding="utf-8"?>
<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">
    <background android:drawable="@color/${id}_background" />
    <foreground android:drawable="@drawable/${id}_foreground" />
    <monochrome android:drawable="@drawable/${id}_foreground" />
</adaptive-icon>
`;
  entries.push({ path: `res/mipmap-anydpi-v26/${id}.xml`, content: adaptive });
  entries.push({ path: `res/mipmap-anydpi-v26/${id}_round.xml`, content: adaptive });

  // Play Console requires exactly 512×512, 32-bit PNG, no transparency.
  const store = document.createElement('canvas');
  store.width = 512;
  store.height = 512;
  const ctx = store.getContext('2d');
  if (ctx) {
    ctx.fillStyle = background;
    ctx.fillRect(0, 0, 512, 512);
    const inner = resizeSquare(source, 512, 0.12);
    ctx.drawImage(inner, 0, 0);
  }
  entries.push({ path: `play-store/${id}-512.png`, content: canvasToBytes(store) });

  notes.push('Copy res/ into app/src/main/ and point android:icon at @mipmap/' + id + '.');
  notes.push('The adaptive foreground is inset to the 66% safe zone, so launcher masks will not clip it.');
  notes.push('play-store/ is flattened onto the background colour — the Play Console rejects transparency.');

  return { entries, notes };
}

/** A general drawable at every density, sized from its mdpi baseline in dp. */
export function androidDrawableBundle(source: HTMLCanvasElement, name: string, baselineDp = 96): AssetBundle {
  const id = slug(name);
  const entries: ZipEntry[] = [];

  const aspect = source.height / source.width;
  for (const { name: density, scale } of ANDROID_DENSITIES) {
    const width = Math.round(baselineDp * scale);
    const height = Math.round(width * aspect);

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(source, 0, 0, width, height);
    }
    entries.push({ path: `res/drawable-${density}/${id}.png`, content: canvasToBytes(canvas) });
  }

  return {
    entries,
    notes: [
      `Baseline ${baselineDp}dp. Reference it as @drawable/${id} — Android picks the right density automatically.`,
    ],
  };
}

const WEB_ICONS = [
  { size: 16, path: 'favicon-16x16.png' },
  { size: 32, path: 'favicon-32x32.png' },
  { size: 48, path: 'favicon-48x48.png' },
  { size: 180, path: 'apple-touch-icon.png' },
  { size: 192, path: 'android-chrome-192x192.png' },
  { size: 512, path: 'android-chrome-512x512.png' },
] as const;

/** Favicon set, manifest and the head snippet that wires them up. */
export function webIconBundle(source: HTMLCanvasElement, appName = 'App', themeColor = '#09090B'): AssetBundle {
  const entries: ZipEntry[] = [];

  for (const { size, path } of WEB_ICONS) {
    // Apple refuses alpha on the touch icon and composites it onto black, so it
    // gets the theme colour behind it instead of a muddy edge.
    const opaque = path === 'apple-touch-icon.png';
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');
    if (ctx) {
      if (opaque) {
        ctx.fillStyle = themeColor;
        ctx.fillRect(0, 0, size, size);
      }
      ctx.drawImage(resizeSquare(source, size, opaque ? 0.1 : 0.04), 0, 0);
    }
    entries.push({ path: `public/${path}`, content: canvasToBytes(canvas) });
  }

  entries.push({
    path: 'public/site.webmanifest',
    content: JSON.stringify(
      {
        name: appName,
        short_name: appName.slice(0, 12),
        icons: [
          { src: '/android-chrome-192x192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: '/android-chrome-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'any maskable' },
        ],
        theme_color: themeColor,
        background_color: themeColor,
        display: 'standalone',
      },
      null,
      2,
    ) + '\n',
  });

  entries.push({
    path: 'HEAD-SNIPPET.html',
    content: `<!-- Paste into <head> -->
<link rel="icon" type="image/png" sizes="32x32" href="/favicon-32x32.png">
<link rel="icon" type="image/png" sizes="16x16" href="/favicon-16x16.png">
<link rel="apple-touch-icon" sizes="180x180" href="/apple-touch-icon.png">
<link rel="manifest" href="/site.webmanifest">
<meta name="theme-color" content="${themeColor}">
`,
  });

  return {
    entries,
    notes: [
      'Drop public/ into your web root.',
      'apple-touch-icon is flattened onto the theme colour — iOS composites alpha onto black otherwise.',
      'The 512 icon is marked maskable, so Android home screens crop it correctly.',
    ],
  };
}

/** Plain responsive exports for a website: 1x/2x/3x plus an OG card. */
export function webImageBundle(source: HTMLCanvasElement, name: string): AssetBundle {
  const id = slug(name);
  const entries: ZipEntry[] = [];

  for (const scale of [1, 2, 3]) {
    const width = Math.round(source.width * (scale / 3));
    const height = Math.round(source.height * (scale / 3));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(width, 1);
    canvas.height = Math.max(height, 1);
    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
    }
    entries.push({ path: `public/${id}${scale > 1 ? `@${scale}x` : ''}.png`, content: canvasToBytes(canvas) });
  }

  // Open Graph cards are a fixed 1200×630 and must be opaque.
  const og = document.createElement('canvas');
  og.width = 1200;
  og.height = 630;
  const ctx = og.getContext('2d');
  if (ctx) {
    ctx.fillStyle = '#09090B';
    ctx.fillRect(0, 0, 1200, 630);
    const scale = Math.min((1200 * 0.6) / source.width, (630 * 0.7) / source.height);
    const w = source.width * scale;
    const h = source.height * scale;
    ctx.drawImage(source, (1200 - w) / 2, (630 - h) / 2, w, h);
  }
  entries.push({ path: `public/${id}-og.png`, content: canvasToBytes(og) });

  return {
    entries,
    notes: [
      `Use <img src="/${id}.png" srcset="/${id}@2x.png 2x, /${id}@3x.png 3x">.`,
      'The OG card is 1200×630 and opaque, which is what link unfurlers expect.',
    ],
  };
}

export function bundleFor(target: AssetTarget, source: HTMLCanvasElement, name: string, options: { background?: string; appName?: string; baselineDp?: number } = {}): AssetBundle {
  switch (target) {
    case 'android-icon':
      return androidIconBundle(source, name, options.background);
    case 'android-drawable':
      return androidDrawableBundle(source, name, options.baselineDp);
    case 'web-favicon':
      return webIconBundle(source, options.appName ?? name, options.background);
    default:
      return webImageBundle(source, name);
  }
}
