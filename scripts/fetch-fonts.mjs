/**
 * Vendors the webfonts into public/fonts.
 *
 * The APK loads the workspace from 127.0.0.1 with no network guarantee, so a
 * <link> to fonts.googleapis.com silently falls back to a system font — which
 * would strip the hand-drawn lettering out of the exact build it matters most
 * in. Only the latin subset is taken; the full set would add megabytes to an APK
 * for glyphs this UI never renders.
 *
 *   node scripts/fetch-fonts.mjs
 */
import fs from 'node:fs/promises';
import path from 'node:path';

const UA =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

const FAMILIES = [
  { css: 'Caveat:wght@400..700', file: 'caveat', family: 'Caveat', weight: '400 700' },
  { css: 'Nunito:wght@400..800', file: 'nunito', family: 'Nunito', weight: '400 800' },
  { css: 'JetBrains+Mono:wght@400..700', file: 'jetbrains-mono', family: 'JetBrains Mono', weight: '400 700' },
];

const OUT_DIR = path.join(process.cwd(), 'public', 'fonts');

/** Pull the `/* latin *\/` block only — the other subsets are dead weight here. */
function latinBlock(css) {
  const blocks = css.split('@font-face').slice(1);
  for (const b of blocks) {
    const url = b.match(/url\((https:\/\/fonts\.gstatic\.com[^)]+)\)/)?.[1];
    const range = b.match(/unicode-range:\s*([^;]+);/)?.[1]?.trim();
    if (!url || !range) continue;
    // The latin block is the one covering basic ASCII (U+0000-00FF).
    if (/U\+0000-00FF/.test(range)) return { url, range };
  }
  return null;
}

await fs.mkdir(OUT_DIR, { recursive: true });
const faces = [];

for (const f of FAMILIES) {
  const res = await fetch(`https://fonts.googleapis.com/css2?family=${f.css}&display=swap`, {
    headers: { 'User-Agent': UA },
  });
  if (!res.ok) throw new Error(`${f.family}: stylesheet returned ${res.status}`);

  const block = latinBlock(await res.text());
  if (!block) throw new Error(`${f.family}: no latin subset in the stylesheet`);

  const font = await fetch(block.url, { headers: { 'User-Agent': UA } });
  if (!font.ok) throw new Error(`${f.family}: font returned ${font.status}`);

  const bytes = Buffer.from(await font.arrayBuffer());
  const name = `${f.file}-latin.woff2`;
  await fs.writeFile(path.join(OUT_DIR, name), bytes);
  console.log(`${f.family.padEnd(16)} ${name.padEnd(26)} ${(bytes.length / 1024).toFixed(1)} KB`);

  faces.push(
    `@font-face {\n` +
      `  font-family: '${f.family}';\n` +
      `  font-style: normal;\n` +
      `  font-weight: ${f.weight};\n` +
      `  font-display: swap;\n` +
      `  src: url('/fonts/${name}') format('woff2');\n` +
      `  unicode-range: ${block.range};\n` +
      `}`,
  );
}

const header =
  `/*\n` +
  ` * Vendored by scripts/fetch-fonts.mjs — do not edit by hand.\n` +
  ` * Self-hosted so the offline APK renders the same lettering as the web build.\n` +
  ` */\n\n`;

await fs.writeFile(path.join(OUT_DIR, 'fonts.css'), header + faces.join('\n\n') + '\n');
console.log(`\nwrote public/fonts/fonts.css (${faces.length} faces)`);
