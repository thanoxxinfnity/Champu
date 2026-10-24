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

/** What a chat is called until somebody says something worth naming it after. */
export const NEW_CHAT_TITLE = 'New chat';

// Words that, on their own, say nothing about a topic: greetings, thanks, "test", acknowledgements, Hinglish included.
const SMALL_WORDS = new Set((
  'hi hii hiii hello hellow helo hey heyy hay yo sup wassup whatsup howdy hola namaste namaskar salaam salam assalamualaikum ' +
  'good morning afternoon evening night gm gn how are you u r doing today there anyone ' +
  'kya haal hal hai ho kaise kese ka kaisa aap tum bhai bro boss dude yar yaar sir mam ' +
  'ok okay k kk fine cool nice thanks thank thx ty welcome yes yeah yep no nope hmm hm ' +
  'test testing check ping are really lol haha what whats up'
).split(/\s+/));

/** A message that is only a greeting, thanks or a "test" — it names nothing, so it must not name the chat either. */
export function isSmallTalk(raw: string): boolean {
  const words = raw.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ').split(/\s+/).filter(Boolean);
  if (!words.length) return true;
  // "hiiii", "heyyy": repeated letters do not make a new word.
  return words.length <= 6 && words.every((w) => SMALL_WORDS.has(w) || SMALL_WORDS.has(w.replace(/(.)\1+/g, '$1')));
}

// Titles a model reaches for when it has nothing to say about the topic: they describe the wording, not the subject.
const GENERIC_TITLE = /^(casual |friendly |simple |basic |quick |brief |general |initial |polite )*(greeting|greetings|hello|hi|hey|chat|conversation|introduction|small talk|chit ?chat|welcome|new chat|new conversation|untitled( run| chat)?|user (greeting|message|query|request)|test( message)?)( (message|exchange|request|query|session|chat))?$/i;

/** True for a title that tells the reader nothing about what the chat is about. */
export function isGenericTitle(title: string): boolean {
  const t = title.trim().replace(/[.!?]+$/, '');
  return !t || GENERIC_TITLE.test(t) || isSmallTalk(t);
}

export function titleFromInput(raw: string): string {
  let s = raw.trim().replace(/\s+/g, ' ');
  if (!s) return 'Untitled run';
  if (isSmallTalk(s)) return NEW_CHAT_TITLE;

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
