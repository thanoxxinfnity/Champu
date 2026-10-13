/**
 * A short, descriptive session title from the user's raw first message — pure text cleanup, no
 * extra model call (titling every new session with an LLM would burn a request per chat for no
 * real benefit). Kept dependency-free so it can be unit tested directly.
 */

// Leading filler stripped before titling — politeness and "do this" framing that carries no
// information about what the session is actually about. Checked repeatedly against the start of
// the input, since people stack several of these in one message ("bro please can you build me a...").
const LEADING_FILLER = [
  /^(hey|hi|yo|ok|okay|so|arey|bhai|bro|boss|dude)[,.!\s]+/i,
  /^(please|plz|pls|kindly)[,.!\s]+/i,
  /^(can|could|would) you (please )?/i,
  /^i (want|need|would like) (you )?to /i,
  /^i want /i,
  /^(let'?s|lets) /i,
  /^(build|make|create|generate|design) me (a|an|the) /i,
  /^(build|make|create|generate|design) (a|an|the) /i,
  /^(now |abhi )/i,
];
// Trailing filler ("...please", "...na bro yar") stripped from the end the same way.
const TRAILING_FILLER = /[,.!\s]+(please yar|please na|please|plz|pls|na|yar|bro)\.?$/i;

export function titleFromInput(raw: string): string {
  let s = raw.trim().replace(/\s+/g, ' ');
  if (!s) return 'Untitled run';

  for (let i = 0; i < 4; i++) {
    const before = s;
    for (const re of LEADING_FILLER) s = s.replace(re, '');
    s = s.trimStart();
    if (s === before) break;
  }
  for (let i = 0; i < 4; i++) {
    const before = s;
    s = s.replace(TRAILING_FILLER, '').trim();
    if (s === before) break;
  }
  if (!s) s = raw.trim();

  // Prefer the first full sentence if it is a reasonable title length on its own.
  const sentenceEnd = s.search(/[.!?\n]/);
  if (sentenceEnd > 3 && sentenceEnd <= 90) s = s.slice(0, sentenceEnd);

  if (s.length > 72) {
    const cut = s.slice(0, 72);
    const lastSpace = cut.lastIndexOf(' ');
    s = (lastSpace > 20 ? cut.slice(0, lastSpace) : cut).trim();
  }

  s = s.charAt(0).toUpperCase() + s.slice(1);
  return s || 'Untitled run';
}
