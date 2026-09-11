'use client';

import { useWorkspace, type ThemePref } from '@/lib/store';

/**
 * Light / system / dark, as three hand-drawn keys.
 *
 * A three-way control rather than a switch, because "follow the OS" is a real
 * answer and a two-state toggle silently forces the user to pick a side — then
 * gets it wrong when their phone flips to dark at sunset.
 */

const OPTIONS: Array<{ value: ThemePref; glyph: string; label: string }> = [
  { value: 'light', glyph: '☀', label: 'Light' },
  { value: 'system', glyph: '◐', label: 'Follow system' },
  { value: 'dark', glyph: '☾', label: 'Dark' },
];

export function ThemeToggle({ className = '' }: { className?: string }) {
  const theme = useWorkspace((s) => s.theme);
  const setTheme = useWorkspace((s) => s.setTheme);

  return (
    <div
      role="radiogroup"
      aria-label="Colour theme"
      className={`flex items-center gap-0.5 p-0.5 ${className}`}
      style={{
        border: '1.5px solid var(--stroke)',
        borderRadius: 'var(--sketch-b)',
        background: 'var(--surface)',
      }}
    >
      {OPTIONS.map((opt) => {
        const active = theme === opt.value;
        return (
          <button
            key={opt.value}
            type="button"
            role="radio"
            aria-checked={active}
            aria-label={opt.label}
            title={opt.label}
            onClick={() => setTheme(opt.value)}
            className="press flex h-[22px] w-[24px] items-center justify-center text-[11px] leading-none"
            style={{
              // Each key gets a different inked corner so the row does not read
              // as three identical printed buttons.
              borderRadius: opt.value === 'light' ? 'var(--sketch-a)' : opt.value === 'dark' ? 'var(--sketch-c)' : 'var(--sketch-b)',
              background: active ? 'var(--accent)' : 'transparent',
              color: active ? 'var(--panel)' : 'var(--ink-faint)',
              transition: 'background var(--dur-fast) var(--ease-out), color var(--dur-fast) var(--ease-out)',
            }}
          >
            {opt.glyph}
          </button>
        );
      })}
    </div>
  );
}
