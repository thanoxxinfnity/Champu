'use client';

import { useState } from 'react';
import { analyzeSource, inspectExe, type AnalysisResult, type ExeInspection } from '@/lib/suites/android/analyzer';
import { buildCommands, generateAndroidProject, toolchainPreflight } from '@/lib/suites/android/generator';
import { useWorkspace } from '@/lib/store';
import { executeCommand } from '@/lib/agent/runtime';
import { downloadZip, formatBytes } from '@/lib/zip';
import { unzipSync, strFromU8 } from 'fflate';

const TEXT_EXT = /\.(js|jsx|ts|tsx|py|cs|java|kt|cpp|c|h|hpp|html|css|xaml|json|xml|txt|md|toml|yml|yaml|ui|qml|pro|gradle)$/i;

export function AndroidStudio() {
  const upsertFile = useWorkspace((s) => s.upsertFile);
  const setRightPaneTab = useWorkspace((s) => s.setRightPaneTab);
  const heartbeat = useWorkspace((s) => s.heartbeat);
  const bridge = useWorkspace((s) => s.bridge);
  const appendTerminal = useWorkspace((s) => s.appendTerminal);
  const sessionId = useWorkspace((s) => s.sessionId);

  const [analysis, setAnalysis] = useState<AnalysisResult | null>(null);
  const [exe, setExe] = useState<ExeInspection | null>(null);
  const [appName, setAppName] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [generatedCount, setGeneratedCount] = useState(0);

  const online = heartbeat.status === 'online' || heartbeat.status === 'degraded';
  const preflight = heartbeat.health
    ? toolchainPreflight(heartbeat.health.toolchains)
    : { ready: false, problems: [{ issue: 'Bridge is offline.', fix: 'Start the agent and connect the tunnel to compile. Project generation works without it.' }] };

  const ingest = async (fileList: FileList) => {
    setBusy('reading');
    setExe(null);
    setAnalysis(null);

    const sources: Array<{ path: string; content: string }> = [];

    for (const file of [...fileList]) {
      if (/\.exe$/i.test(file.name)) {
        const bytes = new Uint8Array(await file.arrayBuffer());
        setExe(inspectExe(bytes));
        continue;
      }

      if (/\.(zip|asar)$/i.test(file.name)) {
        try {
          const unzipped = unzipSync(new Uint8Array(await file.arrayBuffer()));
          for (const [path, data] of Object.entries(unzipped)) {
            if (!TEXT_EXT.test(path) || data.length > 800_000) continue;
            sources.push({ path, content: strFromU8(data) });
          }
        } catch {
          /* not a readable archive */
        }
        continue;
      }

      if (TEXT_EXT.test(file.name) || file.type.startsWith('text/')) {
        sources.push({ path: file.webkitRelativePath || file.name, content: await file.text() });
      }
    }

    if (sources.length) {
      setAnalysis(analyzeSource(sources, appName || undefined));
    }
    setBusy(null);
  };

  const generate = () => {
    if (!analysis) return;
    const { files } = generateAndroidProject({ analysis: { ...analysis, appName: appName || analysis.appName } });

    for (const file of files) {
      upsertFile({
        kind: 'file',
        path: file.path,
        language: file.path.endsWith('.kt') ? 'kotlin' : file.path.endsWith('.xml') ? 'xml' : file.path.endsWith('.kts') ? 'kotlin' : 'text',
        content: file.content,
        complete: true,
        bytes: new TextEncoder().encode(file.content).length,
      });
    }

    setGeneratedCount(files.length);
    setRightPaneTab('files');
  };

  const buildApk = async () => {
    if (!analysis) return;
    setBusy('building');
    setRightPaneTab('terminal');

    const { files } = generateAndroidProject({ analysis: { ...analysis, appName: appName || analysis.appName } });
    const projectDir = (appName || analysis.appName).replace(/\W+/g, '');

    try {
      await bridge.writeFiles(files.map((f) => ({ path: `${projectDir}/${f.path}`, content: f.content })));
      appendTerminal({ stream: 'system', text: `⇪ wrote ${files.length} files to ${projectDir}/` });

      for (const command of buildCommands({ projectDir })) {
        const outcome = await executeCommand(command, { sessionId: sessionId ?? undefined, suite: 'android' });
        if (!outcome.ok && outcome.skipped !== 'offline') break;
      }

      const collected = await bridge.collect(['.apk', '.aab']);
      if (collected.count) {
        appendTerminal({
          stream: 'system',
          text: `📦 ${collected.collected.map((c) => `${c.name} (${formatBytes(c.bytes)})`).join(', ')}`,
        });
        for (const artifact of collected.collected) {
          appendTerminal({ stream: 'system', text: `   ${bridge.artifactUrl(artifact.name)}` });
        }
      } else {
        appendTerminal({ stream: 'system', text: '⚠  no APK found. Read the Gradle output above for the first error.' });
      }
    } catch (err) {
      appendTerminal({ stream: 'system', text: `✘ ${(err as Error).message}` });
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="h-full overflow-y-auto p-4">
      <div className="mx-auto w-full max-w-3xl space-y-4">
        <section className="rounded-xl border p-3" style={{ borderColor: 'var(--line)', background: 'var(--panel)' }}>
          <h3 className="mono mb-1.5 text-[10px] uppercase tracking-[0.12em]" style={{ color: 'var(--ink-faint)' }}>
            source ingest
          </h3>
          <p className="mb-2 text-[11px] leading-[1.5]" style={{ color: 'var(--ink-dim)' }}>
            Drop a desktop app&apos;s <strong>source</strong> — a folder, a .zip, an Electron .asar, Python, C#, Java or Qt
            files. A compiled <code>.exe</code> gets a triage report instead: binaries are not decompiled, so the report
            tells you which runtime it is and the exact command to recover source.
          </p>

          <div className="flex flex-wrap items-center gap-2">
            <input
              type="file"
              multiple
              onChange={(e) => {
                if (e.target.files?.length) void ingest(e.target.files);
                e.target.value = '';
              }}
              className="mono flex-1 text-[10.5px]"
              style={{ color: 'var(--ink-dim)' }}
            />
            <input
              value={appName}
              onChange={(e) => setAppName(e.target.value)}
              placeholder="app name"
              className="mono w-36 rounded border bg-transparent px-2 py-1.5 text-[11px] outline-none"
              style={{ borderColor: 'var(--line)', color: 'var(--ink)' }}
            />
          </div>

          {busy === 'reading' && (
            <p className="mono mt-1.5 text-[10.5px]" style={{ color: 'var(--accent)' }}>
              reading…
            </p>
          )}
        </section>

        {exe && (
          <section
            className="rounded-xl border p-3"
            style={{ borderColor: 'color-mix(in oklab, var(--color-amber) 35%, var(--line))', background: 'var(--panel)' }}
          >
            <h3 className="mono mb-1.5 text-[10px] uppercase tracking-[0.12em]" style={{ color: 'var(--color-amber)' }}>
              binary triage
            </h3>
            <p className="text-[11.5px] leading-[1.55]" style={{ color: 'var(--ink)' }}>
              {exe.verdict}
            </p>
            {exe.isPE && (
              <div className="mono mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-[10px]" style={{ color: 'var(--ink-faint)' }}>
                <span>arch · {exe.architecture}</span>
                <span>subsystem · {exe.subsystem}</span>
                <span>likely stack · {exe.likelyStack}</span>
                <span>imports · {exe.imports.length}</span>
              </div>
            )}
          </section>
        )}

        {analysis && (
          <>
            <section className="rounded-xl border p-3" style={{ borderColor: 'var(--line)', background: 'var(--panel)' }}>
              <h3 className="mono mb-2 text-[10px] uppercase tracking-[0.12em]" style={{ color: 'var(--ink-faint)' }}>
                analysis
              </h3>
              <div className="mono grid grid-cols-2 gap-x-4 gap-y-1 text-[11px]" style={{ color: 'var(--ink-dim)' }}>
                <span>
                  stack · <span style={{ color: 'var(--accent)' }}>{analysis.stack}</span> ({(analysis.confidence * 100).toFixed(0)}%)
                </span>
                <span>
                  target · <span style={{ color: 'var(--accent)' }}>{analysis.target}</span>
                </span>
                <span>ui elements · {analysis.ui.length}</span>
                <span>logic modules · {analysis.logicModules.length}</span>
                <span className="col-span-2 truncate">package · {analysis.packageName}</span>
              </div>

              {analysis.notes.length > 0 && (
                <ul className="mt-2 space-y-1">
                  {analysis.notes.map((note, i) => (
                    <li key={i} className="text-[10.5px] leading-[1.45]" style={{ color: 'var(--ink-faint)' }}>
                      · {note}
                    </li>
                  ))}
                </ul>
              )}
            </section>

            {analysis.blockers.length > 0 && (
              <section className="rounded-xl border p-3" style={{ borderColor: 'var(--line)', background: 'var(--panel)' }}>
                <h3 className="mono mb-2 text-[10px] uppercase tracking-[0.12em]" style={{ color: 'var(--ink-faint)' }}>
                  migration blockers
                </h3>
                <ul className="space-y-2">
                  {analysis.blockers.map((blocker, i) => (
                    <li key={i}>
                      <p className="text-[11.5px] font-medium" style={{ color: blocker.severity === 'blocker' ? 'var(--color-rose)' : 'var(--color-amber)' }}>
                        {blocker.severity === 'blocker' ? '🔴' : '🟡'} {blocker.issue}
                      </p>
                      <p className="mt-0.5 text-[10.5px] leading-[1.45]" style={{ color: 'var(--ink-dim)' }}>
                        {blocker.remedy}
                      </p>
                    </li>
                  ))}
                </ul>
              </section>
            )}

            <section className="rounded-xl border p-3" style={{ borderColor: 'var(--line)', background: 'var(--panel)' }}>
              <h3 className="mono mb-2 text-[10px] uppercase tracking-[0.12em]" style={{ color: 'var(--ink-faint)' }}>
                build
              </h3>

              {!preflight.ready && (
                <ul className="mb-2 space-y-1.5">
                  {preflight.problems.map((problem, i) => (
                    <li key={i} className="text-[10.5px] leading-[1.45]">
                      <span style={{ color: 'var(--color-amber)' }}>⚠ {problem.issue}</span>
                      <br />
                      <span style={{ color: 'var(--ink-faint)' }}>{problem.fix}</span>
                    </li>
                  ))}
                </ul>
              )}

              <div className="flex flex-wrap gap-1.5">
                <button
                  type="button"
                  onClick={generate}
                  className="mono flex-1 rounded px-3 py-2 text-[11px] font-medium"
                  style={{ background: 'var(--accent)', color: '#04150e' }}
                >
                  generate project
                </button>
                <button
                  type="button"
                  onClick={() => {
                    const { files } = generateAndroidProject({ analysis: { ...analysis, appName: appName || analysis.appName } });
                    downloadZip(files.map((f) => ({ path: f.path, content: f.content })), `${(appName || analysis.appName).replace(/\W+/g, '')}-android.zip`);
                  }}
                  className="mono rounded border px-3 py-2 text-[11px]"
                  style={{ borderColor: 'var(--line)', color: 'var(--ink-dim)' }}
                >
                  download .zip
                </button>
                <button
                  type="button"
                  onClick={() => void buildApk()}
                  disabled={!online || busy === 'building'}
                  className="mono rounded border px-3 py-2 text-[11px] disabled:opacity-35"
                  style={{ borderColor: online ? 'var(--accent)' : 'var(--line)', color: online ? 'var(--accent)' : 'var(--ink-faint)' }}
                  title={online ? 'Compile on the bridge host' : 'Bridge is offline'}
                >
                  {busy === 'building' ? 'building…' : 'build APK'}
                </button>
              </div>

              {generatedCount > 0 && (
                <p className="mono mt-1.5 text-[10px]" style={{ color: 'var(--accent)' }}>
                  ✔ {generatedCount} files in the file manager
                </p>
              )}
            </section>
          </>
        )}
      </div>
    </div>
  );
}
