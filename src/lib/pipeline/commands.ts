/** `/review` and `/pipeline`, read from what the user typed. Pure: the runtime does what they ask. */

export type PipelineStep = 'ponytail' | 'plan' | 'review' | 'memfile';
export const STEPS: Array<{ id: PipelineStep; label: string; what: string }> = [
  { id: 'ponytail', label: 'Ponytail', what: 'edits stay small: reuse and refactor before writing new code' },
  { id: 'plan', label: 'Plan + edge cases', what: 'steps and what could break are thought through before any file is written' },
  { id: 'review', label: 'Review', what: 'five reviewers check what was built; only issues they are 80%+ sure of are shown' },
  { id: 'memfile', label: 'Memory file', what: 'the project memory is kept in .chomugiri_memory.json next to the project' },
];

export type PipelineCommand =
  | { kind: 'review' }
  | { kind: 'status' }
  | { kind: 'set'; step: PipelineStep | 'all'; on: boolean };

export function parsePipeline(input: string): PipelineCommand | null {
  const t = input.trim();
  if (/^\/review\s*$/i.test(t)) return { kind: 'review' };
  const m = /^\/pipeline(?:\s+(.*))?$/i.exec(t);
  if (!m) return null;
  const rest = (m[1] ?? '').trim().toLowerCase();
  if (!rest || rest === 'status') return { kind: 'status' };
  const on = /\b(on|enable)\b/.test(rest) ? true : /\b(off|disable)\b/.test(rest) ? false : null;
  if (on === null) return { kind: 'status' };
  const step = STEPS.find((s) => rest.includes(s.id) || (s.id === 'memfile' && /memory|file/.test(rest)));
  return { kind: 'set', step: step ? step.id : 'all', on };
}

export function renderStatus(state: Record<PipelineStep, boolean>): string {
  return `::shield:: **Pipeline**\n\n${STEPS.map((s) => `- **${s.label}** — ${state[s.id] ? 'on' : 'off'} · ${s.what}`).join('\n')}\n\n\`/pipeline off review\` · \`/pipeline on all\` · \`/review\` checks the files in the workspace now.`;
}
