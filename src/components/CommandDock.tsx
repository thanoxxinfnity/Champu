'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useWorkspace, type ChatAttachment } from '@/lib/store';
import { send } from '@/lib/agent/runtime';
import { BUILTIN_SKILLS, expandSkill, parseSlash, searchSkills, type SkillDefinition } from '@/lib/skills/registry';
import { classifyLocal } from '@/lib/agent/router';
import { formatBytes } from '@/lib/zip';
import { hasBlockingSecret, maskSecret, redact, scanForSecrets, suggestEnvName, validateSecretName, type SecretMatch } from '@/lib/security/secrets';
import type { VaultRecord } from '@/lib/db/schema';
import type { SkillRecord } from '@/lib/db/schema';
import { db, isBrowser } from '@/lib/db/schema';

const TEXT_EXTENSIONS =
  /\.(txt|md|markdown|json|jsonc|ya?ml|toml|ini|cfg|conf|env|csv|tsv|xml|html?|css|scss|less|js|jsx|mjs|cjs|ts|tsx|py|rb|go|rs|java|kt|kts|swift|c|h|cpp|hpp|cs|sh|bash|zsh|ps1|sql|gradle|properties|lock|gitignore|dockerfile|mcfunction|lang|vue|svelte|astro)$/i;

const MAX_INLINE_TEXT = 400_000;
const MAX_ATTACHMENT_BYTES = 24 * 1024 * 1024;

async function readAttachment(file: File): Promise<ChatAttachment> {
  const base: ChatAttachment = {
    id: `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`,
    name: file.name,
    kind: file.type || 'application/octet-stream',
    bytes: file.size,
  };

  if (file.size > MAX_ATTACHMENT_BYTES) return base;

  if (file.type.startsWith('image/')) {
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(file);
    }).catch(() => '');
    return { ...base, dataUrl: dataUrl || undefined };
  }

  const looksTextual = file.type.startsWith('text/') || /json|xml|javascript|typescript|yaml/.test(file.type) || TEXT_EXTENSIONS.test(file.name);
  if (looksTextual) {
    const text = await file.text().catch(() => '');
    return { ...base, text: text.slice(0, MAX_INLINE_TEXT), kind: base.kind === 'application/octet-stream' ? 'text/plain' : base.kind };
  }

  return base;
}

/**
 * Credential guard.
 *
 * Sits between the input and the send button. A key pasted into a chat box is
 * the most common way one leaks, and by the time it reaches a model provider it
 * has to be treated as compromised — so this blocks the send outright rather
 * than warning after the fact.
 */
function SecretGuard({
  matches,
  onRedact,
  onVault,
  onDismiss,
}: {
  matches: SecretMatch[];
  onRedact: () => void;
  onVault: (match: SecretMatch) => void;
  onDismiss: () => void;
}) {
  const blocking = hasBlockingSecret(matches);

  return (
    <div
      className="enter-pop mb-2 overflow-hidden rounded-xl border"
      style={{
        borderColor: blocking
          ? 'color-mix(in oklab, var(--color-rose) 45%, var(--line))'
          : 'color-mix(in oklab, var(--color-amber) 45%, var(--line))',
        background: blocking
          ? 'color-mix(in oklab, var(--color-rose) 8%, var(--panel))'
          : 'color-mix(in oklab, var(--color-amber) 7%, var(--panel))',
      }}
      role="alert"
    >
      <div className="flex items-start gap-2.5 px-3 py-2.5">
        <span className="mt-px shrink-0 text-[13px]" aria-hidden>
          {blocking ? '🔒' : '⚠'}
        </span>
        <div className="min-w-0 flex-1">
          <p
            className="text-[12px] font-medium leading-5"
            style={{ color: blocking ? 'var(--color-rose)' : 'var(--color-amber)' }}
          >
            {blocking
              ? 'Sending is blocked — this message contains a credential.'
              : 'This looks like it might contain a credential.'}
          </p>

          <ul className="mt-1.5 space-y-1">
            {matches.map((match, i) => (
              <li key={`${match.start}-${i}`} className="flex flex-wrap items-center gap-1.5">
                <span className="mono text-[10.5px]" style={{ color: 'var(--ink)' }}>
                  {match.label}
                </span>
                <code
                  className="mono rounded px-1.5 py-0.5 text-[10px]"
                  style={{ background: 'var(--surface)', color: 'var(--ink-faint)' }}
                >
                  {maskSecret(match.value)}
                </code>
                <button
                  type="button"
                  onClick={() => onVault(match)}
                  className="press mono rounded px-1.5 py-0.5 text-[10px]"
                  style={{ background: 'color-mix(in oklab, var(--accent) 15%, transparent)', color: 'var(--accent)' }}
                >
                  → Secrets
                </button>
              </li>
            ))}
          </ul>

          <p className="mt-1.5 text-[10.5px] leading-[1.45]" style={{ color: 'var(--ink-faint)' }}>
            {matches[0]?.advice}
          </p>

          <div className="mt-2 flex flex-wrap gap-1.5">
            <button
              type="button"
              onClick={onRedact}
              className="press mono rounded-lg px-2.5 py-1.5 text-[10.5px] font-medium"
              style={{ background: 'var(--accent)', color: '#04150e' }}
            >
              redact and continue
            </button>
            {!blocking && (
              <button
                type="button"
                onClick={onDismiss}
                className="press mono rounded-lg border px-2.5 py-1.5 text-[10.5px]"
                style={{ borderColor: 'var(--line)', color: 'var(--ink-dim)' }}
              >
                it is a placeholder — send anyway
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

/** Slash-command palette. */
function SkillPalette({
  query,
  skills,
  selected,
  onPick,
}: {
  query: string;
  skills: Array<SkillRecord | SkillDefinition>;
  selected: number;
  onPick: (skill: SkillRecord | SkillDefinition) => void;
}) {
  const matches = useMemo(() => searchSkills(query, skills), [query, skills]);
  if (!matches.length) return null;

  return (
    <div
      className="enter-pop absolute bottom-full left-0 right-0 mb-2 max-h-72 overflow-y-auto rounded-2xl border"
      style={{
        borderColor: 'var(--line-strong)',
        background: 'color-mix(in oklab, var(--panel) 94%, transparent)',
        backdropFilter: 'blur(14px) saturate(1.3)',
        WebkitBackdropFilter: 'blur(14px) saturate(1.3)',
        boxShadow: '0 24px 60px -24px rgba(0,0,0,0.85)',
      }}
      role="listbox"
    >
      {matches.map(({ skill }, i) => (
        <button
          key={skill.command}
          type="button"
          onMouseDown={(e) => {
            e.preventDefault();
            onPick(skill);
          }}
          className="enter-fade flex w-full items-start gap-2.5 px-3 py-2.5 text-left"
          style={{
            background: i === selected ? 'color-mix(in oklab, var(--accent) 11%, transparent)' : undefined,
            boxShadow: i === selected ? 'inset 2px 0 0 var(--accent)' : undefined,
            animationDelay: `${Math.min(i, 8) * 24}ms`,
            transition: 'background var(--dur-fast) var(--ease-out), box-shadow var(--dur-fast) var(--ease-out)',
          }}
          role="option"
          aria-selected={i === selected}
        >
          <span className="mt-px shrink-0 text-[14px]" aria-hidden>
            {'icon' in skill ? (skill.icon ?? '⌘') : '⌘'}
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex items-baseline gap-2">
              <span className="mono text-[12px] font-medium" style={{ color: 'var(--accent)' }}>
                /{skill.command}
              </span>
              {'argHint' in skill && skill.argHint && (
                <span className="mono truncate text-[10px]" style={{ color: 'var(--ink-faint)' }}>
                  {skill.argHint}
                </span>
              )}
              {'lane' in skill && skill.lane && (
                <span
                  className="mono ml-auto shrink-0 rounded px-1 py-0.5 text-[9px] uppercase"
                  style={{
                    background: skill.lane === 'B' ? 'color-mix(in oklab, var(--accent) 16%, transparent)' : 'color-mix(in oklab, var(--color-indigo) 16%, transparent)',
                    color: skill.lane === 'B' ? 'var(--accent)' : 'var(--color-indigo)',
                  }}
                >
                  {skill.lane}
                </span>
              )}
            </div>
            <p className="mt-0.5 truncate text-[11px] leading-4" style={{ color: 'var(--ink-dim)' }}>
              {skill.description}
            </p>
          </div>
        </button>
      ))}
    </div>
  );
}

/** Model quick switcher. */
function ModelSwitcher() {
  const models = useWorkspace((s) => s.models);
  const selection = useWorkspace((s) => s.selection);
  const setSelection = useWorkspace((s) => s.setSelection);
  const loadModels = useWorkspace((s) => s.loadModels);
  const loading = useWorkspace((s) => s.modelsLoading);

  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState('');
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  const chatModels = useMemo(
    () =>
      models
        .filter((m) => m.capabilities.includes('chat'))
        .filter((m) => !filter || `${m.label} ${m.id} ${m.vendor}`.toLowerCase().includes(filter.toLowerCase())),
    [models, filter],
  );

  const grouped = useMemo(() => {
    const groups = new Map<string, typeof chatModels>();
    for (const m of chatModels) {
      const key = m.provider === 'pollinations' ? 'Pollinations (zero-key)' : m.vendor;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(m);
    }
    return [...groups.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [chatModels]);

  const active = models.find((m) => m.provider === selection.provider && m.id === selection.model);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="press glow-accent mono flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[11px]"
        style={{ borderColor: 'var(--line)', color: 'var(--ink-dim)' }}
        title={active ? `${active.vendor} · ${active.id}` : selection.model}
      >
        <span
          className="h-1.5 w-1.5 rounded-full"
          style={{ background: selection.provider === 'nim' ? 'var(--accent)' : selection.provider === 'pollinations' ? 'var(--color-amber)' : 'var(--color-indigo)' }}
          aria-hidden
        />
        <span className="max-w-40 truncate">{active?.label ?? selection.model.split('/').pop()}</span>
        {active?.capabilities.includes('reasoning') && (
          <span style={{ color: 'var(--color-indigo)' }} title="Emits reasoning tokens">
            ⚛
          </span>
        )}
        <span aria-hidden style={{ color: 'var(--ink-faint)' }}>
          ▾
        </span>
      </button>

      {open && (
        <div
          className="enter-pop absolute bottom-full right-0 mb-2 flex max-h-[420px] w-80 flex-col overflow-hidden rounded-2xl border"
          style={{
            borderColor: 'var(--line-strong)',
            background: 'color-mix(in oklab, var(--panel) 94%, transparent)',
            backdropFilter: 'blur(14px) saturate(1.3)',
            WebkitBackdropFilter: 'blur(14px) saturate(1.3)',
            boxShadow: '0 24px 60px -24px rgba(0,0,0,0.85)',
          }}
        >
          <div className="flex shrink-0 items-center gap-2 border-b px-2.5 py-2" style={{ borderColor: 'var(--line)' }}>
            <input
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="filter models…"
              autoFocus
              className="mono flex-1 bg-transparent text-[11.5px] outline-none"
              style={{ color: 'var(--ink)' }}
            />
            <button
              type="button"
              onClick={() => void loadModels(true)}
              className="mono text-[10px]"
              style={{ color: 'var(--ink-faint)' }}
              title="Re-probe provider catalogues"
            >
              {loading ? '…' : '↻'}
            </button>
          </div>

          <div className="flex-1 overflow-y-auto py-1">
            {grouped.length === 0 && (
              <p className="mono px-3 py-4 text-center text-[11px] leading-4" style={{ color: 'var(--ink-faint)' }}>
                No models available.
                <br />
                Add NVIDIA_NIM_API_KEY, or use Pollinations
                <br />
                or Duck.ai — neither needs a key.
              </p>
            )}

            {grouped.map(([vendor, list]) => (
              <div key={vendor}>
                <div
                  className="mono sticky top-0 px-3 py-1.5 text-[9.5px] uppercase tracking-[0.14em]"
                  style={{ color: 'var(--ink-faint)', background: 'var(--panel)' }}
                >
                  {vendor}
                </div>
                {list.map((model) => {
                  const isActive = model.provider === selection.provider && model.id === selection.model;
                  const unreachable = model.origin === 'partner-only';
                  // Reachable, just not in-app: picking it hands the prompt to
                  // duck.ai in a new tab. Selectable, and badged so that is no surprise.
                  const handoff = model.origin === 'browser-only';
                  return (
                    <button
                      key={`${model.provider}:${model.id}`}
                      type="button"
                      disabled={unreachable}
                      onClick={() => {
                        setSelection({ provider: model.provider, model: model.id });
                        setOpen(false);
                      }}
                      className="flex w-full items-center gap-2 px-3 py-1.5 text-left disabled:cursor-not-allowed"
                      style={{
                        background: isActive ? 'color-mix(in oklab, var(--accent) 12%, transparent)' : undefined,
                        boxShadow: isActive ? 'inset 2px 0 0 var(--accent)' : undefined,
                        opacity: unreachable ? 0.45 : 1,
                        transition: 'background var(--dur-fast) var(--ease-out)',
                      }}
                      title={model.note}
                    >
                      <span
                        className="mono truncate text-[11.5px]"
                        style={{ color: isActive ? 'var(--accent)' : 'var(--ink)' }}
                      >
                        {model.label}
                      </span>
                      <span className="ml-auto flex shrink-0 gap-1">
                        {handoff && (
                          <span
                            className="text-[9px]"
                            style={{ color: 'var(--color-indigo)' }}
                            title="Free on duck.ai — opens in a new tab with your prompt"
                          >
                            ↗
                          </span>
                        )}
                        {model.capabilities.includes('reasoning') && (
                          <span className="text-[9px]" style={{ color: 'var(--color-indigo)' }} title="reasoning">
                            ⚛
                          </span>
                        )}
                        {model.capabilities.includes('vision') && (
                          <span className="text-[9px]" style={{ color: 'var(--color-amber)' }} title="vision">
                            ◉
                          </span>
                        )}
                        {model.origin === 'alias' && (
                          <span className="mono text-[9px]" style={{ color: 'var(--ink-faint)' }} title={model.note}>
                            alias
                          </span>
                        )}
                        {unreachable && (
                          <span className="mono text-[9px]" style={{ color: 'var(--color-amber)' }} title={model.note}>
                            partner
                          </span>
                        )}
                      </span>
                    </button>
                  );
                })}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Bottom command dock: prompt input, attachments, slash palette, lane indicator
 * and the model switcher.
 */
export function CommandDock() {
  const thinking = useWorkspace((s) => s.thinking);
  const activeSuite = useWorkspace((s) => s.activeSuite);
  const heartbeat = useWorkspace((s) => s.heartbeat);
  const draftsEnabled = useWorkspace((s) => s.draftsEnabled);
  const setDraftsEnabled = useWorkspace((s) => s.setDraftsEnabled);

  const [value, setValue] = useState('');
  const [attachments, setAttachments] = useState<ChatAttachment[]>([]);
  const [customSkills, setCustomSkills] = useState<SkillRecord[]>([]);
  const [paletteIndex, setPaletteIndex] = useState(0);
  const [dragOver, setDragOver] = useState(false);
  const [laneOverride, setLaneOverride] = useState<'A' | 'B' | null>(null);
  const [guardDismissed, setGuardDismissed] = useState(false);

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!isBrowser()) return;
    void db().skills.where('enabled').equals(1).toArray().then(setCustomSkills).catch(() => undefined);
  }, []);

  const allSkills = useMemo<Array<SkillRecord | SkillDefinition>>(
    () => [...customSkills, ...BUILTIN_SKILLS.filter((b) => !customSkills.some((c) => c.command === b.command))],
    [customSkills],
  );

  const parsed = parseSlash(value);
  const showPalette = value.startsWith('/') && !value.includes('\n');
  const paletteQuery = showPalette ? value.slice(1).split(/\s/)[0] : '';
  const matches = useMemo(
    () => (showPalette ? searchSkills(paletteQuery, allSkills) : []),
    [showPalette, paletteQuery, allSkills],
  );

  const classification = useMemo(
    () => (value.trim() && !showPalette ? classifyLocal(value, { hasAttachments: attachments.length > 0 }) : null),
    [value, showPalette, attachments.length],
  );

  // Scans the draft text and every attached text file — a key pasted into an
  // attached .env is the same leak as one typed into the box.
  const secretMatches = useMemo(() => {
    const bodies = [value, ...attachments.map((a) => a.text ?? '')].filter(Boolean);
    return bodies.flatMap((body) => scanForSecrets(body));
  }, [value, attachments]);

  const blocked = hasBlockingSecret(secretMatches) || (secretMatches.length > 0 && !guardDismissed);

  useEffect(() => {
    if (secretMatches.length === 0) setGuardDismissed(false);
  }, [secretMatches.length]);

  const vaultSecret = useCallback(async (match: SecretMatch) => {
    if (!isBrowser()) return;
    const name = window.prompt('Store as which environment variable?', suggestEnvName(match));
    if (!name) return;

    const invalid = validateSecretName(name);
    if (invalid) {
      window.alert(invalid);
      return;
    }

    const now = Date.now();
    const record: VaultRecord = {
      id: `vault_${now.toString(36)}`,
      name,
      value: match.value,
      scope: 'both',
      targets: ['production', 'preview', 'development'],
      note: `Captured from the chat input (${match.label}).`,
      createdAt: now,
      updatedAt: now,
    };
    await db().vault.put(record).catch(() => undefined);
    setValue((v) => redact(v, scanForSecrets(v)));
  }, []);

  const effectiveLane = laneOverride ?? classification?.lane ?? null;

  // Autosize the textarea.
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 260)}px`;
  }, [value]);

  const addFiles = useCallback(async (files: FileList | File[]) => {
    const parsedFiles = await Promise.all([...files].slice(0, 20).map(readAttachment));
    setAttachments((prev) => [...prev, ...parsedFiles].slice(0, 20));
  }, []);

  const applySkill = useCallback(
    (skill: SkillRecord | SkillDefinition) => {
      const rest = value.replace(/^\/[a-z0-9-]*\s*/i, '');
      setValue(`/${skill.command} ${rest}`.trimEnd() + ' ');
      textareaRef.current?.focus();
    },
    [value],
  );

  const submit = useCallback(async () => {
    if (thinking.active) return;
    // Belt and braces — the button is disabled, but Enter must not bypass it.
    if (hasBlockingSecret(scanForSecrets(value))) return;
    const raw = value.trim();
    if (!raw && !attachments.length) return;

    let input = raw;
    let lane = laneOverride ?? undefined;
    let suite = activeSuite;

    const command = parseSlash(raw);
    if (command) {
      const skill = allSkills.find((s) => s.command === command.command);
      if (skill) {
        input = expandSkill(skill, command.args, attachments);
        lane = laneOverride ?? (skill.lane as 'A' | 'B' | undefined);
        if (skill.suite) suite = skill.suite;

        if (isBrowser() && 'usageCount' in skill) {
          void db().skills.update(skill.id, { usageCount: skill.usageCount + 1 }).catch(() => undefined);
        }
      }
      // Unknown slash command falls through as literal text — the model can
      // still act on it, which beats swallowing the turn with an error toast.
    }

    setValue('');
    setAttachments([]);
    setLaneOverride(null);

    await send({ input, attachments, suite, forceLane: lane });
  }, [value, attachments, thinking.active, laneOverride, activeSuite, allSkills]);

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (showPalette && matches.length) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setPaletteIndex((i) => (i + 1) % matches.length);
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setPaletteIndex((i) => (i - 1 + matches.length) % matches.length);
        return;
      }
      if (e.key === 'Tab' || (e.key === 'Enter' && !parsed?.args)) {
        e.preventDefault();
        applySkill(matches[paletteIndex].skill);
        setPaletteIndex(0);
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        setValue('');
        return;
      }
    }

    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void submit();
    }
  };

  const bridgeDown = heartbeat.status === 'offline' || heartbeat.status === 'unauthorized';

  return (
    <div
      className="relative shrink-0 px-3 pb-3 pt-1"
      onDragOver={(e) => {
        e.preventDefault();
        setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragOver(false);
        if (e.dataTransfer.files.length) void addFiles(e.dataTransfer.files);
      }}
    >
      <div className="relative mx-auto max-w-4xl">
        {showPalette && (
          <SkillPalette
            query={paletteQuery}
            skills={allSkills}
            selected={paletteIndex}
            onPick={(skill) => {
              applySkill(skill);
              setPaletteIndex(0);
            }}
          />
        )}

        {secretMatches.length > 0 && !guardDismissed && (
          <SecretGuard
            matches={secretMatches}
            onRedact={() => {
              setValue((v) => redact(v, scanForSecrets(v)));
              setAttachments((prev) => prev.map((a) => (a.text ? { ...a, text: redact(a.text, scanForSecrets(a.text)) } : a)));
            }}
            onVault={(m) => void vaultSecret(m)}
            onDismiss={() => setGuardDismissed(true)}
          />
        )}

        <div
          className="dock-focus rounded-2xl border"
          style={{
            borderColor: dragOver ? 'var(--accent)' : 'var(--line-strong)',
            background: 'color-mix(in oklab, var(--panel) 92%, transparent)',
            backdropFilter: 'blur(16px) saturate(1.4)',
            WebkitBackdropFilter: 'blur(16px) saturate(1.4)',
            boxShadow: dragOver
              ? '0 0 0 4px color-mix(in oklab, var(--accent) 16%, transparent), 0 18px 44px -22px rgba(0,0,0,0.8)'
              : '0 18px 44px -22px rgba(0,0,0,0.8)',
          }}
        >
          {attachments.length > 0 && (
            <div className="flex flex-wrap gap-1.5 border-b px-3 py-2" style={{ borderColor: 'var(--line)' }}>
              {attachments.map((a) => (
                <span
                  key={a.id}
                  className="enter-pop press mono flex items-center gap-1.5 rounded-md border px-2 py-1 text-[10.5px]"
                  style={{ borderColor: 'var(--line)', background: 'var(--surface)', color: 'var(--ink-dim)' }}
                >
                  {a.dataUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={a.dataUrl} alt="" className="h-4 w-4 rounded-sm object-cover" />
                  ) : (
                    <span style={{ color: a.text ? 'var(--accent)' : 'var(--ink-faint)' }}>◆</span>
                  )}
                  <span className="max-w-40 truncate">{a.name}</span>
                  <span style={{ color: 'var(--ink-faint)' }}>{formatBytes(a.bytes)}</span>
                  <button
                    type="button"
                    onClick={() => setAttachments((prev) => prev.filter((x) => x.id !== a.id))}
                    style={{ color: 'var(--ink-faint)' }}
                    aria-label={`Remove ${a.name}`}
                  >
                    ✕
                  </button>
                </span>
              ))}
            </div>
          )}

          <textarea
            ref={textareaRef}
            value={value}
            onChange={(e) => {
              setValue(e.target.value);
              setPaletteIndex(0);
            }}
            onKeyDown={onKeyDown}
            onPaste={(e) => {
              const files = [...e.clipboardData.files];
              if (files.length) {
                e.preventDefault();
                void addFiles(files);
              }
            }}
            rows={1}
            placeholder={
              thinking.active
                ? 'running…'
                : 'Ask, or describe what to build.  /  for commands.  Shift+Enter for a newline.'
            }
            disabled={thinking.active}
            className="w-full resize-none bg-transparent px-4 py-3 text-[14px] leading-[1.55] outline-none placeholder:opacity-45 disabled:opacity-50"
            style={{ color: 'var(--ink)' }}
            aria-label="Prompt"
          />

          <div className="flex items-center gap-2 px-2.5 pb-2.5">
            <input
              ref={fileInputRef}
              type="file"
              multiple
              className="hidden"
              onChange={(e) => {
                if (e.target.files?.length) void addFiles(e.target.files);
                e.target.value = '';
              }}
            />

            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="press glow-accent mono flex items-center gap-1 rounded-lg border px-2 py-1.5 text-[11px]"
              style={{ borderColor: 'var(--line)', color: 'var(--ink-dim)' }}
              title="Attach images, code or documents"
            >
              ＋
            </button>

            {effectiveLane && (
              <button
                type="button"
                onClick={() => setLaneOverride(effectiveLane === 'A' ? 'B' : 'A')}
                className="press mono rounded-lg border px-2 py-1.5 text-[10.5px]"
                style={{
                  borderColor: laneOverride ? 'var(--accent)' : 'var(--line)',
                  color: effectiveLane === 'B' ? 'var(--accent)' : 'var(--color-indigo)',
                }}
                title={
                  effectiveLane === 'B'
                    ? 'Lane B — autonomous execution. Click to force Lane A.'
                    : 'Lane A — technical discourse. Click to force Lane B.'
                }
              >
                Lane {effectiveLane}
                {laneOverride && <span style={{ color: 'var(--ink-faint)' }}> ⟲</span>}
              </button>
            )}

            <button
              type="button"
              onClick={() => setDraftsEnabled(!draftsEnabled)}
              aria-pressed={draftsEnabled}
              className="press mono rounded-lg border px-2 py-1.5 text-[10.5px]"
              style={{
                borderColor: draftsEnabled ? 'color-mix(in oklab, var(--accent-alt) 50%, var(--line))' : 'var(--line)',
                color: draftsEnabled ? 'var(--accent-alt)' : 'var(--ink-faint)',
                background: draftsEnabled ? 'color-mix(in oklab, var(--accent-alt) 10%, transparent)' : undefined,
              }}
              title={
                draftsEnabled
                  ? 'Two alternatives, you pick one. Costs two completions per turn — and on NVIDIA NIM they run one after the other, because its free tier allows only one request at a time.'
                  : 'Generate two alternative answers and pick one.'
              }
            >
              ⑂ drafts
            </button>

            {bridgeDown && (
              <span
                className="mono hidden items-center gap-1 rounded-lg px-2 py-1.5 text-[10px] sm:flex"
                style={{ background: 'color-mix(in oklab, var(--color-amber) 12%, transparent)', color: 'var(--color-amber)' }}
                title={heartbeat.lastError ?? 'Terminal bridge is offline. Terminal steps will be parked.'}
              >
                bridge {heartbeat.status}
              </span>
            )}

            <div className="ml-auto flex items-center gap-2">
              <ModelSwitcher />

              <button
                type="button"
                onClick={() => void submit()}
                disabled={thinking.active || blocked || (!value.trim() && !attachments.length)}
                className="press mono rounded-lg px-3.5 py-1.5 text-[11.5px] font-semibold disabled:opacity-30"
                style={{
                  background: 'linear-gradient(135deg, var(--accent), color-mix(in oklab, var(--accent) 62%, var(--accent-alt)))',
                  color: '#04150e',
                  boxShadow: '0 4px 16px -6px color-mix(in oklab, var(--accent) 70%, transparent)',
                }}
              >
                {thinking.active ? '…' : blocked ? '🔒' : 'run'}
              </button>
            </div>
          </div>
        </div>

        <p className="mono mt-1.5 text-center text-[9.5px]" style={{ color: 'var(--ink-faint)' }}>
          {blocked
            ? 'blocked — remove or vault the credential above'
            : classification && !showPalette
              ? `routed to Lane ${classification.lane} — ${classification.reason}`
              : 'Chomugiri · talk less, work more'}
        </p>
      </div>
    </div>
  );
}
