/**
 * The pure half of /api/nasa: what may be asked, and how NASA's answers are
 * trimmed. Kept free of `fetch` and of the key so it can be tested in Node.
 *
 * The leading underscore matters: Vercel does not turn `api/_*.js` into a route.
 */

/** Horizons bodies the page may ask about — the planets, Pluto, and the Moon. */
export const HORIZONS_BODIES = {
  mercury: '199', venus: '299', earth: '399', mars: '499', jupiter: '599', saturn: '699', uranus: '799', neptune: '899', pluto: '999', moon: '301',
};

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const LUNAR_KM = 384400;

/** `YYYY-MM-DD` for a Date, UTC. */
export const isoDay = (d) => d.toISOString().slice(0, 10);

/**
 * Turns a request's query into exactly one upstream call, or says why not.
 * Nothing here ever builds a URL from a caller-supplied string: the host, the path
 * and every parameter name are fixed, and the few values a caller does choose are
 * matched against an allow-list or a strict pattern first.
 */
export function plan(query, now = new Date()) {
  const kind = String(query.kind ?? '');
  switch (kind) {
    case 'apod':
      return { kind, upstream: { base: 'https://api.nasa.gov/planetary/apod', params: {}, key: true } };
    case 'neo': {
      const start = isoDay(now);
      const end = isoDay(new Date(now.getTime() + 6 * 86400_000));
      return { kind, upstream: { base: 'https://api.nasa.gov/neo/rest/v1/feed', params: { start_date: start, end_date: end }, key: true } };
    }
    case 'epic':
      return { kind, upstream: { base: 'https://api.nasa.gov/EPIC/api/natural', params: {}, key: true } };
    case 'horizons': {
      const id = HORIZONS_BODIES[String(query.body ?? '')];
      if (!id) return { error: 'Unknown body.' };
      const date = String(query.date ?? '');
      if (!DATE.test(date) || Number.isNaN(Date.parse(`${date}T00:00:00Z`))) return { error: 'date must be YYYY-MM-DD.' };
      const year = Number(date.slice(0, 4));
      if (year < 1800 || year > 2100) return { error: 'date out of range (1800-2100).' };
      const stop = isoDay(new Date(Date.parse(`${date}T00:00:00Z`) + 86400_000));
      return {
        kind,
        body: String(query.body),
        upstream: {
          base: 'https://ssd.jpl.nasa.gov/api/horizons.api',
          key: false,
          params: {
            format: 'json', COMMAND: `'${id}'`, OBJ_DATA: "'NO'", MAKE_EPHEM: "'YES'", EPHEM_TYPE: "'VECTORS'",
            CENTER: query.body === 'moon' ? "'500@399'" : "'500@10'", REF_PLANE: "'ECLIPTIC'", REF_SYSTEM: "'ICRF'",
            START_TIME: `'${date}'`, STOP_TIME: `'${stop}'`, STEP_SIZE: "'1d'", VEC_TABLE: "'1'", OUT_UNITS: "'AU-D'", CSV_FORMAT: "'YES'",
          },
        },
      };
    }
    default:
      return { error: 'kind must be one of: apod, neo, epic, horizons.' };
  }
}

/** The upstream URL, with the key added last and only for the hosts that take one. */
export function upstreamUrl(upstream, apiKey) {
  const url = new URL(upstream.base);
  for (const [k, v] of Object.entries(upstream.params)) url.searchParams.set(k, v);
  if (upstream.key) url.searchParams.set('api_key', apiKey);
  return url;
}

/** NeoWs feed → a flat, small list of close approaches, soonest first. */
export function trimNeo(json) {
  const out = [];
  for (const [day, list] of Object.entries(json?.near_earth_objects ?? {})) {
    for (const o of list) {
      const ca = o.close_approach_data?.[0];
      if (!ca) continue;
      const missKm = Number(ca.miss_distance?.kilometers);
      out.push({
        id: String(o.id),
        name: String(o.name).replace(/[()]/g, '').trim(),
        day,
        when: ca.close_approach_date_full ?? day,
        missKm,
        missLunar: missKm / LUNAR_KM,
        speedKms: Number(ca.relative_velocity?.kilometers_per_second),
        diameterM: [Math.round(o.estimated_diameter?.meters?.estimated_diameter_min ?? 0), Math.round(o.estimated_diameter?.meters?.estimated_diameter_max ?? 0)],
        hazardous: Boolean(o.is_potentially_hazardous_asteroid),
        magnitude: o.absolute_magnitude_h ?? null,
        url: typeof o.nasa_jpl_url === 'string' && o.nasa_jpl_url.startsWith('http') ? o.nasa_jpl_url : null,
      });
    }
  }
  return out.filter((o) => Number.isFinite(o.missKm)).sort((a, b) => (a.when < b.when ? -1 : a.when > b.when ? 1 : a.missKm - b.missKm));
}

/** EPIC natural-colour list → the latest few frames with their archive image URLs. */
export function trimEpic(json, count = 4) {
  if (!Array.isArray(json)) return [];
  return json.slice(-count).reverse().flatMap((f) => {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(f.date ?? ''));
    if (!m || typeof f.image !== 'string' || !/^[A-Za-z0-9_]+$/.test(f.image)) return [];
    return [{
      date: String(f.date),
      caption: String(f.caption ?? ''),
      lat: f.centroid_coordinates?.lat ?? null,
      lon: f.centroid_coordinates?.lon ?? null,
      image: `https://epic.gsfc.nasa.gov/archive/natural/${m[1]}/${m[2]}/${m[3]}/jpg/${f.image}.jpg`,
    }];
  });
}

/** APOD → only the fields the card shows. Video days carry a thumbnail or nothing. */
export function trimApod(json) {
  if (!json || typeof json !== 'object' || !json.title) return null;
  const media = json.media_type === 'image' ? 'image' : 'video';
  return {
    date: String(json.date ?? ''),
    title: String(json.title),
    explanation: String(json.explanation ?? ''),
    media,
    url: media === 'image' ? String(json.url ?? '') : null,
    hdurl: media === 'image' && json.hdurl ? String(json.hdurl) : null,
    thumb: media === 'video' && json.thumbnail_url ? String(json.thumbnail_url) : null,
    link: media === 'video' ? String(json.url ?? '') : null,
    copyright: json.copyright ? String(json.copyright).replace(/\s+/g, ' ').trim() : null,
  };
}

/**
 * NASA's APOD API sometimes answers with the real text but a stand-in picture: the NASA
 * logo from its website header (a thin banner), titled "NASA Science". On 2 Oct 2026 it did
 * that for every date. A card showing that is worse than no card, so it is rejected.
 */
export function isPlaceholderApod(json) {
  const url = String(json?.url ?? '') + String(json?.hdurl ?? '');
  return !json?.title || json.title === 'NASA Science' || /nasa-logo|\/wp-content\/themes\//i.test(url);
}

/** The newest APOD article link on science.nasa.gov/apod/ — the first one listed. */
export function parseApodIndex(html) {
  const m = /https:\/\/science\.nasa\.gov\/image-article\/apod-[a-z0-9-]+\//.exec(String(html));
  return m ? m[0] : null;
}

/** Only article pages of this exact shape are ever fetched. */
export const APOD_ARTICLE = /^https:\/\/science\.nasa\.gov\/image-article\/apod-[a-z0-9-]+\/$/;
const APOD_IMAGE_HOST = 'https://assets.science.nasa.gov/';
const decode = (t) => String(t).replace(/&amp;/g, '&').replace(/&#0?39;|&#8217;/g, '’').replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#038;/g, '&');
const meta = (html, prop) => {
  const m = new RegExp(`<meta[^>]+property="${prop}"[^>]+content="([^"]*)"`, 'i').exec(html);
  return m ? decode(m[1]) : null;
};

/** An APOD article page → the same small shape trimApod gives. */
export function parseApodArticle(html, link) {
  const ogTitle = meta(html, 'og:title');
  const image = meta(html, 'og:image');
  if (!ogTitle || !image || !image.startsWith(APOD_IMAGE_HOST) || !APOD_ARTICLE.test(link)) return null;
  const dm = /apod-(\d{4})-([a-z]+)-(\d{1,2})-/.exec(link);
  const months = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
  const mi = dm ? months.indexOf(dm[2]) : -1;
  const date = dm && mi >= 0 ? `${dm[1]}-${String(mi + 1).padStart(2, '0')}-${dm[3].padStart(2, '0')}` : '';
  const title = ogTitle.replace(/^APOD:\s*\d{4}\s+\w+\s+\d{1,2}\s*-\s*/, '').replace(/\s*-\s*NASA Science$/, '');
  const ex = /<strong>\s*Explanation:\s*<\/strong>([\s\S]*?)<\/p>/i.exec(html);
  const explanation = ex ? decode(ex[1].replace(/<[^>]+>/g, '')).replace(/\s+/g, ' ').trim() : (meta(html, 'og:description') ?? '');
  return { date, title, explanation, media: 'image', url: image, hdurl: null, thumb: null, link, copyright: null };
}

/** The first vector row of a Horizons `VECTORS` CSV answer, in AU. */
export function parseHorizons(json) {
  const m = /\$\$SOE\s*([\s\S]*?)\s*\$\$EOE/.exec(String(json?.result ?? ''));
  if (!m) return null;
  const f = m[1].split('\n')[0].split(',').map((s) => s.trim());
  const [x, y, z] = [Number(f[2]), Number(f[3]), Number(f[4])];
  return [x, y, z].every(Number.isFinite) ? { x, y, z } : null;
}

/** Cache lifetimes, in seconds, for the CDN in front of the function. */
export const CACHE = { apod: 3600, neo: 1800, epic: 3600, horizons: 86400 };
