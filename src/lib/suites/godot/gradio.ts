/**
 * Talking to a Gradio app over its REST API.
 *
 * Written against a running Gradio 6 rather than from the documentation: every
 * shape below was read off a real server first, because the alternative is
 * discovering the protocol is different on a Kaggle GPU three hours into a
 * booking.
 *
 * A call is three requests, not one:
 *
 *   1. POST the image as multipart to `/gradio_api/upload`, which answers with
 *      a JSON array of server-side paths. The Image component takes a path, not
 *      base64 — sending base64 fails validation rather than being decoded.
 *   2. POST `{data: [...]}` to `/gradio_api/call/<endpoint>`, which answers
 *      `{event_id}` immediately and runs the job behind a queue.
 *   3. GET `/gradio_api/call/<endpoint>/<event_id>`, which holds open and
 *      streams server-sent events until `complete` or `error`.
 *
 * The result carries both a `path` and a `url`, and the `url` is the one to
 * distrust: a server behind a share tunnel reports whatever address it is bound
 * to, which for a Kaggle kernel is a loopback nobody else can reach. The path
 * is stable, so the download URL is rebuilt from the base that was called.
 */

export interface GradioResult {
  bytes?: Uint8Array;
  error?: string;
  seconds: number;
}

/** A Gradio FileData argument, as the upload step returns it. */
function fileArgument(path: string): Record<string, unknown> {
  return { path, meta: { _type: 'gradio.FileData' } };
}

function base(url: string): string {
  return url.replace(/\/+$/, '');
}

/**
 * Whether something is a Gradio share tunnel.
 *
 * Checked before the URL is used, because the app hands this address to a
 * caller that will then post images to it.
 */
export function isShareUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' && /(^|\.)gradio\.live$/.test(parsed.hostname);
  } catch {
    return false;
  }
}

/** Is a Gradio app answering here, and does it expose the endpoint we need? */
export async function serverIsUp(
  url: string,
  endpoint: string,
  signal?: AbortSignal,
): Promise<{ up: boolean; why?: string }> {
  try {
    const res = await fetch(`${base(url)}/gradio_api/info`, {
      ...(signal ? { signal } : {}),
    });
    if (!res.ok) return { up: false, why: `it answered ${res.status}` };
    const json = (await res.json()) as { named_endpoints?: Record<string, unknown> };
    const names = Object.keys(json.named_endpoints ?? {});
    if (!names.includes(endpoint)) {
      return { up: false, why: `it is a Gradio app but has no ${endpoint} (it has ${names.join(', ') || 'nothing'})` };
    }
    return { up: true };
  } catch (err) {
    return { up: false, why: (err as Error).message };
  }
}

/**
 * The completed or failed payload out of the event stream.
 *
 * Parsed rather than JSON-decoded whole: the stream is `event:`/`data:` line
 * pairs, and a job that is still running sends heartbeats and progress events
 * in between that carry no result.
 */
function readStream(text: string): { data?: unknown; error?: string } {
  let kind = '';
  for (const line of text.split('\n')) {
    if (line.startsWith('event:')) {
      kind = line.slice(6).trim();
      continue;
    }
    if (!line.startsWith('data:')) continue;
    const body = line.slice(5).trim();
    if (kind === 'error') {
      try {
        const parsed = JSON.parse(body) as { error?: string };
        // A Gradio error event can carry a null message, which reads as the
        // absence of a problem rather than a problem nobody described.
        return { error: parsed.error ?? 'the app raised an error and did not say what it was' };
      } catch {
        return { error: body || 'the app raised an error and did not say what it was' };
      }
    }
    if (kind === 'complete') {
      try {
        return { data: JSON.parse(body) };
      } catch {
        return { error: 'the app finished but its answer was not JSON' };
      }
    }
  }
  return { error: 'the stream ended without finishing or failing' };
}

/**
 * Send one image, get one model back.
 *
 * `endpoint` is the Gradio API name, which is the Python function's name with a
 * slash in front — `/to_glb` for `def to_glb`.
 */
export async function generateOnServer(
  url: string,
  image: Uint8Array,
  options: {
    endpoint?: string;
    seed?: number;
    timeoutMs?: number;
    signal?: AbortSignal;
    onStage?: (message: string) => void;
  } = {},
): Promise<GradioResult> {
  const began = Date.now();
  const seconds = () => Math.round((Date.now() - began) / 100) / 10;
  const endpoint = options.endpoint ?? '/to_glb';
  const root = base(url);
  const name = endpoint.replace(/^\//, '');

  // The stream request holds open for the whole job, so its deadline is the
  // job's deadline. A server with the weights already loaded answers in
  // minutes; one that is still warming can take much longer.
  const timer = new AbortController();
  const deadline = setTimeout(() => timer.abort(), options.timeoutMs ?? 30 * 60_000);
  const onAbort = () => timer.abort();
  options.signal?.addEventListener('abort', onAbort);

  try {
    options.onStage?.('Sending the image.');
    const form = new FormData();
    form.append('files', new Blob([image as BlobPart], { type: 'image/png' }), 'input.png');
    const sent = await fetch(`${root}/gradio_api/upload`, {
      method: 'POST',
      body: form,
      signal: timer.signal,
    });
    if (!sent.ok) {
      return { error: `The server would not take the image (${sent.status}).`, seconds: seconds() };
    }
    const paths = (await sent.json()) as string[];
    if (!Array.isArray(paths) || !paths[0]) {
      return { error: 'The server took the image and did not say where it put it.', seconds: seconds() };
    }

    options.onStage?.('Queued on the GPU.');
    const started = await fetch(`${root}/gradio_api/call/${name}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ data: [fileArgument(paths[0]), options.seed ?? 42] }),
      signal: timer.signal,
    });
    if (!started.ok) {
      return { error: `The server refused the job (${started.status}).`, seconds: seconds() };
    }
    const { event_id: event } = (await started.json()) as { event_id?: string };
    if (!event) {
      return { error: 'The server accepted the job without giving it an id.', seconds: seconds() };
    }

    options.onStage?.('Generating.');
    const streamed = await fetch(`${root}/gradio_api/call/${name}/${event}`, { signal: timer.signal });
    if (!streamed.ok) {
      return { error: `The result stream answered ${streamed.status}.`, seconds: seconds() };
    }
    const outcome = readStream(await streamed.text());
    if (outcome.error) return { error: outcome.error, seconds: seconds() };

    const first = Array.isArray(outcome.data) ? (outcome.data as Array<{ path?: string }>)[0] : undefined;
    if (!first?.path) {
      return { error: 'The job finished and produced no file.', seconds: seconds() };
    }

    // Rebuilt from `root`, not taken from the result's own `url`: a server
    // behind a share tunnel reports the address it is bound to, and on a Kaggle
    // kernel that is a loopback address reachable only from inside the kernel.
    options.onStage?.('Downloading the model.');
    const file = await fetch(`${root}/gradio_api/file=${first.path}`, { signal: timer.signal });
    if (!file.ok) {
      return { error: `The model was made but would not download (${file.status}).`, seconds: seconds() };
    }
    const bytes = new Uint8Array(await file.arrayBuffer());
    if (bytes.byteLength < 20 || String.fromCharCode(...bytes.subarray(0, 4)) !== 'glTF') {
      return { error: 'What came back was not a glTF binary.', seconds: seconds() };
    }
    return { bytes, seconds: seconds() };
  } catch (err) {
    const why = (err as Error).name === 'AbortError'
      ? 'The server did not answer in time.'
      : (err as Error).message;
    return { error: why, seconds: seconds() };
  } finally {
    clearTimeout(deadline);
    options.signal?.removeEventListener('abort', onAbort);
  }
}
