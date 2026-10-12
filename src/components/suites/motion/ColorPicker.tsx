'use client';

import { useRef, useState } from 'react';
import { hexToHsv, hsvToHex } from '@/lib/suites/motion/color';

const inputCls = 'mono rounded border bg-transparent px-2 py-1.5 text-[11px] outline-none';
const inputStyle = { borderColor: 'var(--line)', color: 'var(--ink)' } as const;

/** An HSV colour wheel (hue ring + saturation/value square) plus a hex field and a saved-swatch palette. */
export function ColorPicker({ color, onChange, palette, onSavePalette }: {
  color: string;
  onChange: (hex: string) => void;
  palette: string[];
  onSavePalette: (palette: string[]) => void;
}) {
  const hsv = hexToHsv(color);
  const squareRef = useRef<HTMLDivElement>(null);
  const wheelRef = useRef<HTMLDivElement>(null);
  const [hexInput, setHexInput] = useState(color);

  const onSquarePointer = (e: React.PointerEvent) => {
    const el = squareRef.current;
    if (!el) return;
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    const move = (ev: PointerEvent) => {
      const rect = el.getBoundingClientRect();
      const s = Math.max(0, Math.min(1, (ev.clientX - rect.left) / rect.width));
      const v = Math.max(0, Math.min(1, 1 - (ev.clientY - rect.top) / rect.height));
      const hex = hsvToHex(hsv.h, s, v);
      onChange(hex);
      setHexInput(hex);
    };
    move(e.nativeEvent);
    const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  const onWheelPointer = (e: React.PointerEvent) => {
    const el = wheelRef.current;
    if (!el) return;
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    const move = (ev: PointerEvent) => {
      const rect = el.getBoundingClientRect();
      const cx = rect.left + rect.width / 2, cy = rect.top + rect.height / 2;
      const angle = (Math.atan2(ev.clientY - cy, ev.clientX - cx) * 180) / Math.PI;
      const h = (angle + 360) % 360;
      const hex = hsvToHex(h, hsv.s, hsv.v);
      onChange(hex);
      setHexInput(hex);
    };
    move(e.nativeEvent);
    const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  const commitHex = (v: string) => {
    setHexInput(v);
    if (/^#?[0-9a-f]{6}$/i.test(v)) onChange(v.startsWith('#') ? v : `#${v}`);
  };

  return (
    <div className="flex flex-col gap-2">
      <div
        ref={wheelRef}
        onPointerDown={onWheelPointer}
        className="relative h-32 w-32 cursor-crosshair self-center rounded-full"
        style={{ background: 'conic-gradient(red,yellow,lime,cyan,blue,magenta,red)' }}
      >
        <div
          ref={squareRef}
          onPointerDown={onSquarePointer}
          className="absolute inset-[18%] cursor-crosshair rounded"
          style={{ background: `linear-gradient(to top, #000, transparent), linear-gradient(to right, #fff, hsl(${hsv.h},100%,50%))` }}
        >
          <div
            className="pointer-events-none absolute h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow"
            style={{ left: `${hsv.s * 100}%`, top: `${(1 - hsv.v) * 100}%` }}
          />
        </div>
        <div
          className="pointer-events-none absolute h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow"
          style={{
            left: `${50 + 48 * Math.cos((hsv.h * Math.PI) / 180)}%`,
            top: `${50 + 48 * Math.sin((hsv.h * Math.PI) / 180)}%`,
          }}
        />
      </div>

      <div className="flex items-center gap-1.5">
        <div className="h-7 w-7 shrink-0 rounded border" style={{ background: color, borderColor: 'var(--line)' }} />
        <input
          value={hexInput}
          onChange={(e) => commitHex(e.target.value)}
          onFocus={() => setHexInput(color)}
          aria-label="Hex colour"
          className={`${inputCls} flex-1`}
          style={inputStyle}
        />
        <button
          type="button"
          title="Save to palette"
          onClick={() => onSavePalette([color, ...palette.filter((c) => c !== color)].slice(0, 24))}
          className="press mono rounded border px-2 py-1.5 text-[11px]"
          style={{ borderColor: 'var(--line)', color: 'var(--ink-dim)' }}
        >
          +
        </button>
      </div>

      {palette.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {palette.map((c, i) => (
            <button
              key={`${c}_${i}`}
              type="button"
              title={c}
              onClick={() => { onChange(c); setHexInput(c); }}
              className="h-5 w-5 rounded border"
              style={{ background: c, borderColor: c === color ? 'var(--accent)' : 'var(--line)', borderWidth: c === color ? 2 : 1 }}
            />
          ))}
        </div>
      )}
    </div>
  );
}
