'use client';

import { useCallback, useEffect, useState } from 'react';
import { withKeys } from '@/lib/keys';
import { db, isBrowser, type SkillRecord } from '@/lib/db/schema';
import { BUILTIN_SKILLS, parseGeneratedSkill, toRecord } from '@/lib/skills/registry';
import { useWorkspace } from '@/lib/store';
import { downloadText } from '@/lib/zip';

const field = 'mono w-full rounded border bg-transparent px-2 py-1.5 text-[11px] outline-none';
const fieldStyle = { borderColor: 'var(--line)', color: 'var(--ink)' } as const;

export function SkillsManager() {
  const selection = useWorkspace((s) => s.selection);

  const [skills, setSkills] = useState<SkillRecord[]>([]);
  const [editing, setEditing] = useState<SkillRecord | null>(null);
  const [generating, setGenerating] = useState(false);
  const [generatePrompt, setGeneratePrompt] = useState('');
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!isBrowser()) return;
    setSkills(await db().skills.toArray().catch(() => []));
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const save = async (record: SkillRecord) => {
    if (!isBrowser()) return;
    await db().skills.put({ ...record, updatedAt: Date.now() });
    await refresh();
    setEditing(null);
  };

  const remove = async (id: string) => {
    if (!isBrowser()) return;
    await db().skills.delete(id);
    await refresh();
  };

  /** Ask the model to author a new skill and persist whatever it returns. */
  const generateSkill = async () => {
    const brief = generatePrompt.trim();
    if (!brief) return;

    setGenerating(true);
    setError(null);

    try {
      const template = BUILTIN_SKILLS.find((s) => s.command === 'skill')!.template.replace('{{input}}', brief);

      const res = await fetch('/api/chat', withKeys({
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider: selection.provider,
          model: selection.model,
          stream: false,
          json: true,
          maxTokens: 2000,
          messages: [
            { role: 'system', content: 'You author reusable prompt skills. Reply with one JSON object and nothing else.' },
            { role: 'user', content: template },
          ],
        }),
      }));

      const data = (await res.json()) as { content?: string; error?: string };
      if (!res.ok || !data.content) {
        setError(data.error ?? 'The model returned nothing usable.');
        return;
      }

      const parsed = parseGeneratedSkill(data.content);
      if (!parsed) {
        setError('The model did not return a valid skill object. Try rephrasing the brief.');
        return;
      }

      await save({ ...toRecord(parsed, 'generated'), id: `skill_gen_${parsed.command}_${Date.now().toString(36)}` });
      setGeneratePrompt('');
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setGenerating(false);
    }
  };

  const installBuiltins = async () => {
    if (!isBrowser()) return;
    const existing = new Set(skills.map((s) => s.command));
    for (const builtin of BUILTIN_SKILLS) {
      if (existing.has(builtin.command)) continue;
      await db().skills.put(toRecord(builtin, 'builtin'));
    }
    await refresh();
  };

  return (
    <div className="h-full overflow-y-auto p-4">
      <div className="mx-auto w-full max-w-3xl space-y-4">
        <section className="rounded-xl border p-3" style={{ borderColor: 'var(--line)', background: 'var(--panel)' }}>
          <h3 className="mono mb-1.5 text-[10px] uppercase tracking-[0.12em]" style={{ color: 'var(--ink-faint)' }}>
            generate a skill
          </h3>
          <p className="mb-2 text-[11px] leading-[1.5]" style={{ color: 'var(--ink-dim)' }}>
            Describe what the command should do. The agent writes the prompt template and registers a{' '}
            <code>/trigger</code> for it.
          </p>
          <div className="flex gap-1.5">
            <input
              value={generatePrompt}
              onChange={(e) => setGeneratePrompt(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void generateSkill();
              }}
              placeholder="e.g. review a Dockerfile for security and image size"
              className={`${field} flex-1`}
              style={fieldStyle}
            />
            <button
              type="button"
              onClick={() => void generateSkill()}
              disabled={generating || !generatePrompt.trim()}
              className="mono shrink-0 rounded px-3 py-1.5 text-[11px] font-medium disabled:opacity-35"
              style={{ background: 'var(--accent)', color: '#04150e' }}
            >
              {generating ? '…' : 'author'}
            </button>
          </div>
          {error && (
            <p className="mono mt-1.5 text-[10.5px]" style={{ color: 'var(--color-rose)' }}>
              {error}
            </p>
          )}
        </section>

        <section className="rounded-xl border p-3" style={{ borderColor: 'var(--line)', background: 'var(--panel)' }}>
          <div className="mb-2 flex items-center gap-2">
            <h3 className="mono text-[10px] uppercase tracking-[0.12em]" style={{ color: 'var(--ink-faint)' }}>
              skills · {skills.length} stored, {BUILTIN_SKILLS.length} built in
            </h3>
            <button type="button" onClick={() => void installBuiltins()} className="mono ml-auto text-[10px]" style={{ color: 'var(--ink-dim)' }}>
              copy built-ins for editing
            </button>
            <button
              type="button"
              onClick={() =>
                setEditing({
                  id: `skill_${Date.now().toString(36)}`,
                  command: 'my-command',
                  name: 'My command',
                  description: '',
                  template: '',
                  kind: 'custom',
                  lane: 'B',
                  createdAt: Date.now(),
                  updatedAt: Date.now(),
                  usageCount: 0,
                  enabled: 1,
                  icon: '✦',
                })
              }
              className="mono text-[10px]"
              style={{ color: 'var(--accent)' }}
            >
              + new
            </button>
          </div>

          <div className="space-y-1.5">
            {[...skills, ...BUILTIN_SKILLS.filter((b) => !skills.some((s) => s.command === b.command)).map((b) => toRecord(b))].map((skill) => (
              <div key={skill.id} className="flex items-start gap-2 rounded-lg border px-2.5 py-2" style={{ borderColor: 'var(--line)' }}>
                <span className="mt-px shrink-0 text-[13px]" aria-hidden>{skill.icon ?? '✦'}</span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline gap-2">
                    <span className="mono text-[11.5px]" style={{ color: 'var(--accent)' }}>/{skill.command}</span>
                    <span
                      className="mono rounded px-1 py-0.5 text-[8.5px] uppercase"
                      style={{ background: 'var(--surface)', color: 'var(--ink-faint)' }}
                    >
                      {skill.kind}
                    </span>
                    {skill.usageCount > 0 && (
                      <span className="mono text-[9px]" style={{ color: 'var(--ink-faint)' }}>×{skill.usageCount}</span>
                    )}
                  </div>
                  <p className="mt-0.5 line-clamp-2 text-[10.5px] leading-[1.4]" style={{ color: 'var(--ink-dim)' }}>
                    {skill.description}
                  </p>
                </div>

                <div className="flex shrink-0 gap-1.5">
                  <button type="button" onClick={() => setEditing(skill)} className="mono text-[10px]" style={{ color: 'var(--ink-faint)' }}>
                    edit
                  </button>
                  {skills.some((s) => s.id === skill.id) && (
                    <button type="button" onClick={() => void remove(skill.id)} className="mono text-[10px]" style={{ color: 'var(--color-rose)' }}>
                      ✕
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>

          <button
            type="button"
            onClick={() => downloadText(JSON.stringify(skills, null, 2), 'chomugiri-skills.json', 'application/json')}
            className="mono mt-2 w-full rounded border px-2 py-1.5 text-[10px]"
            style={{ borderColor: 'var(--line)', color: 'var(--ink-faint)' }}
          >
            ↓ export skills
          </button>
        </section>

        {editing && (
          <section className="rounded-xl border p-3" style={{ borderColor: 'color-mix(in oklab, var(--accent) 35%, var(--line))', background: 'var(--panel)' }}>
            <h3 className="mono mb-2 text-[10px] uppercase tracking-[0.12em]" style={{ color: 'var(--accent)' }}>
              editing /{editing.command}
            </h3>

            <div className="flex flex-wrap items-end gap-1.5">
              <label className="w-32">
                <span className="mono block text-[9px] uppercase" style={{ color: 'var(--ink-faint)' }}>trigger</span>
                <input
                  value={editing.command}
                  onChange={(e) => setEditing({ ...editing, command: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '-') })}
                  className={field}
                  style={fieldStyle}
                />
              </label>
              <label className="min-w-32 flex-1">
                <span className="mono block text-[9px] uppercase" style={{ color: 'var(--ink-faint)' }}>name</span>
                <input value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} className={field} style={fieldStyle} />
              </label>
              <label className="w-16">
                <span className="mono block text-[9px] uppercase" style={{ color: 'var(--ink-faint)' }}>icon</span>
                <input value={editing.icon ?? ''} onChange={(e) => setEditing({ ...editing, icon: e.target.value })} className={field} style={fieldStyle} />
              </label>
              <label className="w-20">
                <span className="mono block text-[9px] uppercase" style={{ color: 'var(--ink-faint)' }}>lane</span>
                <select
                  value={editing.lane ?? 'B'}
                  onChange={(e) => setEditing({ ...editing, lane: e.target.value as 'A' | 'B' })}
                  className={field}
                  style={{ ...fieldStyle, background: 'var(--surface)' }}
                >
                  <option value="A">A</option>
                  <option value="B">B</option>
                </select>
              </label>
            </div>

            <label className="mt-1.5 block">
              <span className="mono block text-[9px] uppercase" style={{ color: 'var(--ink-faint)' }}>description</span>
              <input value={editing.description} onChange={(e) => setEditing({ ...editing, description: e.target.value })} className={field} style={fieldStyle} />
            </label>

            <label className="mt-1.5 block">
              <span className="mono block text-[9px] uppercase" style={{ color: 'var(--ink-faint)' }}>
                template · {'{{input}}'} = argument, {'{{files}}'} = attachments
              </span>
              <textarea
                value={editing.template}
                onChange={(e) => setEditing({ ...editing, template: e.target.value })}
                rows={10}
                className={`${field} resize-y`}
                style={fieldStyle}
              />
            </label>

            <div className="mt-2 flex gap-1.5">
              <button
                type="button"
                onClick={() => void save(editing)}
                disabled={!editing.command || !editing.template}
                className="mono flex-1 rounded px-3 py-2 text-[11px] font-medium disabled:opacity-35"
                style={{ background: 'var(--accent)', color: '#04150e' }}
              >
                save
              </button>
              <button
                type="button"
                onClick={() => setEditing(null)}
                className="mono rounded border px-3 py-2 text-[11px]"
                style={{ borderColor: 'var(--line)', color: 'var(--ink-dim)' }}
              >
                cancel
              </button>
            </div>
          </section>
        )}
      </div>
    </div>
  );
}
