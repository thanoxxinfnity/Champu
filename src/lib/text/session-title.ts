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

// Words that carry no topic in English or Hinglish requests ("ek simple todo app bana do html me").
const STOP = new Set((
  'a an the and or of for to in on at with by from about into as is are be it this that these those my me mine your our ' +
  'i we you can could would should will please plz pls kindly want need like make build create generate design write give show tell ' +
  'help fix add do does did done just now also some any one new using use via ' +
  'ek ko ka ki ke me mein main mai hai ha h hain ho tha thi the aur bhi bhe jo jab tab na tho to toh yar yaar bro bhai please ' +
  'bana banao banado bana do de dena dedo kar karo kardo karna karke kya kaise kese mujhe mere mera meri humko hum tum aap ' +
  'liye wala wali wale jaisa jasa jesa jaise chahiye chahie sab sabhi accha acha achha thoda bahut jaldi abhi isko usko iska uska ' +
  'raha rahi rahe raha rha rhi pe par se tak hota hoti hote hua hui hue gaya gayi gaye nahi nahin nhi kyu kyun kuch koi woh wo yeh ye is us isme usme'
).split(/\s+/));
const KEEP_UPPER = new Set(['html', 'css', 'js', 'ts', 'api', 'apk', 'ui', 'ux', 'ai', 'pdf', 'sql', 'json', 'csv', 'url', 'seo', 'rpg', 'fps', 'jjk', 'gpu', 'cpu', 'ios', '2d', '3d', 'mcp', 'llm']);

/**
 * A topic title from the user's words alone ("ek simple todo app bana do html me" → "Simple Todo App HTML"): filler and
 * Hinglish request words dropped, the first few content words kept in Title Case. Used when no model may name the chat.
 */
export function topicTitle(raw: string): string {
  if (isSmallTalk(raw)) return NEW_CHAT_TITLE;
  const words = raw
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/https?:\/\/\S+/g, ' ')
    .split(/[^\p{L}\p{N}+#.-]+/u)
    .map((w) => w.replace(/^[.-]+|[.-]+$/g, ''))
    .filter((w) => w && !STOP.has(w.toLowerCase()) && !/^\d+$/.test(w));
  const seen = new Set<string>();
  const picked: string[] = [];
  for (const w of words) {
    const k = w.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    picked.push(KEEP_UPPER.has(k) ? k.toUpperCase() : w.length > 1 && w === w.toUpperCase() ? w : k.charAt(0).toUpperCase() + k.slice(1));
    if (picked.length >= 5) break;
  }
  const t = picked.join(' ').slice(0, 60).trim();
  return t && !isGenericTitle(t) ? t : titleFromInput(raw);
}
