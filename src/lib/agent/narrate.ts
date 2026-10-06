import { redact, scanForSecrets } from '../security/secrets.ts';

/**
 * What the thinking bubble says, and why it is never made up.
 *
 * The bubble used to rotate through a shuffled pool of flavour lines — "Verifying terminal
 * heartbeat…", "Discarding the clever one…" — whatever was actually happening. It read as
 * theatre and sometimes as a lie. It now only ever says the stage the run is really in, and
 * when nothing more specific is known it says so plainly ("Thinking…") and lets the elapsed
 * timer show that time is passing.
 */

/** Opening line, before anything has come back from the model. */
export const openingPhrase = (lane: 'A' | 'B'): string => (lane === 'B' ? 'Reading your request…' : 'Thinking…');

const MAX_PATH = 44;
const shortPath = (p: string) => (p.length > MAX_PATH ? `…${p.slice(-(MAX_PATH - 1))}` : p);

/**
 * The stage a half-written reply is in. Looks at the end of what has streamed so far:
 * an open fenced block with a `path=` means that file is being written right now.
 */
export function streamingPhrase(full: string, lane: 'A' | 'B'): string {
  if (lane === 'B') {
    // Fences alternate open, close, open, close… so an odd count means the last one is still open.
    // One pass over the text, and only the last fence's own line is looked at.
    let count = 0, last = -1;
    for (let i = full.indexOf('```'); i >= 0; i = full.indexOf('```', i + 3)) { count += 1; last = i; }
    if (count % 2 === 1) {
      const eol = full.indexOf('\n', last);
      if (eol > 0) {
        const path = /\bpath=([^\s`]+)/.exec(full.slice(last, eol))?.[1];
        if (path) return `Writing ${shortPath(path)}…`;
      }
    }
  }
  return 'Writing the answer…';
}

/**
 * A plain-words description of a terminal command, for the bubble. Secrets are taken out
 * first — a deploy command may carry a token, and the bubble is on screen.
 */
export function describeCommand(command: string): string {
  const clean = redact(command, scanForSecrets(command)).replace(/--token[= ]\S+/gi, '--token [REDACTED]');
  // Judge by what is being *run*, not by words that merely appear: `cat vercel.json` reads a file, it does not deploy.
  // Each piece of `a && b | c` is looked at from its own first word, past sudo / npx / env assignments.
  for (const piece of clean.toLowerCase().split(/&&|\|\||;|\|/)) {
    const words = piece.trim().split(/\s+/).filter((w) => !/^(sudo|time|npx|env|exec|\w+=\S*)$/.test(w));
    const [tool, ...args] = words;
    const rest = args.join(' ');
    if (tool === 'vercel') return 'Deploying to Vercel…';
    if (tool === 'gradle' || tool === './gradlew' || tool === 'gradlew') return /assemble|bundle|build/.test(rest) ? 'Building the Android app…' : 'Running Gradle…';
    if (tool === 'godot' || tool?.endsWith('/godot')) return /--export/.test(rest) ? 'Exporting the Godot project…' : 'Running Godot…';
    if (/^(npm|pnpm|yarn)$/.test(tool ?? '') && /^(i|install|ci|add)\b/.test(rest)) return 'Installing packages…';
    if (/^(npm|pnpm|yarn)$/.test(tool ?? '') && /^(run\s+)?build\b/.test(rest)) return 'Building the site…';
    if (tool === 'next' && /^build\b/.test(rest)) return 'Building the site…';
    if (tool === 'git' && /^(push|pull|clone)\b/.test(rest)) return 'Syncing with git…';
    if (tool === 'zip' || tool === 'tar') return 'Packaging the files…';
    if (tool === 'unzip') return 'Unpacking the archive…';
    if (tool === 'curl' || tool === 'wget' || tool === 'gdown') {
      const host = /https?:\/\/([^/\s'"]+)/.exec(clean)?.[1];
      return host ? `Downloading from ${host}…` : 'Downloading…';
    }
    if (/^(apt|apt-get|brew|pip3?|dnf|pacman)$/.test(tool ?? '') && /\binstall\b/.test(rest)) return 'Installing packages…';
  }
  const one = clean.replace(/\s+/g, ' ').trim();
  return `Running ${one.length > 48 ? `${one.slice(0, 47)}…` : one}…`;
}
