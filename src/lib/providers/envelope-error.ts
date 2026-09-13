/**
 * Errors that arrive inside a successful response.
 *
 * Pure, and kept apart from the transport so it can be tested directly.
 */

/** What an upstream failure amounts to, in terms the UI can show. */
export interface ErrorInfo {
  message: string;
  code?: string;
  retryable?: boolean;
}

/**
 * An error returned inside a 200.
 *
 * Not every gateway uses HTTP status codes. kie.ai answers
 * `200 {"code":422,"msg":"The model is not supported"}`, and without this that
 * body reached the parser, produced no deltas, and was emitted as the
 * assistant's reply — the user saw raw JSON where the answer should be, with
 * nothing anywhere saying the request had failed.
 *
 * Deliberately conservative: it fires only on a payload that carries a failing
 * code or an error field AND no completion content, so a real answer that
 * happens to mention an error is never swallowed.
 */
export function envelopeError(text: string): ErrorInfo | null {
  if (!text || text.length > 8000) return null;

  let body: Record<string, unknown>;
  try {
    const parsed = JSON.parse(text) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    body = parsed as Record<string, unknown>;
  } catch {
    return null;
  }

  // A payload with real content is an answer, whatever else it carries.
  if (Array.isArray(body.choices) && body.choices.length) return null;
  if (typeof body.content === 'string' && body.content) return null;

  const code = typeof body.code === 'number' ? body.code : undefined;
  const failing = code !== undefined && code >= 400;

  const message =
    (typeof body.msg === 'string' && body.msg) ||
    (typeof body.message === 'string' && body.message) ||
    (typeof body.error === 'string' && body.error) ||
    (typeof body.error === 'object' && body.error && typeof (body.error as { message?: unknown }).message === 'string'
      ? ((body.error as { message: string }).message)
      : '');

  if (!failing && !message) return null;
  if (!message) return null;

  // 422 from a gateway almost always means "that model id is not one of mine",
  // which is worth saying rather than repeating the bare upstream wording.
  const unsupported = /not supported|unsupported|unknown model|no such model/i.test(message);

  return {
    message: unsupported
      ? `${message} — this endpoint does not serve that model id. Check the exact id the provider accepts; a model appearing in its /models list does not guarantee its chat API will serve it.`
      : message,
    code: unsupported ? 'model_unsupported' : `upstream_${code ?? 'error'}`,
    retryable: code !== undefined && code >= 500,
  };
}
