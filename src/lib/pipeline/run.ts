/** The parts of the pipeline that touch storage, the bridge or a model. Everything they decide with lives in the pure modules. */
import { getSetting, setSetting } from '../db/history';
import type { Memory } from '../memory/memory';
import { addMemories } from '../memory/memory';
import { loadMemories, saveMemories } from '../memory/store';
import { STEPS, type PipelineStep } from './commands';
import { MEMORY_FILE, detectProject, fromFile, toFile } from './memory-file';
import { parseReview, renderReview, reviewPrompt, selectFiles, type ReviewFile } from './review';

export async function pipelineState(): Promise<Record<PipelineStep, boolean>> {
  const out = {} as Record<PipelineStep, boolean>;
  for (const s of STEPS) out[s.id] = await getSetting<boolean>(`pipeline.${s.id}`, true);
  return out;
}

export async function setPipeline(step: PipelineStep | 'all', on: boolean): Promise<void> {
  for (const s of STEPS) if (step === 'all' || step === s.id) await setSetting(`pipeline.${s.id}`, on);
}

interface FileBridge {
  writeFiles(files: Array<{ path: string; content?: string }>): Promise<unknown>;
  readFile(path: string): Promise<{ content?: string; binary: boolean }>;
}

/** Writes the memory file into the bridge workspace. Best effort: a missing bridge is not an error. */
export async function saveMemoryFile(bridge: FileBridge, paths: string[]): Promise<void> {
  try {
    const content = toFile(await loadMemories(), detectProject(paths));
    await bridge.writeFiles([{ path: MEMORY_FILE, content }]);
  } catch { /* the browser copy is the one that counts; the file is a mirror */ }
}

/** Reads the memory file back into this browser: only what is not already here, so a hand edit and a fresh phone both work. */
export async function loadMemoryFile(bridge: FileBridge): Promise<number> {
  try {
    const r = await bridge.readFile(MEMORY_FILE);
    const file = !r.binary && r.content ? fromFile(r.content) : null;
    if (!file?.memories.length) return 0;
    const have = await loadMemories();
    const { list, added } = addMemories(have, file.memories as Memory[]);
    if (added.length) await saveMemories(list);
    return added.length;
  } catch { return 0; }
}

export type Complete = (system: string, user: string) => Promise<string>;

/** Five reviewers over `files`, shown only what they are sure of. Returns null when there is nothing to review or the model failed. */
export async function reviewFiles(files: ReviewFile[], complete: Complete): Promise<string | null> {
  const picked = selectFiles(files);
  if (!picked.length) return null;
  try {
    const { system, user } = reviewPrompt(picked);
    return renderReview(parseReview(await complete(system, user)), picked.length);
  } catch { return null; }
}
