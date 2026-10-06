'use client';

import { useMemo } from 'react';
import { activityOf } from '@/lib/agent/activity';
import { iconHtml, pick, SCENE_HTML, TAIL_HTML, VARIANTS } from '@/lib/agent/activity-icons';
import { describeCommand } from '@/lib/agent/narrate';

/**
 * The running-work strip: the thinking bubble's icon, scene and words, on a line of its own.
 * Used where work is visibly happening (the terminal pane while a command runs), so the pane
 * moves the same way the chat block and the bubble do.
 */
export function LiveBar({ command }: { command: string }) {
  const phrase = useMemo(() => describeCommand(command), [command]);
  const kind = activityOf(phrase);
  const variant = pick(command, VARIANTS);
  const html = `${SCENE_HTML}${iconHtml(kind)}<span class="live-text">${phrase.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`)}</span>${TAIL_HTML}`;
  return (
    <div className="live-bar thinking-shell" data-activity={kind} data-variant={variant} role="status" aria-live="polite">
      <div className="live-bar-inner" dangerouslySetInnerHTML={{ __html: html }} />
    </div>
  );
}
