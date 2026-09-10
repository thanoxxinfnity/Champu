'use client';

import { useMemo, useState } from 'react';
import {
  clientConfigs,
  scaffoldServer,
  starterSpec,
  validateSpec,
  type McpParameter,
  type McpServerSpec,
  type McpTool,
} from '@/lib/suites/mcp/scaffold';
import { useWorkspace } from '@/lib/store';
import { downloadZip } from '@/lib/zip';

const field = 'mono w-full rounded border bg-transparent px-2 py-1.5 text-[11px] outline-none';
const fieldStyle = { borderColor: 'var(--line)', color: 'var(--ink)' } as const;

export function McpBuilder() {
  const upsertFile = useWorkspace((s) => s.upsertFile);
  const setRightPaneTab = useWorkspace((s) => s.setRightPaneTab);

  const [spec, setSpec] = useState<McpServerSpec>(starterSpec);
  const [showConfigs, setShowConfigs] = useState(false);

  const issues = useMemo(() => validateSpec(spec), [spec]);
  const errors = issues.filter((i) => i.severity === 'error');
  const configs = useMemo(() => clientConfigs(spec), [spec]);

  const patchTool = (index: number, patch: Partial<McpTool>) =>
    setSpec((s) => ({ ...s, tools: s.tools.map((t, i) => (i === index ? { ...t, ...patch } : t)) }));

  const patchParam = (toolIndex: number, paramIndex: number, patch: Partial<McpParameter>) =>
    setSpec((s) => ({
      ...s,
      tools: s.tools.map((t, i) =>
        i === toolIndex ? { ...t, parameters: t.parameters.map((p, j) => (j === paramIndex ? { ...p, ...patch } : p)) } : t,
      ),
    }));

  const generate = () => {
    const { files } = scaffoldServer(spec);
    for (const file of files) {
      upsertFile({
        kind: 'file',
        path: file.path,
        language: file.path.endsWith('.ts') ? 'typescript' : file.path.endsWith('.py') ? 'python' : file.path.endsWith('.json') ? 'json' : file.path.endsWith('.md') ? 'markdown' : 'text',
        content: file.content,
        complete: true,
        bytes: new TextEncoder().encode(file.content).length,
      });
    }
    setRightPaneTab('files');
  };

  return (
    <div className="h-full overflow-y-auto p-4">
      <div className="mx-auto w-full max-w-3xl space-y-4">
        <section className="rounded-xl border p-3" style={{ borderColor: 'var(--line)', background: 'var(--panel)' }}>
          <h3 className="mono mb-2 text-[10px] uppercase tracking-[0.12em]" style={{ color: 'var(--ink-faint)' }}>
            server
          </h3>
          <div className="flex flex-wrap items-end gap-1.5">
            <label className="min-w-40 flex-1">
              <span className="mono block text-[9px] uppercase" style={{ color: 'var(--ink-faint)' }}>name</span>
              <input value={spec.name} onChange={(e) => setSpec({ ...spec, name: e.target.value })} className={field} style={fieldStyle} />
            </label>
            <label className="w-20">
              <span className="mono block text-[9px] uppercase" style={{ color: 'var(--ink-faint)' }}>version</span>
              <input value={spec.version} onChange={(e) => setSpec({ ...spec, version: e.target.value })} className={field} style={fieldStyle} />
            </label>
            <label className="w-28">
              <span className="mono block text-[9px] uppercase" style={{ color: 'var(--ink-faint)' }}>language</span>
              <select
                value={spec.language}
                onChange={(e) => setSpec({ ...spec, language: e.target.value as McpServerSpec['language'] })}
                className={field}
                style={{ ...fieldStyle, background: 'var(--surface)' }}
              >
                <option value="typescript">TypeScript</option>
                <option value="python">Python</option>
              </select>
            </label>
            <label className="w-24">
              <span className="mono block text-[9px] uppercase" style={{ color: 'var(--ink-faint)' }}>transport</span>
              <select
                value={spec.transport}
                onChange={(e) => setSpec({ ...spec, transport: e.target.value as McpServerSpec['transport'] })}
                className={field}
                style={{ ...fieldStyle, background: 'var(--surface)' }}
              >
                <option value="stdio">stdio</option>
                <option value="http">http</option>
              </select>
            </label>
          </div>
          <label className="mt-1.5 block">
            <span className="mono block text-[9px] uppercase" style={{ color: 'var(--ink-faint)' }}>description</span>
            <input value={spec.description} onChange={(e) => setSpec({ ...spec, description: e.target.value })} className={field} style={fieldStyle} />
          </label>
        </section>

        <section className="rounded-xl border p-3" style={{ borderColor: 'var(--line)', background: 'var(--panel)' }}>
          <div className="mb-2 flex items-center">
            <h3 className="mono text-[10px] uppercase tracking-[0.12em]" style={{ color: 'var(--ink-faint)' }}>
              tools · {spec.tools.length}
            </h3>
            <button
              type="button"
              onClick={() =>
                setSpec({
                  ...spec,
                  tools: [...spec.tools, { name: `tool_${spec.tools.length + 1}`, description: '', parameters: [] }],
                })
              }
              className="mono ml-auto text-[10px]"
              style={{ color: 'var(--accent)' }}
            >
              + add tool
            </button>
          </div>

          <div className="space-y-3">
            {spec.tools.map((tool, ti) => (
              <div key={ti} className="rounded-lg border p-2.5" style={{ borderColor: 'var(--line)' }}>
                <div className="flex flex-wrap items-end gap-1.5">
                  <label className="min-w-32 flex-1">
                    <span className="mono block text-[9px] uppercase" style={{ color: 'var(--ink-faint)' }}>name</span>
                    <input value={tool.name} onChange={(e) => patchTool(ti, { name: e.target.value })} className={field} style={fieldStyle} />
                  </label>
                  <label className="flex items-center gap-1 pb-2">
                    <input type="checkbox" checked={tool.readOnly ?? false} onChange={(e) => patchTool(ti, { readOnly: e.target.checked })} />
                    <span className="mono text-[10px]" style={{ color: 'var(--ink-dim)' }}>read-only</span>
                  </label>
                  <button
                    type="button"
                    onClick={() => setSpec({ ...spec, tools: spec.tools.filter((_, i) => i !== ti) })}
                    className="mono pb-2 text-[10px]"
                    style={{ color: 'var(--color-rose)' }}
                  >
                    ✕
                  </button>
                </div>

                <label className="mt-1.5 block">
                  <span className="mono block text-[9px] uppercase" style={{ color: 'var(--ink-faint)' }}>
                    description — the only thing the model selects on
                  </span>
                  <textarea
                    value={tool.description}
                    onChange={(e) => patchTool(ti, { description: e.target.value })}
                    rows={2}
                    placeholder="Search the indexed documentation and return the most relevant passages. Use this before answering any question about the project."
                    className={`${field} resize-y`}
                    style={fieldStyle}
                  />
                </label>

                <div className="mt-2">
                  <div className="mb-1 flex items-center">
                    <span className="mono text-[9px] uppercase" style={{ color: 'var(--ink-faint)' }}>
                      parameters
                    </span>
                    <button
                      type="button"
                      onClick={() =>
                        patchTool(ti, {
                          parameters: [...tool.parameters, { name: `param${tool.parameters.length + 1}`, type: 'string', description: '', required: true }],
                        })
                      }
                      className="mono ml-auto text-[9.5px]"
                      style={{ color: 'var(--accent)' }}
                    >
                      + param
                    </button>
                  </div>

                  {tool.parameters.map((param, pi) => (
                    <div key={pi} className="mb-1 flex flex-wrap items-center gap-1">
                      <input
                        value={param.name}
                        onChange={(e) => patchParam(ti, pi, { name: e.target.value })}
                        className={`${field} w-24`}
                        style={fieldStyle}
                        placeholder="name"
                      />
                      <select
                        value={param.type}
                        onChange={(e) => patchParam(ti, pi, { type: e.target.value as McpParameter['type'] })}
                        className={`${field} w-20`}
                        style={{ ...fieldStyle, background: 'var(--surface)' }}
                      >
                        {['string', 'number', 'integer', 'boolean', 'array', 'object'].map((t) => (
                          <option key={t} value={t}>{t}</option>
                        ))}
                      </select>
                      <input
                        value={param.description}
                        onChange={(e) => patchParam(ti, pi, { description: e.target.value })}
                        className={`${field} min-w-32 flex-1`}
                        style={fieldStyle}
                        placeholder="description"
                      />
                      <label className="flex items-center gap-1">
                        <input type="checkbox" checked={param.required} onChange={(e) => patchParam(ti, pi, { required: e.target.checked })} />
                        <span className="mono text-[9.5px]" style={{ color: 'var(--ink-faint)' }}>req</span>
                      </label>
                      <button
                        type="button"
                        onClick={() => patchTool(ti, { parameters: tool.parameters.filter((_, j) => j !== pi) })}
                        className="mono text-[10px]"
                        style={{ color: 'var(--color-rose)' }}
                      >
                        ✕
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </section>

        <section className="rounded-xl border p-3" style={{ borderColor: 'var(--line)', background: 'var(--panel)' }}>
          <h3 className="mono mb-2 text-[10px] uppercase tracking-[0.12em]" style={{ color: 'var(--ink-faint)' }}>
            validation
          </h3>
          {issues.length === 0 ? (
            <p className="mono text-[10.5px]" style={{ color: 'var(--accent)' }}>✔ spec is compliant</p>
          ) : (
            <ul className="max-h-40 space-y-1 overflow-y-auto">
              {issues.map((issue, i) => (
                <li key={i} className="text-[10.5px] leading-[1.45]" style={{ color: issue.severity === 'error' ? 'var(--color-rose)' : 'var(--color-amber)' }}>
                  {issue.severity === 'error' ? '🔴' : '🟡'} <span className="mono">{issue.path}</span> — {issue.message}
                </li>
              ))}
            </ul>
          )}

          <div className="mt-3 flex flex-wrap gap-1.5">
            <button
              type="button"
              onClick={generate}
              disabled={errors.length > 0}
              className="mono flex-1 rounded px-3 py-2 text-[11px] font-medium disabled:opacity-35"
              style={{ background: 'var(--accent)', color: '#04150e' }}
            >
              generate server
            </button>
            <button
              type="button"
              onClick={() => {
                const { files } = scaffoldServer(spec);
                downloadZip(files.map((f) => ({ path: f.path, content: f.content })), `${spec.name.toLowerCase().replace(/\W+/g, '-')}-mcp.zip`);
              }}
              disabled={errors.length > 0}
              className="mono rounded border px-3 py-2 text-[11px] disabled:opacity-35"
              style={{ borderColor: 'var(--line)', color: 'var(--ink-dim)' }}
            >
              download .zip
            </button>
            <button
              type="button"
              onClick={() => setShowConfigs((v) => !v)}
              className="mono rounded border px-3 py-2 text-[11px]"
              style={{ borderColor: 'var(--line)', color: 'var(--ink-dim)' }}
            >
              client configs
            </button>
          </div>

          {showConfigs && (
            <div className="mt-3 space-y-2">
              {Object.entries(configs).map(([label, snippet]) => (
                <div key={label}>
                  <div className="mono mb-1 flex items-center gap-2 text-[9.5px] uppercase tracking-[0.1em]" style={{ color: 'var(--ink-faint)' }}>
                    {label}
                    <button
                      type="button"
                      onClick={() => void navigator.clipboard.writeText(snippet)}
                      className="ml-auto normal-case"
                      style={{ color: 'var(--accent)' }}
                    >
                      copy
                    </button>
                  </div>
                  <pre className="mono overflow-x-auto rounded border p-2 text-[10px] leading-[1.55]" style={{ borderColor: 'var(--line)', background: 'var(--surface)', color: 'var(--ink-dim)' }}>
                    {snippet}
                  </pre>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
