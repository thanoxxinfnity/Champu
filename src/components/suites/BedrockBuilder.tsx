'use client';

import { useMemo, useState } from 'react';
import {
  addonEntries,
  buildAddon,
  validateAddon,
  type BlockSpec,
  type EntitySpec,
  type ItemSpec,
  type PackMeta,
} from '@/lib/suites/minecraft/bedrock';
import { mapJavaMod, parseJarManifest, specFromJarResources, type JavaModSpec, type MappingResult } from '@/lib/suites/minecraft/java-map';
import { downloadZip, formatBytes } from '@/lib/zip';
import { unzipSync, strFromU8 } from 'fflate';

const input = 'mono w-full rounded border bg-transparent px-2 py-1.5 text-[11px] outline-none';
const inputStyle = { borderColor: 'var(--line)', color: 'var(--ink)' } as const;

function Row({ children }: { children: React.ReactNode }) {
  return <div className="flex flex-wrap items-end gap-1.5">{children}</div>;
}

function Labelled({ label, children, className }: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <label className={`block ${className ?? ''}`}>
      <span className="mono block text-[9px] uppercase tracking-[0.1em]" style={{ color: 'var(--ink-faint)' }}>
        {label}
      </span>
      <div className="mt-0.5">{children}</div>
    </label>
  );
}

export function BedrockBuilder() {
  const [meta, setMeta] = useState<PackMeta>({
    name: 'My Addon',
    description: 'Built with Chomugiri.',
    namespace: 'chomu',
    version: [1, 0, 0],
    author: 'Chomugiri',
  });

  const [entities, setEntities] = useState<EntitySpec[]>([
    { name: 'sentinel', namespace: 'chomu', behavior: 'hostile', health: 30, movementSpeed: 0.28, attackDamage: 5 },
  ]);
  const [items, setItems] = useState<ItemSpec[]>([]);
  const [blocks, setBlocks] = useState<BlockSpec[]>([]);
  const [conversion, setConversion] = useState<MappingResult | null>(null);
  const [jarNotes, setJarNotes] = useState<string[]>([]);

  const built = useMemo(
    () =>
      buildAddon({
        meta,
        entities: entities.map((e) => ({ ...e, namespace: meta.namespace })),
        items: items.map((i) => ({ ...i, namespace: meta.namespace })),
        blocks: blocks.map((b) => ({ ...b, namespace: meta.namespace })),
        recipes: conversion?.recipes ?? [],
      }),
    [meta, entities, items, blocks, conversion],
  );

  const issues = useMemo(() => validateAddon(built), [built]);
  const errors = issues.filter((i) => i.severity === 'error');

  const exportPack = (kind: 'mcaddon' | 'bp' | 'rp') => {
    const slug = meta.name.toLowerCase().replace(/\W+/g, '_');
    if (kind === 'mcaddon') {
      downloadZip(addonEntries(built, meta), `${slug}.mcaddon`, 'application/octet-stream');
    } else if (kind === 'bp') {
      downloadZip(built.behaviorFiles, `${slug}_bp.mcpack`, 'application/octet-stream');
    } else {
      downloadZip(built.resourceFiles, `${slug}_rp.mcpack`, 'application/octet-stream');
    }
  };

  const importJar = async (file: File) => {
    setJarNotes([]);
    setConversion(null);

    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const unzipped = unzipSync(bytes);

      const listing = Object.entries(unzipped).map(([path, data]) => ({
        path,
        text:
          path.endsWith('.json') || path.endsWith('.toml') || path.endsWith('.mcmeta')
            ? strFromU8(data.subarray(0, 200_000))
            : undefined,
      }));

      const inspection = parseJarManifest(listing);
      const resources = listing
        .filter((f): f is { path: string; text: string } => Boolean(f.text))
        .filter((f) => f.path.startsWith('data/') || f.path.startsWith('assets/'));

      const spec: JavaModSpec = specFromJarResources(inspection, resources);
      const result = mapJavaMod(spec);

      setConversion(result);
      setJarNotes([
        `Loader: ${inspection.loader}${inspection.modId ? ` · mod id "${inspection.modId}"` : ''}`,
        ...inspection.notes,
      ]);

      if (result.blocks.length) setBlocks(result.blocks);
      if (result.items.length) setItems(result.items);
      if (result.entities.length) setEntities(result.entities);
      if (inspection.modId) setMeta((m) => ({ ...m, namespace: result.report.namespace, name: inspection.displayName ?? m.name }));
    } catch (err) {
      setJarNotes([`Could not read the archive: ${(err as Error).message}`]);
    }
  };

  const totalBytes = [...built.behaviorFiles, ...built.resourceFiles].reduce(
    (sum, f) => sum + (typeof f.content === 'string' ? f.content.length : f.content.length),
    0,
  );

  return (
    <div className="flex h-full min-h-0 flex-col overflow-y-auto p-4">
      <div className="mx-auto w-full max-w-3xl space-y-4">
        {/* ── Pack metadata ─────────────────────────────────────────────── */}
        <section className="rounded-xl border p-3" style={{ borderColor: 'var(--line)', background: 'var(--panel)' }}>
          <h3 className="mono mb-2 text-[10px] uppercase tracking-[0.12em]" style={{ color: 'var(--ink-faint)' }}>
            pack
          </h3>
          <Row>
            <Labelled label="name" className="flex-1">
              <input value={meta.name} onChange={(e) => setMeta({ ...meta, name: e.target.value })} className={input} style={inputStyle} />
            </Labelled>
            <Labelled label="namespace">
              <input
                value={meta.namespace}
                onChange={(e) => setMeta({ ...meta, namespace: e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '') })}
                className={`${input} w-28`}
                style={inputStyle}
              />
            </Labelled>
            <Labelled label="version">
              <input
                value={meta.version.join('.')}
                onChange={(e) => {
                  const parts = e.target.value.split('.').map((n) => Number(n) || 0);
                  setMeta({ ...meta, version: [parts[0] ?? 1, parts[1] ?? 0, parts[2] ?? 0] });
                }}
                className={`${input} w-20`}
                style={inputStyle}
              />
            </Labelled>
          </Row>
          <Labelled label="description" className="mt-1.5">
            <input value={meta.description} onChange={(e) => setMeta({ ...meta, description: e.target.value })} className={input} style={inputStyle} />
          </Labelled>
        </section>

        {/* ── Entities ──────────────────────────────────────────────────── */}
        <section className="rounded-xl border p-3" style={{ borderColor: 'var(--line)', background: 'var(--panel)' }}>
          <div className="mb-2 flex items-center">
            <h3 className="mono text-[10px] uppercase tracking-[0.12em]" style={{ color: 'var(--ink-faint)' }}>
              entities · {entities.length}
            </h3>
            <button
              type="button"
              onClick={() =>
                setEntities([...entities, { name: `entity_${entities.length + 1}`, namespace: meta.namespace, behavior: 'passive', health: 20, movementSpeed: 0.25 }])
              }
              className="mono ml-auto text-[10px]"
              style={{ color: 'var(--accent)' }}
            >
              + add
            </button>
          </div>

          <div className="space-y-2">
            {entities.map((entity, i) => (
              <div key={i} className="rounded-lg border p-2" style={{ borderColor: 'var(--line)' }}>
                <Row>
                  <Labelled label="name" className="flex-1">
                    <input
                      value={entity.name}
                      onChange={(e) => setEntities(entities.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))}
                      className={input}
                      style={inputStyle}
                    />
                  </Labelled>
                  <Labelled label="behavior">
                    <select
                      value={entity.behavior}
                      onChange={(e) => setEntities(entities.map((x, j) => (j === i ? { ...x, behavior: e.target.value as EntitySpec['behavior'] } : x)))}
                      className={`${input} w-24`}
                      style={{ ...inputStyle, background: 'var(--surface)' }}
                    >
                      <option value="passive">passive</option>
                      <option value="hostile">hostile</option>
                      <option value="ambient">ambient</option>
                    </select>
                  </Labelled>
                  <Labelled label="hp">
                    <input
                      type="number"
                      value={entity.health}
                      onChange={(e) => setEntities(entities.map((x, j) => (j === i ? { ...x, health: Number(e.target.value) || 1 } : x)))}
                      className={`${input} w-16`}
                      style={inputStyle}
                    />
                  </Labelled>
                  <Labelled label="speed">
                    <input
                      type="number"
                      step={0.01}
                      value={entity.movementSpeed}
                      onChange={(e) => setEntities(entities.map((x, j) => (j === i ? { ...x, movementSpeed: Number(e.target.value) || 0.25 } : x)))}
                      className={`${input} w-16`}
                      style={inputStyle}
                    />
                  </Labelled>
                  <button
                    type="button"
                    onClick={() => setEntities(entities.filter((_, j) => j !== i))}
                    className="mono pb-1.5 text-[10px]"
                    style={{ color: 'var(--color-rose)' }}
                  >
                    ✕
                  </button>
                </Row>
              </div>
            ))}
          </div>
        </section>

        {/* ── Items & blocks ───────────────────────────────────────────── */}
        <div className="grid gap-4 sm:grid-cols-2">
          <section className="rounded-xl border p-3" style={{ borderColor: 'var(--line)', background: 'var(--panel)' }}>
            <div className="mb-2 flex items-center">
              <h3 className="mono text-[10px] uppercase tracking-[0.12em]" style={{ color: 'var(--ink-faint)' }}>
                items · {items.length}
              </h3>
              <button
                type="button"
                onClick={() => setItems([...items, { name: `item_${items.length + 1}`, namespace: meta.namespace }])}
                className="mono ml-auto text-[10px]"
                style={{ color: 'var(--accent)' }}
              >
                + add
              </button>
            </div>
            <div className="space-y-1.5">
              {items.map((item, i) => (
                <Row key={i}>
                  <input
                    value={item.name}
                    onChange={(e) => setItems(items.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))}
                    className={`${input} flex-1`}
                    style={inputStyle}
                  />
                  <input
                    type="number"
                    placeholder="dura"
                    value={item.durability ?? ''}
                    onChange={(e) => setItems(items.map((x, j) => (j === i ? { ...x, durability: Number(e.target.value) || undefined } : x)))}
                    className={`${input} w-16`}
                    style={inputStyle}
                  />
                  <button type="button" onClick={() => setItems(items.filter((_, j) => j !== i))} className="mono text-[10px]" style={{ color: 'var(--color-rose)' }}>
                    ✕
                  </button>
                </Row>
              ))}
            </div>
          </section>

          <section className="rounded-xl border p-3" style={{ borderColor: 'var(--line)', background: 'var(--panel)' }}>
            <div className="mb-2 flex items-center">
              <h3 className="mono text-[10px] uppercase tracking-[0.12em]" style={{ color: 'var(--ink-faint)' }}>
                blocks · {blocks.length}
              </h3>
              <button
                type="button"
                onClick={() => setBlocks([...blocks, { name: `block_${blocks.length + 1}`, namespace: meta.namespace }])}
                className="mono ml-auto text-[10px]"
                style={{ color: 'var(--accent)' }}
              >
                + add
              </button>
            </div>
            <div className="space-y-1.5">
              {blocks.map((block, i) => (
                <Row key={i}>
                  <input
                    value={block.name}
                    onChange={(e) => setBlocks(blocks.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))}
                    className={`${input} flex-1`}
                    style={inputStyle}
                  />
                  <input
                    type="number"
                    step={0.1}
                    placeholder="hard"
                    value={block.destroyTime ?? ''}
                    onChange={(e) => setBlocks(blocks.map((x, j) => (j === i ? { ...x, destroyTime: Number(e.target.value) || undefined } : x)))}
                    className={`${input} w-16`}
                    style={inputStyle}
                  />
                  <button type="button" onClick={() => setBlocks(blocks.filter((_, j) => j !== i))} className="mono text-[10px]" style={{ color: 'var(--color-rose)' }}>
                    ✕
                  </button>
                </Row>
              ))}
            </div>
          </section>
        </div>

        {/* ── Java conversion ──────────────────────────────────────────── */}
        <section className="rounded-xl border p-3" style={{ borderColor: 'var(--line)', background: 'var(--panel)' }}>
          <h3 className="mono mb-1.5 text-[10px] uppercase tracking-[0.12em]" style={{ color: 'var(--ink-faint)' }}>
            java mod conversion
          </h3>
          <p className="mb-2 text-[11px] leading-[1.5]" style={{ color: 'var(--ink-dim)' }}>
            Drop a <code>.jar</code>. Its declarative registry — blocks, items, entity names, recipes, lang — converts.
            Compiled logic does not; the coverage report says exactly what did not carry across.
          </p>

          <input
            type="file"
            accept=".jar,.zip"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void importJar(file);
              e.target.value = '';
            }}
            className="mono w-full text-[10.5px]"
            style={{ color: 'var(--ink-dim)' }}
          />

          {jarNotes.map((note, i) => (
            <p key={i} className="mono mt-1.5 text-[10px] leading-[1.5]" style={{ color: 'var(--color-amber)' }}>
              {note}
            </p>
          ))}

          {conversion && (
            <div className="mt-2 rounded-lg border p-2.5" style={{ borderColor: 'var(--line)' }}>
              <p className="mono text-[10px]" style={{ color: 'var(--accent)' }}>
                coverage {conversion.report.coveragePct}% · {conversion.report.translated.length} translated ·{' '}
                {conversion.report.unmapped.length} unmapped
              </p>
              {conversion.report.unmapped.length > 0 && (
                <ul className="mt-1.5 space-y-1">
                  {conversion.report.unmapped.slice(0, 8).map((u, i) => (
                    <li key={i} className="text-[10px] leading-[1.45]" style={{ color: 'var(--ink-faint)' }}>
                      <span className="mono" style={{ color: 'var(--color-rose)' }}>
                        {u.kind}
                      </span>{' '}
                      {u.reason}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </section>

        {/* ── Validation & export ──────────────────────────────────────── */}
        <section className="rounded-xl border p-3" style={{ borderColor: 'var(--line)', background: 'var(--panel)' }}>
          <div className="mb-2 flex items-baseline gap-2">
            <h3 className="mono text-[10px] uppercase tracking-[0.12em]" style={{ color: 'var(--ink-faint)' }}>
              validation
            </h3>
            <span className="mono text-[10px]" style={{ color: 'var(--ink-faint)' }}>
              {built.behaviorFiles.length + built.resourceFiles.length} files · {formatBytes(totalBytes)}
            </span>
          </div>

          {issues.length === 0 ? (
            <p className="mono text-[10.5px]" style={{ color: 'var(--accent)' }}>
              ✔ no issues
            </p>
          ) : (
            <ul className="max-h-40 space-y-1 overflow-y-auto">
              {issues.map((issue, i) => (
                <li key={i} className="text-[10.5px] leading-[1.45]" style={{ color: issue.severity === 'error' ? 'var(--color-rose)' : 'var(--color-amber)' }}>
                  {issue.severity === 'error' ? '🔴' : '🟡'} <span className="mono">{issue.file}</span> — {issue.message}
                </li>
              ))}
            </ul>
          )}

          <div className="mt-3 flex flex-wrap gap-1.5">
            <button
              type="button"
              onClick={() => exportPack('mcaddon')}
              disabled={errors.length > 0}
              className="mono flex-1 rounded px-3 py-2 text-[11px] font-medium disabled:opacity-35"
              style={{ background: 'var(--accent)', color: '#04150e' }}
            >
              export .mcaddon
            </button>
            <button
              type="button"
              onClick={() => exportPack('bp')}
              disabled={errors.length > 0}
              className="mono rounded border px-3 py-2 text-[11px] disabled:opacity-35"
              style={{ borderColor: 'var(--line)', color: 'var(--ink-dim)' }}
            >
              BP .mcpack
            </button>
            <button
              type="button"
              onClick={() => exportPack('rp')}
              disabled={errors.length > 0}
              className="mono rounded border px-3 py-2 text-[11px] disabled:opacity-35"
              style={{ borderColor: 'var(--line)', color: 'var(--ink-dim)' }}
            >
              RP .mcpack
            </button>
          </div>
        </section>
      </div>
    </div>
  );
}
