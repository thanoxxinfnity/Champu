'use client';

import {
  puterChunkError,
  puterChunkReasoning,
  puterChunkText,
  puterErrorText,
  puterMessages,
  puterNeedsSignIn,
} from './puter-models';
import type { ChatMessage } from './types';

/**
 * Puter.js, in the page.
 *
 * Every other provider is proxied through /api/chat so credentials stay off the
 * device. Puter is the opposite by design: the SDK talks to Puter from the
 * browser and bills the signed-in user's own account, which is exactly what
 * makes it keyless. Proxying it would mean holding a Puter token server-side —
 * the thing that is not needed here.
 */

const SDK_URL = 'https://js.puter.com/v2/';

interface PuterChat {
  (messages: unknown, options: Record<string, unknown>): Promise<AsyncIterable<unknown> | { message?: { content?: unknown } }>;
}

interface PuterSdk {
  ai: { chat: PuterChat };
  auth: {
    isSignedIn: () => boolean;
    signIn: () => Promise<unknown>;
    signOut: () => void;
    getUser: () => Promise<{ username?: string; email?: string }>;
    getMonthlyUsage?: () => Promise<unknown>;
  };
}

declare global {
  interface Window {
    puter?: PuterSdk;
  }
}

let loading: Promise<PuterSdk> | null = null;

/**
 * Load the SDK once.
 *
 * It is fetched lazily rather than in the document head: a user who never picks
 * a Puter model should not pay for a third-party script on every boot, and the
 * APK must still start with no network at all.
 */
export function loadPuter(): Promise<PuterSdk> {
  if (typeof window === 'undefined') {
    return Promise.reject(new Error('Puter only runs in the browser.'));
  }
  if (window.puter) return Promise.resolve(window.puter);
  if (loading) return loading;

  loading = new Promise<PuterSdk>((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(`script[src="${SDK_URL}"]`);
    const script = existing ?? document.createElement('script');

    const settle = () => {
      if (window.puter) resolve(window.puter);
      else fail(new Error('The Puter SDK loaded but did not install itself.'));
    };
    const fail = (err: Error) => {
      loading = null;
      script.remove();
      reject(err);
    };

    script.addEventListener('load', settle, { once: true });
    script.addEventListener(
      'error',
      () =>
        fail(
          new Error(
            'Could not load js.puter.com — Puter needs a working internet connection, and it is the one provider that cannot run offline.',
          ),
        ),
      { once: true },
    );

    // A script that never fires either event (a captive portal, a blocked host)
    // would otherwise leave the run hanging with no message at all.
    setTimeout(() => {
      if (!window.puter) fail(new Error('js.puter.com did not respond within 20 seconds.'));
    }, 20_000);

    if (!existing) {
      script.src = SDK_URL;
      script.async = true;
      document.head.appendChild(script);
    }
  });

  return loading;
}

export async function puterStatus(): Promise<{ available: boolean; signedIn: boolean; user?: string; error?: string }> {
  try {
    const puter = await loadPuter();
    const signedIn = puter.auth.isSignedIn();
    if (!signedIn) return { available: true, signedIn: false };
    const user = await puter.auth.getUser().catch(() => undefined);
    return { available: true, signedIn: true, user: user?.username ?? user?.email };
  } catch (err) {
    return { available: false, signedIn: false, error: (err as Error).message };
  }
}

/** Opens Puter's sign-in window. Resolves once the user is signed in. */
export async function puterSignIn(): Promise<{ signedIn: boolean; user?: string; error?: string }> {
  try {
    const puter = await loadPuter();
    if (!puter.auth.isSignedIn()) await puter.auth.signIn();
    const user = await puter.auth.getUser().catch(() => undefined);
    return { signedIn: puter.auth.isSignedIn(), user: user?.username ?? user?.email };
  } catch (err) {
    return { signedIn: false, error: puterErrorText(err) };
  }
}

/**
 * The account's own monthly allowance, as Puter reports it.
 *
 * Worth showing rather than describing: "no API key" is not the same as "no
 * limit", and a number the user can see beats a promise they have to take on
 * trust. Returns null when Puter does not report one for this account.
 */
export async function puterUsage(): Promise<Record<string, unknown> | null> {
  try {
    const puter = await loadPuter();
    if (!puter.auth.isSignedIn()) return null;
    const usage = await puter.auth.getMonthlyUsage?.();
    return usage && typeof usage === 'object' ? (usage as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

export async function puterSignOut(): Promise<void> {
  const puter = await loadPuter().catch(() => null);
  puter?.auth.signOut();
}

export interface PuterStreamCallbacks {
  onDelta?: (delta: string, full: string) => void;
  onReasoning?: (delta: string, full: string) => void;
  onError?: (message: string) => void;
}

/**
 * Stream a completion from Puter, in the same shape `/api/chat` returns.
 *
 * Never throws: a failure comes back as `error` so the runtime can degrade the
 * same way it does for every other provider.
 */
export async function streamPuter(
  messages: ChatMessage[],
  model: string,
  callbacks: PuterStreamCallbacks,
  signal?: AbortSignal,
  options: { temperature?: number; maxTokens?: number } = {},
): Promise<{ content: string; reasoning: string; error?: string }> {
  let content = '';
  let reasoning = '';

  const fail = (message: string) => {
    callbacks.onError?.(message);
    return { content, reasoning, error: message };
  };

  let puter: PuterSdk;
  try {
    puter = await loadPuter();
  } catch (err) {
    return fail((err as Error).message);
  }

  const ask = () =>
    puter.ai.chat(puterMessages(messages), {
      model,
      stream: true,
      ...(options.temperature !== undefined ? { temperature: options.temperature } : {}),
      ...(options.maxTokens !== undefined ? { max_tokens: options.maxTokens } : {}),
    });

  try {
    // Ask first, sign in only if asked to.
    //
    // Puter serves accounts that have never signed in, at a lower tier, so the
    // keyless promise holds from the very first message. Putting a login window
    // in front of every run would break that — and would also be wrong for the
    // failure that actually happens most, which is an allowance running out.
    let response: Awaited<ReturnType<typeof ask>>;
    try {
      response = await ask();
    } catch (err) {
      if (!puterNeedsSignIn(err) || puter.auth.isSignedIn()) return fail(puterErrorText(err));

      try {
        await puter.auth.signIn();
      } catch (signInError) {
        return fail(
          `Puter asked you to sign in and the window could not open (${puterErrorText(signInError)}). Open Settings → API Keys → Puter and press Sign in — it is free, and it only has to be done once.`,
        );
      }
      if (!puter.auth.isSignedIn()) {
        return fail('Puter sign-in was closed before it finished. Open Settings → API Keys → Puter to try again.');
      }
      response = await ask();
    }

    if (!response || typeof response !== 'object' || !(Symbol.asyncIterator in response)) {
      // Puter answered without streaming; read it as one chunk.
      const whole = puterChunkText(response);
      if (whole) {
        content = whole;
        callbacks.onDelta?.(whole, content);
      }
      return { content, reasoning };
    }

    for await (const part of response as AsyncIterable<unknown>) {
      if (signal?.aborted) break;

      // Provider errors arrive as a chunk, not a throw — a reader that only
      // looks at text finishes clean and empty, with nothing saying why.
      const chunkError = puterChunkError(part);
      if (chunkError) return fail(chunkError);

      const think = puterChunkReasoning(part);
      if (think) {
        reasoning += think;
        callbacks.onReasoning?.(think, reasoning);
      }

      const text = puterChunkText(part);
      if (text) {
        content += text;
        callbacks.onDelta?.(text, content);
      }
    }
  } catch (err) {
    if (signal?.aborted) return { content, reasoning };
    return fail(puterErrorText(err));
  }

  return { content, reasoning };
}

/** Single-shot completion, for the planner and the classifier. */
export async function completePuter(messages: ChatMessage[], model: string, signal?: AbortSignal): Promise<string> {
  const { content, error } = await streamPuter(messages, model, {}, signal);
  if (error) throw new Error(error);
  return content;
}
