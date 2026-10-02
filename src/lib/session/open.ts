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
  // The plan and files are one live slot owned by the run in flight. While a run is going they
  // are left alone (the views hide them from sessions that do not own the run); otherwise this
  // session starts clean.
  if (!s.runSessionId && s.slotSessionId !== session.id) {
    s.setPlan(null);
    s.setFiles(new Map());
    s.setSlotOwner(session.id);
  }

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

  // Coming back to the session whose run is still going: put its half-written answer back on
  // screen, so what streams in next lands somewhere instead of vanishing until the run ends.
  const now = useWorkspace.getState();
  if (now.runSessionId === session.id && now.runAssistantId && !now.messages.some((m) => m.id === now.runAssistantId)) {
    now.pushMessage({ id: now.runAssistantId, role: 'assistant', content: '', streaming: true, createdAt: Date.now() });
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
