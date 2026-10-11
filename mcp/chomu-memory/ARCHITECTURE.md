# chomu-memory: architecture

A local MCP server that gives Claude a private map of a codebase and a memory it can trust, so long projects do not depend on the chat window.
Everything runs on your machine, in one Node process, over stdio. There is no port, no cloud, no telemetry, and no npm dependency.

## The plan, step by step

1. **Index** (`indexer.mjs`). Walk the project (respecting `.gitignore` and `.chomuignore`, skipping `node_modules`, builds, binaries, files over 1 MB, and anything that looks like a secret). A file is read again only when its size, time and hash changed.
2. **Parse** (`parsers/`). TypeScript/JavaScript through the real compiler (`typescript`, found in the project or beside the server): functions, methods, classes, interfaces, types, exported consts, calls, `new`, JSX components, `extends/implements`, imports, callbacks passed by name. Python, GDScript, Go, Rust, Java/Kotlin/C#/C/C++, Ruby, PHP, Lua and shell go through a pattern parser (definitions, block ends by indentation or braces, calls by name). Markdown/JSON/YAML get a file card only.
3. **Cards** (`indexer.mjs`). Every symbol and every file becomes a short "card": what it is, its signature, its doc comment, what it calls, and its first lines. The card is what gets searched, so the index is about what code *does*, not what the file is called.
4. **Embed** (`embed.mjs`). Cards become 384-number vectors. Default: a built-in hashing embedder with identifier splitting and a concept table (login ≈ authenticate ≈ session ≈ token; delete ≈ remove ≈ drop). It needs no model and no download. Optional: a local Ollama server (`CHOMU_EMBED=ollama`) for a neural embedding; the only address it may ever call is the machine's own loopback.
5. **Store** (`db.mjs`). One SQLite file (`node:sqlite`, built into Node 22.5+) with FTS5 for keywords and a BLOB column for vectors. Snapshots are zlib-compressed, content-addressed files next to it.
6. **Resolve** (`indexer.mjs: resolveEdges`). Each call is pointed at the definition it means: unique name → that symbol; else the one in the same file; else the one in a file this file imports. `this.f()` prefers the same class; `obj.f()` on an unknown object only matches methods, and never names every object has (`test`, `push`, `get`). What stays unclear is marked **ambiguous**, never silently guessed.
7. **Query** (`search.mjs`, `graph.mjs`, `trace.mjs`, `facts.mjs`, `history.mjs`). Hybrid search (BM25 + cosine, merged by reciprocal rank fusion), the symbol graph, bug tracing, verified facts, checkpoints.
8. **Serve** (`server.mjs`, `tools.mjs`). 30 tools over MCP (JSON-RPC 2.0, newline-delimited, written by hand). The index refreshes itself before each query (stat-based, throttled).

## The six features, and where they live

| Feature | How | Where |
|---|---|---|
| 1. Semantic code indexing | symbol/file cards → hash or Ollama vectors + FTS5, fused by RRF | `indexer`, `embed`, `search` |
| 2. Symbol graph | definitions, calls/refs/extends edges, resolved to definitions with confidence; callers/callees trees, call paths, impact, file dependencies, dead code (unreferenced, unreachable from entry points, dead ends) | `graph` |
| 3. Verified fact injection | a fact needs evidence (file + lines or a snippet) that is checked when saved and **re-checked every time it is recalled**; moved code is followed, changed code makes the fact stale and it is not injected; a character budget caps what is returned | `facts` (`remember_fact`, `recall_facts`, `inject_context`, `resume_context`) |
| 4. Deep bug tracing | stack traces (Node, Python, Godot) and symptoms → anchors; callers up to an entry point; callees; ranked root-cause candidates with the evidence for each (stack position, words shared with the error, null checks, recent git changes); `trace_value` follows a variable through call arguments into the callee's parameters, and on | `trace` |
| 5. Compaction checkpoints & history | `checkpoint_create` (files + every symbol with a body hash), `checkpoint_diff` (files, symbols, line diff), `checkpoint_file`, `history_search` (events, decisions, checkpoint notes, "when did this function exist"), `save_compaction` / `resume_context` for a chat that is about to be compacted | `history` |
| 6. Raw local archive | everything under `<project>/.chomu-memory/` (git-ignored); loopback-only network guard; secrets blanked before storage; `archive_info`, `archive_export`, `archive_wipe` | `privacy`, `history` |

## Vector storage: what was considered

| Option | Verdict |
|---|---|
| **SQLite + FTS5 + vectors as BLOBs, brute-force cosine in memory** (chosen) | zero dependencies, one file, fast to ~50k cards (tested: 2,100 files, 4,200 symbols in 5 s), trivially private |
| sqlite-vec | good next step past ~100k cards, but a native extension per OS/arch to ship and load; the storage format here (float32 BLOB) is already what it reads |
| Chroma | a Python server and a client library; more moving parts than the problem needs, and a process that listens on a port |
| LanceDB / Qdrant (local) | strong at scale, but native binaries and a second store to keep consistent with the symbol tables |

## Privacy, concretely

- The server writes only inside `.chomu-memory/` (and one line to `.gitignore`). It is a stdio process: it opens no port.
- Source files that look like secrets (`.env*`, `*.pem`, `*.key`, keystores, `credentials`, `secrets`) are never read. Secret-looking strings (`sk-…`, `nvapi-…`, `hf_…`, `ghp_…`, `AKIA…`, private-key blocks, `password: "…"`) are blanked in cards, facts, history and snapshots.
- The only code that can make a network request is the optional Ollama embedder, and `assertLoopback` refuses any address that is not `localhost`/`127.0.0.1`. `CHOMU_OFFLINE=1` forbids even that. A test reads the source and fails if anything else touches the network.
- Tool paths are forced inside the project (`safeJoin`).

## Honest limits

- The default embedder is a hashing model with a concept table, not a neural network: it finds "creature goes towards a noise" → the enemy hearing code well, but it will miss paraphrases that share no words and no concept group. Use Ollama (`nomic-embed-text`) for stronger meaning.
- Calls are matched by name. Dynamic dispatch, signals, reflection and string-built names are invisible, so `call_path` can say "no path" for code that is connected at run time, and `dead_code` can list something that is called dynamically. Both say so; check before deleting.
- Only TypeScript/JavaScript use a real compiler. Other languages use patterns: good for functions, classes and calls, weaker at nested or unusual syntax.
- Bug tracing ranks evidence; it does not run your code. It tells you where to look first and why.
