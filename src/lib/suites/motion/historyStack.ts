/**
 * A capped undo/redo stack of full project snapshots — simple (every entry is the whole project, no diffing)
 * and deliberately bounded (default 100 entries) so a long session never grows memory without limit, the
 * same way most editors trade a little memory for a lot of correctness on undo.
 */
export interface HistoryState<T> {
  entries: T[];
  /** Index of the currently-shown entry within `entries`. */
  index: number;
}

export function newHistory<T>(initial: T): HistoryState<T> {
  return { entries: [initial], index: 0 };
}

/**
 * Record a new state as the current point in history — drops any redo-able future (the normal "you did
 * something new" rule), then caps the stack length by dropping the oldest entry once the limit is hit.
 */
export function pushHistory<T>(state: HistoryState<T>, next: T, maxLen = 100): HistoryState<T> {
  const kept = state.entries.slice(0, state.index + 1);
  let entries = [...kept, next];
  if (entries.length > maxLen) entries = entries.slice(entries.length - maxLen);
  return { entries, index: entries.length - 1 };
}

export function canUndo<T>(state: HistoryState<T>): boolean {
  return state.index > 0;
}
export function canRedo<T>(state: HistoryState<T>): boolean {
  return state.index < state.entries.length - 1;
}

/** Steps back one entry, returning the new state and the entry to apply — or null if already at the start. */
export function undo<T>(state: HistoryState<T>): { state: HistoryState<T>; value: T } | null {
  if (!canUndo(state)) return null;
  const index = state.index - 1;
  return { state: { ...state, index }, value: state.entries[index]! };
}

export function redo<T>(state: HistoryState<T>): { state: HistoryState<T>; value: T } | null {
  if (!canRedo(state)) return null;
  const index = state.index + 1;
  return { state: { ...state, index }, value: state.entries[index]! };
}
