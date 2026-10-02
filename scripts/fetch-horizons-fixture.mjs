/**
 * Records JPL Horizons' own numbers for a handful of dates, so test-ephemeris.mjs
 * can check our orbital-elements maths against NASA's without a network.
 *
 *   node scripts/fetch-horizons-fixture.mjs
 *
 * Horizons is queried for heliocentric (Sun-centred) vectors in the ecliptic frame
 * of J2000 — the same frame site/js/ephemeris.js works in — and for the Moon
 * relative to the Earth. The result is written to scripts/fixtures/horizons.json.
 */
import { writeFileSync } from 'node:fs';

const BODIES = { mercury: '199', venus: '299', earth: '399', mars: '499', jupiter: '599', saturn: '699', uranus: '799', neptune: '899', pluto: '999' };
const DATES = ['1950-06-01 00:00', '2000-01-01 12:00', '2026-10-02 00:00', '2040-03-20 00:00'];

async function vector(command, center, when) {
  const stop = new Date(Date.parse(when.replace(' ', 'T') + ':00Z') + 3600_000).toISOString().slice(0, 16).replace('T', ' ');
  const q = new URLSearchParams({
    format: 'json', COMMAND: `'${command}'`, OBJ_DATA: "'NO'", MAKE_EPHEM: "'YES'", EPHEM_TYPE: "'VECTORS'",
    CENTER: `'${center}'`, REF_PLANE: "'ECLIPTIC'", REF_SYSTEM: "'ICRF'", START_TIME: `'${when}'`, STOP_TIME: `'${stop}'`,
    STEP_SIZE: "'1h'", VEC_TABLE: "'1'", OUT_UNITS: "'AU-D'", CSV_FORMAT: "'YES'",
  });
  const res = await fetch(`https://ssd.jpl.nasa.gov/api/horizons.api?${q}`, { signal: AbortSignal.timeout(60_000) });
  const json = await res.json();
  const block = /\$\$SOE\s*([\s\S]*?)\s*\$\$EOE/.exec(json.result ?? '');
  if (!block) throw new Error(`no data for ${command} @ ${when}: ${(json.result ?? '').slice(0, 200)}`);
  const f = block[1].split('\n')[0].split(',').map((s) => s.trim());
  return { x: Number(f[2]), y: Number(f[3]), z: Number(f[4]) };
}

const out = { source: 'NASA/JPL Horizons API', frame: 'ecliptic J2000, heliocentric (Moon: geocentric, AU)', fetched: new Date().toISOString(), samples: [] };
for (const when of DATES) {
  const sample = { when: when.replace(' ', 'T') + ':00Z', planets: {} };
  for (const [name, id] of Object.entries(BODIES)) sample.planets[name] = await vector(id, '500@10', when);
  sample.moon = await vector('301', '500@399', when);
  out.samples.push(sample);
  console.log('got', when);
}
writeFileSync(new URL('./fixtures/horizons.json', import.meta.url), JSON.stringify(out, null, 1) + '\n');
console.log('wrote scripts/fixtures/horizons.json');
