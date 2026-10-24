/**
 * Pictures and files the assistant hands to the user.
 *
 * A reply that wants to give the user a file or a picture (a generated image, a build output, a report, a screenshot the browser took)
 * says so in a block of its own:
 *
 *     ```send
 *     out/logo.png | The new logo
 *     dist/app.apk
 *     https://example.com/photo.jpg | A photo from the page
 *     ```
 *
 * One item per line: a path in the workspace (or on the terminal bridge) or an http(s) link, then optionally `|` and a caption. The
 * runtime finds the file and attaches it to the message; the chat shows pictures inline and everything else as a file to save.
 */

export interface SendItem {
  /** Workspace/bridge path, or an http(s) URL. */
  source: string;
  caption?: string;
  url: boolean;
}

const FENCE = /^[ \t]*(`{3,}|~{3,})[ \t]*([^\n]*)$/;

function isSendInfo(info: string): boolean {
  const first = info.trim().split(/\s+/)[0]?.toLowerCase() ?? '';
  return first === 'send' || /(^|\s)path=@send\b/.test(info);
}

function itemsFrom(body: string, info: string): SendItem[] {
  const out: SendItem[] = [];
  const inline = /(?:path|file)=("[^"]+"|'[^']+'|\S+)/.exec(info);
  const lines = body.split('\n');
  if (inline && inline[1] !== '@send') lines.unshift(inline[1].replace(/^["']|["']$/g, ''));
  for (const raw of lines) {
    const line = raw.trim().replace(/^[-*]\s+/, '');
    if (!line || line.startsWith('#')) continue;
    const bar = line.indexOf('|');
    const source = (bar >= 0 ? line.slice(0, bar) : line).trim().replace(/^[`"']|[`"']$/g, '');
    const caption = bar >= 0 ? line.slice(bar + 1).trim() : undefined;
    if (!source) continue;
    const url = /^https?:\/\//i.test(source);
    if (!url && (source.startsWith('/') || /^[A-Za-z]:/.test(source) || source.split(/[\\/]/).includes('..'))) continue;
    out.push({ source: source.replace(/^\.\//, ''), caption: caption || undefined, url });
    if (out.length >= 12) break;
  }
  return out;
}

/** Every complete send block in a reply. A block still being written is not sent yet. */
export function parseSendBlocks(content: string): SendItem[] {
  const lines = content.split('\n');
  const out: SendItem[] = [];
  let open: { fence: string; info: string; body: string[] } | null = null;
  for (const line of lines) {
    const m = FENCE.exec(line);
    if (open) {
      if (m && m[1][0] === open.fence[0] && m[1].length >= open.fence.length && !m[2].trim()) {
        if (isSendInfo(open.info)) out.push(...itemsFrom(open.body.join('\n'), open.info));
        open = null;
      } else open.body.push(line);
      continue;
    }
    if (m) open = { fence: m[1], info: m[2], body: [] };
  }
  const seen = new Set<string>();
  return out.filter((i) => (seen.has(i.source) ? false : (seen.add(i.source), true))).slice(0, 12);
}

/** The reply as words: send blocks (finished or still streaming) cut out. */
export function stripSendBlocks(content: string): string {
  const lines = content.split('\n');
  const out: string[] = [];
  let open: { fence: string; keep: boolean; held: string[] } | null = null;
  for (const line of lines) {
    const m = FENCE.exec(line);
    if (open) {
      if (m && m[1][0] === open.fence[0] && m[1].length >= open.fence.length && !m[2].trim()) {
        if (open.keep) out.push(...open.held, line);
        open = null;
      } else if (open.keep) open.held.push(line);
      continue;
    }
    if (m) {
      const send = isSendInfo(m[2]);
      open = { fence: m[1], keep: !send, held: [line] };
      continue;
    }
    out.push(line);
  }
  if (open?.keep) out.push(...open.held);
  return out.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

const MIME: Record<string, string> = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml', bmp: 'image/bmp', avif: 'image/avif',
  pdf: 'application/pdf', zip: 'application/zip', apk: 'application/vnd.android.package-archive', aab: 'application/octet-stream',
  json: 'application/json', csv: 'text/csv', txt: 'text/plain', md: 'text/markdown', html: 'text/html', htm: 'text/html', xml: 'application/xml', yaml: 'text/yaml', yml: 'text/yaml',
  js: 'text/javascript', ts: 'text/plain', py: 'text/x-python', gd: 'text/plain', kt: 'text/plain', java: 'text/plain', sh: 'text/x-shellscript',
  mp3: 'audio/mpeg', wav: 'audio/wav', ogg: 'audio/ogg', mp4: 'video/mp4', webm: 'video/webm', glb: 'model/gltf-binary', gltf: 'model/gltf+json',
  mcpack: 'application/zip', mcaddon: 'application/zip', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
};

export function mimeFor(name: string): string {
  const ext = name.split(/[?#]/)[0].split('.').pop()?.toLowerCase() ?? '';
  return MIME[ext] ?? 'application/octet-stream';
}

export function isImageMime(mime: string): boolean {
  return mime.startsWith('image/');
}

export function baseName(source: string): string {
  const clean = source.split(/[?#]/)[0].replace(/\/+$/, '');
  return clean.split('/').pop() || 'file';
}

/** Binary or text bytes as a data URL (base64 of the bytes). */
export function dataUrlOf(mime: string, base64: string): string {
  return `data:${mime};base64,${base64}`;
}

export function textToBase64(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}
