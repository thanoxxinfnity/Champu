/**
 * The connector's saved state and the `chatFetch` seam.
 *
 * `chatFetch` is a drop-in for `fetch('/api/chat', …)`: anything not addressed to the Antigravity provider goes straight to the
 * server route, and an Antigravity request is answered in the browser — the hub lives on the user's device, which our server
 * cannot reach — with the same SSE frames (or JSON body) the route would have produced, so no caller needs to know the difference.
 */
import { chatOnce, chatStream, type AgConfig, type AgModel } from './client.ts';
import type { ChatMessage, StreamFrame } from '../providers/types.ts';

export interface AgState {
  config: AgConfig | null;
  enabled: boolean;
  models: Record<string, AgModel>;
}

let current: AgState = { config: null, enabled: false, models: {} };

export function getAg(): AgState {
  return current;
}

export function setAg(next: AgState): void {
  current = next;
}

function sse(frames: AsyncGenerator<StreamFrame>, signal?: AbortSignal): Response {
  const enc = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        for await (const f of frames) controller.enqueue(enc.encode(`data: ${JSON.stringify(f)}\n\n`));
      } catch (err) {
        const aborted = signal?.aborted || (err as Error).name === 'AbortError';
        const frame: StreamFrame = { type: 'error', message: aborted ? 'Run cancelled.' : (err as Error).message, retryable: false };
        controller.enqueue(enc.encode(`data: ${JSON.stringify(frame)}\n\n`));
      }
      controller.close();
    },
  });
  return new Response(body, { status: 200, headers: { 'Content-Type': 'text/event-stream; charset=utf-8' } });
}

export async function chatFetch(input: string, init: RequestInit = {}): Promise<Response> {
  let req: { provider?: string; model?: string; messages?: ChatMessage[]; stream?: boolean } | null = null;
  try {
    if (typeof init.body === 'string') req = JSON.parse(init.body);
  } catch {
    req = null;
  }
  if (!req || req.provider !== 'antigravity') return fetch(input, init);

  const ag = getAg();
  if (!ag.config?.hubUrl || !ag.enabled) {
    return new Response(JSON.stringify({ error: 'Antigravity is not connected — open Settings → Connectors and press Connect.' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }
  const model = ag.models[req.model ?? ''] ?? { id: req.model ?? '', enumName: req.model ?? '' };
  const messages = req.messages ?? [];
  const signal = (init.signal as AbortSignal | undefined) ?? undefined;

  if (req.stream) return sse(chatStream(ag.config, model, messages, { signal }), signal);
  try {
    const content = await chatOnce(ag.config, model, messages, signal);
    return new Response(JSON.stringify({ content }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  } catch (err) {
    return new Response(JSON.stringify({ error: (err as Error).message }), { status: 502, headers: { 'Content-Type': 'application/json' } });
  }
}
