import type { SkillRecord, SuiteId } from '@/lib/db/schema';

/**
 * Slash command / skill engine.
 *
 * A skill is a named prompt template bound to a `/trigger`. Built-ins ship with
 * the app; custom skills are user-authored; generated skills are written by the
 * model on request. All three share one execution path.
 */

export interface SkillDefinition {
  command: string;
  name: string;
  description: string;
  template: string;
  suite?: SuiteId;
  lane?: 'A' | 'B';
  icon?: string;
  /** Args the palette prompts for, e.g. `/deploy <project-name>`. */
  argHint?: string;
}

export const BUILTIN_SKILLS: SkillDefinition[] = [
  {
    command: 'make-apk',
    name: 'Build APK',
    description: 'Analyse desktop source, generate an Android project, compile a debug APK on the bridge.',
    suite: 'android',
    lane: 'B',
    icon: '📱',
    argHint: '<app name or description>',
    template: `Build an Android APK.

Target: {{input}}

Attached source: {{files}}

Steps:
1. Analyse the attached source: identify the desktop stack, the UI surface, and the business logic worth porting.
2. Report every desktop assumption that breaks on Android (absolute paths, subprocess spawning, blocking dialogs, fixed window geometry) before writing code.
3. Generate a complete Gradle project — AGP 8.x, Kotlin 2.x, Compose, version catalog, wrapper. Every file emitted in full.
4. Adapt the layout for touch: 48dp minimum targets, single-column reflow, no fixed pixel geometry.
5. Push the project to the bridge workspace, verify the toolchain, then run ./gradlew assembleDebug.
6. Collect the APK and the source ZIP.

If the bridge is offline, complete steps 1-4 and mark 5-6 as blocked. Do not fabricate a build result.`,
  },
  {
    command: 'exe-to-apk',
    name: 'EXE → APK',
    description: 'Triage a Windows binary or desktop source tree and migrate it to Android.',
    suite: 'android',
    lane: 'B',
    icon: '🔄',
    argHint: '<attach the .exe or source>',
    template: `Migrate this desktop application to Android.

Input: {{input}}
Attached: {{files}}

If the attachment is a compiled binary, state plainly that binaries are not decompiled, report what the PE header reveals about the runtime, and give the exact command to recover source for that runtime. Then stop and ask for the source.

If the attachment is source, run the full migration: analysis, blocker report, Android project generation, build.`,
  },
  {
    command: 'build-mcpack',
    name: 'Build .mcpack',
    description: 'Generate a Minecraft Bedrock behaviour + resource pack and export it.',
    suite: 'minecraft',
    lane: 'B',
    icon: '🧱',
    argHint: '<what the addon should do>',
    template: `Build a Minecraft Bedrock addon.

Specification: {{input}}

Requirements:
- Behaviour and resource manifests with distinct UUIDs that cross-reference each other as dependencies.
- Pinned format_versions consistent with the component shapes used. Do not mix schema generations.
- Every entity gets: behaviour definition, client entity definition, render controller, animation controller, and at least a walk animation. An entity without a routed animation controller renders as a frozen T-pose.
- Geometry for every entity, or state explicitly that geometry is missing.
- Texture registries (item_texture.json / terrain_texture.json) for every item and block.
- en_US.lang plus languages.json, or names show as raw keys in-game.

Validate before exporting and report any issue found.`,
  },
  {
    command: 'jar-to-bedrock',
    name: 'Java mod → Bedrock',
    description: 'Translate a Java mod\'s declarative registry into a Bedrock addon, with a coverage report.',
    suite: 'minecraft',
    lane: 'B',
    icon: '☕',
    argHint: '<attach the .jar or mod spec>',
    template: `Convert this Java mod to a Bedrock addon.

Input: {{input}}
Attached: {{files}}

Be honest about the boundary: only the declarative registry converts (blocks, items, entity attributes, recipes, lang). Compiled logic — capabilities, mixins, block entities, custom dimensions, GUIs, renderers — has no Bedrock equivalent and must be reimplemented with the Script API.

Produce:
1. A coverage report: what translated, what did not, and why.
2. The Bedrock addon for everything that translated.
3. A concrete Script API plan for the highest-value unmapped behaviour.`,
  },
  {
    command: 'build-game',
    name: 'Build game',
    description: 'Plan a Godot 4 game from a sentence, source its models, and export a project that runs.',
    suite: 'godot',
    lane: 'B',
    icon: '🎮',
    argHint: '<the game, in a sentence>',
    template: `Build a Godot 4.3 game.

The game: {{input}}

Requirements:
- Restate the plan in two or three lines first. A misread prompt costs a sentence
  to correct here and a whole regenerated project later.
- Every file, each as a path-tagged block: project.godot, main.tscn, the scripts,
  icon.svg. A loose snippet is not a project.
- Touch controls for everything the player must do — this opens on a phone.
- Never reference a .glb the build has not actually produced.
- Say which 3D source each model came from, and carry the credit when one came
  from someone else.`,
  },
  {
    command: 'make-deck',
    name: 'Build deck',
    description: 'Generate an animated HTML5 slide deck that prints cleanly to PDF.',
    suite: 'studio',
    lane: 'B',
    icon: '📊',
    argHint: '<deck topic>',
    template: `Build a presentation deck.

Topic: {{input}}

Requirements:
- One self-contained HTML file. No CDN, no build step, opens offline.
- Keyboard, click and swipe navigation; a print stylesheet that puts one slide per page.
- Varied layouts — do not produce ten identical bullet slides.
- Content carries the argument. Every slide earns its place or is cut.`,
  },
  {
    command: 'make-pdf',
    name: 'Build document',
    description: 'Generate a print-ready formatted document.',
    suite: 'studio',
    lane: 'B',
    icon: '📄',
    argHint: '<document subject>',
    template: `Produce a print-ready document on: {{input}}

Emit a single HTML file with an @page rule and a print stylesheet. Headings avoid orphaning; code blocks and tables never break across pages.`,
  },
  {
    command: 'gen-image',
    name: 'Generate image',
    description: 'Generate imagery through Pollinations or an NVIDIA NIM vision pipeline.',
    suite: 'image',
    lane: 'B',
    icon: '🎨',
    argHint: '<image prompt>',
    template: `Generate an image: {{input}}

Write the prompt for the selected pipeline. State subject, composition, lighting and style explicitly — vague prompts produce generic output.`,
  },
  {
    command: 'deploy',
    name: 'Deploy to Vercel',
    description: 'Validate the generated bundle and deploy it to Vercel.',
    lane: 'B',
    icon: '🚀',
    argHint: '<project name>',
    template: `Deploy the current workspace artifacts to Vercel as "{{input}}".

Before deploying:
1. Confirm an entry point exists (index.html or package.json at the bundle root). A bundle without one deploys green and serves nothing.
2. List the environment variables the build needs and confirm each is set.
3. Report the file count and total bundle size.

Then trigger the deployment and return the live URL.`,
  },
  {
    command: 'audit-code',
    name: 'Audit code',
    description: 'Adversarial review for correctness, security and performance defects.',
    lane: 'A',
    icon: '🔍',
    argHint: '<attach code or describe the target>',
    template: `Audit this code.

Target: {{input}}
Attached: {{files}}

Report only defects you can demonstrate. For each: the file and line, the concrete input that triggers it, the resulting failure, and the fix.

Cover: correctness bugs, unhandled error paths, race conditions, injection and traversal, auth gaps, resource leaks, and hot-path inefficiencies.

Order by severity. If the code is sound, say so — do not manufacture findings to look thorough.`,
  },
  {
    command: 'research',
    name: 'Research',
    description: 'Autonomous search-augmented research run with cited sources.',
    suite: 'workdrive',
    lane: 'B',
    icon: '🔬',
    argHint: '<research question>',
    template: `Run a research pass on: {{input}}

Retrieve sources, rank them, and synthesise findings with inline [n] citations mapping to the source list.

Separate what the sources establish from what you are inferring. Where sources conflict, say so rather than averaging them into a bland consensus.`,
  },
  {
    command: 'zip',
    name: 'Package archive',
    description: 'Bundle the current workspace artifacts into a ZIP.',
    lane: 'B',
    icon: '📦',
    argHint: '<archive name>',
    template: `Package the current session artifacts as "{{input}}.zip". List what is included and the total size.`,
  },
  {
    command: 'test',
    name: 'Run tests',
    description: 'Run the project test suite on the bridge and triage failures.',
    lane: 'B',
    icon: '🧪',
    argHint: '<optional test filter>',
    template: `Run the test suite on the bridge{{input}}.

Detect the runner from the project files. On failure, read the first failure only, root-cause it, patch it, and re-run. Do not re-issue an identical failing command.`,
  },
  {
    command: 'explain',
    name: 'Explain',
    description: 'Direct technical explanation, no filler.',
    lane: 'A',
    icon: '💡',
    argHint: '<topic>',
    template: `Explain: {{input}}

Lead with the answer. Then the mechanism. Quantify where quantities matter. No preamble, no summary of what you are about to say.`,
  },
  {
    command: 'skill',
    name: 'Create skill',
    description: 'Have the agent author a new reusable slash command.',
    suite: 'skills',
    lane: 'B',
    icon: '✨',
    argHint: '<what the skill should do>',
    template: `Author a new Chomugiri skill: {{input}}

Reply with ONE JSON object and nothing else:
{"command":"<kebab-case trigger, no slash>","name":"<short name>","description":"<one line, states when to use it>","icon":"<single emoji>","lane":"A"|"B","suite":"<suite id or null>","argHint":"<what the argument is>","template":"<the prompt template; use {{input}} for the argument and {{files}} for attachments>"}

The template is the whole value of the skill. Make it specific and prescriptive — a vague template produces vague output.`,
  },
];

// ── Matching & expansion ────────────────────────────────────────────────────

export interface ParsedCommand {
  command: string;
  args: string;
  raw: string;
}

export function parseSlash(input: string): ParsedCommand | null {
  const match = /^\/([a-z0-9][a-z0-9-]*)\s*([\s\S]*)$/i.exec(input.trim());
  if (!match) return null;
  return { command: match[1].toLowerCase(), args: match[2].trim(), raw: input };
}

/** Fuzzy subsequence match — `/mkapk` finds `make-apk`. */
function fuzzyScore(query: string, target: string): number {
  if (!query) return 1;
  const q = query.toLowerCase();
  const t = target.toLowerCase();

  if (t === q) return 1000;
  if (t.startsWith(q)) return 500 - t.length;
  if (t.includes(q)) return 250 - t.indexOf(q);

  let qi = 0;
  let score = 0;
  let streak = 0;
  for (let ti = 0; ti < t.length && qi < q.length; ti++) {
    if (t[ti] === q[qi]) {
      streak++;
      score += 10 + streak * 2;
      // Matching at a word boundary is a stronger signal.
      if (ti === 0 || t[ti - 1] === '-' || t[ti - 1] === ' ') score += 15;
      qi++;
    } else {
      streak = 0;
    }
  }
  return qi === q.length ? score : -1;
}

export interface SkillMatch {
  skill: SkillRecord | SkillDefinition;
  score: number;
}

export function searchSkills(
  query: string,
  skills: Array<SkillRecord | SkillDefinition>,
  limit = 12,
): SkillMatch[] {
  const q = query.replace(/^\//, '').trim();

  return skills
    .map((skill) => {
      const commandScore = fuzzyScore(q, skill.command);
      const nameScore = fuzzyScore(q, skill.name) * 0.7;
      const descScore = q.length > 2 ? fuzzyScore(q, skill.description) * 0.25 : -1;
      return { skill, score: Math.max(commandScore, nameScore, descScore) };
    })
    .filter((m) => m.score > 0)
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      const aUsage = 'usageCount' in a.skill ? a.skill.usageCount : 0;
      const bUsage = 'usageCount' in b.skill ? b.skill.usageCount : 0;
      return bUsage - aUsage;
    })
    .slice(0, limit);
}

export interface AttachmentSummary {
  name: string;
  kind: string;
  bytes: number;
  text?: string;
}

/** Substitute `{{input}}` and `{{files}}` into a template. */
export function expandSkill(
  skill: SkillRecord | SkillDefinition,
  args: string,
  attachments: AttachmentSummary[] = [],
): string {
  const fileBlock = attachments.length
    ? attachments
        .map((a) =>
          a.text
            ? `### ${a.name} (${a.kind}, ${a.bytes} bytes)\n\`\`\`\n${a.text.slice(0, 60_000)}\n\`\`\``
            : `### ${a.name} (${a.kind}, ${a.bytes} bytes) — binary, not inlined`,
        )
        .join('\n\n')
    : '_none_';

  return skill.template
    .replace(/\{\{\s*input\s*\}\}/g, args || '(no argument supplied — infer from context)')
    .replace(/\{\{\s*files\s*\}\}/g, fileBlock)
    .trim();
}

/** Parse a model-authored skill from `/skill`. Returns null on malformed output. */
export function parseGeneratedSkill(raw: string): SkillDefinition | null {
  const match = /\{[\s\S]*\}/.exec(raw);
  if (!match) return null;

  try {
    const parsed = JSON.parse(match[0]) as Partial<SkillDefinition> & { suite?: string | null };
    if (!parsed.command || !parsed.template) return null;

    const command = parsed.command.toLowerCase().replace(/^\//, '').replace(/[^a-z0-9-]/g, '-').replace(/-{2,}/g, '-').replace(/^-|-$/g, '');
    if (!command) return null;

    return {
      command,
      name: parsed.name ?? command,
      description: parsed.description ?? '',
      template: parsed.template,
      icon: parsed.icon ?? '✨',
      lane: parsed.lane === 'A' ? 'A' : 'B',
      suite: (parsed.suite as SuiteId | undefined) ?? undefined,
      argHint: parsed.argHint,
    };
  } catch {
    return null;
  }
}

export function toRecord(def: SkillDefinition, kind: SkillRecord['kind'] = 'builtin'): SkillRecord {
  const now = Date.now();
  return {
    id: `skill_${def.command}`,
    command: def.command,
    name: def.name,
    description: def.description,
    template: def.template,
    suite: def.suite,
    kind,
    lane: def.lane,
    createdAt: now,
    updatedAt: now,
    usageCount: 0,
    enabled: 1,
    icon: def.icon,
  };
}
