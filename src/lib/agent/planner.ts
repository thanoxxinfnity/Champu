/**
 * To-Do HUD planner.
 *
 * Turns a Lane B request into an atomic checklist the UI renders live. Steps are
 * typed so the runtime knows which ones depend on the terminal bridge and can
 * park exactly those when the tunnel drops, instead of failing the whole run.
 */

export type TaskStatus = 'pending' | 'in_progress' | 'completed' | 'failed' | 'blocked' | 'skipped';

export type TaskKind =
  | 'analysis'
  | 'codegen'
  | 'terminal'
  | 'build'
  | 'package'
  | 'deploy'
  | 'export'
  | 'research'
  | 'verify';

export interface Task {
  id: string;
  title: string;
  kind: TaskKind;
  status: TaskStatus;
  /** One-line detail shown under the title in the HUD. */
  detail?: string;
  /** Ids of tasks that must complete first. */
  dependsOn?: string[];
  startedAt?: number;
  endedAt?: number;
  error?: string;
  /** Artifact paths produced by this step. */
  outputs?: string[];
}

export interface Plan {
  id: string;
  goal: string;
  suite?: string;
  tasks: Task[];
  createdAt: number;
}

/** Kinds that cannot run without a live tunnel. */
export const TERMINAL_KINDS: ReadonlySet<TaskKind> = new Set(['terminal', 'build', 'package']);

export function requiresBridge(task: Task): boolean {
  return TERMINAL_KINDS.has(task.kind);
}

export const PLANNER_PROMPT = `Decompose the user's request into atomic execution steps.

Reply with ONE JSON object, no prose, no markdown fence:
{"goal":"<one line>","tasks":[{"title":"<imperative, <=70 chars>","kind":"<kind>","detail":"<<=100 chars, optional>","dependsOn":["<index of an earlier task, 1-based, as string>"]}]}

kind must be one of: analysis, codegen, terminal, build, package, deploy, export, research, verify

Rules:
- 3 to 12 tasks. Fewer is better. Never pad with ceremony steps.
- Each task must be independently verifiable — "Write the Gradle module", not "Set up the project".
- Use kind "terminal"/"build"/"package" ONLY for steps that must run a shell on the host machine.
- The final task is normally "verify" or "export".
- Do not include "ask the user" steps. Assume sensible defaults and proceed.`;

interface RawTask {
  title?: string;
  kind?: string;
  detail?: string;
  dependsOn?: string[];
}

const VALID_KINDS = new Set<TaskKind>([
  'analysis', 'codegen', 'terminal', 'build', 'package', 'deploy', 'export', 'research', 'verify',
]);

function coerceKind(raw: string | undefined): TaskKind {
  const k = (raw ?? '').toLowerCase().trim() as TaskKind;
  if (VALID_KINDS.has(k)) return k;
  if (/compil|gradle|assemble/.test(raw ?? '')) return 'build';
  if (/shell|cmd|command|exec/.test(raw ?? '')) return 'terminal';
  if (/zip|pack|archive/.test(raw ?? '')) return 'package';
  if (/publish|vercel|ship/.test(raw ?? '')) return 'deploy';
  return 'codegen';
}

export function newId(prefix = 't'): string {
  return `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
}

/** Parse a planner response. Returns null when the payload is unusable. */
export function parsePlan(raw: string, fallbackGoal: string, suite?: string): Plan | null {
  const match = /\{[\s\S]*\}/.exec(raw);
  if (!match) return null;

  let parsed: { goal?: string; tasks?: RawTask[] };
  try {
    parsed = JSON.parse(match[0]);
  } catch {
    return null;
  }
  if (!Array.isArray(parsed.tasks) || parsed.tasks.length === 0) return null;

  const ids: string[] = [];
  const tasks: Task[] = parsed.tasks.slice(0, 12).map((t, i) => {
    const id = newId();
    ids.push(id);
    return {
      id,
      title: (t.title ?? `Step ${i + 1}`).slice(0, 120),
      kind: coerceKind(t.kind),
      status: 'pending' as TaskStatus,
      detail: t.detail?.slice(0, 200),
      dependsOn: [],
    };
  });

  // Resolve 1-based index references emitted by the planner into real ids.
  parsed.tasks.slice(0, 12).forEach((t, i) => {
    if (!Array.isArray(t.dependsOn)) return;
    tasks[i].dependsOn = t.dependsOn
      .map((d) => ids[Number.parseInt(String(d), 10) - 1])
      .filter((d): d is string => Boolean(d) && d !== tasks[i].id);
  });

  return {
    id: newId('plan'),
    goal: (parsed.goal ?? fallbackGoal).slice(0, 200),
    suite,
    tasks,
    createdAt: Date.now(),
  };
}

/**
 * Deterministic fallback plan.
 * Used when the planner model is unreachable or returns garbage — a Lane B run
 * must still get a HUD rather than silently degrading to freeform chat.
 */
export function heuristicPlan(goal: string, suite?: string): Plan {
  const g = goal.toLowerCase();
  const steps: Array<[string, TaskKind, string?]> = [];

  steps.push(['Analyse the request and pin down requirements', 'analysis', 'Extract targets, constraints and success criteria']);

  if (suite === 'android' || /\bapk\b|android|\.exe|desktop app/.test(g)) {
    steps.push(['Map desktop architecture to an Android module layout', 'analysis']);
    steps.push(['Generate the Gradle project and Compose UI sources', 'codegen']);
    steps.push(['Verify toolchain on the bridge (JDK, SDK, Gradle)', 'terminal']);
    steps.push(['Compile the debug APK', 'build']);
    steps.push(['Pack the source ZIP and collect artifacts', 'package']);
  } else if (suite === 'minecraft' || /bedrock|mcpack|mcaddon|addon/.test(g)) {
    steps.push(['Design the pack manifests and UUID graph', 'analysis']);
    steps.push(['Generate behaviour pack JSON (entities, items, recipes)', 'codegen']);
    steps.push(['Generate resource pack JSON (geometry, textures, render controllers)', 'codegen']);
    steps.push(['Validate schemas against the Bedrock format versions', 'verify']);
    steps.push(['Export .mcpack / .mcaddon', 'export']);
  } else if (suite === 'godot' || suite === 'game' || /\bgame\b|godot/.test(g)) {
    steps.push(['Read the prompt into a game plan', 'analysis']);
    steps.push(['Source the 3D models — download, generate, or build in code', 'codegen']);
    steps.push(['Generate the Godot project: scene, scripts, inputs, audio', 'codegen']);
    steps.push(['Validate that it would actually open and run', 'verify']);
    steps.push(['Export the project zip, and the APK when the bridge is up', 'export']);
  } else if (suite === 'studio' || /deck|slide|presentation|pdf/.test(g)) {
    steps.push(['Draft the narrative outline and slide beats', 'analysis']);
    steps.push(['Generate the HTML5/CSS deck with transitions', 'codegen']);
    steps.push(['Generate supporting imagery', 'codegen']);
    steps.push(['Export the deck bundle', 'export']);
  } else if (suite === 'workdrive' || /research|investigate/.test(g)) {
    steps.push(['Build the query plan and source shortlist', 'research']);
    steps.push(['Retrieve, rank and extract source material', 'research']);
    steps.push(['Synthesise the findings document with citations', 'codegen']);
    steps.push(['Export to the Workdrive history', 'export']);
  } else {
    steps.push(['Design the module structure', 'analysis']);
    steps.push(['Implement the core logic', 'codegen']);
    steps.push(['Wire up the entry points and configuration', 'codegen']);
  }

  if (/deploy|vercel|ship|live/.test(g)) {
    steps.push(['Validate the bundle and environment variables', 'verify']);
    steps.push(['Deploy to Vercel and return the live URL', 'deploy']);
  }

  steps.push(['Verify outputs and report', 'verify']);

  const tasks: Task[] = steps.map(([title, kind, detail]) => ({
    id: newId(),
    title,
    kind,
    status: 'pending',
    detail,
  }));

  // Strictly sequential by default — the model refines dependencies when present.
  for (let i = 1; i < tasks.length; i++) tasks[i].dependsOn = [tasks[i - 1].id];

  return { id: newId('plan'), goal: goal.slice(0, 200), suite, tasks, createdAt: Date.now() };
}

/** Next runnable task: pending, with all dependencies completed or skipped. */
export function nextTask(plan: Plan): Task | undefined {
  const done = new Set(
    plan.tasks.filter((t) => t.status === 'completed' || t.status === 'skipped').map((t) => t.id),
  );
  return plan.tasks.find(
    (t) => t.status === 'pending' && (t.dependsOn ?? []).every((d) => done.has(d)),
  );
}

export function planProgress(plan: Plan): { done: number; total: number; pct: number; failed: number; blocked: number } {
  const total = plan.tasks.length;
  const done = plan.tasks.filter((t) => t.status === 'completed' || t.status === 'skipped').length;
  const failed = plan.tasks.filter((t) => t.status === 'failed').length;
  const blocked = plan.tasks.filter((t) => t.status === 'blocked').length;
  return { done, total, pct: total ? Math.round((done / total) * 100) : 0, failed, blocked };
}

/**
 * Bridge went down mid-run: park terminal-dependent work as `blocked` rather
 * than `failed`, so the run continues on everything browser-side.
 */
export function parkBridgeTasks(plan: Plan, reason: string): { plan: Plan; parked: Task[] } {
  const parked: Task[] = [];
  const tasks = plan.tasks.map((t) => {
    if ((t.status === 'pending' || t.status === 'in_progress') && requiresBridge(t)) {
      const next: Task = { ...t, status: 'blocked', detail: reason };
      parked.push(next);
      return next;
    }
    return t;
  });
  return { plan: { ...plan, tasks }, parked };
}

/** Bridge recovered: un-park everything that was only waiting on the tunnel. */
export function resumeBridgeTasks(plan: Plan): Plan {
  return {
    ...plan,
    tasks: plan.tasks.map((t) =>
      t.status === 'blocked' && requiresBridge(t) ? { ...t, status: 'pending', detail: undefined } : t,
    ),
  };
}
