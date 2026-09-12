/**
 * Whether a finished run should announce itself.
 *
 * The rule is narrow on purpose. A notice is for the case where the user
 * started something and went elsewhere; popping one up over the very
 * conversation the user is watching stream is noise, and announcing a run the
 * user themselves cancelled is worse than noise.
 */
export function shouldNotify(opts: {
  /** The session the workspace is showing now. */
  currentSessionId: string | null;
  /** The session the run belonged to. */
  runSessionId: string;
  /** Whether the tab is in the background. */
  hidden: boolean;
  /** Whether the user stopped the run. */
  aborted: boolean;
}): boolean {
  if (opts.aborted) return false;
  const movedAway = opts.currentSessionId !== opts.runSessionId;
  return movedAway || opts.hidden;
}

/** The topic line for a notice: short, and never empty. */
export function noticeTopic(prompt: string, max = 70): string {
  const clean = prompt.replace(/\s+/g, ' ').trim();
  if (!clean) return 'Untitled run';
  return clean.length <= max ? clean : `${clean.slice(0, max - 1).trimEnd()}…`;
}
