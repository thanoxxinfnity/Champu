'use client';

import { useWorkspace } from '@/lib/store';
import { planProgress, requiresBridge, type Task, type TaskStatus } from '@/lib/agent/planner';

const STATUS_STYLE: Record<TaskStatus, { glyph: string; color: string; label: string }> = {
  pending: { glyph: '○', color: 'var(--ink-faint)', label: 'Pending' },
  in_progress: { glyph: '◐', color: 'var(--accent)', label: 'In progress' },
  completed: { glyph: '●', color: 'var(--accent)', label: 'Completed' },
  failed: { glyph: '✕', color: 'var(--color-rose)', label: 'Failed' },
  blocked: { glyph: '⏸', color: 'var(--color-amber)', label: 'Blocked' },
  skipped: { glyph: '–', color: 'var(--ink-faint)', label: 'Skipped' },
};

const KIND_LABEL: Record<Task['kind'], string> = {
  analysis: 'analyse',
  codegen: 'generate',
  terminal: 'shell',
  build: 'build',
  package: 'package',
  deploy: 'deploy',
  export: 'export',
  research: 'research',
  verify: 'verify',
};

function TaskRow({ task, index }: { task: Task; index: number }) {
  const style = STATUS_STYLE[task.status];
  const bridgeBound = requiresBridge(task);
  const duration = task.startedAt && task.endedAt ? ((task.endedAt - task.startedAt) / 1000).toFixed(1) : null;

  return (
    <li
      className={`relative flex gap-3 rounded-lg border px-3 py-2.5 ${task.status === 'in_progress' ? 'task-running' : ''}`}
      style={{
        borderColor: task.status === 'in_progress' ? 'color-mix(in oklab, var(--accent) 40%, var(--line))' : 'var(--line)',
        background: task.status === 'in_progress' ? 'color-mix(in oklab, var(--accent) 5%, var(--panel))' : 'var(--panel)',
      }}
    >
      <span
        className="mono mt-px shrink-0 text-[13px] leading-5"
        style={{ color: style.color }}
        title={style.label}
        aria-label={style.label}
      >
        {style.glyph}
      </span>

      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <span className="mono shrink-0 text-[10px]" style={{ color: 'var(--ink-faint)' }}>
            {String(index + 1).padStart(2, '0')}
          </span>
          <span
            className="text-[13px] leading-5"
            style={{
              color: task.status === 'completed' ? 'var(--ink-dim)' : 'var(--ink)',
              textDecoration: task.status === 'skipped' ? 'line-through' : undefined,
            }}
          >
            {task.title}
          </span>
        </div>

        {(task.detail || task.error) && (
          <p className="mt-1 text-[11.5px] leading-4" style={{ color: task.error ? 'var(--color-rose)' : 'var(--ink-faint)' }}>
            {task.error ?? task.detail}
          </p>
        )}

        <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
          <span
            className="mono rounded px-1.5 py-0.5 text-[9.5px] uppercase tracking-wider"
            style={{ background: 'var(--surface)', color: 'var(--ink-faint)' }}
          >
            {KIND_LABEL[task.kind]}
          </span>
          {bridgeBound && (
            <span
              className="mono rounded px-1.5 py-0.5 text-[9.5px] uppercase tracking-wider"
              style={{ background: 'color-mix(in oklab, var(--color-indigo) 16%, transparent)', color: 'var(--color-indigo)' }}
              title="Requires the terminal bridge"
            >
              bridge
            </span>
          )}
          {duration && (
            <span className="mono text-[9.5px]" style={{ color: 'var(--ink-faint)' }}>
              {duration}s
            </span>
          )}
        </div>
      </div>
    </li>
  );
}

/**
 * Live task ledger for Lane B runs. Blocked tasks are visually distinct from
 * failed ones — "the tunnel is down" and "the build broke" demand different
 * responses from the user.
 */
export function TodoHud({ compact = false }: { compact?: boolean }) {
  const plan = useWorkspace((s) => s.plan);
  const setPlan = useWorkspace((s) => s.setPlan);

  if (!plan) {
    return (
      <div className="flex h-full items-center justify-center p-8 text-center">
        <div>
          <p className="text-[13px]" style={{ color: 'var(--ink-dim)' }}>
            No active plan.
          </p>
          <p className="mt-1.5 text-[11.5px] leading-4" style={{ color: 'var(--ink-faint)' }}>
            Lane B requests build an atomic checklist here.
            <br />
            Questions route to Lane A and skip planning.
          </p>
        </div>
      </div>
    );
  }

  const progress = planProgress(plan);

  return (
    <div className="flex h-full flex-col">
      <header className="shrink-0 border-b px-4 py-3" style={{ borderColor: 'var(--line)' }}>
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="truncate text-[13px] font-medium leading-5">{plan.goal}</p>
            <p className="mono mt-0.5 text-[10.5px]" style={{ color: 'var(--ink-faint)' }}>
              {progress.done}/{progress.total} complete
              {progress.blocked > 0 && ` · ${progress.blocked} blocked`}
              {progress.failed > 0 && ` · ${progress.failed} failed`}
            </p>
          </div>
          <button
            type="button"
            onClick={() => setPlan(null)}
            className="mono shrink-0 text-[10.5px] transition-opacity hover:opacity-100"
            style={{ color: 'var(--ink-faint)', opacity: 0.7 }}
          >
            clear
          </button>
        </div>

        <div className="mt-2.5 h-1 overflow-hidden rounded-full" style={{ background: 'var(--surface)' }}>
          <div
            className="h-full rounded-full transition-[width] duration-500 ease-out"
            style={{
              width: `${progress.pct}%`,
              background:
                progress.failed > 0
                  ? 'var(--color-rose)'
                  : 'linear-gradient(90deg, var(--accent), var(--accent-alt))',
            }}
          />
        </div>
      </header>

      <ol className={`flex-1 space-y-1.5 overflow-y-auto p-3 ${compact ? 'text-[12px]' : ''}`}>
        {plan.tasks.map((task, i) => (
          <TaskRow key={task.id} task={task} index={i} />
        ))}
      </ol>
    </div>
  );
}
