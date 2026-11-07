/**
 * The parts of Handoff that remember: Specialties (a job that worked, saved to repeat), Scheduled tasks (a job on a timetable),
 * steps the user always allows on a site, and a job handed over from the chat. Pure, so it is tested in node.
 */
import type { Mode } from './actions.ts';

export interface Specialty { id: string; name: string; task: string; mode: Mode; steps: string[]; createdAt: number; uses: number }

const NOISE = /^(Read the page|Wait \d+s|Look at the screen|Scroll (up|down|left|right))$/;

/** A finished run turned into a Specialty: its successful steps, in order, without the noise. */
export function specialtyFromRun(run: { task: string; mode: Mode; steps: Array<{ label: string; ok?: boolean }> }, name?: string, now = Date.now()): Specialty {
  const steps = run.steps.filter((s) => s.ok !== false && !NOISE.test(s.label) && s.label !== 'Finished').map((s) => s.label).slice(0, 15);
  const auto = run.task.replace(/\s+/g, ' ').trim().split(' ').slice(0, 5).join(' ');
  return { id: `spc_${now.toString(36)}${Math.random().toString(36).slice(2, 5)}`, name: (name?.trim() || auto).slice(0, 40), task: run.task, mode: run.mode, steps, createdAt: now, uses: 0 };
}

export const guideOf = (s: Specialty): string => s.steps.map((x, i) => `${i + 1}. ${x}`).join('\n');

// ── scheduled tasks ─────────────────────────────────────────────────────────

export interface Schedule { id: string; task: string; mode: Mode; every: 'day' | 'weekday' | 'week'; time: string; weekday?: number; on: boolean; lastRun?: number; createdAt: number }

const hm = (t: string): [number, number] | null => { const m = /^([01]?\d|2[0-3]):([0-5]\d)$/.exec(t.trim()); return m ? [Number(m[1]), Number(m[2])] : null; };
const dayOk = (s: Schedule, d: Date) => (s.every === 'day' ? true : s.every === 'weekday' ? d.getDay() >= 1 && d.getDay() <= 5 : d.getDay() === (s.weekday ?? 1));

/** The time a schedule should have run most recently, at or before `now` (local time), or null if never yet. */
export function lastSlot(s: Schedule, now: Date): Date | null {
  const t = hm(s.time);
  if (!t) return null;
  for (let back = 0; back < 8; back++) {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - back, t[0], t[1], 0, 0);
    if (d <= now && dayOk(s, d)) return d;
  }
  return null;
}

/** Due: switched on, its latest slot has passed, it has not run since that slot, and the slot is not stale (missed by > 6 h). */
export function isDue(s: Schedule, now: Date): boolean {
  if (!s.on) return false;
  const slot = lastSlot(s, now);
  if (!slot || slot.getTime() < s.createdAt) return false;
  if ((s.lastRun ?? 0) >= slot.getTime()) return false;
  return now.getTime() - slot.getTime() <= 6 * 3600_000;
}

export function nextRun(s: Schedule, now: Date): Date | null {
  const t = hm(s.time);
  if (!t) return null;
  for (let ahead = 0; ahead < 9; ahead++) {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + ahead, t[0], t[1], 0, 0);
    if (d > now && dayOk(s, d)) return d;
  }
  return null;
}

export const validTime = (t: string): boolean => hm(t) !== null;
export const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
export function describeSchedule(s: Schedule): string {
  return `${s.every === 'day' ? 'Every day' : s.every === 'weekday' ? 'Mon–Fri' : `Every ${DAYS[s.weekday ?? 1]}`} at ${s.time}`;
}

// ── steps the user always allows on a site ──────────────────────────────────

export interface AllowRule { host: string; kind: string; createdAt: number }

/** A rule for "pay.amazon.in" does not cover "amazon.in"; one for "amazon.in" covers its subdomains. */
export function isAllowed(rules: AllowRule[], host: string | undefined, kind: string): boolean {
  if (!host) return false;
  const h = host.toLowerCase();
  return rules.some((r) => r.kind === kind && (h === r.host || h.endsWith(`.${r.host}`)));
}
export const siteOf = (host: string): string => host.toLowerCase().replace(/^www\./, '');

// ── a job handed over from the chat ─────────────────────────────────────────

let queued: { task: string; mode?: Mode } | null = null;
export function queueHandoff(task: string, mode?: Mode): void { queued = task.trim() ? { task: task.trim(), mode } : null; }
export function takeQueued(): { task: string; mode?: Mode } | null { const q = queued; queued = null; return q; }

/** "/handoff compare prices …" → the job; "/handoff" alone → empty. */
export function parseHandoffCommand(input: string): { task: string } | null {
  const m = /^\/handoff\b\s*([\s\S]*)$/i.exec(input.trim());
  return m ? { task: m[1]!.trim() } : null;
}
