/**
 * A generated .glb as a workspace file.
 *
 * Binary artifacts travel as data URLs so they go through the same file map,
 * history and export path as every text file — the zip builder decodes them on
 * the way out. Carrying bytes separately would mean a second storage path and a
 * second way for an artifact to go missing.
 */

import type { FileArtifact } from '@/lib/agent/artifacts';

/** Base64 without blowing the stack on a multi-megabyte model. */
function toBase64(bytes: Uint8Array): string {
  // btoa takes a string, and String.fromCharCode(...bytes) on a large array
  // overflows the argument limit — a model big enough to matter is exactly the
  // one that would crash it.
  const CHUNK = 0x8000;
  let binary = '';
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

export function glbArtifact(path: string, bytes: Uint8Array): FileArtifact {
  return {
    kind: 'file',
    path,
    language: 'glb',
    content: `data:model/gltf-binary;base64,${toBase64(bytes)}`,
    complete: true,
    bytes: bytes.byteLength,
  };
}

/**
 * A generated .wav as a workspace file.
 *
 * Same data-URL carriage as a model, for the same reason: one storage path
 * means one way for an artifact to go missing rather than two.
 */
export function wavArtifact(path: string, bytes: Uint8Array): FileArtifact {
  return {
    kind: 'file',
    path,
    language: 'wav',
    content: `data:audio/wav;base64,${toBase64(bytes)}`,
    complete: true,
    bytes: bytes.byteLength,
  };
}
