import type { Plan, Task, TaskKind, TaskStatus } from './planner';

/**
 * Advancing the to-do HUD from what actually happened.
 *
 * The HUD was decorative: the runtime marked the first task in progress and
 * marked one failed, and nothing ever completed anything — so a run that
 * generated files, packed an add-on and answered in full still read "0/7
 * complete". A checklist that never ticks is worse than no checklist, because
 * it reports failure while the work succeeds.
 *
 * Progress is derived from evidence the runtime already has, never from a timer
 * and never from the model's own claims about its work:
 *
 *   analysis / research — the model produced a substantive answer
 *   codegen             — files were extracted
 *   export / package    — an artifact was produced
 *   terminal / build    — a command ran, and its exit code decides
 *   deploy              — a deployment returned a URL
 *   verify              — everything before it finished without failing
 *
 * A step with no evidence is left pending rather than being quietly ticked:
 * claiming a step that did not happen is the failure mode worth avoiding.
 */

export interface RunEvidence {
  /** Characters of non-reasoning answer the model produced. */
  answerChars: number;
  /** Files extracted from the response. */
  filesWritten: number;
  /** A downloadable artifact (an add-on, an APK, a bundle) was produced. */
  artifactProduced: boolean;
  /** Commands that ran, and how many exited non-zero. */
  commandsRun: number;
  commandsFailed: number;
  /** A deployment produced a URL. */
  deployed: boolean;
  /** The run ended in an error. */
  failed: boolean;
}

export const NO_EVIDENCE: RunEvidence = {
  answerChars: 0,
  filesWritten: 0,
  artifactProduced: false,
  commandsRun: 0,
  commandsFailed: 0,
  deployed: false,
  failed: false,
};

/** Enough output to count as having actually analysed or researched something. */
const SUBSTANTIVE_ANSWER = 200;

/**
 * What a single task's status should be, given what the run produced.
 *
 * Returns null when there is no evidence either way, so the caller can leave
 * the task exactly as it is rather than inventing a state for it.
 */
export function statusFor(kind: TaskKind, evidence: RunEvidence): TaskStatus | null {
  switch (kind) {
    case 'analysis':
    case 'research':
      if (evidence.answerChars >= SUBSTANTIVE_ANSWER) return 'completed';
      return null;

    case 'codegen':
      if (evidence.filesWritten > 0) return 'completed';
      return null;

    case 'export':
    case 'package':
      if (evidence.artifactProduced) return 'completed';
      // Packaging that produced files but no archive is not finished.
      return null;

    case 'terminal':
    case 'build':
      if (evidence.commandsFailed > 0) return 'failed';
      if (evidence.commandsRun > 0) return 'completed';
      return null;

    case 'deploy':
      if (evidence.deployed) return 'completed';
      return null;

    case 'verify':
      // Verification is the last thing to claim: only once the run as a whole
      // came through clean and actually did something.
      if (evidence.failed) return 'failed';
      if (evidence.answerChars > 0 || evidence.filesWritten > 0) return 'completed';
      return null;

    default:
      return null;
  }
}

/**
 * Applies the evidence across a whole plan.
 *
 * A task the user or the runtime already settled (failed, blocked) is left
 * alone — evidence advances work that is still open, it does not overwrite a
 * decision already made.
 */
export function advancePlan(plan: Plan, evidence: RunEvidence): Plan {
  const tasks: Task[] = plan.tasks.map((task) => {
    if (task.status === 'failed' || task.status === 'blocked' || task.status === 'completed') return task;

    const next = statusFor(task.kind, evidence);
    if (!next || next === task.status) return task;
    return { ...task, status: next };
  });

  return { ...plan, tasks };
}

/** Anything still pending at the end of a clean run never had its evidence. */
export function settleRemaining(plan: Plan, evidence: RunEvidence): Plan {
  if (evidence.failed) return plan;

  return {
    ...plan,
    tasks: plan.tasks.map((task) =>
      task.status === 'pending' || task.status === 'in_progress'
        ? { ...task, status: 'skipped' as TaskStatus, detail: task.detail ?? 'nothing in this run required it' }
        : task,
    ),
  };
}
