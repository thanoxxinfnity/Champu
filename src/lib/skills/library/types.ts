/** public/skills/index.json, written by scripts/vendor-skill-library.mjs. */
export interface LibSkill {
  id: string;
  source: 'superpowers' | 'anthropic' | 'agentic';
  description: string;
  /** Distinctive words from the name and description; what the selector matches a request against. */
  kw: string[];
  bytes: number;
  category?: string;
  /** A working-method skill (debug, test first, plan, review) rather than a topic. */
  process?: boolean;
}
export interface LibIndex {
  sources: Record<string, { repo: string; commit: string; license: string }>;
  skills: LibSkill[];
}
