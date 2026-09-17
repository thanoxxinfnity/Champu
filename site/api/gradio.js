/**
 * Where a Kaggle server says where it is.
 *
 * Kaggle does not publish a running kernel's log — an output call against a
 * running kernel answers with no files and an empty log — so a notebook that
 * opens a Gradio tunnel and prints the share URL has put it somewhere nobody
 * can read until it has stopped being useful. The notebook POSTs it here
 * instead, and the app reads it back.
 *
 * The nonce is the whole authorisation story, and it is deliberately small.
 * Whoever pushes the notebook generates it, it travels inside that one
 * notebook, and it is good for one registration. Nothing reusable goes into a
 * notebook, so a leaked nonce costs one stale URL on one run rather than
 * write access to anything.
 *
 * Blob is the store because this deployment already has `BLOB_READ_WRITE_TOKEN`
 * and a serverless function has no memory between invocations. The record is
 * tiny and it expires on read: a share URL outlives its kernel by nothing, so
 * serving a stale one is worse than serving none.
 */
import { head, put } from '@vercel/blob';

/** How long a registration is worth believing. Kaggle caps a GPU session well
 *  inside this, so anything older is certainly dead. */
const MAX_AGE_MS = 12 * 60 * 60 * 1000;

/** Enough to be unguessable, short enough to read in a log. */
const NONCE = /^[A-Za-z0-9_-]{16,64}$/;

export const config = { runtime: 'nodejs' };

function send(response, status, body) {
  response.status(status).setHeader('Content-Type', 'application/json');
  response.end(JSON.stringify(body));
}

export default async function handler(request, response) {
  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    return send(response, 503, { error: 'This deployment has no Blob store.' });
  }

  const url = new URL(request.url, `https://${request.headers.host}`);
  const nonce = request.method === 'POST' ? undefined : url.searchParams.get('nonce');

  if (request.method === 'GET') {
    if (!nonce || !NONCE.test(nonce)) {
      return send(response, 400, { error: 'Ask with a nonce.' });
    }
    let found;
    try {
      found = await head(`gradio/${nonce}.json`);
    } catch {
      // Not an error: the usual answer is "the kernel has not started yet",
      // and the caller polls. Saying 404 would make it look broken.
      return send(response, 200, { status: 'waiting' });
    }
    const record = await (await fetch(found.url)).json();
    const age = Date.now() - Date.parse(record.at);
    if (!Number.isFinite(age) || age > MAX_AGE_MS) {
      return send(response, 200, { status: 'expired' });
    }
    return send(response, 200, { status: 'ready', url: record.url, at: record.at });
  }

  if (request.method !== 'POST') {
    return send(response, 405, { error: 'POST to register, GET to read.' });
  }

  let body = '';
  for await (const chunk of request) body += chunk;
  let parsed;
  try {
    parsed = JSON.parse(body || '{}');
  } catch {
    return send(response, 400, { error: 'That was not JSON.' });
  }

  if (!parsed.nonce || !NONCE.test(parsed.nonce)) {
    return send(response, 400, { error: 'A registration needs a nonce.' });
  }
  // Only a Gradio share tunnel. This endpoint hands a URL to something that
  // will then send images to it, so it does not get to be any URL at all.
  let target;
  try {
    target = new URL(parsed.url);
  } catch {
    return send(response, 400, { error: 'That was not a URL.' });
  }
  if (target.protocol !== 'https:' || !/(^|\.)gradio\.live$/.test(target.hostname)) {
    return send(response, 400, { error: 'Only an https gradio.live share URL can be registered.' });
  }

  await put(
    `gradio/${parsed.nonce}.json`,
    JSON.stringify({ url: target.toString(), at: new Date().toISOString() }),
    {
      access: 'public',
      contentType: 'application/json',
      addRandomSuffix: false,
      allowOverwrite: true,
    },
  );
  return send(response, 200, { status: 'registered' });
}
