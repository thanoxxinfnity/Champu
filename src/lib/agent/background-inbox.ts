'use client';

import { useEffect } from 'react';
import { useWorkspace } from '@/lib/store';
import { bridgeTakesJobs, runningJobs, syncJobs } from './background';

/**
 * Mount once. Takes the terminal's finished background replies into their conversations:
 * as soon as the bridge is reachable, when the tab comes back to the front, and on a timer — quick while something is running, slow otherwise.
 */
export function useBackgroundInbox(): void {
  const status = useWorkspace((s) => s.heartbeat.status);
  const version = useWorkspace((s) => s.heartbeat.health?.version);

  useEffect(() => {
    if (!bridgeTakesJobs()) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const loop = async () => {
      if (cancelled) return;
      await syncJobs();
      if (cancelled) return;
      timer = setTimeout(() => void loop(), runningJobs > 0 ? 3000 : 30000);
    };
    void loop();
    const onVisible = () => {
      if (document.visibilityState === 'visible') {
        clearTimeout(timer);
        void loop();
      }
    };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('online', onVisible);
    return () => {
      cancelled = true;
      clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('online', onVisible);
    };
  }, [status, version]);
}
