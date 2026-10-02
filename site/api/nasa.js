/**
 * NASA data for the solar-system page, behind our own door.
 *
 *   /api/nasa?kind=apod                       Astronomy Picture of the Day
 *   /api/nasa?kind=neo                        near-Earth asteroids, next 7 days
 *   /api/nasa?kind=epic                       latest full-disc photos of Earth
 *   /api/nasa?kind=horizons&body=mars&date=…  JPL Horizons vector, to check our maths
 *
 * Why a function and not a call from the page: api.nasa.gov wants a key, and a key
 * written into a page is a key handed to everybody who opens it. Here it is read from
 * the deployment's environment (NASA_API_KEY) at request time, added to the upstream
 * URL, and never put in a response, a header, a log line or an error message.
 *
 * It is a narrow door on purpose. The caller picks one of four kinds; the host, path
 * and parameter names are fixed in _nasa-lib.js; the few values a caller supplies are
 * matched against an allow-list or a strict pattern. It cannot be made to fetch an
 * arbitrary URL or to forward arbitrary parameters.
 *
 * The CDN does most of the work: answers are cached (see CACHE), so a page that is
 * opened a thousand times asks NASA a handful of times. NASA's APOD service answers 500
 * from time to time; the last good copy is served for as long as the CDN keeps it
 * (stale-while-revalidate / stale-if-error) and, failing that, a plain error.
 */
import { APOD_ARTICLE, CACHE, isPlaceholderApod, parseApodArticle, parseApodIndex, parseHorizons, plan, trimApod, trimEpic, trimNeo, upstreamUrl } from './_nasa-lib.js';

export const config = { runtime: 'nodejs' };

/** Best-effort per-instance throttle. The CDN cache is the real limiter. */
const hits = new Map();
function throttled(ip) {
  const now = Date.now();
  const recent = (hits.get(ip) ?? []).filter((t) => now - t < 60_000);
  recent.push(now);
  hits.set(ip, recent);
  if (hits.size > 500) hits.clear();
  return recent.length > 60;
}

const HEADERS = { Accept: 'application/json', 'User-Agent': 'chomugiri-site/1.0 (+https://chomugiri.vercel.app)' };
const page = async (url) => {
  const r = await fetch(url, { headers: { ...HEADERS, Accept: 'text/html' }, signal: AbortSignal.timeout(12_000) });
  if (!r.ok) throw new Error(String(r.status));
  return r.text();
};

/**
 * Picture of the day. The API is tried twice (it answers 500 now and then); a stand-in
 * picture is rejected; and then the real APOD page on science.nasa.gov is read instead.
 */
async function apod(url) {
  for (let i = 0; i < 2; i += 1) {
    try {
      const r = await fetch(url, { headers: HEADERS, signal: AbortSignal.timeout(10_000) });
      if (r.ok) {
        const json = await r.json();
        if (!isPlaceholderApod(json)) return trimApod(json);
        break; // a placeholder is not going to get better on a retry
      }
    } catch { /* try again, then the page */ }
    await new Promise((res) => setTimeout(res, 500));
  }
  try {
    const link = parseApodIndex(await page('https://science.nasa.gov/apod/'));
    if (link && APOD_ARTICLE.test(link)) return parseApodArticle(await page(link), link);
  } catch { /* nothing left to try */ }
  return null;
}

/** The last good answer per cache key, for the moments NASA is down. */
const lastGood = new Map();

export default async function handler(request, response) {
  if (request.method !== 'GET') {
    response.status(405).json({ error: 'GET only.' });
    return;
  }

  const ip = String(request.headers['x-forwarded-for'] ?? '').split(',')[0].trim() || 'unknown';
  if (throttled(ip)) {
    response.status(429).json({ error: 'Slow down a little.' });
    return;
  }

  const chosen = plan(request.query ?? {});
  if (chosen.error) {
    response.status(400).json({ error: chosen.error });
    return;
  }

  // DEMO_KEY works for a handful of calls an hour; the real key is what makes this usable.
  const apiKey = process.env.NASA_API_KEY || 'DEMO_KEY';
  const url = upstreamUrl(chosen.upstream, apiKey);
  const cacheKey = `${chosen.kind}:${chosen.body ?? ''}:${url.searchParams.get('date') ?? url.searchParams.get('START_TIME') ?? ''}`;

  let data = null;
  let status = 200;
  try {
    if (chosen.kind === 'apod') {
      data = await apod(url);
    } else {
      const upstream = await fetch(url, { headers: HEADERS, signal: AbortSignal.timeout(15_000) });
      status = upstream.status;
      if (!upstream.ok) throw new Error(String(status));
      const json = await upstream.json();
      if (chosen.kind === 'neo') data = { asOf: new Date().toISOString(), objects: trimNeo(json) };
      else if (chosen.kind === 'epic') data = { frames: trimEpic(json) };
      else data = parseHorizons(json);
    }
  } catch {
    if (status === 200) status = 504;
  }
  if (!data && status === 200) status = 504; // nothing usable came back, and nothing threw

  if (data && (!Array.isArray(data) || data.length)) {
    if (lastGood.size >= 200) lastGood.delete(lastGood.keys().next().value);
    lastGood.set(cacheKey, data);
    response.setHeader('Cache-Control', `public, s-maxage=${CACHE[chosen.kind]}, stale-while-revalidate=86400, stale-if-error=604800`);
    response.status(200).json({ source: 'NASA', kind: chosen.kind, data });
    return;
  }

  const stale = lastGood.get(cacheKey);
  if (stale) {
    response.setHeader('Cache-Control', 'public, s-maxage=60, stale-while-revalidate=3600');
    response.status(200).json({ source: 'NASA', kind: chosen.kind, data: stale, stale: true });
    return;
  }

  // Never echo anything from the upstream, and never the URL (it carries the key).
  response.setHeader('Cache-Control', 'no-store');
  response.status(502).json({ error: `NASA's ${chosen.kind} service did not answer (${status}).`, kind: chosen.kind });
}
