'use client';

import { listMessages } from '@/lib/db/history';
import { useWorkspace } from '@/lib/store';
import type { SessionRecord } from '@/lib/db/schema';

/**
 * Switch the workspace to a stored session.
 *
 * Lifted out of the sidebar because it is no longer only the sidebar's job:
 * a finished background run offers to jump straight back to the conversation
 * it belongs to, and that has to land the user in exactly the same state as
 * clicking the session in the list would.
 */
export async function openSession(session: SessionRecord): Promise<void> {
  const s = useWorkspace.getState();

  s.setSuite(session.suite);
  s.setSessionId(session.id);
  s.clearMessages();
  s.setPlan(null);
  s.setFiles(new Map());

  const messages = await listMessages(session.id);
  for (const m of messages) {
    if (m.role === 'tool') continue;
    s.pushMessage({
      id: m.id,
      role: m.role,
      content: m.content,
      reasoning: m.reasoning,
      lane: m.lane,
      model: m.model,
      provider: m.provider as never,
      createdAt: m.createdAt,
      attachments: m.attachments?.map((a, i) => ({ id: `${m.id}_${i}`, ...a })),
      usage: m.usage,
      durationMs: m.durationMs,
    });
  }
}

/** Open a session by id, when only the id is to hand. */
export async function openSessionById(id: string): Promise<boolean> {
  const { db, isBrowser } = await import('@/lib/db/schema');
  if (!isBrowser()) return false;
  const session = await db().sessions.get(id);
  if (!session) return false;
  await openSession(session);
  return true;
}
