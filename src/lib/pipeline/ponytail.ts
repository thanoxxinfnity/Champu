/**
 * The Ponytail rule: code you do not write has no bugs.
 *
 * Added to a build that is changing or extending something that already exists, where the cheap mistake is to
 * add a second helper, a new file or a layer of abstraction next to one that was already there. It asks for
 * the smallest change that does the job. It is NOT attached to a from-scratch build ("make me a game"), where
 * "minimal lines" would only make the result thinner.
 */

export const PONYTAIL_RULE = `## PONYTAIL RULE (keep the change small)
Before you write code, ask whether new code is needed at all.
- Refactor or reuse what already exists in the workspace first; do not add a second helper, file or abstraction beside one that is already there.
- No speculative code: nothing "for later", no unused parameters, no dead branches, no wrapper that only forwards a call.
- Change only what the request needs; leave the rest of each file as it is, and re-emit a file in full only when it changes.
- Output the fewest lines that fully do the job. Do not trade correctness or readability for line count.`;

/** Words that mean "change what is there" rather than "make something new". */
const EDITING = /\b(fix|bug|refactor|clean ?up|rename|update|upgrade|change|modify|tweak|improve|optimi[sz]e|add (?:a |an |the )?(?:button|field|option|feature|check|test|route|endpoint|screen|page)|extend|patch|remove|delete|simplif\w*|theek|sudhar\w*|badal\w*|hata\w*)\b/i;

/**
 * Whether this request is about code that already exists: there are files in the workspace and the words say
 * change, not create. A fresh build in an empty workspace never gets the rule.
 */
export function wantsPonytail(request: string, workspaceFileCount: number): boolean {
  if (workspaceFileCount < 1) return false;
  return EDITING.test(request);
}
