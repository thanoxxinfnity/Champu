# Monte Carlo Monitoring Advisor Skill

This skill handles all monitoring requests -- coverage analysis, data monitor creation, and AI agent monitoring. It routes to the right reference file based on the user's intent.

> **Monte Carlo tool routing (required):** Always call Monte Carlo MCP tools through this plugin's
> bundled server, whose fully-qualified tool names are
> `mcp__plugin_mc-agent-toolkit_monte-carlo-mcp__<tool>` (e.g.
> `mcp__plugin_mc-agent-toolkit_monte-carlo-mcp__get_alerts`). Bare tool names used in this skill
> (`get_alerts`, `search`, `get_table`, …) refer to that bundled server. If the session also has a
> separately-configured `monte-carlo-mcp` server, do **not** route to it — it may point at a
> different endpoint or credentials.

Reference files live next to this skill file. **Use the Read tool** (not MCP resources) to access them:

- Data monitor creation procedure: `references/data-monitor-creation.md` (relative to this file)
- Agent monitor creation procedure: `references/agent-monitor-creation.md` (relative to this file)
- Per-type references: `references/data-*.md` and `references/agent-*.md` (relative to this file)

## When to activate this skill

Activate when the user:

- Asks about monitoring coverage, data coverage, or coverage gaps
- Wants to understand what's monitored vs. not in their warehouse
- Asks about use cases, use-case criticality, or use-case analysis
- Wants to explore their data estate and find what needs monitoring
- Says things like "what should I monitor?", "where are my coverage gaps?", "show me my use cases"
- Asks about unmonitored tables with anomalies or importance-based prioritization
- Asks to create, add, or set up a monitor (e.g. "add a monitor for...", "create a freshness check on...", "set up validation for...")
- Mentions monitoring a specific table, field, or metric
- Wants to check data quality rules or enforce data contracts
- Asks about monitoring options for a table or dataset
- Requests monitors-as-code YAML generation
- Wants to add monitoring after new transformation logic (when the prevent skill is not active)
- Asks about monitoring AI agents, agent latency, agent token usage, or agent quality
- Wants to set up alerts on agent behavior or execution patterns
- Asks about investigating agent traces or conversations
- Says things like "monitor my agent", "track agent latency", "alert on agent errors"
- Asks about agent evaluation monitors, trajectory monitors, or validation monitors
- Mentions agent observability or agent monitoring

## When NOT to activate this skill

Do not activate when the user is:

- Just querying data or exploring table contents
- Triaging or responding to active alerts (use the prevent skill's Workflow 3)
- Running impact assessments before code changes (use the prevent skill's Workflow 4)
- Asking about existing monitor configuration (use `get_monitors` directly)
- Editing or deleting existing monitors

---

## Prerequisites

- **Required:** Monte Carlo MCP server (`monte-carlo-mcp`) must be configured and authenticated
- **Optional:** A database MCP server (Snowflake, BigQuery, Redshift, Databricks) for SQL profiling of table usage patterns

---

## Available MCP tools

All tools are available via the `monte-carlo-mcp` MCP server.

### Coverage and discovery tools

| Tool | Purpose |
| --- | --- |
| `get_warehouses` | List accessible warehouses (needed first -- `get_use_cases` requires `warehouse_id`) |
| `get_use_cases` | List use cases with criticality, descriptions, table counts, precomputed tag names |
| `get_use_case_table_summary` | Criticality distribution (HIGH/MEDIUM/LOW table counts) for a use case |
| `get_use_case_tables` | Paginated tables with criticality, golden-table status, MCONs |
| `get_monitors` | Check monitoring status on specific tables via `mcons` filter |
| `get_asset_lineage` | Upstream/downstream dependencies for tables (takes MCONs + direction) |
| `get_audiences` | List notification audiences |
| `get_unmonitored_tables_with_anomalies` | Tables with muted OOTB anomalies but no monitors (takes ISO 8601 time range) |
| `search` | Find tables by name; supports `is_monitored` filter |
| `get_table` | Table details, fields, stats, domain membership |
| `get_queries_for_table` | Query logs for a table (source/destination) |
| `get_field_metric_definitions` | Available metrics per field type for a warehouse |
| `get_domains` | List Monte Carlo domains |
| `get_validation_predicates` | Available validation rule types |

### Data monitor creation tools

All five tools follow a **two-call preview-then-confirm pattern**: the first call (with the default `dry_run=True`) returns rendered MaC YAML for review; the second call (`dry_run=False`) deploys the monitor live and returns a deep link to it. Pass `monitor_uuid` on either call to update an existing monitor in place instead of creating a new one. See `references/data-monitor-creation.md` for the full flow.

| Tool | Purpose |
| --- | --- |
| `create_or_update_table_monitor` | Create or update a table monitor (preview YAML on `dry_run=True`, deploy on `dry_run=False`) |
| `create_or_update_metric_monitor` | Create or update a metric monitor (preview YAML on `dry_run=True`, deploy on `dry_run=False`) |
| `create_or_update_validation_monitor` | Create or update a validation monitor (preview YAML on `dry_run=True`, deploy on `dry_run=False`) |
| `create_or_update_sql_monitor` | Create or update a custom SQL monitor (preview YAML on `dry_run=True`, deploy on `dry_run=False`) |
| `create_or_update_comparison_monitor` | Create or update a comparison monitor (preview YAML on `dry_run=True`, deploy on `dry_run=False`) |

### Agent monitoring tools

| Tool | Purpose |
| --- | --- |
| `get_agent_metadata` | List AI agents -- returns agent names, `agentReference` values (the `agent` arg for monitor creation), trace table MCONs, source types |
| `get_agent_conversation` | Retrieve recent LLM interactions/conversations for an agent |
| `get_agent_trace` | Inspect execution traces and span trees |
| `create_or_update_agent_metric_monitor` | Create or update monitors for quantitative span-level metrics (preview YAML on `dry_run=True`, deploy on `dry_run=False`) |
| `create_or_update_agent_evaluation_monitor` | Create or update monitors for LLM-evaluated quality metrics (preview YAML on `dry_run=True`, deploy on `dry_run=False`) |
| `create_or_update_agent_trajectory_monitor` | Create or update trajectory monitors for execution pattern alerts (preview YAML on `dry_run=True`, deploy on `dry_run=False`) |
| `create_or_update_agent_validation_monitor` | Create or update validation monitors for logical assertions (preview YAML on `dry_run=True`, deploy on `dry_run=False`) |

---

## Routing

When the user's request comes in, determine which workflow to follow:

| User intent | Workflow |
| --- | --- |
| Coverage analysis, use-case exploration, "what should I monitor?" | **Coverage workflow** (below) |
| Create a specific data monitor for a known table | **Read `references/data-monitor-creation.md`** and follow its procedure |
| Monitor AI agents, agent latency, agent quality, agent traces | **Read `references/agent-monitor-creation.md`** and follow its procedure |
| Coverage analysis leads to monitor creation | Complete coverage workflow, then **read `references/data-monitor-creation.md`** for creation |

When reading reference files, always use the **Read tool** with the path relative to this skill file.

---

## Coverage workflow

This is the primary flow when the user asks about monitoring coverage, coverage gaps, or what to monitor.

### Step 1: Discover warehouses

Call `get_warehouses` to list all accessible warehouses.

- If **one** warehouse: select it automatically, proceed to Step 2.
- If **multiple** warehouses: present warehouse **names** (never UUIDs) and ask the user which one to explore.

### Step 2: Discover use cases

Call `get_use_cases(warehouse_id=<selected>)` to discover use cases for the chosen warehouse.

- If **use cases exist** --> proceed to the **Use-case exploration** (below).
- If **no use cases** --> proceed to the **Importance-based fallback** (below).

### Step 3: Check for database MCP (optional)

Check if the user has a database MCP server available by looking for tools containing `snowflake`, `bigquery`, `redshift`, or `databricks` in the tool list. If found, note it for the SQL profiling step later. If not found, skip SQL profiling gracefully.

---

## Use-case exploration

This is the primary flow when use cases are defined.

### Present use cases

- Sort by criticality: **HIGH** before **MEDIUM** before **LOW**.
- For each use case, show the **description** and explain the **reasoning for its criticality level** so the user understands why it matters.
- Call `get_use_case_tables` with `golden_tables_only=true` and mention specific golden-table names as concrete examples. Golden tables are the last layer in the warehouse -- they feed ML models, dashboards, and reports. Explain this when relevant.
- Use `get_asset_lineage` to explain how tables in a use case are connected and why certain tables are important (e.g. a golden table with many upstream dependencies).

### "Create a use case" requests

You **cannot** create use cases -- they are generated automatically by Monte Carlo (along with their criticality), and there is no tool to author one. When the user asks to "create", "set up", or "define" a use case: briefly say so, and do NOT silently substitute monitor deployment. Then offer what you *can* do for the table(s) they named -- look up the existing use case / criticality, recommend field monitors, generate monitor previews, or analyze coverage gaps -- and act on the do-able part without expanding to sibling tables.

### Analyze coverage

1. Call `get_use_case_table_summary` to show how many tables exist at each criticality level (HIGH / MEDIUM / LOW) for the use case.
2. Call `get_use_case_tables` to obtain table MCONs, then call `get_monitors(mcons=[...])` to report how many are already monitored vs. not.
3. **Default to HIGH + MEDIUM criticality scope.** This covers the most important tables without overwhelming the user. Do NOT ask the user which scope to use -- just proceed. If they want LOW-criticality tables included, they'll ask.
4. You may suggest covering **multiple** use cases in one session.
5. **Bias toward action, not questions.** When the scope is clear (HIGH + MEDIUM for the selected use case), proceed directly to generating monitor previews for all recommended monitors. Frame it as opt-out, not opt-in: "I'll generate previews for all N monitors -- tell me if you want to skip any." Do NOT ask "which would you like me to create?" one at a time -- batch them.

### Identify coverage gaps with anomaly data

Use `get_unmonitored_tables_with_anomalies` to discover tables that are **not monitored** but already have muted out-of-the-box anomalies. This reveals real coverage gaps -- places where Monte Carlo detected data issues but no monitor was configured to alert anyone.

- Call it with a recent time window (e.g. last 7-30 days) using ISO 8601 timestamps.
- Results are ranked by **importance score** -- the most critical gaps appear first.
- Each result includes a sample of anomaly events showing what types of issues were detected (freshness, volume, schema changes).
- Use this to **prioritize** which unmonitored tables to cover first -- a table with recent anomalies is a stronger candidate than one with no activity.
- Cross-reference with use-case data: if an unmonitored table with anomalies belongs to a critical use case, escalate its priority.

---

## Importance-based fallback

When no use cases are defined, fall back to importance-based table discovery.

1. **Find unmonitored tables:** Use `search(query="", is_monitored=false)` to find unmonitored tables sorted by importance.
2. **Find tables with anomalies:** Use `get_unmonitored_tables_with_anomalies` with a recent time 

…(the rest of this skill is left out)