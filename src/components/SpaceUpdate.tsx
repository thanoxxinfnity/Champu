'use client';

/**
 * "Update my Hugging Face terminal": shown when the terminal is a Hugging Face Space on an older bridge. One tap commits a
 * Dockerfile to the Space that fetches the newest bridge each time it starts (see lib/bridge/hf-space.ts), using the Hugging Face
 * token saved in API Keys. Says plainly what it changes and that a rebuild erases the Space's workspace; the same Dockerfile can
 * be copied for doing it by hand.
 */
import { useState } from 'react';
import { useWorkspace } from '@/lib/store';
import { loadKeys } from '@/lib/keys';
import { SPACE_DOCKERFILE, spaceSubdomain, updateSpace, type SpaceStep } from '@/lib/bridge/hf-space';
import { copyText } from './codeActions';
import { Icon } from '@/components/Icon';

const btn = 'press mono inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[10.5px] disabled:opacity-40';
const STEP: Record<SpaceStep, string> = { account: 'Checking the token', space: 'Finding your Space', secret: 'Keeping the terminal token', commit: 'Writing the new Dockerfile' };

export function SpaceUpdate({ version, latest }: { version?: string; latest: string | null }) {
  const bridge = useWorkspace((s) => s.bridge);
  const [state, setState] = useState<{ busy?: string; ok?: string; page?: string; error?: string }>({});
  const [sure, setSure] = useState(false);
  const [copied, setCopied] = useState(false);
  const { url, token } = bridge.describe();
  if (!spaceSubdomain(url)) return null;

  const run = async () => {
    setState({ busy: 'Starting' });
    try {
      const keys = await loadKeys();
      const r = await updateSpace({ hfToken: keys.huggingface, bridgeUrl: url, bridgeToken: token, onStep: (s) => setState({ busy: STEP[s] }) });
      setSure(false);
      setState({ ok: `Done. Hugging Face is rebuilding ${r.repo} now (about 3 to 6 minutes). The terminal comes back by itself on the newest bridge, with the same link and token.`, page: r.page });
      // Look again a few times while it rebuilds, so the status turns green without a tap.
      for (const s of [90, 180, 300, 420]) setTimeout(() => void useWorkspace.getState().monitor?.ping(), s * 1000);
    } catch (e) {
      setState({ error: (e as Error).message });
    }
  };

  return (
    <div className="space-y-2 rounded-lg border p-2.5" style={{ borderColor: 'var(--accent)' }} data-testid="space-update">
      <p className="flex items-center gap-2 text-[12px] font-semibold" style={{ color: 'var(--ink)' }}><Icon name="cloud" size={15} />Your terminal is a Hugging Face Space</p>
      <p className="text-[11px] leading-[1.55]" style={{ color: 'var(--ink-dim)' }}>
        It runs bridge {version ?? 'unknown'}{latest ? `, and this app needs ${latest}` : ''}. A Space is built from its own files, so it cannot be updated from here the usual way.
        One tap writes a new Dockerfile into the Space with your Hugging Face token (API Keys); from then on the Space fetches the newest bridge by itself every time it starts.
      </p>
      {!sure && !state.ok && (
        <button type="button" className={btn} style={{ borderColor: 'var(--accent)', color: 'var(--accent)' }} onClick={() => setSure(true)} data-testid="space-update-start"><Icon name="upload" size={12} />Update my Hugging Face terminal</button>
      )}
      {sure && !state.ok && (
        <div className="space-y-2 rounded-md border p-2" style={{ borderColor: 'color-mix(in oklab, var(--color-amber) 55%, var(--line))' }}>
          <p className="text-[11px] leading-[1.55]" style={{ color: 'var(--ink)' }}>
            This replaces the Dockerfile of your Space and makes it rebuild. Files in the terminal’s workspace are erased by a rebuild (Hugging Face erases them on every restart too), so save anything you need first. Your link and token stay the same.
          </p>
          <div className="flex flex-wrap gap-2">
            <button type="button" className={btn} disabled={!!state.busy} style={{ borderColor: 'var(--accent)', color: 'var(--accent)' }} onClick={() => void run()} data-testid="space-update-confirm">{state.busy ? `${state.busy}…` : 'Yes, update it'}</button>
            <button type="button" className={btn} disabled={!!state.busy} style={{ borderColor: 'var(--line)', color: 'var(--ink-dim)' }} onClick={() => { setSure(false); setState({}); }}>Not now</button>
          </div>
        </div>
      )}
      {state.error && <p className="text-[11px] leading-[1.5]" style={{ color: 'var(--color-rose)' }} role="alert">{state.error}</p>}
      {state.ok && (
        <p className="text-[11px] leading-[1.5]" style={{ color: 'var(--accent)' }} role="status">
          {state.ok} {state.page && <a href={state.page} target="_blank" rel="noreferrer" className="underline">Open the Space</a>}
        </p>
      )}
      <details className="text-[10.5px]" style={{ color: 'var(--ink-faint)' }}>
        <summary className="cursor-pointer">Do it by hand instead</summary>
        <p className="mt-1.5 leading-[1.5]">On huggingface.co open your Space, Files, the file named Dockerfile, Edit, replace everything with the text below, Commit. In Settings of the Space add a secret named CHOMUGIRI_TOKEN with your terminal token (the part after # in your link).</p>
        <button type="button" className={`${btn} mt-1.5`} style={{ borderColor: 'var(--line)', color: copied ? 'var(--accent)' : 'var(--ink-dim)' }} onClick={() => void copyText(SPACE_DOCKERFILE).then((ok) => { if (ok) { setCopied(true); setTimeout(() => setCopied(false), 1500); } })}>
          <Icon name="copy" size={12} />{copied ? 'copied' : 'copy the Dockerfile'}
        </button>
      </details>
    </div>
  );
}
