/**
 * Getting a file out of the app and onto the phone.
 *
 * A plain `<a href="data:…" download>` fails on phones for anything past a couple of megabytes (an APK, a zip, a model), and a blob link is
 * silently ignored by some in-app browsers. So a file is saved in two ways, and the user can use whichever works on their phone:
 *   - download: the bytes become a Blob and a real download starts;
 *   - share: the system share sheet opens with the file in it ("Save to Files", Drive, WhatsApp …), which every phone can do.
 * Remote links are fetched into a Blob when the host allows it, and opened in a new tab when it does not.
 */
import { dataUrlToBytes, downloadBlob } from './zip';
import { mimeFor } from './text/send-blocks';

export interface SaveSource {
  name: string;
  kind?: string;
  /** `data:` URL with the bytes, or an http(s) link. */
  dataUrl?: string;
  /** Plain text content, when the file is text. */
  text?: string;
}

/** A Blob copy that never shares memory with a SharedArrayBuffer (Blob will not take one). */
export function blobOf(bytes: Uint8Array | string, mime: string): Blob {
  if (typeof bytes === 'string') return new Blob([bytes], { type: mime });
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);
  return new Blob([buffer], { type: mime });
}

export async function blobFrom(src: SaveSource): Promise<Blob | null> {
  const mime = src.kind && src.kind !== 'file' ? src.kind : mimeFor(src.name);
  if (src.dataUrl?.startsWith('data:')) return blobOf(dataUrlToBytes(src.dataUrl), mime);
  if (src.text != null) return blobOf(src.text, mime);
  if (src.dataUrl && /^https?:/i.test(src.dataUrl)) {
    try {
      const res = await fetch(src.dataUrl);
      if (!res.ok) return null;
      return await res.blob();
    } catch {
      return null; // the host does not allow the app to read it: the caller opens the link instead
    }
  }
  return null;
}

export function canShareFiles(): boolean {
  if (typeof navigator === 'undefined' || typeof navigator.canShare !== 'function' || typeof navigator.share !== 'function') return false;
  try {
    return navigator.canShare({ files: [new File(['x'], 'x.txt', { type: 'text/plain' })] });
  } catch {
    return false;
  }
}

export async function shareBlob(blob: Blob, name: string): Promise<'shared' | 'cancelled' | 'unsupported'> {
  if (!canShareFiles()) return 'unsupported';
  const file = new File([blob], name, { type: blob.type || mimeFor(name) });
  try {
    if (!navigator.canShare({ files: [file] })) return 'unsupported';
    await navigator.share({ files: [file], title: name });
    return 'shared';
  } catch (err) {
    return (err as Error).name === 'AbortError' ? 'cancelled' : 'unsupported';
  }
}

/** Download a file source. Returns false when nothing could be saved (the caller says so). */
export async function downloadSource(src: SaveSource): Promise<boolean> {
  const blob = await blobFrom(src);
  if (blob) {
    downloadBlob(blob, src.name);
    return true;
  }
  if (src.dataUrl && /^https?:/i.test(src.dataUrl)) {
    window.open(src.dataUrl, '_blank', 'noopener,noreferrer');
    return true;
  }
  return false;
}

export async function shareSource(src: SaveSource): Promise<'shared' | 'cancelled' | 'unsupported' | 'missing'> {
  const blob = await blobFrom(src);
  if (!blob) return 'missing';
  return shareBlob(blob, src.name);
}
