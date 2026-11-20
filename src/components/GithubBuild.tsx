'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { buildOnGitHub, canBuildApk, detectProject, type BuildOutcome, type ProjectFile } from '@/lib/deploy/github';
import { loadKeys } from '@/lib/keys';
import { useWorkspace, visibleFiles } from '@/lib/store';
import { Icon } from '@/components/Icon';

/**
 * Build an APK on GitHub Actions, with the user's own GitHub token.
 *
 * Two places show it: the header, for whatever project is in the Files pane, and the Android suite, for the project it
 * has just generated. Both hand over their files; this does the rest and shows each step as it happens, then the
 * download link (or the part of the log that says why it failed).
 *
 * A website has no APK, so for one this says so and points at Deploy (Vercel), which has its own token.
 */

interface Props {
  files: ProjectFile[];
  /** Name of the app: becomes the repository and the label under the icon. */
  title: string;
  onOpenSettings?: () => void;
  onTitleChange?: (title: string) => void;
}

export function GithubBuildCard({ files, title, onOpenSettings, onTitleChange }: Props) {
  const appendTerminal = useWorkspace((s) => s.appendTerminal);
  const [token, setToken] = useState('');
  const [isPublic, setIsPublic] = useState(true);
  const [busy, setBusy] = useState(false);
  const [steps, setSteps] = useState<string[]>([]);
  const [outcome, setOutcome] = useState<BuildOutcome | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const tokenLoaded = useRef(false);

  // The token is read from wherever the platform keeps it (the native store in the APK), on every open.
  useEffect(() => {
    let alive = true;
    void loadKeys().then((k) => {
      if (alive) {
        setToken(k.github);
        tokenLoaded.current = true;
      }
    });
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    if (!busy) return;
    const startedAt = Date.now();
    const id = setInterval(() => setElapsed(Math.floor((Date.now() - startedAt) / 1000)), 500);
    return () => clearInterval(id);
  }, [busy]);

  const kind = detectProject(files.map((f) => f.path));
  const buildable = canBuildApk(kind);

  const start = useCallback(async () => {
    setBusy(true);
    setError(null);
    setOutcome(null);
    setSteps([]);
    setElapsed(0);
    const say = (text: string) => {
      setSteps((prev) => [...prev, text]);
      appendTerminal({ stream: 'system', text: `github · ${text}` });
    };
    try {
      const result = await buildOnGitHub({ token, files, title, isPublic, onStep: say });
      setOutcome(result);
      if (result.dropped.length) appendTerminal({ stream: 'system', text: `github · left out ${result.dropped.length} file(s) the build writes itself: ${result.dropped.slice(0, 3).join(', ')}` });
      if (result.ok) appendTerminal({ stream: 'system', text: `github · APK: ${result.apkUrl}` });
      else appendTerminal({ stream: 'stderr', text: `github · build failed\n${result.log ?? ''}` });
    } catch (err) {
      const message = (err as Error).message;
      setError(message);
      appendTerminal({ stream: 'stderr', text: `github · ${message}` });
    } finally {
      setBusy(false);
    }
  }, [appendTerminal, files, isPublic, title, token]);

  const dim = { color: 'var(--ink-faint)' } as const;

  return (
    <div data-testid="github-build">
      <p className="mono mb-2 text-[9.5px] uppercase tracking-[0.12em]" style={dim}>
        github actions · {kind === 'flutter' ? 'flutter' : kind === 'gradle' ? 'android (gradle)' : kind}
      </p>

      {!buildable && (
        <p className="text-[10.5px] leading-[1.45]" style={{ color: 'var(--color-amber)' }}>
          {kind === 'web'
            ? 'This is a website, so there is no APK to build. Use Deploy to put it online with your Vercel token.'
            : 'Nothing to build yet: a Flutter project needs pubspec.yaml, an Android project needs settings.gradle.kts.'}
        </p>
      )}

      {buildable && (
        <>
          {onTitleChange && (
            <input
              value={title}
              onChange={(e) => onTitleChange(e.target.value)}
              className="mono mb-2 w-full rounded border bg-transparent px-2 py-1.5 text-[11px] outline-none"
              style={{ borderColor: 'var(--line)', color: 'var(--ink)' }}
              placeholder="app name"
              aria-label="App name"
            />
          )}
          <label className="mono mb-2 flex items-center gap-1.5 text-[10.5px]" style={{ color: 'var(--ink-dim)' }}>
            <input type="checkbox" checked={!isPublic} onChange={(e) => setIsPublic(!e.target.checked)} />
            private repository (the download link then needs a GitHub login)
          </label>

          {!token && (
            <div className="mb-2">
              <p className="text-[10.5px] leading-[1.45]" style={{ color: 'var(--color-amber)' }}>
                No GitHub token yet. Create one at github.com/settings/tokens (classic, scopes repo and workflow), then paste it under Settings → API Keys.
              </p>
              {onOpenSettings && (
                <button
                  type="button"
                  onClick={onOpenSettings}
                  className="press mono mt-1.5 w-full rounded-lg border px-2 py-1.5 text-[10.5px]"
                  style={{ borderColor: 'var(--color-amber)', color: 'var(--color-amber)' }}
                >
                  open Settings → API Keys
                </button>
              )}
            </div>
          )}

          <button
            type="button"
            onClick={() => void start()}
            disabled={busy || !token || files.length === 0}
            className="press mono w-full rounded-lg px-3 py-2 text-[11px] font-semibold disabled:opacity-35"
            style={{ background: 'var(--accent)', color: 'var(--panel)' }}
            data-testid="github-build-start"
          >
            {busy ? `building on GitHub… ${elapsed}s` : <span className="inline-flex items-center gap-1.5"><Icon name="android" size={14} />build APK on GitHub</span>}
          </button>
          <p className="mono mt-1.5 text-[10px] leading-[1.45]" style={dim}>
            {files.length} file{files.length === 1 ? '' : 's'} are pushed to a repository of yours; GitHub Actions builds the APK (about 4 to 8 minutes). The APK is signed with a fixed public sideload key, so a new build installs over the last one.
          </p>
        </>
      )}

      {steps.length > 0 && (
        <ol className="mono mt-2 space-y-0.5 text-[10px] leading-[1.4]" style={{ color: 'var(--ink-dim)' }} role="status" aria-live="polite">
          {steps.map((s, i) => (
            <li key={i} style={{ opacity: i === steps.length - 1 && busy ? 1 : 0.7 }}>
              {i === steps.length - 1 && busy ? '› ' : '✓ '}
              {s}
            </li>
          ))}
        </ol>
      )}

      {error && (
        <p className="mt-2 whitespace-pre-wrap text-[10.5px] leading-[1.45]" style={{ color: 'var(--color-danger)' }} role="alert">
          {error}
        </p>
      )}

      {outcome?.ok && outcome.apkUrl && (
        <div className="mt-2 flex gap-1.5">
          <a
            href={outcome.apkUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="press mono flex-1 truncate rounded-lg border px-2 py-1.5 text-center text-[10.5px]"
            style={{ borderColor: 'color-mix(in oklab, var(--accent) 40%, var(--line))', color: 'var(--accent)' }}
            data-testid="github-build-apk"
          >
            <span className="inline-flex items-center gap-1.5"><Icon name="download" size={14} />download the APK</span>
          </a>
          {outcome.runUrl && (
            <a href={outcome.runUrl} target="_blank" rel="noopener noreferrer" className="press mono shrink-0 rounded-lg border px-2 py-1.5 text-[10.5px]" style={{ borderColor: 'var(--line)', color: 'var(--ink-dim)' }}>
              run
            </a>
          )}
        </div>
      )}

      {outcome && !outcome.ok && (
        <div className="mt-2">
          <p className="text-[10.5px] leading-[1.45]" style={{ color: 'var(--color-danger)' }}>The build failed. The end of the log:</p>
          <pre className="mono mt-1 max-h-40 overflow-auto whitespace-pre-wrap rounded border p-1.5 text-[9.5px]" style={{ borderColor: 'var(--line)', color: 'var(--ink-dim)' }}>{outcome.log}</pre>
          <div className="mt-1.5 flex gap-1.5">
            <button
              type="button"
              className="press mono rounded border px-2 py-1 text-[10px]"
              style={{ borderColor: 'var(--line)', color: 'var(--ink-dim)' }}
              onClick={() => void navigator.clipboard?.writeText(outcome.log ?? '')}
            >
              copy log
            </button>
            {outcome.runUrl && (
              <a href={outcome.runUrl} target="_blank" rel="noopener noreferrer" className="press mono rounded border px-2 py-1 text-[10px]" style={{ borderColor: 'var(--line)', color: 'var(--ink-dim)' }}>
                open the run
              </a>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/** Header button for the project in the Files pane. Shown only for a project that can become an APK. */
export function GithubBuildButton({ onOpenSettings }: { onOpenSettings?: () => void }) {
  const files = useWorkspace(visibleFiles);
  const [open, setOpen] = useState(false);
  const list: ProjectFile[] = [...files.values()].map((f) => ({ path: f.path, content: f.content }));
  const pubspecName = /^name:\s*["']?([A-Za-z0-9_]+)/m.exec(files.get('pubspec.yaml')?.content ?? '')?.[1];
  const [title, setTitle] = useState('');
  const shownTitle = title || pubspecName || 'chomugiri-app';

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="press mono flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[10.5px] transition-colors"
        style={{ borderColor: 'var(--line)', color: 'var(--ink-dim)' }}
        title="Build the APK on GitHub Actions"
        data-testid="github-build-open"
      >
        <span className="inline-flex items-center gap-1"><Icon name="android" size={13} />apk</span>
      </button>
      {open && (
        <div className="enter-pop absolute right-0 top-full z-30 mt-2 w-[19rem] max-w-[calc(100vw-1.5rem)] rounded-xl border p-3 shadow-2xl" style={{ borderColor: 'var(--line-strong)', background: 'var(--panel)' }}>
          <p className="hand mb-1 text-[19px] leading-none">Build the APK</p>
          <GithubBuildCard
            files={list}
            title={shownTitle}
            onTitleChange={setTitle}
            onOpenSettings={() => {
              setOpen(false);
              onOpenSettings?.();
            }}
          />
        </div>
      )}
    </div>
  );
}
