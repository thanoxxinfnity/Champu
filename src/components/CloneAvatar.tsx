'use client';

import { useEffect, useRef, useState } from 'react';
import { LogoMark } from './Logo';

/**
 * Animated avatar shown beside the thinking indicator.
 *
 * Plays only while the agent is working and pauses the moment it stops — a video
 * looping forever in a chat view is a real battery cost on a phone for no
 * information gain.
 *
 * Falls back to the animated logo mark if the clip cannot decode, which happens
 * on WebViews without the H.264 decoder.
 */
export function CloneAvatar({ active, size = 40 }: { active: boolean; size?: number }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || failed) return;

    if (active) {
      video.currentTime = video.currentTime || 0;
      void video.play().catch(() => setFailed(true));
    } else {
      video.pause();
    }
  }, [active, failed]);

  return (
    <div
      className="thinking-shell relative shrink-0"
      style={{ width: size, height: size }}
      aria-hidden
    >
      <span className="thinking-aurora" style={{ inset: -8 }} />

      <div
        className="relative overflow-hidden rounded-full"
        style={{
          width: size,
          height: size,
          border: '1px solid color-mix(in oklab, var(--accent) 34%, var(--line))',
          background: 'var(--surface)',
          boxShadow: active ? '0 0 18px -4px color-mix(in oklab, var(--accent) 55%, transparent)' : undefined,
          transition: 'box-shadow var(--dur-base) var(--ease-out)',
        }}
      >
        {failed ? (
          <div className="flex h-full w-full items-center justify-center">
            <LogoMark size={size * 0.62} rounded={false} id="avatar-fallback" />
          </div>
        ) : (
          <video
            ref={videoRef}
            src="/clone.mp4"
            muted
            loop
            playsInline
            preload="metadata"
            onError={() => setFailed(true)}
            className="h-full w-full object-cover"
            style={{
              filter: active ? 'none' : 'grayscale(0.7) brightness(0.72)',
              transition: 'filter var(--dur-slow) var(--ease-out)',
            }}
          />
        )}
      </div>
    </div>
  );
}
