'use client';

/**
 * The "Secured" side of Handoff: the encrypted vault (set up, unlock, add logins / cards / details), the secure form the agent asks
 * the user to fill, the list of steps always allowed per site, Scheduled tasks and the background scheduler. Values typed here are
 * kept in memory only while the vault is open and are written to storage encrypted.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { getSetting, setSetting } from '@/lib/db/history';
import { useWorkspace } from '@/lib/store';
import type { Mode } from '@/lib/handoff/actions';
import { FIELDS, MIN_PIN, describeForAgent, fieldValue, findByRef, lastFour, newItemId, validateItem, type VaultItem } from '@/lib/handoff/vault';
import { useVaultStore } from '@/lib/handoff/vault-store';
import type { SecretHit, VaultAccess } from '@/lib/handoff/loop';
import { describeSchedule, isDue, nextRun, queueHandoff, siteOf, validTime, DAYS, type AllowRule, type Schedule } from '@/lib/handoff/specialties';
import { Icon, SiteLogo, hostOf } from './Icon';

export { VAULT_KEY } from '@/lib/handoff/vault-store';
export const ALLOW_KEY = 'handoff.allow.v1';
export const SCHEDULES_KEY = 'handoff.schedules.v1';

const box = { borderColor: 'var(--line)', background: 'var(--panel)' } as const;
const input = 'w-full rounded-xl border bg-transparent px-3 text-[14px] outline-none';
const inputStyle = { borderColor: 'var(--line)', color: 'var(--ink)', minHeight: 44 } as const;
const GRAD = 'linear-gradient(140deg, hsl(18 88% 58%), hsl(338 78% 52%))';
const SAFE = 'linear-gradient(140deg, hsl(152 60% 40%), hsl(190 70% 40%))';

function B({ children, onClick, primary, danger, disabled, grow }: { children: React.ReactNode; onClick: () => void; primary?: boolean; danger?: boolean; disabled?: boolean; grow?: boolean }) {
  return (
    <button type="button" onClick={onClick} disabled={disabled} className={'press inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-xl px-4 text-[13.5px] font-semibold disabled:opacity-40' + (grow ? ' flex-1' : '')}
      style={{ minHeight: 44, ...(primary ? { background: SAFE, color: '#fff' } : danger ? { color: 'hsl(4 75% 56%)', border: '1px solid hsl(4 75% 56% / .35)' } : { border: '1px solid var(--line)', color: 'var(--ink-dim)' }) }}>{children}</button>
  );
}

/* ── the vault, as a hook the whole Handoff area shares ─────────────────── */
export interface VaultState {
  exists: boolean;
  open: boolean;
  items: VaultItem[];
  create: (pin: string) => Promise<void>;
  unlock: (pin: string) => Promise<void>;
  lock: () => void;
  save: (items: VaultItem[]) => Promise<void>;
  reset: () => Promise<void>;
  touch: () => void;
}

export function useVault(): VaultState {
  const st = useVaultStore();
  useEffect(() => { void st.load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);
  return { exists: !!st.sealed, open: st.open, items: st.items, create: st.create, unlock: st.unlock, lock: st.lock, save: st.save, reset: st.reset, touch: st.touch };
}

/** The same vault outside React (the chat's Computer use runs here). */
export function vaultNow(): VaultState {
  const st = useVaultStore.getState();
  return { get exists() { return !!useVaultStore.getState().sealed; }, get open() { return useVaultStore.getState().open; }, get items() { return useVaultStore.getState().items; }, create: st.create, unlock: st.unlock, lock: st.lock, save: st.save, reset: st.reset, touch: st.touch };
}

/** What the agent loop gets: names only, values on request, and the secure form. */
export function vaultAccess(v: VaultState, oneTime: Map<string, string>, ask: VaultAccess['ask']): VaultAccess {
  return {
    info: () => (v.open ? describeForAgent(v.items, [...oneTime.keys()]) : `The vault is locked, so saved logins and cards are not available.${oneTime.size ? ` Given for this job: ${[...oneTime.keys()].map((k) => `once:${k}`).join(', ')}.` : ''} If the job needs a login, card or code, use request_secret.`),
    get: (ref, field): SecretHit | null => {
      if (ref.startsWith('once:')) { const val = oneTime.get(ref.slice(5)); return val ? { value: val, kind: 'once', label: ref.slice(5) } : null; }
      if (!v.open) return null;
      const it = findByRef(ref, v.items);
      const val = it ? fieldValue(it, field) : null;
      if (!it || !val) return null;
      v.touch();
      return { value: val, kind: it.kind, site: it.kind === 'login' ? it.site : undefined, label: it.kind === 'login' ? it.site : it.label };
    },
    ask,
  };
}

/* ── the vault screen ────────────────────────────────────────────────────── */
const BLANK: Record<VaultItem['kind'], () => VaultItem> = {
  login: () => ({ id: newItemId(), kind: 'login', label: '', site: '', username: '', password: '' }),
  card: () => ({ id: newItemId(), kind: 'card', label: '', name: '', number: '', expiry: '', cvv: '' }),
  identity: () => ({ id: newItemId(), kind: 'identity', label: 'Home', fullName: '', email: '', phone: '', address: '', city: '', pincode: '' }),
};
const LABELS: Record<string, string> = { site: 'Website (e.g. amazon.in)', username: 'Username or email', password: 'Password', label: 'Name it', name: 'Name on card', number: 'Card number', expiry: 'Expiry MM/YY', cvv: 'CVV', fullName: 'Full name', email: 'Email', phone: 'Phone', address: 'Address', city: 'City', pincode: 'PIN code' };
const SECRETISH = new Set(['password', 'cvv', 'number']);

function ItemForm({ item, onSave, onCancel }: { item: VaultItem; onSave: (it: VaultItem) => void; onCancel: () => void }) {
  const [it, setIt] = useState<VaultItem>(item);
  const [err, setErr] = useState('');
  const keys = it.kind === 'login' ? ['site', ...FIELDS.login] : ['label', ...FIELDS[it.kind]];
  const val = (k: string) => String((it as unknown as Record<string, unknown>)[k] ?? '');
  return (
    <div className="space-y-2.5 rounded-2xl border p-3" style={box}>
      {keys.map((k) => (
        <label key={k} className="block">
          <span className="mono mb-1 block text-[10.5px] uppercase tracking-wider" style={{ color: 'var(--ink-faint)' }}>{LABELS[k] ?? k}</span>
          <input value={val(k)} onChange={(e) => setIt({ ...it, [k]: e.target.value } as VaultItem)} type={SECRETISH.has(k) ? 'password' : 'text'} inputMode={k === 'number' || k === 'cvv' || k === 'pincode' || k === 'phone' ? 'numeric' : undefined} autoComplete="off" autoCapitalize="off" spellCheck={false} className={input} style={inputStyle} />
        </label>
      ))}
      {err && <p className="text-[12px]" style={{ color: 'hsl(4 75% 56%)' }}>{err}</p>}
      <div className="flex gap-2"><B grow onClick={onCancel}>Cancel</B><B grow primary onClick={() => { const e = validateItem(it); if (e) setErr(e); else onSave(it.kind === 'login' ? { ...it, site: siteOf(it.site.trim().replace(/^https?:\/\//, '').replace(/\/.*$/, '')) } : it); }}>Save encrypted</B></div>
    </div>
  );
}

export function VaultPanel({ v, rules, setRules }: { v: VaultState; rules: AllowRule[]; setRules: (r: AllowRule[]) => void }) {
  const [pin, setPin] = useState('');
  const [pin2, setPin2] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<VaultItem | null>(null);
  const act = async (f: () => Promise<void>) => { setBusy(true); setErr(''); try { await f(); setPin(''); setPin2(''); } catch (e) { setErr((e as Error).message); } finally { setBusy(false); } };

  return (
    <div className="space-y-5 p-3 pb-28">
      <section className="space-y-3 rounded-3xl border p-4" style={{ ...box, background: 'radial-gradient(110% 90% at 0% 0%, hsl(152 60% 40% / .16), transparent 60%), var(--panel)' }}>
        <div className="flex items-center gap-3">
          <span className="grid h-11 w-11 place-items-center rounded-2xl text-white" style={{ background: SAFE }}><Icon name="shield" size={22} /></span>
          <div>
            <h2 className="text-[17px] font-semibold" style={{ color: 'var(--ink)' }}>Secured vault</h2>
            <p className="text-[12px]" style={{ color: 'var(--ink-dim)' }}>{v.open ? `Open · locks itself after 10 minutes` : v.exists ? 'Locked' : 'Not set up yet'}</p>
          </div>
        </div>
        <ul className="list-disc space-y-1 pl-4 text-[12.5px]" style={{ color: 'var(--ink-dim)' }}>
          <li>Encrypted on this phone with your PIN (AES-256). The PIN is never stored.</li>
          <li>The AI only sees names like “login:amazon” — the app types the value into the page itself.</li>
          <li>A login is only filled on its own website (phishing guard), and only on https pages.</li>
          <li>Cards and personal details are filled only after you approve each time.</li>
        </ul>
        {!v.exists && (
          <div className="space-y-2">
            <input value={pin} onChange={(e) => setPin(e.target.value)} type="password" inputMode="numeric" placeholder={`New PIN (${MIN_PIN}+ characters)`} autoComplete="new-password" className={input} style={inputStyle} />
            <input value={pin2} onChange={(e) => setPin2(e.target.value)} type="password" inputMode="numeric" placeholder="Repeat the PIN" autoComplete="new-password" className={input} style={inputStyle} />
            <B primary disabled={busy || pin.length < MIN_PIN} onClick={() => void act(async () => { if (pin !== pin2) throw new Error('The two PINs differ.'); await v.create(pin); })}>{busy ? 'Encrypting…' : 'Create vault'}</B>
            <p className="text-[11.5px]" style={{ color: 'var(--ink-faint)' }}>If you forget the PIN, nobody can open the vault — not even us. You can only reset it (everything inside is deleted).</p>
          </div>
        )}
        {v.exists && !v.open && (
          <div className="flex gap-2">
            <input value={pin} onChange={(e) => setPin(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') void act(() => v.unlock(pin)); }} type="password" inputMode="numeric" placeholder="PIN" autoComplete="current-password" className={input} style={inputStyle} />
            <B primary disabled={busy || !pin} onClick={() => void act(() => v.unlock(pin))}>{busy ? '…' : 'Unlock'}</B>
          </div>
        )}
        {v.open && <div className="flex gap-2"><B grow onClick={v.lock}>Lock now</B></div>}
        {err && <p className="text-[12.5px]" style={{ color: 'hsl(4 75% 56%)' }}>{err}</p>}
      </section>

      {v.open && (
        <section className="space-y-2">
          <div className="flex items-center justify-between px-1"><h3 className="mono text-[10.5px] uppercase tracking-wider" style={{ color: 'var(--ink-faint)' }}>Inside · {v.items.length}</h3></div>
          {editing ? (
            <ItemForm item={editing} onCancel={() => setEditing(null)} onSave={(it) => void act(async () => { await v.save([...v.items.filter((x) => x.id !== it.id), it]); setEditing(null); })} />
          ) : (
            <div className="grid grid-cols-3 gap-2">
              <B onClick={() => setEditing(BLANK.login())}>+ Login</B><B onClick={() => setEditing(BLANK.card())}>+ Card</B><B onClick={() => setEditing(BLANK.identity())}>+ Details</B>
            </div>
          )}
          <ul className="space-y-1.5">
            {v.items.map((it) => (
              <li key={it.id} className="flex items-center gap-3 rounded-2xl border px-3 py-2.5" style={box}>
                {it.kind === 'login' ? <SiteLogo site={it.site} size={36} /> : <span className="grid h-9 w-9 place-items-center rounded-xl" style={{ background: 'var(--surface)', color: 'var(--ink-dim)' }}><Icon name={it.kind === 'card' ? 'card' : 'user'} /></span>}
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13.5px] font-semibold" style={{ color: 'var(--ink)' }}>{it.kind === 'login' ? it.site : it.label}</span>
                  <span className="mono block truncate text-[11px]" style={{ color: 'var(--ink-faint)' }}>{it.kind === 'login' ? `${it.username || '—'} · ••••••` : it.kind === 'card' ? `•••• ${lastFour(it.number)} · ${it.expiry}` : `${it.fullName} · ${it.city}`}</span>
                </span>
                <button type="button" onClick={() => setEditing(it)} className="press mono rounded-lg border px-2 text-[11px]" style={{ minHeight: 34, borderColor: 'var(--line)', color: 'var(--ink-dim)' }}>Edit</button>
                <button type="button" onClick={() => { if (confirm('Delete this from the vault?')) void act(() => v.save(v.items.filter((x) => x.id !== it.id))); }} className="press mono rounded-lg border px-2 text-[11px]" style={{ minHeight: 34, borderColor: 'var(--line)', color: 'hsl(4 75% 56%)' }} aria-label="Delete"><Icon name="x" size={14} /></button>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="space-y-2">
        <h3 className="mono px-1 text-[10.5px] uppercase tracking-wider" style={{ color: 'var(--ink-faint)' }}>Always allowed · {rules.length}</h3>
        {rules.length ? (
          <ul className="space-y-1.5">
            {rules.map((r, i) => (
              <li key={`${r.host}-${r.kind}`} className="flex items-center justify-between rounded-2xl border px-3 py-2.5 text-[13px]" style={box}>
                <span style={{ color: 'var(--ink)' }}>{r.kind === 'login' ? 'Fill my login' : r.kind === 'click' ? 'Clicks' : r.kind === 'type' ? 'Typing' : 'Keys'} on <b>{r.host}</b></span>
                <button type="button" onClick={() => setRules(rules.filter((_, j) => j !== i))} className="mono text-[11px]" style={{ color: 'hsl(4 75% 56%)' }}>remove</button>
              </li>
            ))}
          </ul>
        ) : <p className="px-1 text-[12px]" style={{ color: 'var(--ink-faint)' }}>When you approve a step, tick “Always allow on this site” and Handoff remembers it. Payments, sending, deleting and terminal commands always ask.</p>}
      </section>

      {v.exists && <B danger onClick={() => { if (confirm('Delete the whole vault and everything in it? This cannot be undone.')) void v.reset(); }}>Reset vault</B>}
    </div>
  );
}

/* ── the secure form the agent asks for ──────────────────────────────────── */
export interface SecureRequest { fields: string[]; why: string; site?: string }

/** What the form is for, from the fields the agent asked for. */
export function secureKind(fields: string[]): 'login' | 'apikey' | 'code' | 'card' | 'other' {
  const f = fields.join(' ');
  if (/pass/.test(f)) return 'login';
  if (/api|token|key|secret/.test(f)) return 'apikey';
  if (/otp|code|pin/.test(f)) return 'code';
  if (/card|cvv|cvc|expiry/.test(f)) return 'card';
  return 'other';
}
const FIELD_LABEL: Record<string, string> = { username: 'Username or email', email: 'Email', user: 'Username', password: 'Password', otp: 'Verification code', code: 'Code', pin: 'PIN', api_key: 'API key', token: 'Access token', secret: 'Secret', cvv: 'CVV', number: 'Card number', card_number: 'Card number', expiry: 'Expiry (MM/YY)' };

export function SecureForm({ req, canSave, onSubmit, onCancel }: { req: SecureRequest; canSave: boolean; onSubmit: (values: Record<string, string>, save: boolean) => void; onCancel: () => void }) {
  const [vals, setVals] = useState<Record<string, string>>({});
  const [save, setSave] = useState(false);
  const [show, setShow] = useState<Record<string, boolean>>({});
  const kind = secureKind(req.fields);
  const host = req.site ? hostOf(req.site) : '';
  const loginish = kind === 'login' && !!req.site;
  const hidden = (f: string) => /pass|otp|code|pin|cvv|cvc|card|number|key|token|secret/.test(f) && !show[f];
  const all = req.fields.every((f) => vals[f]?.trim());
  const title = kind === 'login' ? `Sign in to ${host || 'this site'}` : kind === 'apikey' ? `${host ? `${host} ` : ''}API key` : kind === 'code' ? 'Verification code' : kind === 'card' ? 'Card details' : 'Secure details';
  return (
    <section className="overflow-hidden rounded-3xl border" style={{ borderColor: 'hsl(152 60% 40% / .45)', background: 'var(--panel)', boxShadow: '0 18px 40px -28px hsl(152 60% 25%)' }} role="dialog" aria-label="Secure form">
      <div className="flex items-center gap-2 px-4 py-2" style={{ background: 'hsl(152 60% 40% / .10)', color: 'hsl(152 60% 32%)' }}>
        <Icon name="shield" size={15} />
        <p className="text-[11px] font-semibold uppercase tracking-wider">Secure form · the AI never sees what you type</p>
      </div>
      <div className="space-y-3 p-4">
        <div className="flex items-center gap-3">
          {host ? <SiteLogo site={host} size={48} /> : <span className="grid h-12 w-12 place-items-center rounded-2xl text-white" style={{ background: SAFE }}><Icon name={kind === 'apikey' ? 'apikey' : kind === 'card' ? 'card' : kind === 'code' ? 'lock' : 'key'} size={22} /></span>}
          <div className="min-w-0">
            <p className="truncate text-[16px] font-semibold" style={{ color: 'var(--ink)' }}>{title}</p>
            {host && <p className="mono truncate text-[11.5px]" style={{ color: 'var(--ink-faint)' }}>https://{host}</p>}
          </div>
        </div>
        <p className="text-[13px] leading-relaxed" style={{ color: 'var(--ink-dim)' }}>{req.why}</p>
        {req.fields.map((f, i) => (
          <label key={f} className="block">
            <span className="mb-1 block text-[11.5px] font-medium" style={{ color: 'var(--ink-dim)' }}>{FIELD_LABEL[f] ?? LABELS[f] ?? f.replace(/_/g, ' ')}</span>
            <span className="flex items-center gap-2 rounded-xl border px-3" style={{ borderColor: 'var(--line)', background: 'var(--surface)', minHeight: 46 }}>
              <input value={vals[f] ?? ''} autoFocus={i === 0} onChange={(e) => setVals({ ...vals, [f]: e.target.value })} type={hidden(f) ? 'password' : 'text'}
                inputMode={/otp|code|pin|cvv/.test(f) ? 'numeric' : f === 'email' ? 'email' : undefined}
                autoComplete={/otp|code/.test(f) ? 'one-time-code' : f === 'password' ? 'current-password' : /user|email/.test(f) ? 'username' : 'off'}
                autoCapitalize="off" spellCheck={false} className={`min-w-0 flex-1 bg-transparent text-[15px] outline-none${kind === 'code' ? ' mono tracking-[.3em]' : ''}`} style={{ color: 'var(--ink)' }} />
              {/pass|key|token|secret|cvv|pin/.test(f) && (
                <button type="button" onClick={() => setShow({ ...show, [f]: !show[f] })} aria-label={show[f] ? 'Hide' : 'Show'} className="grid h-8 w-8 place-items-center rounded-lg" style={{ color: 'var(--ink-faint)' }}><Icon name="eye" size={16} /></button>
              )}
            </span>
          </label>
        ))}
        {loginish && canSave && (
          <label className="flex items-center gap-2 text-[12.5px]" style={{ color: 'var(--ink-dim)' }}><input type="checkbox" checked={save} onChange={(e) => setSave(e.target.checked)} /> Save to my vault as the login for {host}</label>
        )}
        <div className="flex gap-2 pt-1"><B grow onClick={onCancel}>Not now</B><B grow primary disabled={!all} onClick={() => onSubmit(vals, save)}><Icon name="lock" size={15} />{kind === 'login' ? 'Sign in securely' : 'Send securely'}</B></div>
        <p className="text-[11px]" style={{ color: 'var(--ink-faint)' }}>{kind === 'login' ? `Typed only into ${host || 'the site'} itself, never anywhere else.` : 'Used for this job only, then forgotten.'}</p>
      </div>
    </section>
  );
}

/* ── scheduled tasks ─────────────────────────────────────────────────────── */
export function SchedulesCard({ schedules, setSchedules, defaultTask, defaultMode }: { schedules: Schedule[]; setSchedules: (s: Schedule[]) => void; defaultTask: string; defaultMode: Mode }) {
  const [adding, setAdding] = useState(false);
  const [task, setTask] = useState('');
  const [every, setEvery] = useState<Schedule['every']>('day');
  const [time, setTime] = useState('08:00');
  const [weekday, setWeekday] = useState(1);
  const now = new Date();
  return (
    <section className="space-y-2">
      <div className="flex items-center justify-between px-1">
        <h3 className="mono text-[10.5px] uppercase tracking-wider" style={{ color: 'var(--ink-faint)' }}>Scheduled · {schedules.length}</h3>
        {!adding && <button type="button" onClick={() => { setAdding(true); setTask(defaultTask); }} className="mono text-[11px] font-semibold" style={{ color: 'hsl(18 88% 52%)' }}>+ schedule</button>}
      </div>
      {adding && (
        <div className="space-y-2 rounded-2xl border p-3" style={box}>
          <textarea value={task} onChange={(e) => setTask(e.target.value)} rows={2} placeholder="e.g. Give me the morning news brief" className={input + ' py-2.5'} style={inputStyle} />
          <div className="flex gap-2">
            <select value={every} onChange={(e) => setEvery(e.target.value as Schedule['every'])} className={input} style={inputStyle}><option value="day">Every day</option><option value="weekday">Mon–Fri</option><option value="week">Once a week</option></select>
            {every === 'week' && <select value={weekday} onChange={(e) => setWeekday(Number(e.target.value))} className={input} style={{ ...inputStyle, maxWidth: 90 }}>{DAYS.map((d, i) => <option key={d} value={i}>{d}</option>)}</select>}
            <input type="time" value={time} onChange={(e) => setTime(e.target.value)} className={input} style={{ ...inputStyle, maxWidth: 120 }} />
          </div>
          <div className="flex gap-2"><B grow onClick={() => setAdding(false)}>Cancel</B><B grow primary disabled={!task.trim() || !validTime(time)} onClick={() => { setSchedules([...schedules, { id: `sch_${Date.now().toString(36)}`, task: task.trim(), mode: defaultMode, every, time, weekday, on: true, createdAt: Date.now() }]); setAdding(false); }}>Save</B></div>
        </div>
      )}
      {schedules.map((s, i) => (
        <div key={s.id} className="flex items-center gap-3 rounded-2xl border px-3 py-2.5" style={box}>
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl" style={{ background: 'var(--surface)', color: 'var(--ink-dim)' }}><Icon name="clock" /></span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[13.5px] font-medium" style={{ color: 'var(--ink)' }}>{s.task}</span>
            <span className="mono block text-[11px]" style={{ color: 'var(--ink-faint)' }}>{describeSchedule(s)}{s.on ? ` · next ${nextRun(s, now)?.toLocaleString('en-IN', { weekday: 'short', hour: '2-digit', minute: '2-digit' }) ?? '—'}` : ' · paused'}</span>
          </span>
          <button type="button" role="switch" aria-checked={s.on} onClick={() => setSchedules(schedules.map((x, j) => (j === i ? { ...x, on: !x.on } : x)))} className="relative h-6 w-10 shrink-0 rounded-full" style={{ background: s.on ? GRAD : 'var(--line)' }} aria-label={s.on ? 'Pause' : 'Resume'}><span className="absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all" style={{ left: s.on ? 18 : 2 }} /></button>
          <button type="button" onClick={() => setSchedules(schedules.filter((_, j) => j !== i))} aria-label="Delete schedule" className="grid h-9 w-8 place-items-center" style={{ color: 'hsl(4 75% 56%)' }}><Icon name="x" size={15} /></button>
        </div>
      ))}
      {!adding && !schedules.length && <p className="px-1 text-[12px]" style={{ color: 'var(--ink-faint)' }}>Repeat a job on a timetable — a news brief every morning, a price check every Friday. It runs while Chomugiri is open.</p>}
    </section>
  );
}

/**
 * Runs due Scheduled tasks from anywhere in the app: once a minute it checks, marks the slot as run, hands the job to Handoff,
 * opens Handoff and raises a notification. Mounted once by the Workspace.
 */
export function HandoffScheduler() {
  useEffect(() => {
    let stop = false;
    const check = async () => {
      if (stop) return;
      const list = await getSetting<Schedule[]>(SCHEDULES_KEY, []).catch(() => [] as Schedule[]);
      const now = new Date();
      const due = (Array.isArray(list) ? list : []).find((s) => isDue(s, now));
      if (due) {
        await setSetting(SCHEDULES_KEY, list.map((s) => (s.id === due.id ? { ...s, lastRun: now.getTime() } : s)));
        queueHandoff(due.task, due.mode);
        useWorkspace.getState().setSuite('handoff');
        try { if (typeof Notification !== 'undefined' && Notification.permission === 'granted') new Notification('Handoff started', { body: due.task }); } catch { /* ignore */ }
      }
    };
    const t = setInterval(() => void check(), 60_000);
    const first = setTimeout(() => void check(), 5_000);
    return () => { stop = true; clearInterval(t); clearTimeout(first); };
  }, []);
  return null;
}

/** The sky behind the Handoff home, following the time of day (dawn, day, dusk, night). */
export function skyFor(hour: number): { bg: string; night: boolean; glyph: string } {
  if (hour >= 5 && hour < 8) return { bg: 'linear-gradient(180deg, hsl(28 85% 72% / .55), hsl(330 55% 70% / .25) 55%, transparent)', night: false, glyph: 'sunrise' };
  if (hour >= 8 && hour < 17) return { bg: 'linear-gradient(180deg, hsl(205 85% 66% / .45), hsl(195 80% 80% / .18) 60%, transparent)', night: false, glyph: 'sun' };
  if (hour >= 17 && hour < 20) return { bg: 'linear-gradient(180deg, hsl(18 90% 60% / .5), hsl(290 45% 45% / .28) 60%, transparent)', night: false, glyph: 'sunset' };
  return { bg: 'linear-gradient(180deg, hsl(235 55% 18% / .85), hsl(255 45% 28% / .4) 60%, transparent)', night: true, glyph: 'moon' };
}
