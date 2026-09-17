/**
 * Retextures every .glb in a zip and writes a new zip beside it.
 *
 * Written for exactly the pack this was built for: forty trimesh exports with
 * POSITION and nothing else. Each one goes through retextureGlbFile in turn —
 * sequentially, not in parallel, because Pollinations is one shared free
 * service and forty simultaneous requests to it is not a considerate way to
 * use something that needs no key.
 *
 *   node --experimental-strip-types scripts/retexture-batch.mjs <in.zip> <out.zip>
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { inflateRawSync } from 'node:zlib';
import { retextureGlbFile } from '../src/lib/suites/godot/retexture.ts';

// Minimal ZIP reader/writer. Reads both stored (method 0) and deflated
// (method 8, the zip default and what the source pack actually uses) via
// Node's own `inflateRawSync` — raw deflate, no zlib/gzip wrapper, which is
// what the zip format itself specifies for method 8. Writes stored only:
// these files are already-compressed binary (glTF BIN + JPEG), deflating them
// again would not meaningfully shrink the result, and a stored entry needs no
// compression step to write correctly the first time.
function readZip(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const entries = [];
  // Find End Of Central Directory by scanning back from the end.
  let eocd = -1;
  for (let i = bytes.length - 22; i >= 0; i -= 1) {
    if (view.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('Not a zip file (no EOCD record found).');
  const count = view.getUint16(eocd + 10, true);
  let cdOffset = view.getUint32(eocd + 16, true);

  for (let i = 0; i < count; i += 1) {
    if (view.getUint32(cdOffset, true) !== 0x02014b50) throw new Error('Corrupt central directory.');
    const compSize = view.getUint32(cdOffset + 20, true);
    const nameLen = view.getUint16(cdOffset + 28, true);
    const extraLen = view.getUint16(cdOffset + 30, true);
    const commentLen = view.getUint16(cdOffset + 32, true);
    const localOffset = view.getUint32(cdOffset + 42, true);
    const name = new TextDecoder().decode(bytes.subarray(cdOffset + 46, cdOffset + 46 + nameLen));

    // Local header tells us where the actual data starts (its own name/extra
    // fields can differ in length from the central directory's copy).
    const localNameLen = view.getUint16(localOffset + 26, true);
    const localExtraLen = view.getUint16(localOffset + 28, true);
    const method = view.getUint16(localOffset + 8, true);
    const dataStart = localOffset + 30 + localNameLen + localExtraLen;
    const raw = bytes.subarray(dataStart, dataStart + compSize);
    let data;
    if (method === 0) {
      data = raw;
    } else if (method === 8) {
      data = new Uint8Array(inflateRawSync(raw));
    } else {
      throw new Error(`${name}: compression method ${method} is not supported (expected 0 or 8).`);
    }

    entries.push({ name, bytes: data });
    cdOffset += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

function crc32(bytes) {
  if (!crc32.table) {
    crc32.table = new Uint32Array(256);
    for (let n = 0; n < 256; n += 1) {
      let c = n;
      for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      crc32.table[n] = c >>> 0;
    }
  }
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i += 1) c = crc32.table[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function writeZip(entries) {
  const nameBytes = entries.map((e) => new TextEncoder().encode(e.name));
  const crcs = entries.map((e) => crc32(e.bytes));
  const locals = [];
  const localOffsets = [];
  let offset = 0;
  entries.forEach((e, i) => {
    localOffsets.push(offset);
    const header = new Uint8Array(30);
    const v = new DataView(header.buffer);
    v.setUint32(0, 0x04034b50, true);
    v.setUint16(4, 20, true); // version needed
    v.setUint16(6, 0, true); // flags
    v.setUint16(8, 0, true); // method: stored
    v.setUint16(10, 0, true); v.setUint16(12, 0, true); // mod time/date
    v.setUint32(14, crcs[i], true);
    v.setUint32(18, e.bytes.length, true); // compressed size
    v.setUint32(22, e.bytes.length, true); // uncompressed size
    v.setUint16(26, nameBytes[i].length, true);
    v.setUint16(28, 0, true); // extra length
    locals.push(header, nameBytes[i], e.bytes);
    offset += header.length + nameBytes[i].length + e.bytes.length;
  });

  const centralParts = [];
  let centralSize = 0;
  entries.forEach((e, i) => {
    const header = new Uint8Array(46);
    const v = new DataView(header.buffer);
    v.setUint32(0, 0x02014b50, true);
    v.setUint16(4, 20, true); v.setUint16(6, 20, true);
    v.setUint16(8, 0, true); v.setUint16(10, 0, true);
    v.setUint16(12, 0, true); v.setUint16(14, 0, true);
    v.setUint32(16, crcs[i], true);
    v.setUint32(20, e.bytes.length, true);
    v.setUint32(24, e.bytes.length, true);
    v.setUint16(28, nameBytes[i].length, true);
    v.setUint32(42, localOffsets[i], true);
    centralParts.push(header, nameBytes[i]);
    centralSize += header.length + nameBytes[i].length;
  });

  const eocd = new Uint8Array(22);
  const v = new DataView(eocd.buffer);
  v.setUint32(0, 0x06054b50, true);
  v.setUint16(8, entries.length, true);
  v.setUint16(10, entries.length, true);
  v.setUint32(12, centralSize, true);
  v.setUint32(16, offset, true);

  const all = [...locals, ...centralParts, eocd];
  const total = all.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let at = 0;
  for (const part of all) { out.set(part, at); at += part.length; }
  return out;
}

const [, , inPath, outPath] = process.argv;
if (!inPath || !outPath) {
  console.log('usage: retexture-batch.mjs <in.zip> <out.zip>');
  process.exit(1);
}

const entries = readZip(new Uint8Array(readFileSync(inPath)));
const models = entries.filter((e) => e.name.endsWith('.glb'));
console.log(`${models.length} models to retexture\n`);

const done = [];
const failed = [];
for (const [i, entry] of models.entries()) {
  const name = entry.name.replace(/\.glb$/, '');
  const before = entry.bytes.length;
  process.stdout.write(`[${i + 1}/${models.length}] ${entry.name} (${(before / 1048576).toFixed(1)} MB)… `);
  const began = Date.now();
  try {
    const { glb, textureSource } = await retextureGlbFile(entry.bytes, name.replace(/_/g, ' '), { timeoutMs: 60_000 });
    const took = ((Date.now() - began) / 1000).toFixed(1);
    console.log(`${textureSource}, ${(glb.length / 1048576).toFixed(1)} MB, ${took}s`);
    done.push({ name: entry.name, bytes: glb });
  } catch (err) {
    console.log(`FAILED: ${err.message}`);
    failed.push({ name: entry.name, why: err.message });
    done.push(entry); // keep the original rather than dropping the model entirely
  }
}

writeFileSync(outPath, writeZip(done));
console.log(`\nwrote ${outPath}`);
console.log(`retextured: ${done.length - failed.length}/${models.length}`);
if (failed.length) {
  console.log('kept as-is (untextured):');
  for (const f of failed) console.log(`  ${f.name}: ${f.why}`);
}
