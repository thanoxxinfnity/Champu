# chomu-memory

A local MCP server: **semantic code index, symbol graph, verified facts, deep bug tracing, compaction checkpoints and history, and a private archive**, for Claude (Claude Code, Claude Desktop, Cursor, any MCP client). Read `ARCHITECTURE.md` for how and why.

- Needs **Node 22.5 or newer**. Nothing to install (`npm install` is not needed; there are no dependencies).
- 100 % local: no network, no external database. The archive is `<project>/.chomu-memory/`.

## Try it

```bash
cd mcp/chomu-memory
node --disable-warning=ExperimentalWarning bin/chomu-mcp.mjs index  --root /path/to/project
node --disable-warning=ExperimentalWarning bin/chomu-mcp.mjs search "where is the user logged in" --root /path/to/project
node --disable-warning=ExperimentalWarning bin/chomu-mcp.mjs doctor --root /path/to/project
```

## Connect it to Claude

**Claude Code** (this repo already has a `.mcp.json`; Claude Code asks you to approve it). Or for any project:

```bash
claude mcp add chomu-memory -- node --disable-warning=ExperimentalWarning /abs/path/to/mcp/chomu-memory/bin/chomu-mcp.mjs serve --root /abs/path/to/project
```

**Claude Desktop** (`claude_desktop_config.json`):

```json
{ "mcpServers": { "chomu-memory": {
  "command": "node",
  "args": ["--disable-warning=ExperimentalWarning", "/abs/path/to/mcp/chomu-memory/bin/chomu-mcp.mjs", "serve", "--root", "/abs/path/to/project"]
} } }
```

**Cursor / others**: the same command and args in their MCP settings.

Options: `--data <dir>` (archive location), `--embed hash|ollama`, `--no-auto-index`. Environment: `CHOMU_EMBED=ollama`, `CHOMU_OLLAMA_MODEL`, `CHOMU_OFFLINE=1`. Put paths you do not want indexed in `.chomuignore` (same syntax as `.gitignore`).

## How to work with it

1. New or compacted chat → `resume_context` (last saved compaction + verified facts + history). No more pasting old chats.
2. Before reading files → `search_code` (describe what the code does), `find_symbol`, `find_callers`, `call_path`, `impact_analysis`, `file_dependencies`.
3. A bug → `trace_bug` with the error text and stack, then `trace_value` to follow a variable.
4. Learned something → `remember_fact` with evidence (`{file, start_line, end_line}` or `{file, snippet}`). It is only ever returned after being re-verified; if the code changed it goes stale and is not injected.
5. Before a risky change → `checkpoint_create`; after → `checkpoint_diff`. Chat getting long → `save_compaction`.
6. Cleaning up → `dead_code` (unreferenced / unreachable from entry points / dead ends).

## Tools (30)

`resume_context` `inject_context` `search_code` `project_overview` `find_symbol` `get_symbol` `find_callers` `find_callees` `find_references` `call_path` `impact_analysis` `file_dependencies` `dead_code` `remember_fact` `recall_facts` `verify_facts` `list_facts` `forget_fact` `trace_bug` `trace_value` `checkpoint_create` `checkpoint_list` `checkpoint_diff` `checkpoint_file` `history_search` `log_event` `save_compaction` `index_project` `archive_info` `archive_export` `archive_wipe`

## Tests

```bash
npm run mcp:test     # from the repo root: 12 tests incl. the stdio protocol, the privacy checks and the "no network" source check
```
