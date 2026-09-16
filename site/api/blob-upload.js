/**
 * A client upload token for Vercel Blob.
 *
 * `BLOB_READ_WRITE_TOKEN` is a sealed v2 envelope: reading it back through the
 * API — even with `decrypt=true` — gives 1176 characters of ciphertext that only
 * resolve inside a deployment. So nothing outside Vercel can upload, and the
 * usual answer, "POST the file to a function", does not work either: a
 * serverless request body caps out at 4.5MB and these are thirty.
 *
 * The documented path for files this size is a **client upload**. This route
 * runs where the envelope resolves, hands back a short-lived token scoped to
 * one pathname, and the file goes straight from the uploader to Blob storage
 * without passing through here at all.
 *
 * It is deliberately narrow: only under `builds/`, only the types a build
 * actually produces, and only with the shared secret this deployment was given.
 * An open upload endpoint on a public domain is a free file host for everyone
 * who finds it.
 */
import { handleUpload } from '@vercel/blob/client';

const ALLOWED = [
  'application/vnd.android.package-archive',
  'application/zip',
  'application/octet-stream',
  'application/wasm',
];

export const config = { runtime: 'nodejs' };

export default async function handler(request, response) {
  if (request.method !== 'POST') {
    response.status(405).json({ error: 'POST only.' });
    return;
  }

  const secret = process.env.UPLOAD_SECRET;
  if (!secret) {
    response.status(503).json({ error: 'No UPLOAD_SECRET is configured on this deployment.' });
    return;
  }

  try {
    const json = await handleUpload({
      request,
      body: request.body,
      onBeforeGenerateToken: async (pathname, clientPayload) => {
        // Checked here rather than in the browser: the browser is the thing
        // being authorised, so anything it asserts about itself is worthless.
        if (clientPayload !== secret) throw new Error('Not allowed.');
        if (!pathname.startsWith('builds/')) throw new Error('Uploads go under builds/.');
        return {
          allowedContentTypes: ALLOWED,
          // Overwriting is how "the latest build" stays one URL rather than a
          // list of them nobody can tell apart.
          allowOverwrite: true,
          addRandomSuffix: false,
          tokenPayload: JSON.stringify({ pathname }),
        };
      },
      onUploadCompleted: async () => {
        // Nothing to do. Required by the helper, and a no-op is the honest
        // implementation: there is no database here to record it in.
      },
    });
    response.status(200).json(json);
  } catch (err) {
    // 400, not 500: every way this fails is the caller asking for something it
    // is not allowed to have.
    response.status(400).json({ error: err instanceof Error ? err.message : 'Upload refused.' });
  }
}
