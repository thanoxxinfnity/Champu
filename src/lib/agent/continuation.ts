import { splitAtOpenBlock } from './artifacts.ts';

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
