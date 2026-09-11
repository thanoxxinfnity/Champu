'use client';

import { useEffect, useState } from 'react';
import { db, isBrowser, type VaultRecord } from '@/lib/db/schema';
import { secretsToEnvObject } from '@/lib/security/secrets';
import { useWorkspace } from '@/lib/store';

/**
 * One-click Vercel deployment of the generated frontend artifacts.
 * Preflight runs before any upload: no token, no files, or no entry point are
 * all caught here rather than after a 40MB POST.
 */
export function DeployButton() {
  const files = useWorkspace((s) => s.files);
  const vercelToken = useWorkspace((s) => s.vercelToken);
  const vercelTeamId = useWorkspace((s) => s.vercelTeamId);
  const setLastDeploy = useWorkspace((s) => s.setLastDeploy);
  const lastDeploy = useWorkspace((s) => s.lastDeploy);
  const appendTerminal = useWorkspace((s) => s.appendTerminal);
  const setRightPaneTab = useWorkspace((s) => s.setRightPaneTab);

  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);
  const [projectName, setProjectName] = useState('chomugiri-app');
  const [vault, setVault] = useState<VaultRecord[]>([]);

  // Environment comes from the vault, never from the generated bundle — the
  // whole point of the vault is that a key is not in a file someone can read.
  useEffect(() => {
    if (!open || !isBrowser()) return;
    void db().vault.toArray().then(setVault).catch(() => undefined);
  }, [open]);

  const buildEnv = secretsToEnvObject(vault, 'build');

  const list = [...files.values()];
  const hasEntry = list.some((f) =>
    /^(index\.html|public\/index\.html|package\.json|app\/page\.(t|j)sx?|pages\/index\.(t|j)sx?|src\/app\/page\.(t|j)sx?)$/.test(f.path),
  );

  const deploy = async () => {
    setBusy(true);
    setRightPaneTab('terminal');
    appendTerminal({ stream: 'system', text: `▲ deploying ${list.length} files to Vercel as "${projectName}"…` });

    try {
      const res = await fetch('/api/vercel/deploy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          token: vercelToken,
          teamId: vercelTeamId || undefined,
          name: projectName,
          files: list.map((f) => ({ path: f.path, content: f.content })),
          target: 'production',
          env: Object.keys(buildEnv).length ? buildEnv : undefined,
          wait: true,
        }),
      });

      const data = (await res.json()) as {
        url?: string;
        inspectorUrl?: string;
        readyState?: string;
        project?: string;
        error?: string;
        note?: string;
      };

      if (!res.ok) {
        appendTerminal({ stream: 'stderr', text: `✘ ${data.error ?? `Vercel returned ${res.status}`}` });
        setLastDeploy({ url: null, inspectorUrl: data.inspectorUrl ?? null, readyState: data.readyState ?? 'ERROR', project: projectName, error: data.error, at: Date.now() });
        return;
      }

      appendTerminal({ stream: 'system', text: `✔ ${data.readyState} · ${data.url ?? 'no url returned'}` });
      if (data.note) appendTerminal({ stream: 'system', text: `  ${data.note}` });

      setLastDeploy({
        url: data.url ?? null,
        inspectorUrl: data.inspectorUrl ?? null,
        readyState: data.readyState ?? 'READY',
        project: data.project ?? projectName,
        at: Date.now(),
      });
      setOpen(false);
    } catch (err) {
      appendTerminal({ stream: 'stderr', text: `✘ ${(err as Error).message}` });
    } finally {
      setBusy(false);
    }
  };

  if (!list.length) return null;

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="mono flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[10.5px] transition-colors"
        style={{ borderColor: 'var(--line)', color: lastDeploy?.url ? 'var(--accent)' : 'var(--ink-dim)' }}
        title="Deploy the generated artifacts to Vercel"
      >
        ▲ deploy
      </button>

      {open && (
        <div
          className="absolute right-0 top-full z-30 mt-2 w-72 rounded-xl border p-3 shadow-2xl"
          style={{ borderColor: 'var(--line-strong)', background: 'var(--panel)' }}
        >
          <p className="mono mb-2 text-[9.5px] uppercase tracking-[0.12em]" style={{ color: 'var(--ink-faint)' }}>
            vercel deployment
          </p>

          <input
            value={projectName}
            onChange={(e) => setProjectName(e.target.value)}
            className="mono w-full rounded border bg-transparent px-2 py-1.5 text-[11px] outline-none"
            style={{ borderColor: 'var(--line)', color: 'var(--ink)' }}
            placeholder="project name"
          />

          <p className="mono mt-1.5 text-[10px] leading-[1.45]" style={{ color: 'var(--ink-faint)' }}>
            {list.length} file{list.length === 1 ? '' : 's'} in the bundle
            {vault.length > 0 && ` · ${Object.keys(buildEnv).length} env var${Object.keys(buildEnv).length === 1 ? '' : 's'} from the vault`}
          </p>

          {!vercelToken && (
            <p className="mt-1.5 text-[10.5px] leading-[1.45]" style={{ color: 'var(--color-amber)' }}>
              No Vercel token configured. Add one in Settings → Deployment.
            </p>
          )}

          {!hasEntry && (
            <p className="mt-1.5 text-[10.5px] leading-[1.45]" style={{ color: 'var(--color-amber)' }}>
              No entry point (index.html or package.json at the bundle root). Vercel would deploy an empty site.
            </p>
          )}

          <button
            type="button"
            onClick={() => void deploy()}
            disabled={busy || !vercelToken || !hasEntry}
            className="mono mt-2 w-full rounded px-3 py-2 text-[11px] font-medium disabled:opacity-35"
            style={{ background: 'var(--accent)', color: '#04150e' }}
          >
            {busy ? 'building…' : 'deploy to production'}
          </button>

          {lastDeploy?.url && (
            <a
              href={lastDeploy.url}
              target="_blank"
              rel="noopener noreferrer"
              className="mono mt-2 block truncate text-[10.5px]"
              style={{ color: 'var(--accent)' }}
            >
              ↗ {lastDeploy.url}
            </a>
          )}
        </div>
      )}
    </div>
  );
}
