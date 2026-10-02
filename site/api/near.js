/**
 * The visitor's rough area, for the "near me" switch in Ask Chomu agent — nothing finer than city,
 * region and country, taken from the hosting platform's own geo headers. Asked for only when the
 * visitor turns the switch on; never stored.
 */
import { placeFrom } from '../js/agent-core.js';

export const config = { runtime: 'nodejs' };

const SITE = /^https:\/\/chomugiri\.vercel\.app$|^http:\/\/localhost(:\d+)?$/;

export default function handler(request, response) {
  response.setHeader('Cache-Control', 'no-store');
  const origin = String(request.headers.origin ?? request.headers.referer ?? '');
  const ok = SITE.test(origin.replace(/(https?:\/\/[^/]+).*/, '$1')) || (process.env.VERCEL_URL && origin.startsWith(`https://${process.env.VERCEL_URL}`));
  if (request.method !== 'GET' || !ok) {
    response.status(403).json({ error: 'Not from here.' });
    return;
  }
  response.status(200).json({ place: placeFrom(request.headers) });
}
