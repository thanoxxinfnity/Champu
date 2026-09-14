/**
 * A request that never reached the API.
 *
 * A 403 has two completely different meanings and we were reporting both as
 * one: "your key is wrong" and "a security service in front of this endpoint
 * refused the connection". The second is far more common on hosted gateways —
 * Cloudflare, Akamai, AWS WAF — and telling that user to check their API key
 * sends them looking in the one place the problem is not.
 *
 * The tell is the body: an API answers JSON, a WAF answers an HTML block page.
 *
 * Pure — no network — so the detection is testable on its own.
 */

export interface BlockedInfo {
  /** The service that refused, when it names itself. */
  service: string;
  /** The support reference the block page prints, if any. */
  reference?: string;
  message: string;
}

const HTML_START = /^\s*(<!doctype html|<html[\s>])/i;

/**
 * Whether this response is a block page rather than an API error.
 *
 * Conservative: it must be an HTML body on a refusing status. A JSON error is
 * always treated as the API speaking for itself, however it is worded.
 */
export function wafBlock(status: number, headers: Headers | Record<string, string>, body: string): BlockedInfo | null {
  if (status !== 403 && status !== 401 && status !== 503 && status !== 429) return null;

  const get = (name: string): string => {
    if (typeof (headers as Headers).get === 'function') return (headers as Headers).get(name) ?? '';
    const map = headers as Record<string, string>;
    const key = Object.keys(map).find((k) => k.toLowerCase() === name);
    return key ? map[key] : '';
  };

  const contentType = get('content-type').toLowerCase();
  const looksHtml = contentType.includes('text/html') || HTML_START.test(body);
  if (!looksHtml) return null;

  // Optional markup between the label and the id, but nothing greedy — a
  // wildcard here eats the first half of the id and reports the rest.
  const rayId = get('cf-ray') || /Cloudflare Ray ID:\s*(?:<[^>]*>\s*)*([0-9a-f]{8,})/i.exec(body)?.[1];
  const server = get('server').toLowerCase();

  const service =
    server.includes('cloudflare') || /cloudflare/i.test(body)
      ? 'Cloudflare'
      : server.includes('akamai') || /akamai/i.test(body)
        ? 'Akamai'
        : /aws|awselb/i.test(server) || /request blocked/i.test(body)
          ? 'AWS WAF'
          : server || 'a security service';

  const reference = rayId || /(?:Request ID|Reference #|Error Id)[:\s]*([\w-]{6,})/i.exec(body)?.[1];

  return {
    service,
    reference,
    message:
      `Blocked by ${service} before the request reached the API (${status}). This is not your API key — ` +
      `the endpoint's own protection refused the connection.` +
      (reference ? ` Reference: ${reference}.` : '') +
      ` Some providers block anything that is not a desktop browser; if this keeps happening, send that reference to the endpoint's support and ask them to allow API clients.`,
  };
}

/** How Chomugiri identifies itself to an upstream. */
export const USER_AGENT = 'Chomugiri/2.8 (+https://github.com/thanoxxinfnity/Champu)';
