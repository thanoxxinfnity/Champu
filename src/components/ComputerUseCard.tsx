'use client';
/**
 * The chat's Computer use card: a live run of the agent on the bridge's browser or screen, inside the conversation — what it is
 * doing, the screen (live, with take-over), approvals, its questions, the secure form for logins and codes, and the result.
 */
import { useState } from 'react';
import { answerQuestion, decideApproval, stopComputerUse, submitSecureForm, useRunner } from '@/lib/handoff/runner';
import { siteOf } from '@/lib/handoff/specialties';
import { useVaultStore } from '@/lib/handoff/vault-store';
import { LiveScreen, useLiveScreen, GRAD } from './suites/handoff/LiveScreen';
import { SecureForm } from './suites/handoff/Secured';

const card = { borderColor: 'var(--line)', background: 'var(--panel)' } as const;

function B({ children, onClick, primary, danger, grow }: { children: React.ReactNode; onClick: () => void; primary?: boolean; danger?: boolean; grow?: boolean }) {
  return (
    <button type="button" onClick={onClick} className={'press inline-flex items-center justify-center whitespace-nowrap rounded-xl px-3.5 text-[13px] font-semibold' + (grow ? ' flex-1' : '')}
      style={{ minHeight: 42, ...(primary ? { background: GRAD, color: '#fff' } : danger ? { color: 'hsl(4 75% 56%)', border: '1px solid hsl(4 75% 56% / .35)' } : { border: '1px solid var(--line)', color: 'var(--ink-dim)' }) }}>{children}</button>
  );
}

export function ComputerUseCard({ runId }: { runId: string }) {
  const run = useRunner((s) => s.runs[runId]);
  const vaultOpen = useVaultStore((s) => s.open);
  const view = useLiveScreen(run?.mode ?? 'browser', run?.screen ?? null);
  const [remember, setRemember] = useState(false);
  const [reply, setReply] = useState('');
  const [showAll, setShowAll] = useState(false);
  if (!run) return null;
  const running = run.status === 'running';
  const steps = showAll ? run.steps : run.steps.slice(-5);

  return (
    <div className="mt-2 space-y-2.5 rounded-2xl border p-3" style={{ ...card, background: 'linear-gradient(160deg, hsl(18 88% 58% / .08), transparent 55%), var(--panel)' }}>
      <div className="flex items-center gap-2.5">
        <span className="grid h-8 w-8 shrink-0 place-items-center rounded-xl text-[15px] text-white" style={{ background: GRAD }}>🖥</span>
        <div className="min-w-0 flex-1">
          <p className="text-[13px] font-semibold" style={{ color: 'var(--ink)' }}>Computer use · {run.mode === 'desktop' ? 'Linux screen' : 'browser'}</p>
          <p className="flex items-center gap-1.5 truncate text-[11.5px]" style={{ color: 'var(--ink-dim)' }}>
            {running && <span className="inline-block h-2.5 w-2.5 shrink-0 animate-spin rounded-full border-2" style={{ borderColor: 'var(--line)', borderTopColor: 'hsl(18 88% 58%)' }} />}
            {running ? run.statusText || 'Working…' : run.status === 'done' ? `Done · ${run.steps.length} steps` : run.status === 'failed' ? 'Failed' : run.status === 'limit' ? 'Step limit reached' : 'Stopped'}
          </p>
        </div>
        {running && <B danger onClick={() => stopComputerUse(runId)}>■ Stop</B>}
      </div>

      {run.approval && (
        <div className="space-y-2 rounded-xl border-2 p-3" style={{ borderColor: 'hsl(38 92% 50% / .7)', background: 'hsl(38 92% 50% / .08)' }} role="alertdialog" aria-label="Approve this step">
          <p className="text-[10.5px] font-bold uppercase tracking-wider" style={{ color: 'hsl(38 92% 45%)' }}>Needs your OK</p>
          <p className="text-[14px] font-semibold" style={{ color: 'var(--ink)' }}>{run.approval.label}</p>
          <p className="text-[12.5px]" style={{ color: 'var(--ink-dim)' }}>{run.approval.reason}</p>
          {run.approval.action.type === 'shell' && <pre className="mono overflow-x-auto rounded-lg p-2 text-[11.5px]" style={{ background: 'var(--surface)', color: 'var(--ink)' }}>{run.approval.action.cmd}</pre>}
          {run.approval.rememberable && run.approval.host && (
            <label className="flex items-center gap-2 text-[12px]" style={{ color: 'var(--ink-dim)' }}><input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} /> Always allow on {siteOf(run.approval.host)}</label>
          )}
          <div className="flex gap-2"><B grow onClick={() => void decideApproval(runId, false)}>✕ No</B><B grow primary onClick={() => { void decideApproval(runId, true, remember); setRemember(false); }}>✓ Approve</B></div>
        </div>
      )}

      {run.secure && <SecureForm req={run.secure} canSave={vaultOpen} onSubmit={(vals, save) => submitSecureForm(runId, vals, save)} onCancel={() => submitSecureForm(runId, null)} />}

      {run.question !== null && (
        <div className="space-y-2 rounded-xl border-2 p-3" style={{ borderColor: 'hsl(210 85% 55% / .6)', background: 'hsl(210 85% 55% / .07)' }}>
          <p className="text-[10.5px] font-bold uppercase tracking-wider" style={{ color: 'hsl(210 85% 50%)' }}>The agent asks</p>
          <p className="text-[14px] font-semibold" style={{ color: 'var(--ink)' }}>{run.question}</p>
          <div className="flex gap-2">
            <input value={reply} onChange={(e) => setReply(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && reply.trim()) { answerQuestion(runId, reply.trim()); setReply(''); } }} placeholder="Your answer…" className="min-w-0 flex-1 rounded-xl border bg-transparent px-3 text-[14px] outline-none" style={{ borderColor: 'var(--line)', color: 'var(--ink)', minHeight: 42 }} />
            <B primary onClick={() => { if (reply.trim()) { answerQuestion(runId, reply.trim()); setReply(''); } }}>Send</B>
          </div>
        </div>
      )}

      <LiveScreen screen={view.screen} mode={run.mode} canControl={run.mode === 'desktop' && view.online} live={view.live} setLive={view.setLive} refreshing={view.refreshing} onClick={view.control.click} onType={view.control.type} onKey={view.control.key} />

      {run.steps.length > 0 && (
        <ol className="space-y-1">
          {run.steps.length > 5 && !showAll && <li><button type="button" onClick={() => setShowAll(true)} className="mono text-[11px]" style={{ color: 'var(--ink-faint)' }}>show all {run.steps.length} steps</button></li>}
          {steps.map((s) => (
            <li key={s.index} className="flex items-center gap-2 text-[12.5px]" style={{ color: 'var(--ink)' }}>
              <span className="mono grid h-5 w-5 shrink-0 place-items-center rounded-full text-[10px] font-bold" style={{ background: s.ok === false ? 'hsl(4 75% 56% / .15)' : s.ok ? 'hsl(145 60% 42% / .15)' : 'var(--surface)', color: s.ok === false ? 'hsl(4 75% 56%)' : s.ok ? 'hsl(145 60% 38%)' : 'var(--ink-faint)' }}>{s.ok === undefined ? s.index : s.ok ? '✓' : '!'}</span>
              <span className="min-w-0 flex-1 truncate">{s.label}</span>
              {s.verdict === 'confirm' && s.approved !== undefined && <span className="mono text-[10px]" style={{ color: s.approved ? 'hsl(145 60% 38%)' : 'hsl(38 92% 45%)' }}>{s.approved ? 'approved' : 'refused'}</span>}
            </li>
          ))}
        </ol>
      )}

      {!running && run.summary && <p className="whitespace-pre-wrap rounded-xl border p-2.5 text-[13.5px] leading-relaxed" style={{ borderColor: 'var(--line)', color: 'var(--ink)' }}>{run.summary}</p>}
    </div>
  );
}
