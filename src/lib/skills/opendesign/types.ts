/** The shape of public/od/index.json, written by scripts/vendor-open-design.mjs. */
export interface OdSkill {
  id: string;
  description: string;
  triggers: string[];
  mode: string;
  category?: string;
  craft: string[];
  /** Needs an outside service (fal.ai, Figma, a browser agent): listed, never injected on its own. */
  external?: boolean;
  bytes: number;
}
export interface OdTemplate {
  id: string;
  description: string;
  triggers: string[];
  mode: string;
  platform?: string;
  scenario?: string;
  craft: string[];
  example: boolean;
  bytes: number;
}
export interface OdSystem { id: string; name: string; category: string; tagline: string; bytes: number }
export interface OdCraft { id: string; title: string; bytes: number }
export interface OdPrompt {
  id: string;
  surface: 'image' | 'video';
  title: string;
  summary: string;
  category: string;
  tags: string[];
  model?: string;
  aspect?: string;
  license?: string;
}
export interface OdIndex {
  source: { repo: string; commit: string; license: string };
  skills: OdSkill[];
  templates: OdTemplate[];
  systems: OdSystem[];
  craft: OdCraft[];
  prompts: OdPrompt[];
}

/** How the app reads the pack: the browser fetches it, a test reads the folder. */
export interface OdIo {
  json: <T>(path: string) => Promise<T | null>;
  text: (path: string) => Promise<string | null>;
}
