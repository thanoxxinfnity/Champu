/**
 * Where the planets are, for any date.
 *
 * The planets are placed from the orbital elements NASA's Jet Propulsion Laboratory
 * publishes for exactly this purpose — "Keplerian Elements for Approximate Positions
 * of the Major Planets" (E. M. Standish, JPL Solar System Dynamics), Table 1, valid
 * 1800 AD – 2050 AD. Six numbers and six rates per planet; solve Kepler's equation,
 * rotate into the ecliptic. No network, so the sky works offline and on a slow phone.
 *
 * "Approximate" is meant literally: JPL quotes errors of arc-minutes for the inner
 * planets and a few arc-minutes more for the outer ones. test-ephemeris.mjs measures
 * this module against JPL Horizons itself, and the site offers the same check live.
 *
 * Units: AU, degrees, Julian centuries since J2000.0. Ecliptic J2000 frame, +X toward
 * the vernal equinox, +Z toward the ecliptic north pole.
 */

const RAD = Math.PI / 180;

/** [value at J2000, rate per Julian century] for a, e, I, L, long.peri, long.node. */
const ELEMENTS = {
  mercury: { a: [0.38709927, 0.00000037], e: [0.20563593, 0.00001906], I: [7.00497902, -0.00594749], L: [252.2503235, 149472.67411175], w: [77.45779628, 0.16047689], O: [48.33076593, -0.12534081] },
  venus: { a: [0.72333566, 0.0000039], e: [0.00677672, -0.00004107], I: [3.39467605, -0.0007889], L: [181.9790995, 58517.81538729], w: [131.60246718, 0.00268329], O: [76.67984255, -0.27769418] },
  earth: { a: [1.00000261, 0.00000562], e: [0.01671123, -0.00004392], I: [-0.00001531, -0.01294668], L: [100.46457166, 35999.37244981], w: [102.93768193, 0.32327364], O: [0.0, 0.0] },
  mars: { a: [1.52371034, 0.00001847], e: [0.0933941, 0.00007882], I: [1.84969142, -0.00813131], L: [-4.55343205, 19140.30268499], w: [-23.94362959, 0.44441088], O: [49.55953891, -0.29257343] },
  jupiter: { a: [5.202887, -0.00011607], e: [0.04838624, -0.00013253], I: [1.30439695, -0.00183714], L: [34.39644051, 3034.74612775], w: [14.72847983, 0.21252668], O: [100.47390909, 0.20469106] },
  saturn: { a: [9.53667594, -0.0012506], e: [0.05386179, -0.00050991], I: [2.48599187, 0.00193609], L: [49.95424423, 1222.49362201], w: [92.59887831, -0.41897216], O: [113.66242448, -0.28867794] },
  uranus: { a: [19.18916464, -0.00196176], e: [0.04725744, -0.00004397], I: [0.77263783, -0.00242939], L: [313.23810451, 428.48202785], w: [170.9542763, 0.40805281], O: [74.01692503, 0.04240589] },
  neptune: { a: [30.06992276, 0.00026291], e: [0.00859048, 0.00005105], I: [1.77004347, 0.00035372], L: [-55.12002969, 218.45945325], w: [44.96476227, -0.32241464], O: [131.78422574, -0.00508664] },
  pluto: { a: [39.48211675, -0.00031596], e: [0.2488273, 0.0000517], I: [17.14001206, 0.00004818], L: [238.92903833, 145.20780515], w: [224.06891629, -0.04062942], O: [110.30393684, -0.01183482] },
};

export const PLANET_IDS = Object.keys(ELEMENTS);

/** Julian Date from a JS Date (UTC). */
export function julianDate(date) {
  return date.getTime() / 86400000 + 2440587.5;
}

/** Julian centuries since J2000.0 (2000-01-01 12:00 TT; TT−UTC is ~69 s, ignored). */
export function centuries(date) {
  return (julianDate(date) - 2451545.0) / 36525;
}

const norm = (deg) => ((deg % 360) + 540) % 360 - 180; // → [-180, 180)

/** Solve Kepler's equation M = E − e·sin E by Newton's method. */
export function solveKepler(M, e) {
  let E = M + e * Math.sin(M) * (1 + e * Math.cos(M));
  for (let i = 0; i < 12; i += 1) {
    const d = (E - e * Math.sin(E) - M) / (1 - e * Math.cos(E));
    E -= d;
    if (Math.abs(d) < 1e-12) break;
  }
  return E;
}

/** The six orbital elements of a planet at time T, in degrees/AU. */
export function elementsAt(id, T) {
  const el = ELEMENTS[id];
  if (!el) throw new Error(`unknown planet: ${id}`);
  const v = (k) => el[k][0] + el[k][1] * T;
  return { a: v('a'), e: v('e'), I: v('I'), L: v('L'), w: v('w'), O: v('O') };
}

/**
 * Heliocentric ecliptic position of a planet, in AU. `T` is Julian centuries since
 * J2000 (use `centuries(date)`).
 */
export function planetPosition(id, T) {
  const { a, e, I, L, w, O } = elementsAt(id, T);
  const omega = (w - O) * RAD; // argument of perihelion
  const M = norm(L - w) * RAD; // mean anomaly
  const E = solveKepler(M, e);
  const xp = a * (Math.cos(E) - e);
  const yp = a * Math.sqrt(1 - e * e) * Math.sin(E);
  const cw = Math.cos(omega), sw = Math.sin(omega);
  const cO = Math.cos(O * RAD), sO = Math.sin(O * RAD);
  const cI = Math.cos(I * RAD), sI = Math.sin(I * RAD);
  return {
    x: (cw * cO - sw * sO * cI) * xp + (-sw * cO - cw * sO * cI) * yp,
    y: (cw * sO + sw * cO * cI) * xp + (-sw * sO + cw * cO * cI) * yp,
    z: sw * sI * xp + cw * sI * yp,
    r: Math.hypot(xp, yp),
  };
}

/** A sampled orbit (closed polyline) for drawing: `n` points over one full revolution. */
export function orbitPath(id, T, n = 256) {
  const { a, e, I, w, O } = elementsAt(id, T);
  const omega = (w - O) * RAD;
  const cw = Math.cos(omega), sw = Math.sin(omega);
  const cO = Math.cos(O * RAD), sO = Math.sin(O * RAD);
  const cI = Math.cos(I * RAD), sI = Math.sin(I * RAD);
  const pts = [];
  for (let i = 0; i <= n; i += 1) {
    const E = (i / n) * 2 * Math.PI;
    const xp = a * (Math.cos(E) - e);
    const yp = a * Math.sqrt(1 - e * e) * Math.sin(E);
    pts.push({
      x: (cw * cO - sw * sO * cI) * xp + (-sw * cO - cw * sO * cI) * yp,
      y: (cw * sO + sw * cO * cI) * xp + (-sw * sO + cw * cO * cI) * yp,
      z: sw * sI * xp + cw * sI * yp,
    });
  }
  return pts;
}

/**
 * The Moon, geocentric ecliptic, from the principal terms of the lunar theory
 * (Meeus, "Astronomical Algorithms", ch. 47, abridged). Good to a fraction of a
 * degree — plenty to put it on the right side of the Earth with the right phase.
 * Distance in kilometres.
 */
export function moonPosition(T) {
  const d = (deg) => deg * RAD;
  const Lp = 218.3164477 + 481267.88123421 * T; // mean longitude
  const D = 297.8501921 + 445267.1114034 * T; // mean elongation
  const M = 357.5291092 + 35999.0502909 * T; // sun mean anomaly
  const Mp = 134.9633964 + 477198.8675055 * T; // moon mean anomaly
  const F = 93.272095 + 483202.0175233 * T; // argument of latitude
  const lon =
    Lp + 6.288774 * Math.sin(d(Mp)) + 1.274027 * Math.sin(d(2 * D - Mp)) + 0.658314 * Math.sin(d(2 * D)) +
    0.213618 * Math.sin(d(2 * Mp)) - 0.185116 * Math.sin(d(M)) - 0.114332 * Math.sin(d(2 * F)) +
    0.058793 * Math.sin(d(2 * D - 2 * Mp)) + 0.057066 * Math.sin(d(2 * D - M - Mp)) + 0.053322 * Math.sin(d(2 * D + Mp)) +
    0.045758 * Math.sin(d(2 * D - M)) - 0.040923 * Math.sin(d(M - Mp)) - 0.034720 * Math.sin(d(D)) -
    0.030383 * Math.sin(d(M + Mp));
  const lat =
    5.128122 * Math.sin(d(F)) + 0.280602 * Math.sin(d(Mp + F)) + 0.277693 * Math.sin(d(Mp - F)) +
    0.173237 * Math.sin(d(2 * D - F)) + 0.055413 * Math.sin(d(2 * D - Mp + F)) + 0.046271 * Math.sin(d(2 * D - Mp - F)) +
    0.032573 * Math.sin(d(2 * D + F));
  const dist =
    385000.56 - 20905.355 * Math.cos(d(Mp)) - 3699.111 * Math.cos(d(2 * D - Mp)) - 2955.968 * Math.cos(d(2 * D)) -
    569.925 * Math.cos(d(2 * Mp)) + 48.888 * Math.cos(d(M)) - 3.149 * Math.cos(d(2 * F)) + 246.158 * Math.cos(d(2 * D - 2 * Mp)) -
    152.138 * Math.cos(d(2 * D - M - Mp)) - 170.733 * Math.cos(d(2 * D + Mp)) - 204.586 * Math.cos(d(2 * D - M)) -
    129.620 * Math.cos(d(M - Mp)) + 108.743 * Math.cos(d(D)) + 104.755 * Math.cos(d(M + Mp));
  const lonR = d(lon), latR = d(lat);
  return {
    x: dist * Math.cos(latR) * Math.cos(lonR),
    y: dist * Math.cos(latR) * Math.sin(lonR),
    z: dist * Math.sin(latR),
    lonDeg: ((lon % 360) + 360) % 360,
    distKm: dist,
  };
}

/** Moon phase as the Sun–Moon elongation, 0 = new, 0.5 = full (fraction of a lunation). */
export function moonPhase(date) {
  const T = centuries(date);
  const sun = planetPosition('earth', T); // Earth's heliocentric longitude + 180° = Sun's geocentric longitude
  const sunLon = (Math.atan2(-sun.y, -sun.x) / RAD + 360) % 360;
  const m = moonPosition(T);
  return (((m.lonDeg - sunLon) % 360 + 360) % 360) / 360;
}

/** Light travel time in minutes for a distance in AU. */
export const lightMinutes = (au) => (au * 149597870.7) / 299792.458 / 60;

export const AU_KM = 149597870.7;
