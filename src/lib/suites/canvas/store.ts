/**
 * Store screenshots: take a Canvas board screen and frame it as an App Store / Play Store marketing image —
 * a background, a headline, and the screen sitting inside a drawn device bezel, sized to what each store accepts
 * for upload. The composition is itself one self-contained HTML file (same shape as a board screen), so it opens
 * in a browser and can be screenshotted or printed to an image at the store's exact pixel size.
 *
 * This is a framing step, not a capture step: it does not run a simulator or an emulator. The screen's own HTML
 * is the "device content" — usually a Canvas board screen built for 'phone' or 'tablet' — embedded through an
 * iframe and scaled to fit the bezel.
 */
import type { CanvasBoard, CanvasScreen } from './board.ts';
import type { ZipEntry } from '../../zip.ts';

export type StoreTarget = 'iphone' | 'ipad' | 'android';

export interface StoreSpec {
  label: string;
  /** Which board device this target's content comes from. */
  device: 'phone' | 'tablet';
  /** Upload canvas size, portrait pixels. */
  w: number;
  h: number;
  /** Device bezel shape to draw. */
  bezel: 'notch' | 'dynamic-island' | 'tablet' | 'android';
}

/**
 * Upload sizes as each store currently documents them for its largest common device class. A store's exact
 * requirement can move between a developer's checks — reconfirm against the current App Store Connect /
 * Play Console help before a real submission; these are the shapes to design against, not a guarantee.
 */
export const STORE_SPECS: Record<StoreTarget, StoreSpec> = {
  iphone: { label: 'iPhone (App Store)', device: 'phone', w: 1290, h: 2796, bezel: 'dynamic-island' },
  ipad: { label: 'iPad (App Store)', device: 'tablet', w: 2064, h: 2752, bezel: 'tablet' },
  android: { label: 'Android phone (Play Store)', device: 'phone', w: 1080, h: 1920, bezel: 'android' },
};

export interface StoreFrameOptions {
  target: StoreTarget;
  headline: string;
  /** A CSS background value: a solid colour or a gradient. */
  background: string;
  /** Headline and screen text colour. */
  ink: string;
  /** Headline above the device (true) or below it (false). */
  headlineOnTop: boolean;
}

export const STORE_FRAME_DEFAULTS: Omit<StoreFrameOptions, 'headline' | 'target'> = {
  background: 'linear-gradient(160deg, #2b2f3a 0%, #15171c 100%)',
  ink: '#f4f5f7',
  headlineOnTop: true,
};

/** A short headline guessed from the screen's name, for a first draft — the caller should let the user edit it. */
export function defaultHeadline(screen: CanvasScreen): string {
  const words = screen.name.replace(/[-_]+/g, ' ').trim();
  if (!words) return 'Do it from your pocket';
  return words[0]!.toUpperCase() + words.slice(1);
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

/** The bezel's own aspect ratio and corner radius, independent of the store canvas it sits on. */
function bezelGeometry(spec: StoreSpec): { w: number; h: number; radius: number; notch: boolean; island: boolean } {
  if (spec.bezel === 'tablet') return { w: 820, h: 1180, radius: 36, notch: false, island: false };
  if (spec.bezel === 'android') return { w: 390, h: 844, radius: 34, notch: false, island: false };
  return { w: 390, h: 844, radius: 54, notch: spec.bezel === 'notch', island: spec.bezel === 'dynamic-island' };
}

/**
 * Compose one screen into a store-ready marketing image, as HTML sized to the target's exact upload canvas.
 * The screen's own markup is embedded through an iframe (so its fonts, scripts and colours render as designed)
 * and scaled with CSS `transform: scale()` to fill the bezel's content area.
 */
export function composeStoreFrame(screen: CanvasScreen, opts: StoreFrameOptions): string {
  const spec = STORE_SPECS[opts.target];
  const g = bezelGeometry(spec);
  // Room for the headline and breathing space above/below the bezel, at the canvas's own scale.
  const headlineBand = Math.round(spec.h * 0.22);
  const deviceBand = spec.h - headlineBand;
  const scale = Math.min((spec.w * 0.82) / g.w, (deviceBand * 0.86) / g.h);
  const bezelTop = opts.headlineOnTop ? headlineBand + (deviceBand - g.h * scale) / 2 : (deviceBand - g.h * scale) / 2;
  const headlineTop = opts.headlineOnTop ? 0 : deviceBand;
  const cutout = g.island
    ? `<div style="position:absolute;top:18px;left:50%;transform:translateX(-50%);width:${Math.round(g.w * 0.28)}px;height:26px;border-radius:16px;background:#000;z-index:2"></div>`
    : g.notch
      ? `<div style="position:absolute;top:0;left:50%;transform:translateX(-50%);width:${Math.round(g.w * 0.46)}px;height:30px;border-radius:0 0 18px 18px;background:#000;z-index:2"></div>`
      : '';
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${esc(screen.name)} — ${esc(spec.label)}</title>
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>
  html,body{margin:0;padding:0;width:${spec.w}px;height:${spec.h}px;overflow:hidden;background:${opts.background};font:600 ${Math.round(spec.w * 0.072)}px/1.18 -apple-system,BlinkMacSystemFont,'Segoe UI',system-ui,sans-serif;color:${opts.ink}}
  .headline{position:absolute;top:${headlineTop}px;left:0;width:100%;height:${headlineBand}px;display:flex;align-items:center;justify-content:center;text-align:center;padding:0 7%;box-sizing:border-box}
  .bezel{position:absolute;top:${Math.round(bezelTop)}px;left:50%;transform:translateX(-50%);width:${g.w}px;height:${g.h}px;border-radius:${g.radius}px;background:#000;box-shadow:0 ${Math.round(spec.w * 0.02)}px ${Math.round(spec.w * 0.08)}px rgba(0,0,0,.45);padding:12px;box-sizing:border-box;transform-origin:top center;scale:${scale.toFixed(4)}}
  .screen{position:relative;width:100%;height:100%;border-radius:${Math.max(g.radius - 10, 8)}px;overflow:hidden;background:#fff}
  iframe{border:0;width:${g.w - 24}px;height:${g.h - 24}px;display:block}
</style></head>
<body>
  <div class="headline">${esc(opts.headline)}</div>
  <div class="bezel">
    ${cutout}
    <div class="screen"><iframe srcdoc="${esc(screen.html)}" scrolling="no" loading="lazy" title="${esc(screen.name)}"></iframe></div>
  </div>
</body></html>`;
}

export interface StoreFrameRequest {
  target: StoreTarget;
  /** Screen id → headline/background overrides; a screen not listed uses the default headline and the shared background. */
  perScreen?: Record<string, Partial<StoreFrameOptions>>;
  background?: string;
  ink?: string;
}

/** Every screen on the board whose device matches the target, framed and ready to export. */
export function storeFrameEntries(board: CanvasBoard, req: StoreFrameRequest): ZipEntry[] {
  const spec = STORE_SPECS[req.target];
  const taken = new Set<string>();
  const entries: ZipEntry[] = [];
  for (const screen of board.screens) {
    if (screen.device !== spec.device) continue;
    const override = req.perScreen?.[screen.id];
    const opts: StoreFrameOptions = {
      target: req.target,
      headline: override?.headline ?? defaultHeadline(screen),
      background: override?.background ?? req.background ?? STORE_FRAME_DEFAULTS.background,
      ink: override?.ink ?? req.ink ?? STORE_FRAME_DEFAULTS.ink,
      headlineOnTop: override?.headlineOnTop ?? STORE_FRAME_DEFAULTS.headlineOnTop,
    };
    const base = screen.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'screen';
    let path = `store/${req.target}/${base}.html`;
    for (let i = 2; taken.has(path); i++) path = `store/${req.target}/${base}-${i}.html`;
    taken.add(path);
    entries.push({ path, content: composeStoreFrame(screen, opts) });
  }
  return entries;
}

export function storeReadme(target: StoreTarget, count: number): string {
  const spec = STORE_SPECS[target];
  return `# Store screenshots — ${spec.label}

${count} screen${count === 1 ? '' : 's'} framed to ${spec.w}×${spec.h}px, the ${spec.label} upload canvas.

Each file in \`store/${target}/\` is a complete HTML page at that exact pixel size — open it, screenshot or
print it to an image at ${spec.w}×${spec.h}, and upload. Headlines and the background are placeholders:
edit the HTML directly, or go back to the board and re-export with different copy.

Reconfirm the upload size against the current App Store Connect / Play Console help before a real submission —
stores revise these from time to time.
`;
}
