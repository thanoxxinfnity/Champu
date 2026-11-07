/**
 * The Tools hub: 150+ small utilities, each a pure function plus a description of its own form and its own kind of result.
 * Nothing here touches the network or the DOM, so every tool is tested with plain node and runs the same on a phone.
 */
export type Values = Record<string, string | number | boolean>;

export type Field =
  | { id: string; label: string; kind: 'text'; placeholder?: string; default?: string; mono?: boolean }
  | { id: string; label: string; kind: 'area'; placeholder?: string; default?: string; rows?: number; mono?: boolean }
  | { id: string; label: string; kind: 'number'; default?: number; min?: number; max?: number; step?: number; unit?: string }
  | { id: string; label: string; kind: 'select'; options: Array<string | { value: string; label: string }>; default?: string }
  | { id: string; label: string; kind: 'toggle'; default?: boolean }
  | { id: string; label: string; kind: 'color'; default?: string }
  | { id: string; label: string; kind: 'range'; min: number; max: number; step?: number; default?: number; unit?: string }
  | { id: string; label: string; kind: 'date'; default?: string }
  | { id: string; label: string; kind: 'datetime'; default?: string };

export type Out =
  | { kind: 'text'; text: string; lang?: string }
  | { kind: 'list'; items: string[] }
  | { kind: 'table'; head: string[]; rows: Array<Array<string | number>> }
  | { kind: 'stats'; items: Array<{ label: string; value: string }> }
  | { kind: 'swatches'; items: Array<{ hex: string; label?: string }> }
  | { kind: 'svg'; svg: string; name?: string }
  | { kind: 'bars'; items: Array<{ label: string; value: number }> }
  | { kind: 'calendar'; year: number; month: number; marks?: number[] }
  | { kind: 'diff'; rows: Array<{ t: ' ' | '+' | '-'; s: string }> }
  | { kind: 'css'; css: string; preview: string }
  | { kind: 'multi'; parts: Array<{ title?: string; out: Out }> }
  | { kind: 'error'; message: string };

export type CatId = 'text' | 'dev' | 'convert' | 'calc' | 'generate' | 'color' | 'time' | 'security' | 'web' | 'fun';

export interface ToolDef {
  id: string;
  name: string;
  cat: CatId;
  /** One symbol on the tile. */
  glyph: string;
  blurb: string;
  fields: Field[];
  run: (v: Values) => Out | Promise<Out>;
  /** Values the "Example" button fills in; the tests run every tool on them. */
  example: Values;
  keywords?: string[];
  /** Runs while typing (default) or only on the button, for heavy or random tools. */
  manual?: boolean;
}

export interface Category { id: CatId; name: string; glyph: string; hue: number; blurb: string }
