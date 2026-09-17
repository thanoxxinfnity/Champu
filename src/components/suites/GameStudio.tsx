'use client';

/**
 * Game Studio.
 *
 * The Godot suite has always worked through chat; this is the panel for the
 * parts chat is bad at. Three of them:
 *
 *   - **Seeing the plan before the build.** The planner reads a sentence into a
 *     genre, a view, a player and a cast. Getting that wrong costs a whole
 *     project, and it is far cheaper to notice in a list than in a zip.
 *   - **Choosing the model.** Sketchfab search returns eight plausible zombies
 *     with different licences, face counts and file sizes. That is a decision
 *     with a picture attached, not a paragraph.
 *   - **Getting the file.** A zip and, when the bridge is up, an APK.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { planGame, planSummary, playerParts } from '@/lib/suites/godot/plan';
import { buildProject } from '@/lib/suites/godot/project';
import { buildGodotExport } from '@/lib/suites/godot/export';
import { generateModel, pipelineStatement } from '@/lib/suites/godot/model-source';
import { creditsFile, searchModels, type SketchfabModel } from '@/lib/suites/godot/sketchfab';
import { glbArtifact } from '@/lib/suites/godot/artifact';
import { loadKeys } from '@/lib/keys';
import { useWorkspace } from '@/lib/store';
import { downloadZip } from '@/lib/zip';

const field = 'mono w-full rounded border bg-transparent px-2 py-1.5 text-[11px] outline-none';
const fieldStyle = { borderColor: 'var(--line)', color: 'var(--ink)' } as const;

/**
 * A reference image, for the generators that take one rather than a prompt.
 *
 * Falls through to Pollinations, which needs no key: a user whose only
 * credential is a Kaggle token should still get meshes, and refusing for want
 * of an NVIDIA key would make the free path depend on a paid one.
 */
async function referenceImage(prompt: string): Promise<Uint8Array | null> {
  for (const body of [
    { provider: 'nim', model: 'black-forest-labs/flux.1-dev', prompt, width: 1024, height: 1024, steps: 30 },
    { provider: 'pollinations', prompt, width: 1024, height: 1024 },
  ]) {
    try {
      const res = await fetch('/api/image', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) continue;
      const json = (await res.json()) as { images?: Array<{ dataUrl?: string }> };
      const dataUrl = json.images?.[0]?.dataUrl;
      if (!dataUrl) continue;
      const bytes = Uint8Array.from(atob(dataUrl.slice(dataUrl.indexOf(',') + 1)), (c) => c.charCodeAt(0));
      if (bytes.byteLength > 1024) return bytes;
    } catch {
      // One provider refusing is not both refusing.
    }
  }
  return null;
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border p-3" style={{ borderColor: 'var(--line)', background: 'var(--panel)' }}>
      <h3 className="mono mb-2 text-[10px] uppercase tracking-[0.12em]" style={{ color: 'var(--ink-faint)' }}>
        {title}
      </h3>
      {children}
    </section>
  );
}

function bytesLabel(n: number): string {
  if (!n) return '—';
  return n > 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.round(n / 1024)} KB`;
}

export function GameStudio() {
  const upsertFile = useWorkspace((s) => s.upsertFile);
  const setRightPaneTab = useWorkspace((s) => s.setRightPaneTab);

  const [prompt, setPrompt] = useState('a zombie survival shooter called Chomu Game, first person');
  const [busy, setBusy] = useState('');
  const [note, setNote] = useState('');
  const [results, setResults] = useState<SketchfabModel[]>([]);
  const [chosen, setChosen] = useState<SketchfabModel | null>(null);
  const [pipeline, setPipeline] = useState('');

  // Shown rather than assumed. Someone who pasted a Sketchfab token and still
  // gets boxes should be able to see, without asking, that it was not picked up.
  useEffect(() => {
    let live = true;
    void loadKeys().then((k) => {
      if (live) {
        setPipeline(
          pipelineStatement({
            sketchfab: k.sketchfab,
            meshy: k.meshy,
            tripo: k.tripo,
            nim: k.nim,
            trellisUrl: k.trellisUrl,
          }),
        );
      }
    });
    return () => {
      live = false;
    };
  }, []);

  // Re-planned as you type. It is a pure function of the sentence, so there is
  // nothing to wait for and no reason to make anyone press a button to see it.
  const plan = useMemo(() => planGame(prompt.trim() || 'a game'), [prompt]);

  const search = useCallback(async () => {
    setBusy('Searching Sketchfab…');
    setNote('');
    try {
      const found = await searchModels(`${plan.player.description} ${plan.genre}`, { animatedOnly: true, count: 8 });
      const models = found.models.length
        ? found.models
        : (await searchModels(plan.entities[0]?.name ?? plan.player.description, { count: 8 })).models;
      setResults(models);
      if (!models.length) setNote(found.error ?? 'Nothing usable came back.');
    } catch (err) {
      setNote(`Sketchfab search failed: ${(err as Error).message}`);
    } finally {
      setBusy('');
    }
  }, [plan]);

  const build = useCallback(async () => {
    setBusy('Building the project…');
    setNote('');
    try {
      const keys = await loadKeys();
      const modelKeys = {
        sketchfab: keys.sketchfab,
        meshy: keys.meshy,
        tripo: keys.tripo,
        nim: keys.nim,
        trellisUrl: keys.trellisUrl,
        kaggle: keys.kaggle,
        huggingface: keys.huggingface,
      };

      const outcome = await generateModel(
        {
          prompt: chosen ? chosen.name : `${plan.player.description}, ${plan.genre} game character, realistic, detailed`,
          role: 'character',
          plan: plan.player.body,
          parts: playerParts(plan),
        },
        modelKeys,
        {
          onStage: (_source, message) => setBusy(message),
          // The first half of image-to-3D. Without it the Kaggle source cannot
          // be reached at all, and skips itself with a note saying why.
          renderImage: referenceImage,
        },
      );

      const modelPath = 'character.glb';
      const files = buildProject({
        name: plan.name,
        dimension: plan.dimension,
        genre: plan.genre,
        view: plan.view,
        models: [{ path: `res://${modelPath}`, node: 'Character', rigged: outcome.rigged }],
      }).map((f) => ({
        kind: 'file' as const,
        path: f.path,
        language: f.path.endsWith('.gd') ? 'gdscript' : f.path.endsWith('.md') ? 'markdown' : 'text',
        content: f.content,
        complete: true,
        bytes: new TextEncoder().encode(f.content).length,
      }));

      if (outcome.bytes) files.push(glbArtifact(modelPath, outcome.bytes));

      // The credit ships with the build, not in a message someone has to
      // remember to copy. Every CC Attribution licence requires it.
      const credit = outcome.credit ?? chosen;
      if (credit) {
        const content = creditsFile([credit]);
        files.push({
          kind: 'file',
          path: 'CREDITS.md',
          language: 'markdown',
          content,
          complete: true,
          bytes: new TextEncoder().encode(content).length,
        });
      }

      for (const file of files) upsertFile(file);
      setRightPaneTab('files');

      const exported = buildGodotExport(files, plan);
      if (!exported) {
        setNote('The project came out without a project.godot, which should be impossible. Nothing was downloaded.');
        return;
      }
      // Refused rather than shipped. A project that fails its own validation is
      // one that opens to an empty window, and finding that out on a phone is
      // worse than not getting a file.
      // buildGodotExport runs the runtime checks itself, on the completed set at
      // the paths Godot will see. Doing it again here is what got both copies
      // wrong the first time.
      if (exported.problems.length) {
        setNote(`Not shipping this — it would not run:\n${exported.problems.map((p) => `• ${p}`).join('\n')}`);
        return;
      }

      downloadZip(exported.entries, exported.filename);
      setNote(
        [
          `${exported.filename} — ${exported.entries.length} files, model from ${outcome.source}${outcome.rigged ? ', rigged' : ', not rigged'}.`,
          ...outcome.notes.map((n) => `• ${n}`),
          ...(credit ? [`• Credit for "${credit.name}" by ${credit.author} is in CREDITS.md — keep it with anything you ship.`] : []),
        ].join('\n'),
      );
    } catch (err) {
      setNote(`Build failed: ${(err as Error).message}`);
    } finally {
      setBusy('');
    }
  }, [plan, chosen, upsertFile, setRightPaneTab]);

  return (
    <div className="h-full overflow-y-auto p-4">
      <div className="mx-auto w-full max-w-3xl space-y-4">
        <Panel title="the game">
          <textarea
            className={field}
            style={{ ...fieldStyle, minHeight: 64, resize: 'vertical' }}
            value={prompt}
            spellCheck={false}
            onChange={(e) => setPrompt(e.target.value)}
          />
          <p className="mono mt-2 text-[10px]" style={{ color: 'var(--ink-faint)' }}>
            {plan.name} · {plan.dimension.toUpperCase()} {plan.genre} · {plan.view}
          </p>
        </Panel>

        <Panel title="the plan">
          <pre className="mono whitespace-pre-wrap text-[11px] leading-relaxed" style={{ color: 'var(--ink-dim)' }}>
            {planSummary(plan)}
          </pre>
        </Panel>

        <Panel title="the character model">
          {pipeline ? (
            <p className="mono mb-2 text-[10px]" style={{ color: 'var(--ink-faint)' }}>
              {pipeline}
            </p>
          ) : null}
          <div className="flex flex-wrap gap-2">
            <button
              className="mono rounded border px-3 py-1.5 text-[11px]"
              style={{ borderColor: 'var(--line)', color: 'var(--ink)' }}
              disabled={!!busy}
              onClick={search}
            >
              search sketchfab
            </button>
            {chosen ? (
              <button
                className="mono rounded border px-3 py-1.5 text-[11px]"
                style={{ borderColor: 'var(--line)', color: 'var(--ink-dim)' }}
                onClick={() => setChosen(null)}
              >
                clear pick — generate instead
              </button>
            ) : null}
          </div>

          {results.length ? (
            <ul className="mt-3 space-y-1.5">
              {results.map((m) => (
                <li key={m.uid}>
                  <button
                    className="flex w-full items-center gap-3 rounded border p-2 text-left"
                    style={{
                      borderColor: chosen?.uid === m.uid ? 'var(--accent)' : 'var(--line)',
                      background: chosen?.uid === m.uid ? 'color-mix(in oklab, var(--accent) 10%, transparent)' : undefined,
                    }}
                    onClick={() => setChosen(m)}
                  >
                    {m.thumbnail ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={m.thumbnail} alt="" width={64} height={36} className="rounded" style={{ objectFit: 'cover' }} />
                    ) : null}
                    <span className="min-w-0 flex-1">
                      <span className="mono block truncate text-[11px]" style={{ color: 'var(--ink)' }}>
                        {m.name}
                      </span>
                      <span className="mono block truncate text-[10px]" style={{ color: 'var(--ink-faint)' }}>
                        {m.author} · {m.licence} · {m.faceCount.toLocaleString()} faces · {bytesLabel(m.glbBytes)}
                        {m.animations ? ' · animated' : ' · static'}
                      </span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
        </Panel>

        <Panel title="build">
          <button
            className="mono rounded border px-3 py-1.5 text-[11px]"
            style={{ borderColor: 'var(--accent)', color: 'var(--accent)' }}
            disabled={!!busy}
            onClick={build}
          >
            {busy || 'build the project'}
          </button>
          {note ? (
            <pre className="mono mt-3 whitespace-pre-wrap text-[10.5px] leading-relaxed" style={{ color: 'var(--ink-dim)' }}>
              {note}
            </pre>
          ) : null}
        </Panel>
      </div>
    </div>
  );
}
