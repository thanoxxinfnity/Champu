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
    const opens = [...full.matchAll(/```[^\n]*?\bpath=([^\s`]+)[^\n]*\n/g)];
    const last = opens[opens.length - 1];
    if (last) {
      const after = full.slice((last.index ?? 0) + last[0].length);
      if (!after.includes('```')) return `Writing ${shortPath(last[1])}…`;
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
  const c = clean.toLowerCase();
  if (/\bvercel\b/.test(c)) return 'Deploying to Vercel…';
  if (/\bgradlew?\b/.test(c)) return /assemble|bundle|build/.test(c) ? 'Building the Android app…' : 'Running Gradle…';
  if (/\bgodot\b/.test(c)) return /--export/.test(c) ? 'Exporting the Godot project…' : 'Running Godot…';
  if (/\b(npm|pnpm|yarn)\s+(i|install|ci|add)\b/.test(c)) return 'Installing packages…';
  if (/\b(npm|pnpm|yarn)\s+(run\s+)?build\b|\bnext build\b/.test(c)) return 'Building the site…';
  if (/\bgit\s+(push|pull|clone)\b/.test(c)) return 'Syncing with git…';
  if (/\b(zip|tar)\b/.test(c)) return 'Packaging the files…';
  const one = clean.replace(/\s+/g, ' ').trim();
  return `Running ${one.length > 48 ? `${one.slice(0, 47)}…` : one}…`;
}
