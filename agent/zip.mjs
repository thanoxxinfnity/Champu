import { deflateRawSync, crc32 } from 'node:zlib';

/**
 * Minimal ZIP writer (APPNOTE 6.3.x, deflate + store).
 *
 * Written by hand rather than pulled from npm so the bridge daemon stays a
 * zero-dependency single-file install — `node agent/chomugiri-agent.mjs` must
 * work on a fresh machine with nothing but Node.
 *
 * Emits Zip64 end-of-central-directory records when an archive exceeds the
 * 32-bit limits, so multi-GB SDK/APK bundles do not silently corrupt.
 */

const LOCAL_SIG = 0x04034b50;
const CENTRAL_SIG = 0x02014b50;
const EOCD_SIG = 0x06054b50;
const ZIP64_EOCD_SIG = 0x06064b50;
const ZIP64_LOCATOR_SIG = 0x07064b50;

const U32_MAX = 0xffffffff;
const U16_MAX = 0xffff;

/** Node >=20.12 exposes zlib.crc32; fall back to a table for older runtimes. */
const crcTable = (() => {
  const table = new Int32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[i] = c;
  }
  return table;
})();

function crc32Fallback(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = crcTable[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

const checksum = typeof crc32 === 'function' ? (buf) => crc32(buf) >>> 0 : crc32Fallback;

function dosDateTime(date = new Date()) {
  const year = Math.max(1980, date.getFullYear());
  const time = ((date.getHours() & 0x1f) << 11) | ((date.getMinutes() & 0x3f) << 5) | ((date.getSeconds() / 2) & 0x1f);
  const day = (((year - 1980) & 0x7f) << 9) | (((date.getMonth() + 1) & 0x0f) << 5) | (date.getDate() & 0x1f);
  return { time, day };
}

/**
 * @param {Array<{name: string, data: Buffer|string, store?: boolean, date?: Date}>} entries
 * @returns {Buffer}
 */
export function createZip(entries) {
  const chunks = [];
  const central = [];
  let offset = 0;

  for (const entry of entries) {
    const nameBuf = Buffer.from(entry.name.replace(/\\/g, '/'), 'utf8');
    const raw = Buffer.isBuffer(entry.data) ? entry.data : Buffer.from(String(entry.data), 'utf8');
    const crc = checksum(raw);

    // Store already-compressed payloads (png/jpg/zip) — deflate makes them bigger.
    const store = entry.store ?? /\.(png|jpe?g|gif|webp|zip|jar|apk|mp[34]|ogg|woff2?)$/i.test(entry.name);
    const body = store ? raw : deflateRawSync(raw, { level: 9 });
    const method = store ? 0 : 8;

    const { time, day } = dosDateTime(entry.date);
    const needsZip64 = raw.length > U32_MAX || body.length > U32_MAX || offset > U32_MAX;

    const local = Buffer.alloc(30);
    local.writeUInt32LE(LOCAL_SIG, 0);
    local.writeUInt16LE(needsZip64 ? 45 : 20, 4); // version needed
    local.writeUInt16LE(0x0800, 6); // UTF-8 filename flag
    local.writeUInt16LE(method, 8);
    local.writeUInt16LE(time, 10);
    local.writeUInt16LE(day, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(needsZip64 ? U32_MAX : body.length, 18);
    local.writeUInt32LE(needsZip64 ? U32_MAX : raw.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);

    let localExtra = Buffer.alloc(0);
    if (needsZip64) {
      localExtra = Buffer.alloc(20);
      localExtra.writeUInt16LE(0x0001, 0);
      localExtra.writeUInt16LE(16, 2);
      localExtra.writeBigUInt64LE(BigInt(raw.length), 4);
      localExtra.writeBigUInt64LE(BigInt(body.length), 12);
    }
    local.writeUInt16LE(localExtra.length, 28);

    chunks.push(local, nameBuf, localExtra, body);

    const centralExtraParts = [];
    if (needsZip64) {
      const ex = Buffer.alloc(28);
      ex.writeUInt16LE(0x0001, 0);
      ex.writeUInt16LE(24, 2);
      ex.writeBigUInt64LE(BigInt(raw.length), 4);
      ex.writeBigUInt64LE(BigInt(body.length), 12);
      ex.writeBigUInt64LE(BigInt(offset), 20);
      centralExtraParts.push(ex);
    }
    const centralExtra = Buffer.concat(centralExtraParts);

    const cd = Buffer.alloc(46);
    cd.writeUInt32LE(CENTRAL_SIG, 0);
    cd.writeUInt16LE(0x031e, 4); // made by: UNIX, spec 3.0
    cd.writeUInt16LE(needsZip64 ? 45 : 20, 6);
    cd.writeUInt16LE(0x0800, 8);
    cd.writeUInt16LE(method, 10);
    cd.writeUInt16LE(time, 12);
    cd.writeUInt16LE(day, 14);
    cd.writeUInt32LE(crc, 16);
    cd.writeUInt32LE(needsZip64 ? U32_MAX : body.length, 20);
    cd.writeUInt32LE(needsZip64 ? U32_MAX : raw.length, 24);
    cd.writeUInt16LE(nameBuf.length, 28);
    cd.writeUInt16LE(centralExtra.length, 30);
    cd.writeUInt32LE((0o100644 << 16) >>> 0, 38); // external attrs: regular file 0644
    cd.writeUInt32LE(needsZip64 ? U32_MAX : offset, 42);

    central.push(cd, nameBuf, centralExtra);
    offset += local.length + nameBuf.length + localExtra.length + body.length;
  }

  const centralBuf = Buffer.concat(central);
  const centralOffset = offset;
  const count = entries.length;
  const zip64 = count > U16_MAX || centralOffset > U32_MAX || centralBuf.length > U32_MAX;

  const tail = [centralBuf];

  if (zip64) {
    const z64 = Buffer.alloc(56);
    z64.writeUInt32LE(ZIP64_EOCD_SIG, 0);
    z64.writeBigUInt64LE(44n, 4); // size of this record - 12
    z64.writeUInt16LE(0x031e, 12);
    z64.writeUInt16LE(45, 14);
    z64.writeBigUInt64LE(BigInt(count), 24);
    z64.writeBigUInt64LE(BigInt(count), 32);
    z64.writeBigUInt64LE(BigInt(centralBuf.length), 40);
    z64.writeBigUInt64LE(BigInt(centralOffset), 48);

    const loc = Buffer.alloc(20);
    loc.writeUInt32LE(ZIP64_LOCATOR_SIG, 0);
    loc.writeBigUInt64LE(BigInt(centralOffset + centralBuf.length), 8);
    loc.writeUInt32LE(1, 16);

    tail.push(z64, loc);
  }

  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(EOCD_SIG, 0);
  eocd.writeUInt16LE(zip64 ? U16_MAX : count, 8);
  eocd.writeUInt16LE(zip64 ? U16_MAX : count, 10);
  eocd.writeUInt32LE(zip64 ? U32_MAX : centralBuf.length, 12);
  eocd.writeUInt32LE(zip64 ? U32_MAX : centralOffset, 16);
  tail.push(eocd);

  return Buffer.concat([...chunks, ...tail]);
}
