/**
 * Put a build on Vercel Blob.
 *
 * Not a direct upload: `BLOB_READ_WRITE_TOKEN` is a sealed envelope that only
 * resolves inside a deployment, so nothing outside Vercel can write to the
 * store. And not a POST to a function either — a serverless body caps at 4.5MB
 * and these are thirty.
 *
 * So it is the documented client upload: `/api/blob-upload` on the deployment
 * hands back a short-lived token scoped to one pathname, and the bytes go
 * straight from here to Blob storage.
 *
 *   node --experimental-strip-types scripts/upload-blob.mjs <file> <pathname>
 */
import { readFile } from 'node:fs/promises';
import { basename } from 'node:path';
import { upload } from '@vercel/blob/client';

const file = process.argv[2];
const pathname = process.argv[3] ?? `builds/${basename(file)}`;
const secret = process.env.UPLOAD_SECRET;
const site = process.env.SITE ?? 'https://chomugiri.vercel.app';

if (!file || !secret) {
  console.log('usage: UPLOAD_SECRET=… upload-blob.mjs <file> [pathname]');
  process.exit(1);
}

const bytes = await readFile(file);
console.log(`uploading ${file} (${(bytes.byteLength / 1048576).toFixed(1)} MB) -> ${pathname}`);

const type = file.endsWith('.apk')
  ? 'application/vnd.android.package-archive'
  : file.endsWith('.zip')
    ? 'application/zip'
    : 'application/octet-stream';

const blob = await upload(pathname, new Blob([bytes], { type }), {
  access: 'public',
  handleUploadUrl: `${site}/api/blob-upload`,
  // The shared secret. Checked on the server, because the browser is the thing
  // being authorised and anything it asserts about itself is worthless.
  clientPayload: secret,
  contentType: type,
});

console.log('url:', blob.url);
console.log('downloadUrl:', blob.downloadUrl ?? '(same)');
