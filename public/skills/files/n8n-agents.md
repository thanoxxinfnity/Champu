# n8n Agents

## When to Use

Use this skill for n8n AI Agent, LangChain, classifier, extractor, memory, RAG, tool-calling, structured-output, or human-review design. Confirm the target n8n instance and inspect the live node schema before applying version-sensitive configuration.

Before activating or testing a workflow that can send messages, write data, make purchases, change accounts, or call external services, show the user the exact effects and obtain approval. Store provider keys and tokens only in n8n credentials; never place them in prompts, Set nodes, workflow JSON, examples, or logs.

The n8n AI Agent node (`@n8n/n8n-nodes-langchain.agent`) is a multi-turn LLM driver with sub-nodes for the model, memory, tools, and an optional output parser. This skill is the **deep** guide to designing agents and the LangChain family around them. For the high-level "where an agent fits in a workflow" picture, see the **n8n-workflow-patterns** skill — this skill goes one level down into *how to build it well*.

For node-type formats: in workflow JSON the LangChain nodes use the long `@n8n/n8n-nodes-langchain.*` form (`.agent`, `.lmChatOpenAi`, `.memoryBufferWindow`, `.outputParserStructured`, `.toolWorkflow`, `.toolHttpRequest`, `.toolCode`). When you call `get_node` / `validate_node`, use the **short** form (`nodes-langchain.agent`). See **n8n-mcp-tools-expert** for the format rules.

---

## Pick the right node first

Reaching for an Agent when the task is one-shot classification or extraction is the most common over-build. Decide before you wire anything:

| You need to… | Use | Why |
|---|---|---|
| Call tools, reason over multiple turns, or hold memory | **AI Agent** (`.agent`) | The full loop: model + tools + memory + optional parser. Also a fine default when you'd rather standardize. |
| One-shot text in → text out, no tools | **Basic LLM Chain** (`.chainLlm`) | No agent loop, easier to debug. Still accepts an `outputParserStructured` sub-node. |
| Route a natural-language input to one of **N branches** | **Text Classifier** (`.textClassifier`) | ONE node, N output handles, downstream wires directly into each. Not Agent + Switch. |
| Pull structured fields out of free text | **Information Extractor** (`.informationExtractor`) | Purpose-built field extraction with a schema. |
| 3-way positive/neutral/negative split | **Sentiment Analysis** (`.sentimentAnalysis`) | Built-in branch outputs. |
| Condense a long document | **Summarization Chain** (`.chainSummarization`) | Map-reduce summarization built in. |
| Generate an image / audio / video | **The provider's native single-call node** (OpenAI, Gemini, ElevenLabs…) | NEVER wrap media generation in an Agent — see "Binary and the agent boundary". |

**Text Classifier detail (the Agent + Switch anti-pattern):** every category needs both a **name AND a description**. The model routes against the *description*, not the name — a category with no description gets picked by coin-flip. Set `options.enableAutoFixing: true` for robustness on edge inputs. One node, N branches, done. Reaching for an Agent that "decides" then a Switch that "routes" is two nodes plus prompt boilerplate for what Text Classifier does natively.

Chat-model nodes (`.lmChatOpenAi`, `.lmChatAnthropic`, `.lmChatOpenRouter`, …) are **sub-nodes** — they don't run standalone. They wire into a chain, agent, classifier, or extractor via the `ai_languageModel` connection.

---

## The sub-node pattern

The Agent has a **main input** (the prompt / user message) and up to four **sub-node slots**, each wired by its own `ai_*` connection type:

| Slot | Connection type | Required? | Node example |
|---|---|---|---|
| **model** | `ai_languageModel` | Yes | `.lmChatOpenAi`, `.lmChatAnthropic`, `.lmChatOpenRouter` |
| **memory** | `ai_memory` | Optional | `.memoryBufferWindow`, `.memoryPostgresChat` |
| **tools** | `ai_tool` | Optional (but the point of an agent) | `slackTool`, `.toolWorkflow`, `.toolHttpRequest`, `.toolCode` |
| **outputParser** | `ai_outputParser` | Optional | `.outputParserStructured` |

A sub-node connects FROM itself TO the agent. In workflow JSON the connection lives on the **sub-node**, keyed by the `ai_*` type:

```json
"Main LLM": {
  "ai_languageModel": [[{ "node": "AI Agent", "type": "ai_languageModel", "index": 0 }]]
},
"Simple Memory": {
  "ai_memory": [[{ "node": "AI Agent", "type": "ai_memory", "index": 0 }]]
},
"Search customer DB": {
  "ai_tool": [[{ "node": "AI Agent", "type": "ai_tool", "index": 0 }]]
}
```

Multiple tools all connect into the same `ai_tool` index 0 — they stack, they don't fan into separate indices. With `n8n_update_partial_workflow` you wire each with an `addConnection` op using `sourceOutput: "ai_tool"`. The agent puts its final answer in **`$json.output`** (not `.text`, not `.response`) — downstream nodes read `{{ $json.output }}`.

See **references/EXAMPLES.md** for a complete stateless agent-core node-object snippet.

---

## Two non-negotiables

1. **Tool names and descriptions ARE part of the prompt.** The model picks a tool by reading its name and description — nothing else. A tool named `tool1` with an empty description is invisible to the model: it skips it, mis-selects it, or hallucinates parameters. There's usually no error — just an agent that "won't use my tool". Treat both like API design. → **references/TOOLS.md**
2. **Structured output must parse AND autoFix.** An `outputParserStructured` with `autoFix: true` and a **coding-capable fixer model** is the production pattern. Without autoFix, one malformed JSON response halts the whole workflow. → **references/STRUCTURED_OUTPUT.md**

---

## Strong defaults

- **Per-tool usage goes in the tool description, not the system prompt.** Anything about *how to call this specific tool* belongs with the tool, so it travels across agents and keeps the system prompt focused. → **references/SYSTEM_PROMPT.md**
- **Sub-workflow tools (`.toolWorkflow`) for anything multi-step.** Any workflow becomes a tool with typed `$fromAI()` inputs, and composes with branching, error handling, and reuse. Default here when in doubt. → **references/SUBWORKFLOW_AS_TOOL.md** and **n8n-subworkflows**.
- **Wrap tools with user-visible side effects in human review.** Sends, payments, refunds, account changes get gated behind an approval node so a human signs off before the tool fires. → **references/HUMAN_REVIEW.md**
- **Raise `maxIterations`.** The default tool-call cap is **low** (single digits on most versions) — fine for a one-tool agent, far too low for a multi-tool agent that chains several calls per turn. It surfaces as "max iterations reached" or empty output. Set `options.maxIterations` to a realistic ceiling (15 for a focused sub-agent, 50-200 for a broad orchestrator).
- **Put the current date in the system prompt** via `{{ $now }}` (or `{{ $now.format('DDDD') }}`). A hardcoded date is stale immediately.

---

## The four tool types

Pick the lightest option that covers the job:

| Tool type | Node | Use when |
|---|---|---|
| **Native tool node** | `slackTool`, `gmailTool`, `toolCalculator`, … | The capability maps to one existing node + one operation. Lowest overhead. |
| **Sub-workflow as tool** | `.toolWorkflow` | More than one node, reusable logic, or you want independent testability. The canonical n8n way — **default when in doubt**. |
| **HTTP Request Tool** | `.toolHttpRequest` | A single external HTTP API the agent should orchestrate directly. Reuse the service's predefined credential to cover operations a native node doesn't expose. |
| **MCP Client Tool** | `.mcpClientTool` | A maintained MCP server already covers it, or you want one published workflow to serve many agents. |

There is also a **Custom Code Tool** (`.toolCode`) for pure inline computation — but its runtime contract (string in / string out, no `$fromAI`, no `$helpers`) is owned by the **n8n-code-tool** skill. Read that before writing one. Rule of thumb: if you find yourself reaching for `$fromAI()` inside the code, you want `.toolWorkflow` instead.

### `$fromAI()`: how the agent fills tool parameters

Tool parameters the agent should decide are wrapped in `$fromAI()`. It is a **real n8n expression helper**, used inside a tool node's parameter expressions:

```
={{ $fromAI('paramName', 'what to put here — be specific: format, range, example', 'string') }}
```

- **paramName** — the name the model uses internally (snake_case or camelCase, be consistent).
- **description** — tells the model what value to produce. **It is part of the prompt** — write it like JSDoc.
- **type** (optional) — `'string'` (default), `'number'`, `'boolean'`, `'json'`. A wrong-typed value fails the call.
- **defaultValue** (optional) — used when the model omits it.

`$fromAI()` carries JSON only — it **cannot carry binary** (no base64, no file bytes). And not every parameter has to be `$fromAI`: plumb identity, authority limits, and correlation IDs (`userId`, refund caps, `sessionId`) deterministically from workflow context so the agent can't get them wrong or even see them. → **references/TOOLS.md** for the full anatomy and the "give the agent a button, not a steering wheel" pattern.

---

## System prompt vs tool description

| Belongs in the **system prompt** | Belongs in the **tool's description** |
|---|---|
| Persona, role, voice | What this specific tool does |
| Global output/format rules ("respond in markdown") | When to use it vs other tools |
| Refusal / safety behavior | What each parameter means and its shape |
| Display protocols (`![]()` for images) | Examples of good vs bad invocations |
| Universal context (current date via `$now`, user role) | Tool-specific gotchas (rate limits, edge cases) |
| Inter-tool flow ("after generating, always display") | Tool-specific input transformations |

Why split it: a well-described tool works in **any** agent that drops it in, tool details only "load" when the model considers that tool (token efficiency), and you update one tool description instead of a paragraph buried in a 5000-token prompt. → **references/SYSTEM_PROMPT.md**

---

## Structured output: when and how

Add an `outputParserStructured` sub-node (wired `ai_outputParser`) when downstream needs strict JSON, not free-form text. Two rules:

1. **Use `schemaType: 'manual'` with a real JSON Schema, not `jsonSchemaExample`.** An example can't express required-vs-optional, enums, numeric ranges, or array constraints — you outgrow it the first time the shape gets non-trivial. Reach for `fromJson` + an example only for throwaway shapes.
2. **`autoFix: true` with a coding-capable fixer model.** Wire a *second* model into the parser's `ai_languageModel` slot. Reconciling broken JSON against a schema is a coding task — a weak fixer just produces another malformed retry and burns tokens.

→ **references/STRUCTURED_OUTPUT.md** for the schema patterns, the load-bearing "DO NOT wrap in markdown" retry line, and the parse-failure cookbook.

---

## Memory: brief mental model

Memory is a sub-node (`ai_memory`). Without it, every call is stateless — correct for one-shot tasks (classify, summarize). With it, the agent holds a conversation, keyed by whatever expression you bind to `sessionKey`.

- **`memoryBufferWindow`** — keeps the last N exchanges per key and persists across executions via n8n's store. The default for chat. **`contextWindowLength` defaults to 5, which is very low** — 50 is a saner starting point. Messages past the window are gone entirely.
- **`memoryPostgresChat` / `memoryRedisChat`** — only when memory must be read *outside* the agent (your own UI, analytics, cross-system). Not needed just to survive restarts; BufferWindow already does that.

**Plumb a stable key from the trigger to memory consistently.** Chat triggers fill `sessionId` automatically; for other surfaces derive one (Slack `thread_ts`, a webhook conversation ID). Never hardcode `sessionId: 'default'` and never put `sessionId` behind `$fromAI` (the model

…(the rest of this skill is left out)