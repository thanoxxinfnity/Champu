/** The memory list on this device (IndexedDB, settings table). Nothing here is sent anywhere but into the prompt of a run. */
import { getSetting, setSetting } from '../db/history';
import { addMemories, prune, type Memory } from './memory';

const KEY = 'memory.v1';
const ON = 'memory.on';

export const loadMemories = (): Promise<Memory[]> => getSetting<Memory[]>(KEY, []).then((l) => (Array.isArray(l) ? l : []));
export const saveMemories = (list: Memory[]): Promise<void> => setSetting(KEY, prune(list));
export const memoryEnabled = (): Promise<boolean> => getSetting<boolean>(ON, true);
export const setMemoryEnabled = (on: boolean): Promise<void> => setSetting(ON, on);

export async function remember(incoming: Memory[]): Promise<{ added: Memory[]; merged: number }> {
  const { list, added, merged } = addMemories(await loadMemories(), incoming);
  await saveMemories(list);
  return { added, merged };
}

export async function forget(ids: string[]): Promise<number> {
  const drop = new Set(ids);
  const list = await loadMemories();
  const kept = list.filter((m) => !drop.has(m.id));
  await saveMemories(kept);
  return list.length - kept.length;
}

/** Count a use for each memory that went into a prompt, so the ones that keep helping outlive the ones that never do. */
export async function markUsed(ids: string[]): Promise<void> {
  const use = new Set(ids);
  const list = await loadMemories();
  await saveMemories(list.map((m) => (use.has(m.id) ? { ...m, uses: m.uses + 1 } : m)));
}
