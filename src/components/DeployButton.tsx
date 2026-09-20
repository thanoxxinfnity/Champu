'use client';

import { useEffect, useState } from 'react';
import { db, isBrowser, type VaultRecord } from '@/lib/db/schema';
import { secretsToEnvObject } from '@/lib/security/secrets';
import { useWorkspace } from '@/lib/store';
import { deployMode, hasEntryPoint, liveSite, preflight, recordAfter, targetProject } from '@/lib/deploy/state';

/**
 * Ship the generated site to Vercel.
 *
 * Two states, because they are two different intentions. The first time there
 * is nothing on the internet yet, so the action is **launch** and the project
 * name matters. Afterwards the site exists and has a URL people may already
 * have, so the action is **update** — same project, new version, same address.
 * Collapsing both into one "deploy" button hid that distinction and made it
 * far too easy to launch a second site instead of updating the first.
 *
 * Preflight runs before any upload: no token, no files, or no entry point are
 * all caught here rather than after a 40MB POST.
 */
export function DeployButton({ onOpenSettings }: { onOpenSettings?: () => void } = {}) {
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
  const [renaming, setRenaming] = useState(false);
  const [vault, setVault] = useState<VaultRecord[]>([]);

  // A site that has been launched owns its name — an update must go to the same
  // project or it silently becomes a different website. The decision lives in
  // lib/deploy/state so it can be tested without mounting a component.
  const live = liveSite(lastDeploy);
  const target = targetProject(lastDeploy, projectName, renaming);
  const mode = deployMode(lastDeploy, renaming);

  useEffect(() => {
    if (live && !renaming) setProjectName(live.project);
  }, [live, renaming]);

  // Environment comes from the vault, never from the generated bundle — the
  // whole point of the vault is that a key is not in a file someone can read.
  useEffect(() => {
    if (!open || !isBrowser()) return;
    void db().vault.toArray().then(setVault).catch(() => undefined);
  }, [open]);

  const buildEnv = secretsToEnvObject(vault, 'build');

  const list = [...files.values()];
  const paths = list.map((f) => f.path);
  const hasEntry = hasEntryPoint(paths);
  const check = preflight({ paths, token: vercelToken, projectName: target });

  const ship = async () => {
    setBusy(true);
    setRightPaneTab('terminal');
    const verb = mode === 'update' ? 'updating' : 'launching';
    appendTerminal({ stream: 'system', text: `▲ ${verb} "${target}" — ${list.length} files to Vercel…` });

    try {
      // No timeout at all meant a genuinely stuck deploy (not a slow-but-
      // progressing one — the server route caps itself at maxDuration) left
      // the "launching…" button spinning forever with no way to tell the two
      // apart. 310s gives the route's own 300s cap room to answer first.
      const res = await fetch('/api/vercel/deploy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          token: vercelToken,
          teamId: vercelTeamId || undefined,
          name: target,
          files: list.map((f) => ({ path: f.path, content: f.content })),
          target: 'production',
          env: Object.keys(buildEnv).length ? buildEnv : undefined,
          wait: true,
        }),
        signal: AbortSignal.timeout(310_000),
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
        // A failed update must not erase the site that is still live.
        setLastDeploy(
          recordAfter(lastDeploy, {
            ok: false,
            inspectorUrl: data.inspectorUrl,
            readyState: data.readyState,
            project: target,
            error: data.error,
          }),
        );
        return;
      }

      appendTerminal({ stream: 'system', text: `✔ ${data.readyState} · ${data.url ?? 'no url returned'}` });
      if (data.note) appendTerminal({ stream: 'system', text: `  ${data.note}` });

      setLastDeploy(
        recordAfter(lastDeploy, {
          ok: true,
          url: data.url ?? null,
          inspectorUrl: data.inspectorUrl ?? null,
          readyState: data.readyState ?? 'READY',
          project: data.project ?? target,
        }),
      );
      setRenaming(false);
      setOpen(false);
    } catch (err) {
      appendTerminal({ stream: 'stderr', text: `✘ ${(err as Error).message}` });
    } finally {
      setBusy(false);
    }
  };

  // Shown even with nothing to ship, so the path to deployment — and the reason
  // it is not available yet — is always visible rather than something the user
  // has to already know exists.
  const nothingToShip = check.reason === 'no-files';
  const blocked = !check.ready;

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="press mono flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[10.5px] transition-colors"
        style={{
          borderColor: live ? 'color-mix(in oklab, var(--accent) 45%, var(--line))' : 'var(--line)',
          color: live ? 'var(--accent)' : 'var(--ink-dim)',
        }}
        title={live ? `Update ${live.project}` : 'Launch the generated site on Vercel'}
      >
        {live ? '↻ update' : '▲ launch'}
      </button>

      {open && (
        <div
          className="enter-pop absolute right-0 top-full z-30 mt-2 w-[19rem] max-w-[calc(100vw-1.5rem)] rounded-xl border p-3 shadow-2xl"
          style={{ borderColor: 'var(--line-strong)', background: 'var(--panel)' }}
        >
          <p className="hand mb-1 text-[19px] leading-none">{live ? 'Update your site' : 'Launch your site'}</p>
          <p className="mono mb-2.5 text-[9.5px] uppercase tracking-[0.12em]" style={{ color: 'var(--ink-faint)' }}>
            vercel · production
          </p>

          {mode === 'update' && live ? (
            <div className="rounded-lg border p-2" style={{ borderColor: 'var(--line)', background: 'var(--surface)' }}>
              <p className="mono truncate text-[11px]" style={{ color: 'var(--ink)' }}>
                {live.project}
              </p>
              <p className="mono mt-0.5 text-[10px]" style={{ color: 'var(--ink-faint)' }}>
                live · {live.releases ?? 1} release{(live.releases ?? 1) === 1 ? '' : 's'} · updates keep this address
              </p>
              <button
                type="button"
                onClick={() => setRenaming(true)}
                className="mono mt-1.5 text-[10px] underline"
                style={{ color: 'var(--ink-dim)' }}
              >
                launch a separate site instead
              </button>
            </div>
          ) : (
            <>
              <input
                value={projectName}
                onChange={(e) => setProjectName(e.target.value)}
                className="mono w-full rounded border bg-transparent px-2 py-1.5 text-[11px] outline-none"
                style={{ borderColor: 'var(--line)', color: 'var(--ink)' }}
                placeholder="project name"
                aria-label="Project name"
              />
              {renaming && (
                <button
                  type="button"
                  onClick={() => setRenaming(false)}
                  className="mono mt-1 text-[10px] underline"
                  style={{ color: 'var(--ink-dim)' }}
                >
                  cancel — update {live?.project} instead
                </button>
              )}
            </>
          )}

          <p className="mono mt-1.5 text-[10px] leading-[1.45]" style={{ color: 'var(--ink-faint)' }}>
            {list.length} file{list.length === 1 ? '' : 's'} in the bundle
            {vault.length > 0 && ` · ${Object.keys(buildEnv).length} env var${Object.keys(buildEnv).length === 1 ? '' : 's'} from the vault`}
          </p>

          {nothingToShip && (
            <p className="mt-1.5 text-[10.5px] leading-[1.45]" style={{ color: 'var(--color-amber)' }}>
              Nothing to ship yet. Ask Chomugiri to build a site — the generated files appear in the Files pane, and this
              button ships them.
            </p>
          )}

          {!vercelToken && (
            <div className="mt-1.5">
              <p className="text-[10.5px] leading-[1.45]" style={{ color: 'var(--color-amber)' }}>
                No Vercel token yet. Create one at vercel.com/account/tokens, then paste it under Settings → API Keys.
              </p>
              {/* Naming the destination is not the same as getting there. */}
              {onOpenSettings && (
                <button
                  type="button"
                  onClick={() => {
                    setOpen(false);
                    onOpenSettings();
                  }}
                  className="press mono mt-1.5 w-full rounded-lg border px-2 py-1.5 text-[10.5px]"
                  style={{ borderColor: 'var(--color-amber)', color: 'var(--color-amber)' }}
                >
                  open Settings → API Keys
                </button>
              )}
            </div>
          )}

          {!nothingToShip && !hasEntry && (
            <p className="mt-1.5 text-[10.5px] leading-[1.45]" style={{ color: 'var(--color-amber)' }}>
              No entry point (index.html or package.json at the bundle root). Vercel would deploy an empty site.
            </p>
          )}

          <button
            type="button"
            onClick={() => void ship()}
            disabled={busy || blocked}
            className="press mono mt-2 w-full rounded-lg px-3 py-2 text-[11px] font-semibold disabled:opacity-35"
            style={{ background: 'var(--accent)', color: 'var(--panel)' }}
          >
            {busy ? (mode === 'update' ? 'updating…' : 'building…') : mode === 'update' ? '↻ update site' : '▲ launch site'}
          </button>

          {live?.url && (
            <div className="mt-2 flex gap-1.5">
              <a
                href={live.url}
                target="_blank"
                rel="noopener noreferrer"
                className="press mono flex-1 truncate rounded-lg border px-2 py-1.5 text-center text-[10.5px]"
                style={{ borderColor: 'color-mix(in oklab, var(--accent) 40%, var(--line))', color: 'var(--accent)' }}
              >
                ↗ open site
              </a>
              {live.inspectorUrl && (
                <a
                  href={live.inspectorUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="press mono shrink-0 rounded-lg border px-2 py-1.5 text-[10.5px]"
                  style={{ borderColor: 'var(--line)', color: 'var(--ink-dim)' }}
                  title="Build logs on Vercel"
                >
                  logs
                </a>
              )}
            </div>
          )}

          {lastDeploy?.error && (
            <p className="mt-1.5 text-[10.5px] leading-[1.45]" style={{ color: 'var(--color-danger)' }}>
              Last attempt failed: {lastDeploy.error}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
