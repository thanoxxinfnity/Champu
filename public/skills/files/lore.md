# lore — Framework-agnostic Memory Management

## What this skill is

A long-term knowledge base for a software project, maintained by AI agents. It is **not** a dev journal or a changelog. It captures the kind of context that normally lives only in the original developer's head:

- What the project is, how it is shaped (architecture)
- Why specific choices were made over alternatives (decisions)
- How code should be written and what to avoid (conventions)

This knowledge is persisted as **plain Markdown files** in `.lore/` at the project root. Any agent that can read files can consume them.

## When to Use

The skill uses a **two-tier trigger model**.

### Tier 1 — Loading the skill

Load this skill when the user explicitly invokes `lore`, names a subcommand, references `.lore/`, or asks to record, recall, audit, sync, or compress project memory about decisions, architecture, conventions, or monorepo scopes. Generic phrases like "init", "compress", "audit", or "query" alone are not enough — they may map to the agent's native commands or unrelated tasks (Claude Code's `/init`, `/compact`, security audits, SQL queries, etc.).

| User says (examples) | Command |
|---|---|
| "lore init" / "create lore memory bank" / "initialize lore" | `init` |
| "lore sync" / "sync this change to lore" / "record this decision in lore" | `sync` |
| "lore query" / "query lore" / "what's the project convention" | `query` |
| "lore audit" / "check lore" / "is memory still accurate" | `audit` |
| "lore compress" / "compress lore" / "summarize lore" | `compress` |
| "lore mirror" / "update CLAUDE.md" / "refresh mirror" | `mirror` |
| "lore history" / "show the git history of this entry" / "show me the commits behind this" | `history` |

### Tier 2 — Internal proposals (after the skill is loaded)

Once the skill is loaded for this session, certain commands may proactively propose themselves based on internal thresholds. These proposals still require user acceptance — the skill never mutates files silently.

- `sync` proposes when 50+ changed lines span 2+ directories, OR a new top-level module/directory/dependency was added or removed, OR a new convention was explicitly discussed in chat.
- `compress` appends a `[COMPRESS NOTICE]` to sync proposals when entries > 500, `SUMMARY.md` is missing, or last compression > 30 days ago.
- `sync` emits `[ALERT]` markers when an active entry conflicts with current code or with a candidate change.
- `mirror` regenerates automatically during `compress` if `auto_mirror: true` is set in `.lore/.config.json`.

Other commands (`init`, `query`, `history`) are always explicit — they need user intent. See [`references/workflows.md`](references/workflows.md) for when each workflow is used.

## Which command do I need?

| User goal | Command | When | Procedure |
|---|---|---|---|
| First-time setup, or start over | `init` | One-time setup | [`references/workflows.md#init`](references/workflows.md#init--initialize-the-memory-bank), then `references/platform-mirrors.md` + `references/monorepo-detection.md` |
| "Remember this change" after a feature / refactor / bug fix | `sync` | After a non-trivial change | [`references/workflows.md#sync`](references/workflows.md#sync--update-after-a-change), then `references/stale-new-markers.md` |
| "What is the project convention / why was X chosen?" | `query` | Answer from memory | [`references/workflows.md#query`](references/workflows.md#query--answer-from-memory) |
| "Is memory still accurate?" | `audit` | Memory may have drifted from reality | [`references/workflows.md#audit`](references/workflows.md#audit--check-memory-vs-reality), then `references/audit-template.md` |
| "Summarize the memory bank" | `compress` | SUMMARY.md stale, or entries > 500 | [`references/workflows.md#compress`](references/workflows.md#compress--build-the-top-level-summary), then `references/summary-template.md` |
| "Update CLAUDE.md / AGENTS.md / mirrors" | `mirror` | Explicit publish of mirror changes | [`references/workflows.md#mirror`](references/workflows.md#mirror--regenerate-platform-mirrors), then `references/platform-mirrors.md` |
| "Why does this decision exist?" / "show the commits behind this" | `history` | Git story behind an entry | [`references/workflows.md#history`](references/workflows.md#history--show-git-commits-related-to-a-memory-entry), then `references/history-command.md` |
| Agent-native `/init` or `/compact` | do **not** trigger lore | — | Relationship to agent native commands |

The step-by-step procedures for all seven commands live in [`references/workflows.md`](references/workflows.md) — load that file before executing any command.

**Already have `.lore/`?** Adding a new scope is still `sync` — `init` is only for first-time setup or an explicit start-over. A change that introduces a new scope does not reinitialize the memory bank; `sync` creates the scope directories directly (see `references/workflows.md` sync step 2).

**Start minimal.** lore does not require a monorepo or mirrors. Single-package projects get `_global/` only (no scopes). Single-host setups can set `mirror_targets: []` in `.lore/.config.json` to disable mirror generation and read `.lore/SUMMARY.md` directly.

**Happy path.** `init` once -> then the recurring cadence is `sync` (record) / `query` (recall) / `audit` (check) -> `compress` when SUMMARY grows stale (or a `[COMPRESS NOTICE]` appears) -> `mirror` to publish structural changes.

## Reference index

Detailed specifications live in `references/`. Load these on demand.

| File | When to load |
|---|---|
| `references/workflows.md` | Executing any `lore <command>` — step-by-step procedures for all seven workflows |
| `references/entry-format.md` | Writing entries, computing IDs, cross-file references |
| `references/summary-template.md` | Running `compress` — SUMMARY.md schema and selection rules |
| `references/audit-template.md` | Running `audit` — report format and severity definitions |
| `references/monorepo-detection.md` | During `init` — detecting scope boundaries from workspace config (`sync` creates newly-introduced scopes directly, see `references/workflows.md`) |
| `references/stale-new-markers.md` | During `sync` — full marking convention and user reply semantics |
| `references/platform-mirrors.md` | Platform file mapping (CLAUDE.md / .cursorrules / etc.), two-section file structure |
| `references/config.md` | `.lore/.config.json` schema and field semantics |
| `references/history-command.md` | Running `history` — full spec, dispatch rules, error table |
| `references/compatibility.md` | Versioning policy: `.config.json#schema_version`, migration tools, deprecation workflow |
| `scripts/README.md` | Helper scripts (id_hash, list_entries, find_duplicates, find_stale, history) — also in Chinese (`scripts/README.zh-CN.md`) |

## Memory architecture

### Directory layout

```
.lore/
|-- SUMMARY.md        # Top-level digest of key entries. New agents read this first, then open referenced entries.
|-- .config.json      # Optional config: auto_mirror, sync_trust, mirror_targets, etc.
|-- _global/          # Cross-scope facts (whole-project architecture, global decisions)
|   |-- ARCHITECTURE.md
|   |-- DECISIONS.md
|   `-- CONVENTIONS.md
|-- scopes/           # Per-scope facts
|   `-- <scope-name>/
|       |-- ARCHITECTURE.md
|       |-- DECISIONS.md
|       `-- CONVENTIONS.md
|-- draft/            # Used only by `init`. Proposals pending user confirmation.
|-- audit/            # Used only by `audit`. Reports; never mutates main files.
`-- .archive/         # My notes backups (mirror wipe only); see references/platform-mirrors.md.
```

**Scope detection and creation:** `init` detects scope boundaries once (see `references/monorepo-detection.md` for marker detection across pnpm / Yarn / npm / Lerna / Nx / Rush / Cargo / Go / Bazel); `sync` creates the scope directories when a change introduces a new scope (see `references/workflows.md` sync step 2). Single-package projects fall back to `_global/` only.

### Layer semantics

Each layer answers one kind of question. The boundary that trips people up most is *fact vs. reason*: the choice itself is ARCH, the reasoning behind it is DEC.

| Layer | Answers | File | Example |
|---|---|---|---|
| ARCH | What the project / module is and how it is shaped (structure, stack, layout) | `ARCHITECTURE.md` | "Use Next.js App Router" |
| DEC | Why a choice was made over alternatives (reasoning, tradeoffs) | `DECISIONS.md` | "Chose Zustand over Redux; reason: 60% less boilerplate" |
| CONV | How code should be written and what to avoid (rules) | `CONVENTIONS.md` | "Never commit secrets" |

**Boundary rule:** "we use X" -> ARCH; "why X over Y" -> DEC. A short inline reason (e.g. `reason: streaming + RSC`) may stay on an ARCH entry when it fits; anything with alternatives or tradeoffs ("why X over Y") is a DEC entry that references the ARCH ID (see `references/entry-format.md` for the atomicity rule and splitting examples).

**Placement (all three layers):** affects 2+ scopes (e.g. "use pnpm workspaces", "TypeScript strict") -> the `_global/` file; affects exactly one scope -> that scope's file.

There is no separate metadata file. Every status lives as inline tags on entries themselves.

### Entry format

Each entry is a Markdown bullet (2 lines or fewer), with a layer prefix, a deterministic ID, and inline status tags. See `references/entry-format.md` for the full spec (ID generation via content hash, tag semantics, cross-file reference format, splitting rules).

```markdown
- [ARCH-2026-07-09-a3f2] Use Next.js App Router; reason: streaming + RSC. #added:2026-07-09
- [DEC-2026-02-03-7c19] Chose Zustand over Redux; reason: 60% less boilerplate. #added:2026-02-03
- [CONV-2026-01-20-b1e8] Never commit secrets; use `dotenv` + `.env.local` (gitignored). #added:2026-01-20
```

## Platform mirror

The canonical store is `.lore/*`. Agents that expect a single config file at the project root (`CLAUDE.md` for Claude Code, `.cursorrules` for Cursor, `.clinerules` for Cline, `AGENTS.md` for Aider, etc.) read a synced projection of that store.

**A mirror is a synced projection, not a strict derivative.** It contains two sections: a Skill-managed `## Lore` section (rewritten on mirror regeneration) and a user-editable `## My notes` section (preserved verbatim). Both sections are legitimate mirror content; the Skill never touches My notes. The two-section template and the `<!-- LORE:START -->` / `<!-- LORE:END -->` boundary markers are specified in `references/platform-mirrors.md`.

**Default behavior:**

- **Init**: targets are auto-detected (existing platform files in repo root). If none detected, ask the user via multi-select which agents they use. For each detected file lacking a `## Lore` section, ask take over / preserve / abort per file. Auto-create missing files with the full two-section template; refresh existing lore mirrors; preserve My notes verbatim.
- **Compress**: controlled by `.lore/.config.json#auto_mirror`. Default is `false` (ask per target). When `true`, mirrors update automatically. My notes section is **always** preserved.
- **Sync**: never touches mirrors by default. To restore mirror updates on every `sync`, set `sync_updates_mirror: true` in `.lore/.config.json` (see `references/config.md`).

By default the Lore section is an **index** into `.lore/` — paths plus a per-scope one-line description, ~600 bytes worst case. The agent reads `.lore/SUMMARY.md` (or calls `lore query <term>`) on demand.

### Mirror update triggers

Platform mirrors are regenerated on only three occasions, not on every `sync`:

1. `init` completion — first time the mirror is created or restructured
2. `compress` completion — `SUMMARY.md` changed, so mirrors reflect the new digest
3. Explicit `lore mirror` command — user forces a regeneration

`sync` only updates `.lore/*` files. This is deliberate: mirror files are agent-facing entry points, not a per-change log. Regenerating the

…(the rest of this skill is left out)