import { area, B, err, escapeHtml, list, N, num, S, sel, stats, table, text, tog, txt } from '../helpers.ts';
import type { Out, ToolDef, Values } from '../types.ts';

/** A tiny CSV reader: quotes, escaped quotes, commas and newlines inside quotes. */
export function parseCsv(src: string, sep = ','): string[][] {
  const rows: string[][] = [];
  let row: string[] = [], cell = '', q = false;
  for (let i = 0; i < src.length; i++) {
    const c = src[i]!;
    if (q) { if (c === '"') { if (src[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += c; }
    else if (c === '"') q = true;
    else if (c === sep) { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && src[i + 1] === '\n') i++; row.push(cell); rows.push(row); row = []; cell = ''; }
    else cell += c;
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
  return rows.filter((r) => !(r.length === 1 && r[0] === ''));
}
export const csvCell = (x: unknown, sep = ','): string => { const s = x === null || x === undefined ? '' : typeof x === 'object' ? JSON.stringify(x) : String(x); return new RegExp(`["\\n\\r${sep}]`).test(s) ? `"${s.replace(/"/g, '""')}"` : s; };

function yaml(x: unknown, ind = 0): string {
  const pad = '  '.repeat(ind);
  const scalar = (s: unknown): string => (typeof s === 'string' ? (/^[\w./-]+$/.test(s) && !/^(true|false|null|\d.*)$/i.test(s) ? s : JSON.stringify(s)) : String(s));
  if (Array.isArray(x)) return x.length ? x.map((e) => (e && typeof e === 'object' ? `${pad}-\n${yaml(e, ind + 1)}` : `${pad}- ${scalar(e)}`)).join('\n') : `${pad}[]`;
  if (x && typeof x === 'object') { const e = Object.entries(x as Record<string, unknown>); return e.length ? e.map(([k, val]) => (val && typeof val === 'object' && (Array.isArray(val) ? val.length : Object.keys(val).length) ? `${pad}${k}:\n${yaml(val, ind + 1)}` : `${pad}${k}: ${val && typeof val === 'object' ? (Array.isArray(val) ? '[]' : '{}') : scalar(val)}`)).join('\n') : `${pad}{}`; }
  return pad + scalar(x);
}

const sortKeys = (x: unknown): unknown => (Array.isArray(x) ? x.map(sortKeys) : x && typeof x === 'object' ? Object.fromEntries(Object.entries(x as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : 1)).map(([k, val]) => [k, sortKeys(val)])) : x);

function jsonPath(data: unknown, path: string): unknown {
  const parts = path.replace(/^\$\.?/, '').match(/[^.[\]]+|\[\d+\]/g) ?? [];
  let cur: unknown = data;
  for (const p of parts) {
    const k = p.startsWith('[') ? Number(p.slice(1, -1)) : p;
    if (cur === null || cur === undefined) return undefined;
    cur = (cur as Record<string | number, unknown>)[k as string | number];
  }
  return cur;
}

const STATUS: Array<[number, string, string]> = [[100, 'Continue', 'Keep sending the body.'], [101, 'Switching Protocols', 'Upgrading, e.g. to WebSocket.'], [200, 'OK', 'Success.'], [201, 'Created', 'A new resource was made.'], [202, 'Accepted', 'Queued for later.'], [204, 'No Content', 'Success, nothing to return.'], [206, 'Partial Content', 'A range of the file.'], [301, 'Moved Permanently', 'Use the new URL from now on.'], [302, 'Found', 'Temporary redirect.'], [304, 'Not Modified', 'Use your cached copy.'], [307, 'Temporary Redirect', 'Redirect, keep the method.'], [308, 'Permanent Redirect', 'Redirect forever, keep the method.'], [400, 'Bad Request', 'The request is malformed.'], [401, 'Unauthorized', 'Log in first.'], [403, 'Forbidden', 'You may not do this.'], [404, 'Not Found', 'Nothing at that address.'], [405, 'Method Not Allowed', 'Wrong HTTP method.'], [408, 'Request Timeout', 'The server gave up waiting.'], [409, 'Conflict', 'Clashes with current state.'], [410, 'Gone', 'Removed for good.'], [413, 'Payload Too Large', 'Body too big.'], [415, 'Unsupported Media Type', 'Format not accepted.'], [418, "I'm a teapot", 'A joke status (RFC 2324).'], [422, 'Unprocessable Entity', 'Valid syntax, invalid content.'], [429, 'Too Many Requests', 'Slow down: rate limited.'], [500, 'Internal Server Error', 'The server broke.'], [501, 'Not Implemented', 'Not supported.'], [502, 'Bad Gateway', 'A bad answer from upstream.'], [503, 'Service Unavailable', 'Overloaded or down.'], [504, 'Gateway Timeout', 'Upstream took too long.']];
const MIME: Array<[string, string]> = [['html', 'text/html'], ['css', 'text/css'], ['js', 'text/javascript'], ['json', 'application/json'], ['xml', 'application/xml'], ['txt', 'text/plain'], ['csv', 'text/csv'], ['md', 'text/markdown'], ['png', 'image/png'], ['jpg', 'image/jpeg'], ['jpeg', 'image/jpeg'], ['gif', 'image/gif'], ['webp', 'image/webp'], ['svg', 'image/svg+xml'], ['ico', 'image/x-icon'], ['mp3', 'audio/mpeg'], ['wav', 'audio/wav'], ['mp4', 'video/mp4'], ['webm', 'video/webm'], ['pdf', 'application/pdf'], ['zip', 'application/zip'], ['gz', 'application/gzip'], ['apk', 'application/vnd.android.package-archive'], ['woff2', 'font/woff2'], ['ttf', 'font/ttf'], ['wasm', 'application/wasm'], ['glb', 'model/gltf-binary'], ['docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'], ['xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet']];
const PORTS: Array<[number, string]> = [[20, 'FTP data'], [21, 'FTP'], [22, 'SSH'], [23, 'Telnet'], [25, 'SMTP'], [53, 'DNS'], [67, 'DHCP'], [80, 'HTTP'], [110, 'POP3'], [123, 'NTP'], [143, 'IMAP'], [161, 'SNMP'], [389, 'LDAP'], [443, 'HTTPS'], [465, 'SMTPS'], [587, 'SMTP submission'], [993, 'IMAPS'], [995, 'POP3S'], [1433, 'MS SQL'], [1521, 'Oracle'], [3000, 'Dev servers (Next, Rails)'], [3306, 'MySQL'], [3389, 'RDP'], [5000, 'Flask'], [5173, 'Vite'], [5432, 'PostgreSQL'], [5672, 'RabbitMQ'], [6379, 'Redis'], [8000, 'Django / dev'], [8080, 'HTTP alt'], [8443, 'HTTPS alt'], [9000, 'PHP-FPM / dev'], [9200, 'Elasticsearch'], [27017, 'MongoDB']];
const GIT: Array<[string, string]> = [['git init', 'Start a repository'], ['git clone <url>', 'Copy a repository'], ['git status', 'What changed'], ['git add -A', 'Stage everything'], ['git commit -m "msg"', 'Save the staged changes'], ['git push -u origin <branch>', 'Upload a branch'], ['git pull', 'Fetch and merge'], ['git fetch', 'Download without merging'], ['git branch <name>', 'New branch'], ['git switch <name>', 'Change branch'], ['git switch -c <name>', 'New branch and switch'], ['git merge <name>', 'Merge a branch in'], ['git rebase <base>', 'Replay commits on a base'], ['git log --oneline --graph', 'Compact history'], ['git diff', 'Unstaged changes'], ['git diff --staged', 'Staged changes'], ['git stash', 'Shelve changes'], ['git stash pop', 'Bring them back'], ['git restore <file>', 'Discard changes in a file'], ['git reset --soft HEAD~1', 'Undo the last commit, keep changes'], ['git revert <sha>', 'Undo a commit with a new commit'], ['git tag v1.0', 'Mark a release'], ['git remote -v', 'List remotes'], ['git cherry-pick <sha>', 'Copy one commit here'], ['git blame <file>', 'Who changed each line']];

export const devTools: ToolDef[] = [
  {
    id: 'json-formatter', name: 'JSON formatter', cat: 'dev', glyph: '{ }', blurb: 'Format, minify, validate and sort JSON.',
    fields: [area('t', 'JSON', { rows: 8, mono: true }), sel('mode', 'Do', [{ value: 'pretty', label: 'Pretty print' }, { value: 'min', label: 'Minify' }, { value: 'sort', label: 'Sort keys' }], 'pretty'), sel('ind', 'Indent', ['2', '4', 'tab'], '2')], example: { t: '{"b":1,"a":[1,2,{"x":null}]}', mode: 'pretty', ind: '2' },
    run: (v) => {
      try {
        let x: unknown = JSON.parse(S(v, 't'));
        if (S(v, 'mode') === 'sort') x = sortKeys(x);
        return text(S(v, 'mode') === 'min' ? JSON.stringify(x) : JSON.stringify(x, null, S(v, 'ind') === 'tab' ? '\t' : Number(S(v, 'ind')) || 2), 'json');
      } catch (e) { return err(`Invalid JSON: ${(e as Error).message}`); }
    },
  },
  {
    id: 'json-to-csv', name: 'JSON → CSV', cat: 'dev', glyph: 'J>C', blurb: 'An array of objects to CSV.',
    fields: [area('t', 'JSON array', { rows: 7, mono: true }), sel('sep', 'Separator', [{ value: ',', label: 'Comma' }, { value: ';', label: 'Semicolon' }, { value: '\t', label: 'Tab' }], ',')], example: { t: '[{"name":"Asha","age":24},{"name":"Ravi, K","age":31,"city":"Pune"}]', sep: ',' },
    run: (v) => {
      try {
        const a = JSON.parse(S(v, 't')); const rows = Array.isArray(a) ? a : [a]; const sep = S(v, 'sep') || ',';
        const keys = [...new Set(rows.flatMap((r) => (r && typeof r === 'object' ? Object.keys(r) : [])))];
        return text([keys.map((k) => csvCell(k, sep)).join(sep), ...rows.map((r) => keys.map((k) => csvCell((r as Record<string, unknown>)[k], sep)).join(sep))].join('\n'), 'csv');
      } catch (e) { return err(`Invalid JSON: ${(e as Error).message}`); }
    },
  },
  {
    id: 'csv-to-json', name: 'CSV → JSON', cat: 'dev', glyph: 'C>J', blurb: 'CSV with a header row to a JSON array.',
    fields: [area('t', 'CSV', { rows: 7, mono: true }), sel('sep', 'Separator', [{ value: ',', label: 'Comma' }, { value: ';', label: 'Semicolon' }, { value: '\t', label: 'Tab' }], ','), tog('num', 'Turn numbers into numbers', true)], example: { t: 'name,age\nAsha,24\n"Ravi, K",31', sep: ',', num: true },
    run: (v) => {
      const rows = parseCsv(S(v, 't'), S(v, 'sep') || ',');
      if (rows.length < 1) return err('Add a header row and some data.');
      const [head, ...body] = rows;
      return text(JSON.stringify(body.map((r) => Object.fromEntries(head!.map((h, i) => [h, B(v, 'num') && r[i] !== undefined && r[i] !== '' && !isNaN(Number(r[i])) ? Number(r[i]) : r[i] ?? '']))), null, 2), 'json');
    },
  },
  {
    id: 'json-to-yaml', name: 'JSON → YAML', cat: 'dev', glyph: 'J>Y', blurb: 'Convert JSON to YAML.',
    fields: [area('t', 'JSON', { rows: 7, mono: true })], example: { t: '{"name":"app","ports":[80,443],"db":{"host":"localhost","debug":true}}' },
    run: (v) => { try { return text(yaml(JSON.parse(S(v, 't'))), 'yaml'); } catch (e) { return err(`Invalid JSON: ${(e as Error).message}`); } },
  },
  {
    id: 'json-path', name: 'JSON path finder', cat: 'dev', glyph: '$.', blurb: 'Read a value from JSON with a path like $.users[0].name.',
    fields: [area('t', 'JSON', { rows: 7, mono: true }), txt('p', 'Path', { placeholder: '$.users[0].name', mono: true })], example: { t: '{"users":[{"name":"Asha"},{"name":"Ravi"}]}', p: '$.users[1].name' },
    run: (v) => { try { const r = jsonPath(JSON.parse(S(v, 't')), S(v, 'p')); return r === undefined ? err('Nothing at that path.') : text(typeof r === 'string' ? r : JSON.stringify(r, null, 2)); } catch (e) { return err(`Invalid JSON: ${(e as Error).message}`); } },
  },
  {
    id: 'base64', name: 'Base64', cat: 'dev', glyph: 'b64', blurb: 'Encode and decode Base64 (text, UTF-8, URL-safe).',
    fields: [area('t', 'Input', { rows: 5, mono: true }), sel('mode', 'Mode', [{ value: 'enc', label: 'Encode' }, { value: 'dec', label: 'Decode' }], 'enc'), tog('url', 'URL-safe')], example: { t: 'Hello, Chomugiri! नमस्ते', mode: 'enc', url: false },
    run: (v) => {
      const t = S(v, 't');
      if (S(v, 'mode') === 'enc') { const b = btoa(String.fromCharCode(...new TextEncoder().encode(t))); return text(B(v, 'url') ? b.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '') : b); }
      try { const s = atob(t.replace(/-/g, '+').replace(/_/g, '/').replace(/\s/g, '')); return text(new TextDecoder().decode(Uint8Array.from(s, (c) => c.charCodeAt(0)))); } catch { return err('That is not valid Base64.'); }
    },
  },
  {
    id: 'url-encode', name: 'URL encode / decode', cat: 'dev', glyph: '%20', blurb: 'Percent-encode or decode text for URLs.',
    fields: [area('t', 'Input', { rows: 4, mono: true }), sel('mode', 'Mode', [{ value: 'enc', label: 'Encode component' }, { value: 'encfull', label: 'Encode whole URL' }, { value: 'dec', label: 'Decode' }], 'enc')], example: { t: 'q=chai & biscuit/ए', mode: 'enc' },
    run: (v) => { try { const m = S(v, 'mode'); return text(m === 'dec' ? decodeURIComponent(S(v, 't').replace(/\+/g, ' ')) : m === 'encfull' ? encodeURI(S(v, 't')) : encodeURIComponent(S(v, 't'))); } catch { return err('That is not valid percent-encoding.'); } },
  },
  {
    id: 'html-entities', name: 'HTML entities', cat: 'dev', glyph: '&;', blurb: 'Escape or unescape HTML special characters.',
    fields: [area('t', 'Input', { rows: 4, mono: true }), sel('mode', 'Mode', [{ value: 'enc', label: 'Escape' }, { value: 'dec', label: 'Unescape' }], 'enc')], example: { t: '<a href="x">Tom & "Jerry"</a>', mode: 'enc' },
    run: (v) => text(S(v, 'mode') === 'enc' ? escapeHtml(S(v, 't')) : S(v, 't').replace(/&(#x?[0-9a-f]+|amp|lt|gt|quot|apos|nbsp);/gi, (_m, e: string) => { const l = e.toLowerCase(); if (l[0] === '#') return String.fromCodePoint(l[1] === 'x' ? parseInt(l.slice(2), 16) : parseInt(l.slice(1), 10)); return ({ amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' })[l] ?? _m; })),
  },
  {
    id: 'jwt-decoder', name: 'JWT decoder', cat: 'dev', glyph: 'icon:key', blurb: 'Read the header and payload of a JSON Web Token (does not verify it).',
    fields: [area('t', 'Token', { rows: 4, mono: true })], example: { t: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTYiLCJuYW1lIjoiQXNoYSIsImV4cCI6MTk5OTk5OTk5OX0.c2lnbg' },
    run: (v) => {
      try {
        const p = S(v, 't').trim().split('.'); if (p.length < 2) return err('A JWT has three parts separated by dots.');
        const dec = (s: string) => JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0))));
        const head = dec(p[0]!), pay = dec(p[1]!);
        const parts: Array<{ title: string; out: Out }> = [{ title: 'Header', out: text(JSON.stringify(head, null, 2), 'json') }, { title: 'Payload', out: text(JSON.stringify(pay, null, 2), 'json') }];
        if (typeof pay.exp === 'number') parts.push({ title: 'Expiry', out: stats([['Expires', new Date(pay.exp * 1000).toISOString()], ['Status', pay.exp * 1000 < Date.now() ? 'Expired' : 'Still valid']]) });
        return { kind: 'multi', parts };
      } catch { return err('That does not look like a JWT.'); }
    },
  },
  {
    id: 'regex-tester', name: 'Regex tester', cat: 'dev', glyph: '.*', blurb: 'Try a regular expression and see every match and group.',
    fields: [txt('re', 'Pattern', { placeholder: '(\\w+)@(\\w+)\\.com', mono: true }), txt('flags', 'Flags', { default: 'g', mono: true }), area('t', 'Test text', { rows: 5 })], example: { re: '(\\w+)@(\\w+)\\.com', flags: 'g', t: 'asha@chomu.com, ravi@mail.com' },
    run: (v) => {
      try {
        const flags = S(v, 'flags').includes('g') ? S(v, 'flags') : S(v, 'flags') + 'g';
        const re = new RegExp(S(v, 're'), flags), rows: Array<Array<string | number>> = [];
        for (const m of S(v, 't').matchAll(re)) { rows.push([rows.length + 1, m.index ?? 0, m[0], m.slice(1).map((g) => g ?? '∅').join(' | ')]); if (rows.length > 200) break; }
        return rows.length ? table(['#', 'At', 'Match', 'Groups'], rows) : text('No matches.');
      } catch (e) { return err((e as Error).message); }
    },
  },
  {
    id: 'cron-explainer', name: 'Cron explainer', cat: 'dev', glyph: 'icon:timer', blurb: 'Explain a 5-field cron expression and list its next runs.',
    fields: [txt('c', 'Cron', { default: '*/15 9-17 * * 1-5', mono: true })], example: { c: '*/15 9-17 * * 1-5' },
    run: (v) => {
      const p = S(v, 'c').trim().split(/\s+/); if (p.length !== 5) return err('Use 5 fields: minute hour day month weekday.');
      const rng: Array<[number, number]> = [[0, 59], [0, 23], [1, 31], [1, 12], [0, 6]], names = ['minute', 'hour', 'day of month', 'month', 'weekday'];
      const expand = (f: string, [lo, hi]: [number, number]): number[] | null => {
        const out = new Set<number>();
        for (const part of f.split(',')) {
          const m = /^(\*|\d+(?:-\d+)?)(?:\/(\d+))?$/.exec(part); if (!m) return null;
          const step = m[2] ? Number(m[2]) : 1; let a = lo, b = hi;
          if (m[1] !== '*') { const [x, y] = m[1]!.split('-').map(Number); a = x!; b = y ?? (m[2] ? hi : x!); }
          if (a < lo || b > hi || step < 1) return null;
          for (let i = a; i <= b; i += step) out.add(i);
        }
        return [...out].sort((x, y) => x - y);
      };
      const sets = p.map((f, i) => expand(f, rng[i]!)); const bad = sets.findIndex((s) => !s); if (bad >= 0) return err(`The ${names[bad]} field is not valid.`);
      const [mi, ho, dm, mo, wd] = sets as number[][];
      const runs: string[] = []; const d = new Date(); d.setSeconds(0, 0); d.setMinutes(d.getMinutes() + 1);
      for (let k = 0; k < 600000 && runs.length < 5; k++, d.setMinutes(d.getMinutes() + 1)) {
        const dayOk = p[2] === '*' && p[4] !== '*' ? wd!.includes(d.getDay()) : p[4] === '*' && p[2] !== '*' ? dm!.includes(d.getDate()) : dm!.includes(d.getDate()) && wd!.includes(d.getDay());
        if (mi!.includes(d.getMinutes()) && ho!.includes(d.getHours()) && mo!.includes(d.getMonth() + 1) && dayOk) runs.push(d.toString().slice(0, 21));
      }
      return { kind: 'multi', parts: [{ title: 'Meaning', out: table(['Field', 'Values'], p.map((f, i) => [names[i]!, f === '*' ? 'every' : (sets[i] as number[]).join(', ')])) }, { title: 'Next runs', out: list(runs.length ? runs : ['None in the next ~1000 days']) }] };
    },
  },
  {
    id: 'query-string', name: 'Query string parser', cat: 'dev', glyph: '?=', blurb: 'Split a query string into keys and values, or build one.',
    fields: [txt('q', 'Query or URL', { default: '?q=chai&page=2&tag=a&tag=b', mono: true })], example: { q: 'https://x.com/s?q=chai%20tea&page=2&tag=a&tag=b' },
    run: (v) => { const q = S(v, 'q'); const sp = new URLSearchParams(q.includes('?') ? q.slice(q.indexOf('?') + 1).split('#')[0] : q); const rows = [...sp.entries()].map(([k, x]) => [k, x]); return rows.length ? table(['Key', 'Value'], rows) : text('No parameters.'); },
  },
  {
    id: 'url-parser', name: 'URL parser', cat: 'dev', glyph: 'icon:link', blurb: 'Break a URL into protocol, host, path, query and hash.',
    fields: [txt('u', 'URL', { default: 'https://user@example.com:8080/a/b?x=1#top', mono: true })], example: { u: 'https://user@example.com:8080/a/b?x=1#top' },
    run: (v) => { try { const u = new URL(S(v, 'u')); return table(['Part', 'Value'], [['Protocol', u.protocol], ['Username', u.username || '—'], ['Host', u.hostname], ['Port', u.port || '(default)'], ['Path', u.pathname], ['Query', u.search || '—'], ['Hash', u.hash || '—'], ['Origin', u.origin]]); } catch { return err('That is not a full URL (include https://).'); } },
  },
  {
    id: 'http-status', name: 'HTTP status codes', cat: 'dev', glyph: '404', blurb: 'Look up what an HTTP status code means.',
    fields: [txt('q', 'Code or word', { placeholder: '404 or redirect' })], example: { q: '40' },
    run: (v) => { const q = S(v, 'q').toLowerCase().trim(); const r = STATUS.filter(([c, n, d]) => !q || String(c).startsWith(q) || n.toLowerCase().includes(q) || d.toLowerCase().includes(q)); return r.length ? table(['Code', 'Name', 'Meaning'], r) : text('No match.'); },
  },
  {
    id: 'mime-types', name: 'MIME types', cat: 'dev', glyph: 'mime', blurb: 'File extension to MIME type.',
    fields: [txt('q', 'Extension', { placeholder: 'png' })], example: { q: 'p' },
    run: (v) => { const q = S(v, 'q').toLowerCase().replace(/^\./, ''); const r = MIME.filter(([e, m]) => !q || e.startsWith(q) || m.includes(q)); return r.length ? table(['Extension', 'Type'], r) : text('Unknown.'); },
  },
  {
    id: 'chmod-calculator', name: 'chmod calculator', cat: 'dev', glyph: 'rwx', blurb: 'Unix permissions: tick boxes or type 755.',
    fields: [txt('n', 'Octal', { default: '755', mono: true })], example: { n: '754' },
    run: (v) => {
      const o = S(v, 'n').trim(); if (!/^[0-7]{3,4}$/.test(o)) return err('Use 3 or 4 octal digits, like 755.');
      const d = o.slice(-3).split('').map(Number); const sym = d.map((x) => `${x & 4 ? 'r' : '-'}${x & 2 ? 'w' : '-'}${x & 1 ? 'x' : '-'}`).join('');
      return { kind: 'multi', parts: [{ out: stats([['Symbolic', sym], ['Command', `chmod ${o} file`]]) }, { out: table(['Who', 'Read', 'Write', 'Execute'], ['Owner', 'Group', 'Others'].map((w, i) => [w, d[i]! & 4 ? '✓' : '—', d[i]! & 2 ? '✓' : '—', d[i]! & 1 ? '✓' : '—'])) }] };
    },
  },
  {
    id: 'semver-compare', name: 'Semver compare', cat: 'dev', glyph: '1.2.3', blurb: 'Which version is newer?',
    fields: [txt('a', 'Version A', { default: '1.4.2', mono: true }), txt('b', 'Version B', { default: '1.10.0', mono: true })], example: { a: '1.4.2', b: '1.10.0' },
    run: (v) => {
      const p = (s: string) => /^v?(\d+)\.(\d+)\.(\d+)(?:-([\w.]+))?/.exec(s.trim());
      const a = p(S(v, 'a')), b = p(S(v, 'b')); if (!a || !b) return err('Use MAJOR.MINOR.PATCH, like 1.2.3.');
      for (let i = 1; i <= 3; i++) { const d = Number(a[i]) - Number(b[i]); if (d) return stats([['Result', d > 0 ? `${S(v, 'a')} is newer` : `${S(v, 'b')} is newer`], ['Bump', ['major', 'minor', 'patch'][i - 1]!]]); }
      return stats([['Result', a[4] === b[4] ? 'Equal' : a[4] ? `${S(v, 'b')} is newer (pre-release)` : `${S(v, 'a')} is newer`]]);
    },
  },
  {
    id: 'css-minify', name: 'CSS minifier', cat: 'dev', glyph: '{;}', blurb: 'Shrink CSS: strip comments and whitespace.',
    fields: [area('t', 'CSS', { rows: 7, mono: true })], example: { t: '/* box */\n.a {\n  color : red;\n  margin: 0 auto ;\n}\n' },
    run: (v) => { const t = S(v, 't'); const m = t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\s+/g, ' ').replace(/\s*([{}:;,>])\s*/g, '$1').replace(/;}/g, '}').trim(); return { kind: 'multi', parts: [{ out: text(m, 'css') }, { out: stats([['Before', `${t.length} B`], ['After', `${m.length} B`], ['Saved', `${t.length ? Math.round((1 - m.length / t.length) * 100) : 0}%`]]) }] }; },
  },
  {
    id: 'html-minify', name: 'HTML minifier', cat: 'dev', glyph: '</>', blurb: 'Remove comments and extra whitespace from HTML.',
    fields: [area('t', 'HTML', { rows: 7, mono: true })], example: { t: '<div>\n  <!-- hi -->\n  <p>  Hello   world </p>\n</div>' },
    run: (v) => { const t = S(v, 't'); const m = t.replace(/<!--[\s\S]*?-->/g, '').replace(/>\s+</g, '><').replace(/\s{2,}/g, ' ').trim(); return { kind: 'multi', parts: [{ out: text(m, 'html') }, { out: stats([['Before', `${t.length} B`], ['After', `${m.length} B`]]) }] }; },
  },
  {
    id: 'sql-formatter', name: 'SQL formatter', cat: 'dev', glyph: 'SQL', blurb: 'Put each clause of a query on its own line.',
    fields: [area('t', 'SQL', { rows: 6, mono: true }), tog('up', 'Uppercase keywords', true)], example: { t: 'select id, name from users where age > 18 and city = "Pune" order by name limit 10', up: true },
    run: (v) => {
      const kw = ['select', 'from', 'where', 'group by', 'order by', 'having', 'limit', 'left join', 'right join', 'inner join', 'join', 'on', 'union', 'insert into', 'values', 'update', 'set', 'delete from', 'and', 'or'];
      let t = S(v, 't').replace(/\s+/g, ' ').trim();
      for (const k of kw) t = t.replace(new RegExp(`\\b${k}\\b`, 'gi'), (m) => (B(v, 'up') ? m.toUpperCase() : m));
      t = t.replace(/\b(SELECT|FROM|WHERE|GROUP BY|ORDER BY|HAVING|LIMIT|LEFT JOIN|RIGHT JOIN|INNER JOIN|JOIN|UNION|INSERT INTO|VALUES|UPDATE|SET|DELETE FROM)\b/gi, '\n$1').replace(/\b(AND|OR)\b/gi, '\n  $1');
      return text(t.trim(), 'sql');
    },
  },
  {
    id: 'markdown-to-html', name: 'Markdown → HTML', cat: 'dev', glyph: 'M>H', blurb: 'Headings, bold, italic, links, code, lists and quotes to HTML.',
    fields: [area('t', 'Markdown', { rows: 8, mono: true })], example: { t: '# Title\n\nSome **bold** and *italic* with `code` and a [link](https://x.com).\n\n- one\n- two\n\n> quote' },
    run: (v) => {
      const out: string[] = []; let inList = false, inCode = false;
      const inline = (s: string) => escapeHtml(s).replace(/`([^`]+)`/g, '<code>$1</code>').replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>').replace(/\*([^*]+)\*/g, '<em>$1</em>').replace(/\[([^\]]+)\]\((https?:[^)\s]+)\)/g, '<a href="$2">$1</a>');
      for (const l of S(v, 't').split('\n')) {
        if (l.startsWith('```')) { out.push(inCode ? '</code></pre>' : '<pre><code>'); inCode = !inCode; continue; }
        if (inCode) { out.push(escapeHtml(l)); continue; }
        const h = /^(#{1,6})\s+(.*)$/.exec(l), li = /^[-*]\s+(.*)$/.exec(l), q = /^>\s?(.*)$/.exec(l);
        if (li) { if (!inList) { out.push('<ul>'); inList = true; } out.push(`<li>${inline(li[1]!)}</li>`); continue; }
        if (inList) { out.push('</ul>'); inList = false; }
        if (h) out.push(`<h${h[1]!.length}>${inline(h[2]!)}</h${h[1]!.length}>`);
        else if (q) out.push(`<blockquote>${inline(q[1]!)}</blockquote>`);
        else if (l.trim()) out.push(`<p>${inline(l)}</p>`);
      }
      if (inList) out.push('</ul>');
      if (inCode) out.push('</code></pre>');
      return text(out.join('\n'), 'html');
    },
  },
  {
    id: 'ascii-table', name: 'ASCII table', cat: 'dev', glyph: '65', blurb: 'Codes for the printable ASCII characters.',
    fields: [txt('q', 'Filter', { placeholder: 'A or 65 or 0x41' })], example: { q: 'A' },
    run: (v) => { const q = S(v, 'q').trim().toLowerCase(); const rows: Array<Array<string | number>> = []; for (let i = 32; i < 127; i++) { const c = String.fromCharCode(i); if (!q || c.toLowerCase() === q || String(i) === q || `0x${i.toString(16)}` === q) rows.push([c === ' ' ? '(space)' : c, i, '0x' + i.toString(16).toUpperCase(), '0b' + i.toString(2).padStart(8, '0')]); } return table(['Char', 'Dec', 'Hex', 'Binary'], rows); },
  },
  {
    id: 'unicode-lookup', name: 'Unicode lookup', cat: 'dev', glyph: 'U+', blurb: 'Code points and UTF-8 bytes of any character.',
    fields: [txt('t', 'Characters', { default: 'é😀₹' })], example: { t: 'é😀₹' },
    run: (v) => table(['Char', 'Code point', 'UTF-8 bytes', 'UTF-16 units'], [...S(v, 't')].map((c) => { const cp = c.codePointAt(0)!; return [c, 'U+' + cp.toString(16).toUpperCase().padStart(4, '0'), [...new TextEncoder().encode(c)].map((b) => b.toString(16).padStart(2, '0')).join(' '), c.length]; })),
  },
  {
    id: 'env-parser', name: '.env → JSON', cat: 'dev', glyph: '.env', blurb: 'Turn KEY=value lines into JSON (comments and quotes handled).',
    fields: [area('t', '.env', { rows: 6, mono: true })], example: { t: '# db\nHOST=localhost\nPORT=5432\nNAME="my app"' },
    run: (v) => { const o: Record<string, string> = {}; for (const l of S(v, 't').split('\n')) { const m = /^\s*(?:export\s+)?([A-Za-z_][\w.]*)\s*=\s*(.*?)\s*$/.exec(l); if (m && !l.trim().startsWith('#')) o[m[1]!] = m[2]!.replace(/^(["'])(.*)\1$/, '$2'); } return text(JSON.stringify(o, null, 2), 'json'); },
  },
  {
    id: 'curl-to-fetch', name: 'cURL → fetch', cat: 'dev', glyph: 'curl', blurb: 'Convert a simple curl command to JavaScript fetch.',
    fields: [area('t', 'curl command', { rows: 4, mono: true })], example: { t: `curl -X POST https://api.x.com/v1/items -H "Content-Type: application/json" -H "Authorization: Bearer TOKEN" -d '{"a":1}'` },
    run: (v) => {
      const t = S(v, 't').replace(/\\\n/g, ' '); const url = /(https?:\/\/[^\s"']+)/.exec(t)?.[1]; if (!url) return err('No URL found.');
      const headers: Record<string, string> = {}; for (const m of t.matchAll(/(?:-H|--header)\s+(['"])(.*?)\1/g)) { const i = m[2]!.indexOf(':'); if (i > 0) headers[m[2]!.slice(0, i).trim()] = m[2]!.slice(i + 1).trim(); }
      const data = /(?:-d|--data(?:-raw)?)\s+(['"])([\s\S]*?)\1/.exec(t)?.[2]; const method = /(?:-X|--request)\s+(\w+)/.exec(t)?.[1] ?? (data ? 'POST' : 'GET');
      const opts: string[] = [`  method: '${method.toUpperCase()}'`]; if (Object.keys(headers).length) opts.push(`  headers: ${JSON.stringify(headers, null, 2).replace(/\n/g, '\n  ')}`); if (data) opts.push(`  body: ${JSON.stringify(data)}`);
      return text(`const res = await fetch('${url}', {\n${opts.join(',\n')}\n});\nconst data = await res.json();`, 'js');
    },
  },
  {
    id: 'cidr-calculator', name: 'CIDR / subnet', cat: 'dev', glyph: '/24', blurb: 'Network, broadcast and host range of an IPv4 block.',
    fields: [txt('c', 'CIDR', { default: '192.168.1.37/24', mono: true })], example: { c: '192.168.1.37/24' },
    run: (v) => {
      const m = /^(\d+)\.(\d+)\.(\d+)\.(\d+)\/(\d+)$/.exec(S(v, 'c').trim()); if (!m) return err('Use a.b.c.d/nn, like 10.0.0.0/8.');
      const o = m.slice(1, 5).map(Number), p = Number(m[5]); if (o.some((x) => x > 255) || p > 32) return err('Out of range.');
      const ip = ((o[0]! << 24) | (o[1]! << 16) | (o[2]! << 8) | o[3]!) >>> 0, mask = p === 0 ? 0 : (0xffffffff << (32 - p)) >>> 0, net = (ip & mask) >>> 0, bc = (net | ~mask) >>> 0;
      const s = (x: number) => [x >>> 24, (x >>> 16) & 255, (x >>> 8) & 255, x & 255].join('.');
      return stats([['Network', s(net)], ['Mask', s(mask)], ['Broadcast', s(bc)], ['First host', s(p >= 31 ? net : net + 1)], ['Last host', s(p >= 31 ? bc : bc - 1)], ['Usable hosts', p >= 31 ? 2 ** (32 - p) : Math.max(0, 2 ** (32 - p) - 2)]]);
    },
  },
  {
    id: 'port-lookup', name: 'Common ports', cat: 'dev', glyph: ':80', blurb: 'What runs on a port.',
    fields: [txt('q', 'Port or name', { placeholder: '5432 or redis' })], example: { q: 'sql' },
    run: (v) => { const q = S(v, 'q').toLowerCase().trim(); const r = PORTS.filter(([p, n]) => !q || String(p) === q || n.toLowerCase().includes(q)); return r.length ? table(['Port', 'Service'], r) : text('Unknown port.'); },
  },
  {
    id: 'user-agent', name: 'User-agent reader', cat: 'dev', glyph: 'UA', blurb: 'Browser, system and device from a user-agent string.',
    fields: [area('t', 'User-agent', { rows: 3, mono: true })], example: { t: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36' },
    run: (v) => {
      const t = S(v, 't'); const pick = (a: Array<[RegExp, string]>) => { for (const [re, n] of a) { const m = re.exec(t); if (m) return `${n}${m[1] ? ' ' + m[1] : ''}`; } return 'Unknown'; };
      return stats([['Browser', pick([[/Edg\/([\d.]+)/, 'Edge'], [/OPR\/([\d.]+)/, 'Opera'], [/Firefox\/([\d.]+)/, 'Firefox'], [/Chrome\/([\d.]+)/, 'Chrome'], [/Version\/([\d.]+).*Safari/, 'Safari']])], ['System', pick([[/Android ([\d.]+)/, 'Android'], [/iPhone OS ([\d_]+)/, 'iOS'], [/Windows NT ([\d.]+)/, 'Windows'], [/Mac OS X ([\d_.]+)/, 'macOS'], [/Linux/, 'Linux']])], ['Device', /Mobile|Android|iPhone/.test(t) ? 'Phone / mobile' : /iPad|Tablet/.test(t) ? 'Tablet' : 'Desktop']]);
    },
  },
  {
    id: 'html-to-text', name: 'HTML → plain text', cat: 'dev', glyph: 'H>T', blurb: 'Strip tags and decode entities.',
    fields: [area('t', 'HTML', { rows: 6, mono: true })], example: { t: '<h1>Hi</h1><p>Tom &amp; <b>Jerry</b></p><script>x()</script>' },
    run: (v) => text(S(v, 't').replace(/<(script|style)[\s\S]*?<\/\1>/gi, '').replace(/<br\s*\/?>|<\/(p|div|h\d|li|tr)>/gi, '\n').replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&nbsp;/g, ' ').replace(/\n{3,}/g, '\n\n').trim()),
  },
  {
    id: 'git-cheatsheet', name: 'Git cheat sheet', cat: 'dev', glyph: 'git', blurb: 'Search the commands you always forget.',
    fields: [txt('q', 'Search', { placeholder: 'undo, branch, stash…' })], example: { q: 'undo' },
    run: (v) => { const q = S(v, 'q').toLowerCase().trim(); const r = GIT.filter(([c, d]) => !q || c.toLowerCase().includes(q) || d.toLowerCase().includes(q)); return r.length ? table(['Command', 'What it does'], r) : text('Nothing matches.'); },
  },
  {
    id: 'line-endings', name: 'Line endings', cat: 'dev', glyph: 'LF', blurb: 'Count and convert CRLF, LF and CR.',
    fields: [area('t', 'Text', { rows: 5, mono: true }), sel('to', 'Convert to', [{ value: 'lf', label: 'LF (Unix)' }, { value: 'crlf', label: 'CRLF (Windows)' }, { value: 'cr', label: 'CR (old Mac)' }], 'lf')], example: { t: 'a\r\nb\nc\rd', to: 'lf' },
    run: (v) => { const t = S(v, 't'); const crlf = (t.match(/\r\n/g) ?? []).length, lf = (t.match(/(?<!\r)\n/g) ?? []).length, cr = (t.match(/\r(?!\n)/g) ?? []).length; const nl = S(v, 'to') === 'crlf' ? '\r\n' : S(v, 'to') === 'cr' ? '\r' : '\n'; return { kind: 'multi', parts: [{ out: stats([['CRLF', crlf], ['LF', lf], ['CR', cr]]) }, { out: text(t.replace(/\r\n|\r|\n/g, nl).replace(/\r/g, '␍').replace(/\n/g, '␊\n')) }] }; },
  },
  {
    id: 'json-diff-keys', name: 'JSON key compare', cat: 'dev', glyph: '{±}', blurb: 'Which keys were added, removed or changed between two JSON objects.',
    fields: [area('a', 'Old JSON', { rows: 5, mono: true }), area('b', 'New JSON', { rows: 5, mono: true })], example: { a: '{"a":1,"b":2,"c":{"d":1}}', b: '{"a":1,"b":3,"c":{"d":1,"e":2},"f":true}' },
    run: (v: Values) => {
      try {
        const flat = (x: unknown, p = '', o: Record<string, unknown> = {}): Record<string, unknown> => { if (x && typeof x === 'object') for (const [k, y] of Object.entries(x as Record<string, unknown>)) flat(y, p ? `${p}.${k}` : k, o); else o[p] = x; return o; };
        const a = flat(JSON.parse(S(v, 'a'))), b = flat(JSON.parse(S(v, 'b'))); const rows: Array<Array<string | number>> = [];
        for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) { if (!(k in a)) rows.push(['+ added', k, '', JSON.stringify(b[k])]); else if (!(k in b)) rows.push(['− removed', k, JSON.stringify(a[k]), '']); else if (JSON.stringify(a[k]) !== JSON.stringify(b[k])) rows.push(['~ changed', k, JSON.stringify(a[k]), JSON.stringify(b[k])]); }
        return rows.length ? table(['Change', 'Key', 'Old', 'New'], rows) : text('Identical.');
      } catch (e) { return err(`Invalid JSON: ${(e as Error).message}`); }
    },
  },
  {
    id: 'uuid-generator', name: 'UUID generator', cat: 'dev', glyph: 'ID', blurb: 'Random version-4 UUIDs, one or many.',
    fields: [num('n', 'How many', { default: 5, min: 1, max: 100 }), tog('upper', 'Uppercase'), tog('nodash', 'No dashes')], example: { n: 3, upper: false, nodash: false }, manual: true,
    run: (v) => {
      const out: string[] = [];
      for (let i = 0; i < Math.max(1, Math.min(100, N(v, 'n', 5))); i++) {
        const b = new Uint8Array(16); (globalThis.crypto ?? { getRandomValues: (a: Uint8Array) => a.map(() => Math.random() * 256) }).getRandomValues(b); b[6] = (b[6]! & 15) | 64; b[8] = (b[8]! & 63) | 128;
        const h = [...b].map((x) => x.toString(16).padStart(2, '0')).join(''); let u = `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
        if (B(v, 'nodash')) u = u.replace(/-/g, ''); out.push(B(v, 'upper') ? u.toUpperCase() : u);
      }
      return list(out);
    },
  },
];
