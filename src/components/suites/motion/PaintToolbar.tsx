'use client';

import { BRUSH_KINDS, type BrushKind, type BrushSettings } from '@/lib/suites/motion/brush';
import { SkillIcon } from '@/components/SkillIcon';
import { ColorPicker } from './ColorPicker';

export type PaintTool = 'brush' | 'erase-object' | 'erase-pixel' | 'erase-color' | 'lasso' | 'fill' | 'gradient' | 'eyedropper' | 'cel-shade' | 'color-replace';

const TOOLS: Array<{ tool: PaintTool; icon: string; label: string }> = [
  { tool: 'brush', icon: 'pen', label: 'Brush' },
  { tool: 'erase-object', icon: 'bug', label: 'Erase (whole stroke)' },
  { tool: 'erase-pixel', icon: 'wrench', label: 'Erase (pixels)' },
  { tool: 'erase-color', icon: 'convert', label: 'Erase (colour only)' },
  { tool: 'lasso', icon: 'cube', label: 'Lasso select' },
  { tool: 'fill', icon: 'palette', label: 'Smart fill bucket' },
  { tool: 'gradient', icon: 'spark', label: 'Gradient' },
  { tool: 'eyedropper', icon: 'search', label: 'Eyedropper' },
  { tool: 'cel-shade', icon: 'shield', label: 'Auto cel shadow' },
  { tool: 'color-replace', icon: 'wand', label: 'Replace colour everywhere' },
];

const BRUSH_LABEL: Record<BrushKind, string> = {
  pencil: 'Pencil', ink: 'Ink pen', airbrush: 'Airbrush', watercolor: 'Watercolor', charcoal: 'Charcoal', neon: 'Neon/glow',
};

const inputCls = 'mono rounded border bg-transparent px-2 py-1 text-[10.5px] outline-none';
const inputStyle = { borderColor: 'var(--line)', color: 'var(--ink)' } as const;

export interface PaintToolbarProps {
  tool: PaintTool;
  onToolChange: (t: PaintTool) => void;
  brush: BrushSettings;
  onBrushChange: (b: BrushSettings) => void;
  gapClosePx: number;
  onGapCloseChange: (n: number) => void;
  gradientKind: 'linear' | 'radial' | 'mesh';
  onGradientKindChange: (k: 'linear' | 'radial' | 'mesh') => void;
  alphaLock: boolean;
  onAlphaLockChange: (v: boolean) => void;
  palette: string[];
  onPaletteChange: (p: string[]) => void;
  onAutoFlatColor: () => void;
  onClearFrame: () => void;
}

/** The paint toolbar: tool picker, live brush settings, fill/gradient options, colour. Shown whenever a paint layer is selected. */
export function PaintToolbar(props: PaintToolbarProps) {
  const { tool, onToolChange, brush, onBrushChange, gapClosePx, onGapCloseChange, gradientKind, onGradientKindChange, alphaLock, onAlphaLockChange, palette, onPaletteChange, onAutoFlatColor, onClearFrame } = props;

  return (
    <div className="flex w-60 shrink-0 flex-col gap-2.5 overflow-y-auto border-r p-3" style={{ borderColor: 'var(--line)', background: 'var(--panel)' }}>
      <p className="mono text-[10px] uppercase tracking-wide" style={{ color: 'var(--ink-faint)' }}>paint tools</p>
      <div className="grid grid-cols-5 gap-1">
        {TOOLS.map((t) => (
          <button
            key={t.tool}
            type="button"
            title={t.label}
            onClick={() => onToolChange(t.tool)}
            className="press flex items-center justify-center rounded border py-1.5"
            style={{
              borderColor: tool === t.tool ? 'var(--accent)' : 'var(--line)',
              background: tool === t.tool ? 'color-mix(in oklab, var(--accent) 15%, transparent)' : undefined,
              color: tool === t.tool ? 'var(--accent)' : 'var(--ink-dim)',
            }}
          >
            <SkillIcon name={t.icon} size={14} />
          </button>
        ))}
      </div>

      {tool === 'brush' && (
        <div className="flex flex-col gap-2 border-t pt-2.5" style={{ borderColor: 'var(--line)' }}>
          <select
            value={brush.kind}
            onChange={(e) => onBrushChange({ ...brush, kind: e.target.value as BrushKind })}
            className={`${inputCls} w-full`}
            style={{ ...inputStyle, background: 'var(--panel)' }}
          >
            {BRUSH_KINDS.map((k) => <option key={k} value={k}>{BRUSH_LABEL[k]}</option>)}
          </select>
          <label className="flex items-center gap-2 text-[10.5px]" style={{ color: 'var(--ink-dim)' }}>
            size
            <input type="range" min={1} max={80} value={brush.size} onChange={(e) => onBrushChange({ ...brush, size: Number(e.target.value) })} className="flex-1" />
            <span className="mono w-7 text-right">{brush.size}</span>
          </label>
          <label className="flex items-center gap-2 text-[10.5px]" style={{ color: 'var(--ink-dim)' }}>
            opacity
            <input type="range" min={0.05} max={1} step={0.05} value={brush.opacity} onChange={(e) => onBrushChange({ ...brush, opacity: Number(e.target.value) })} className="flex-1" />
          </label>
          <label className="flex items-center gap-2 text-[10.5px]" style={{ color: 'var(--ink-dim)' }} title="Smooths out a shaky hand — higher values lag the line further behind the cursor for a cleaner stroke">
            stabilizer
            <input type="range" min={0} max={0.9} step={0.05} value={brush.stabilizer} onChange={(e) => onBrushChange({ ...brush, stabilizer: Number(e.target.value) })} className="flex-1" />
          </label>
          <label className="flex items-center gap-2 text-[10.5px]" style={{ color: 'var(--ink-dim)' }} title="How much stylus/touch pressure widens the stroke">
            pressure→width
            <input type="range" min={0} max={1} step={0.05} value={brush.pressureSizeMix} onChange={(e) => onBrushChange({ ...brush, pressureSizeMix: Number(e.target.value) })} className="flex-1" />
          </label>
          <label className="mono flex items-center gap-1.5 text-[10.5px]" style={{ color: 'var(--ink-dim)' }} title="Keeps new strokes inside this layer's already-painted pixels">
            <input type="checkbox" checked={alphaLock} onChange={(e) => onAlphaLockChange(e.target.checked)} />
            alpha lock
          </label>
        </div>
      )}

      {(tool === 'fill' || tool === 'cel-shade' || tool === 'color-replace') && (
        <div className="flex flex-col gap-2 border-t pt-2.5" style={{ borderColor: 'var(--line)' }}>
          <label className="flex items-center gap-2 text-[10.5px]" style={{ color: 'var(--ink-dim)' }} title="Closes small gaps in the line art so a fill doesn't leak out">
            gap close
            <input type="range" min={0} max={8} value={gapClosePx} onChange={(e) => onGapCloseChange(Number(e.target.value))} className="flex-1" />
            <span className="mono w-5 text-right">{gapClosePx}</span>
          </label>
          {tool === 'fill' && (
            <button type="button" onClick={onAutoFlatColor} className="press mono rounded border px-2 py-1.5 text-left text-[11px]" style={{ borderColor: 'var(--line)', color: 'var(--ink)' }}>
              <SkillIcon name="palette" size={12} className="mr-1.5 inline" /> Auto flat-colour every region
            </button>
          )}
        </div>
      )}

      {tool === 'gradient' && (
        <div className="flex flex-col gap-2 border-t pt-2.5" style={{ borderColor: 'var(--line)' }}>
          <select value={gradientKind} onChange={(e) => onGradientKindChange(e.target.value as 'linear' | 'radial' | 'mesh')} className={`${inputCls} w-full`} style={{ ...inputStyle, background: 'var(--panel)' }}>
            <option value="linear">Linear — drag a line</option>
            <option value="radial">Radial — drag out from a point</option>
            <option value="mesh">Mesh — click to drop colour points</option>
          </select>
        </div>
      )}

      <div className="border-t pt-2.5" style={{ borderColor: 'var(--line)' }}>
        <ColorPicker color={brush.color} onChange={(c) => onBrushChange({ ...brush, color: c })} palette={palette} onSavePalette={onPaletteChange} />
      </div>

      <button type="button" onClick={onClearFrame} className="press mono mt-auto rounded border px-2 py-1.5 text-[10.5px]" style={{ borderColor: 'var(--line)', color: 'var(--color-rose)' }}>
        Clear this frame
      </button>
    </div>
  );
}
