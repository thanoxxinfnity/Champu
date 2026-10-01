import { extractArtifacts, splitAtOpenBlock } from './artifacts.ts';

/**
 * Finishing a build that ran out of output tokens.
 *
 * A whole game is more text than one reply is allowed to be, and a reasoning
 * model spends part of the same allowance thinking. The provider says so with a
 * finish reason, which used to be ignored: the last file was cut off mid-line,
 * saved as if it were whole, and the project failed to run with nothing saying
 * why. This turns the cut into a continuation instead.
 */

/** Every provider's spelling of "stopped because the output limit was reached". */
export function isTruncated(finishReason?: string): boolean {
  if (!finishReason) return false;
  return /^(length|max[_-]?tokens|max[_-]?output[_-]?tokens)$/i.test(finishReason.trim());
}

export const MAX_CONTINUATIONS = 4;

export interface ContinuationPlan {
  /** The reply so far with the unfinished block removed. */
  kept: string;
  /** The message that asks the model to pick up from there. */
  prompt: string;
  openPath?: string;
}

/**
 * Plans the next pass, or returns null when continuing cannot help — the
 * reply was cut off in prose, or before a single block finished, so there is
 * nothing to build on and another pass would only start over.
 */
export function planContinuation(content: string): ContinuationPlan | null {
  const split = splitAtOpenBlock(content);
  if (!split || !split.complete.trim()) return null;

  const restart = split.openPath
    ? `Your last reply was cut off in the middle of \`${split.openPath}\`. Write that file again in full from its first line, then every file that still remains.`
    : 'Your last reply was cut off in the middle of a block. Write that block again in full from its first line, then everything that still remains.';

  return {
    kept: split.complete,
    openPath: split.openPath,
    prompt: `${restart} Do not repeat files that were already completed. Keep the same path-tagged block format, and keep each file small enough to finish.`,
  };
}

export const MAX_NUDGES = 2;

/**
 * A reply that announces a file and then simply ends.
 *
 * Kimi K3 narrates ("Creating `index.html` — the page shell…") and stops with a
 * clean "stop" finish reason, as if the file would follow in a later turn. In
 * this app there is no later turn, so the build was reported as "nothing was
 * built" even though the model had a complete plan. The reply never ran out of
 * tokens, so continuing is the wrong tool; it has to be told to write the
 * files it just named.
 *
 * Returns null when the reply already contains a block (nothing to nudge), or
 * when it ends on a question — that is the model asking the user something,
 * and answering it for them would be worse than the silence.
 */
export function planNudge(content: string): ContinuationPlan | null {
  if (extractArtifacts(content).length > 0) return null;

  const text = content.trim();
  const lastLine = text.split('\n').filter((l) => l.trim()).pop() ?? '';
  if (/[?？]\s*$/.test(lastLine)) return null;

  const named = [...text.matchAll(/`([^`\s]+\.[A-Za-z0-9]{1,8})`/g)].map((m) => m[1]);
  const first = named[0];

  return {
    kept: text,
    openPath: first,
    prompt: `${first ? `You named \`${first}\` but never wrote it` : 'You described what you will build but never wrote a file'}. Nothing has been built yet, and this is the only reply you get. Write every file now, each as a path-tagged fenced block (\`\`\`lang path=<file>), starting with the first block immediately and with no further narration before it. Keep each file complete.`,
  };
}
