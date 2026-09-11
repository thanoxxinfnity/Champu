import { NextRequest } from 'next/server';
import { streamChat } from '@/lib/providers/openai-compat';
import { nimChatConfig, resolveNimModel, hasNimKey } from '@/lib/providers/nim';
import { pollinationsChatConfig } from '@/lib/providers/pollinations';
import { customChatConfig } from '@/lib/providers/custom';
import { ProviderError, type ChatRequest, type StreamFrame } from '@/lib/providers/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

/**
 * Unified chat gateway.
 *
 * Everything model-facing goes through here for three reasons:
 *   1. NIM sends no CORS headers — a browser cannot call it directly.
 *   2. The NIM key must never reach the client bundle.
 *   3. One normalised SSE frame shape keeps the agent core vendor-agnostic.
 */

function encodeFrame(frame: StreamFrame): Uint8Array {
  return new TextEncoder().encode(`data: ${JSON.stringify(frame)}\n\n`);
}

export async function POST(req: NextRequest) {
  let body: ChatRequest;
  try {
    body = (await req.json()) as ChatRequest;
  } catch {
    return Response.json({ error: 'Request body is not valid JSON.' }, { status: 400 });
  }

  if (!Array.isArray(body.messages) || body.messages.length === 0) {
    return Response.json({ error: '`messages` must be a non-empty array.' }, { status: 400 });
  }
  if (!body.model) {
    return Response.json({ error: '`model` is required.' }, { status: 400 });
  }

  const provider = body.provider ?? 'nim';

  let config;
  let modelId = body.model;

  try {
    switch (provider) {
      case 'nim': {
        if (!hasNimKey()) {
          return Response.json(
            {
              error:
                'NVIDIA_NIM_API_KEY is not set on the server. Add it to .env.local, or switch the active model to Pollinations (zero-key), a Duck.ai model (free, opens in the browser), or a custom endpoint.',
              code: 'nim_key_missing',
            },
            { status: 503 },
          );
        }
        modelId = await resolveNimModel(body.model);
        config = nimChatConfig();
        break;
      }
      case 'pollinations':
        config = pollinationsChatConfig();
        break;
      case 'duckai':
        // Deliberate, and not a gap to be plugged later. duck.ai gates its chat
        // API behind an anti-abuse fingerprint check (HTTP 418 ERR_CHALLENGE for
        // anything that is not a real browser session), and Chomugiri does not
        // forge that. The client hands these prompts to duck.ai directly; if a
        // request still arrives here, something bypassed that path.
        return Response.json(
          {
            error:
              'Duck.ai models are reached by hand-off, not by API — duck.ai only answers a real browser session. ' +
              'Pick the model again from the dock to open it in duck.ai with your prompt, or choose a model Chomugiri can call directly.',
            code: 'duckai_handoff_only',
          },
          { status: 501 },
        );
      case 'custom': {
        if (!body.custom?.baseUrl) {
          return Response.json({ error: 'A custom provider request needs `custom.baseUrl`.' }, { status: 400 });
        }
        config = customChatConfig(body.custom);
        break;
      }
      default:
        return Response.json({ error: `Unknown provider "${provider}".` }, { status: 400 });
    }
  } catch (err) {
    const pe = err as ProviderError;
    return Response.json({ error: pe.message, code: pe.code ?? 'config_error' }, { status: pe.status ?? 400 });
  }

  // Non-streaming callers (planner, classifier) get plain JSON back.
  if (body.stream === false) {
    let content = '';
    let reasoning = '';
    let failure: StreamFrame | null = null;

    for await (const frame of streamChat(config, body, modelId, req.signal)) {
      if (frame.type === 'delta') content += frame.delta;
      else if (frame.type === 'reasoning') reasoning += frame.delta;
      else if (frame.type === 'error') failure = frame;
    }

    if (failure && failure.type === 'error' && !content) {
      return Response.json(
        { error: failure.message, code: failure.code, retryable: failure.retryable },
        { status: failure.code?.startsWith('http_') ? Number(failure.code.slice(5)) || 502 : 502 },
      );
    }

    // A 200 with nothing in it is a failure, not an answer. The internal callers
    // here (classifier, planner) parse JSON from `content`, and handing them an
    // empty string produces a confusing downstream parse error instead of a
    // legible cause.
    if (!content && !reasoning) {
      return Response.json(
        {
          error: `${modelId} returned an empty completion. Cold-start models can exceed the gateway timeout on their first call — retry, or pick a smaller model.`,
          code: 'empty_completion',
          retryable: true,
        },
        { status: 502 },
      );
    }

    return Response.json({ content, reasoning, model: modelId, provider });
  }

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const push = (frame: StreamFrame) => {
        try {
          controller.enqueue(encodeFrame(frame));
        } catch {
          /* client disconnected */
        }
      };

      push({ type: 'meta', provider, model: modelId, runId: body.runId });

      try {
        for await (const frame of streamChat(config, body, modelId, req.signal)) push(frame);
      } catch (err) {
        // A throw here means a bug in the transport, not an upstream refusal.
        push({
          type: 'error',
          message: `Gateway failure: ${(err as Error).message}`,
          code: 'gateway_exception',
        });
        push({ type: 'done', finishReason: 'error' });
      } finally {
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}
