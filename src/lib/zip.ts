import { zipSync, strToU8, type Zippable } from 'fflate';

/**
 * Client-side archive builder.
 * Used for .zip, .mcpack and .mcaddon exports — all three are ordinary ZIP
 * containers distinguished only by extension and internal layout.
 */

export interface ZipEntry {
  path: string;
  content: string | Uint8Array;
}

const PRECOMPRESSED = /\.(png|jpe?g|gif|webp|zip|jar|apk|mcpack|mcaddon|ogg|mp[34]|woff2?)$/i;

export function buildZip(entries: ZipEntry[]): Uint8Array {
  const tree: Zippable = {};
  for (const entry of entries) {
    const path = entry.path.replace(/^\/+/, '').replace(/\\/g, '/');
    if (!path) continue;
    const data = typeof entry.content === 'string' ? strToU8(entry.content) : entry.content;
    // Storing already-compressed payloads avoids ~10% size growth and CPU burn.
    tree[path] = PRECOMPRESSED.test(path) ? [data, { level: 0 }] : data;
  }
  return zipSync(tree, { level: 9, mtime: new Date() });
}

export function zipBlob(entries: ZipEntry[], mime = 'application/zip'): Blob {
  const bytes = buildZip(entries);
  return new Blob([bytes as unknown as ArrayBuffer], { type: mime });
}

/**
 * Inside the Android app a WebView cannot download: a tap on a blob: link does nothing. The bytes are posted to the app's own
 * shell instead, which writes the file into Download/Chomugiri and shows a notification. Resolves to where the file went, or null.
 */
export async function saveViaShell(blob: Blob, filename: string): Promise<string | null> {
  const shell = typeof window !== 'undefined' ? (window as unknown as { __chomugiriShell?: { platform?: string } }).__chomugiriShell : undefined;
  if (shell?.platform !== 'android') return null;
  try {
    const res = await fetch(`/api/shell/save?name=${encodeURIComponent(filename)}`, { method: 'POST', headers: { 'Content-Type': blob.type || 'application/octet-stream' }, body: blob });
    if (!res.ok) return null;
    const j = (await res.json()) as { ok?: boolean; where?: string };
    if (j.ok) window.dispatchEvent(new CustomEvent('chomugiri:saved', { detail: { name: filename, where: j.where ?? 'Downloads' } }));
    return j.ok ? (j.where ?? 'Downloads') : null;
  } catch {
    return null;
  }
}

function anchorDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Revoking synchronously cancels the download in Safari.
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/** Saves a file: a browser download, or the app's own save inside the Android app. No-ops during SSR. */
export function downloadBlob(blob: Blob, filename: string): void {
  if (typeof document === 'undefined') return;
  const shell = (window as unknown as { __chomugiriShell?: { platform?: string } }).__chomugiriShell;
  if (shell?.platform === 'android') {
    // An older shell without the save route answers with an error: the link is still tried, so nothing gets worse.
    void saveViaShell(blob, filename).then((where) => { if (!where) anchorDownload(blob, filename); });
    return;
  }
  anchorDownload(blob, filename);
}

export function downloadZip(entries: ZipEntry[], filename: string, mime?: string): void {
  downloadBlob(zipBlob(entries, mime), filename);
}

export function downloadText(content: string, filename: string, mime = 'text/plain;charset=utf-8'): void {
  downloadBlob(new Blob([content], { type: mime }), filename);
}

export function dataUrlToBytes(dataUrl: string): Uint8Array {
  const comma = dataUrl.indexOf(',');
  const meta = dataUrl.slice(0, comma);
  const payload = dataUrl.slice(comma + 1);
  if (!meta.includes('base64')) return strToU8(decodeURIComponent(payload));
  const binary = atob(payload);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}
