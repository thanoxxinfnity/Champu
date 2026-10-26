'use client';

/**
 * Auto-push: keep the terminal's keys equal to the app's, without pressing "Pull APIs on terminal" every time.
 *
 * What is mirrored is exactly what the button sends (keyEnvFrom): the app's own credentials, every free provider and every custom
 * endpoint with its keys and base URL. When the user adds, edits, disables or removes one, the terminal follows a moment later. It also
 * fills a terminal that lost its keys (a rebuilt Space, a wiped workspace) the next time it is reachable.
 * The switch itself is remembered in the browser's database.
 */

import { useEffect } from 'react';
import { create } from 'zustand';
import { getSetting, setSetting } from '@/lib/db/history';
import { getKeys } from '@/lib/keys';
import { useWorkspace } from '@/lib/store';
import { keyEnvFrom } from './key-env';
import { lacksKeyStore } from './update';

interface AutoPushState {
  on: boolean;
  loaded: boolean;
  /** Last result, for the settings screen. */
  last: { at: number; ok: boolean; text: string } | null;
  set: (on: boolean) => void;
  load: () => Promise<void>;
  note: (ok: boolean, text: string) => void;
}

export const useAutoPush = create<AutoPushState>((set, get) => ({
  on: false,
  loaded: false,
  last: null,
  set: (on) => {
    set({ on });
    void setSetting('autoPushKeys', on);
  },
  load: async () => {
    if (get().loaded) return;
    const on = await getSetting<boolean>('autoPushKeys', false);
    set({ on, loaded: true });
  },
  note: (ok, text) => set({ last: { at: Date.now(), ok, text } }),
}));

/** The variables the app would send right now. */
export function currentKeyEnv(): Record<string, string> {
  const s = useWorkspace.getState();
  return keyEnvFrom({ ...getKeys(), vercel: s.vercelToken }, s.endpoints);
}

/** Mount once, high in the tree. */
export function useAutoPushKeys(): void {
  const on = useAutoPush((s) => s.on);
  const load = useAutoPush((s) => s.load);
  const heartbeat = useWorkspace((s) => s.heartbeat);
  const bridge = useWorkspace((s) => s.bridge);
  const online = heartbeat.status === 'online' || heartbeat.status === 'degraded';
  const capable = online && !lacksKeyStore(heartbeat.health);
  const bridgeStart = heartbeat.health ? Math.round(Date.now() / 1000 - heartbeat.health.uptimeSec) : 0;

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!on || !capable) return;
    let pushed = '';
    let busy = false;
    let cancelled = false;

    const tick = async () => {
      if (busy || cancelled) return;
      const env = currentKeyEnv();
      const sig = JSON.stringify(Object.entries(env).sort(([a], [b]) => a.localeCompare(b)));
      const count = Object.keys(env).length;
      busy = true;
      try {
        if (!pushed) {
          // First look at this terminal: only push when it differs from the app (or is empty), so reopening the app is not a write.
          const held = (await bridge.keys()).keys.map((k) => k.name).sort().join(',');
          const mine = Object.keys(env).sort().join(',');
          if (count > 0 && held !== mine) {
            const r = await bridge.pushKeys(env);
            useAutoPush.getState().note(true, `Auto-pushed ${r.stored} key${r.stored === 1 ? '' : 's'} to the terminal.`);
          }
          pushed = sig;
        } else if (sig !== pushed && (count > 0 || pushed !== '[]')) {
          const r = await bridge.pushKeys(env);
          pushed = sig;
          useAutoPush.getState().note(true, `Terminal updated: ${r.stored} key${r.stored === 1 ? '' : 's'}.`);
        }
      } catch (err) {
        useAutoPush.getState().note(false, `Auto-push failed: ${(err as Error).message}`);
      } finally {
        busy = false;
      }
    };

    void tick();
    const id = setInterval(() => void tick(), 4000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
    // A restarted bridge (different start time) is looked at again from scratch.
  }, [on, capable, bridge, bridgeStart]);
}
