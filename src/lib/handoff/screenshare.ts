'use client';
/**
 * Screen share for the chat: a frame of the user's own screen (getDisplayMedia, where the browser has it — desktop Chrome/Edge/
 * Firefox), of the agent's computer on the bridge (its Linux screen or browser), or a screenshot picked from the gallery (phones).
 * "Live" keeps the share open so every chat message carries a fresh frame until it is stopped. Nothing is recorded: one still
 * frame goes with a message, nothing else leaves the device.
 */
import { create } from 'zustand';
import { useWorkspace, type ChatAttachment } from '../store';
import { hasDesktop } from '../bridge/update';
import { screenshotName } from './loop';

export const useScreenShare = create<{ live: boolean }>(() => ({ live: false }));

let stream: MediaStream | null = null;
let video: HTMLVideoElement | null = null;

export const canShareScreen = (): boolean => typeof navigator !== 'undefined' && !!navigator.mediaDevices && 'getDisplayMedia' in navigator.mediaDevices;

async function openStream(): Promise<void> {
  if (stream) return;
  const s = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: 5 }, audio: false });
  stream = s;
  video = document.createElement('video');
  video.muted = true;
  video.playsInline = true;
  video.srcObject = s;
  await video.play().catch(() => {});
  s.getVideoTracks()[0]?.addEventListener('ended', () => stopScreenShare());
  // wait for the first frame
  for (let i = 0; i < 40 && video.videoWidth === 0; i++) await new Promise((r) => setTimeout(r, 50));
}

function frame(): string | null {
  if (!video || !video.videoWidth) return null;
  const k = Math.min(1, 1280 / video.videoWidth);
  const c = document.createElement('canvas');
  c.width = Math.round(video.videoWidth * k);
  c.height = Math.round(video.videoHeight * k);
  c.getContext('2d')!.drawImage(video, 0, 0, c.width, c.height);
  return c.toDataURL('image/jpeg', 0.85);
}

export async function startScreenShare(): Promise<void> {
  await openStream();
  useScreenShare.setState({ live: true });
}

export function stopScreenShare(): void {
  stream?.getTracks().forEach((t) => t.stop());
  stream = null;
  if (video) video.srcObject = null;
  video = null;
  useScreenShare.setState({ live: false });
}

/** One frame of the user's screen: from the live share, or a one-off share that is closed right after. */
export async function grabMyScreen(): Promise<string> {
  if (stream) { const f = frame(); if (f) return f; }
  if (!canShareScreen()) throw new Error('This browser cannot share its screen.');
  await openStream();
  const f = frame();
  if (!useScreenShare.getState().live) stopScreenShare();
  if (!f) throw new Error('The shared screen gave no picture.');
  return f;
}

/** One frame of the agent's computer (bridge): its Linux screen when one is running, else its browser. */
export async function grabAgentScreen(): Promise<string> {
  const st = useWorkspace.getState();
  const online = st.heartbeat.status === 'online' || st.heartbeat.status === 'degraded';
  if (!online) throw new Error('The Terminal Bridge is not connected.');
  const bridge = st.bridge;
  if (hasDesktop(st.heartbeat.health as never)) {
    const info = await bridge.desktop({ action: 'info' }).catch(() => null);
    if (info?.ok && !/display: \(none\)|not reachable/.test(info.text)) {
      const r = await bridge.desktop({ action: 'shot' });
      if (r.ok && r.image) return bridge.artifactDataUrl(r.image);
    }
  }
  const r = await bridge.browser('browser_take_screenshot', {});
  const name = screenshotName(r.text);
  if (!name) throw new Error('The agent has no page open yet. Ask it to open something first (/computer-use …).');
  return bridge.artifactDataUrl(name);
}

export function screenAttachment(dataUrl: string, who: 'my' | 'agent'): ChatAttachment {
  const kind = /^data:image\/png/.test(dataUrl) ? 'image/png' : 'image/jpeg';
  return { id: `scr_${Date.now().toString(36)}`, name: `${who === 'my' ? 'my-screen' : 'agent-screen'}-${new Date().toTimeString().slice(0, 8).replace(/:/g, '')}.${kind === 'image/png' ? 'png' : 'jpg'}`, kind, bytes: Math.round(dataUrl.length * 0.75), dataUrl };
}
