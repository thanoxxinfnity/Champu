/**
 * Model Context Protocol server scaffolder.
 *
 * Emits servers that satisfy the MCP specification's wire contract: JSON-RPC 2.0
 * over stdio, an `initialize` handshake declaring capabilities, and the
 * `tools/list`, `tools/call`, `resources/list`, `resources/read`,
 * `prompts/list`, `prompts/get` methods.
 *
 * Tool input schemas are JSON Schema draft-07 objects — that is what MCP clients
 * validate against, and an invalid schema makes a tool silently unavailable in
 * Claude Code / Cursor rather than raising a visible error.
 */

export type McpLanguage = 'typescript' | 'python';
export type McpTransport = 'stdio' | 'http';

export type JsonSchemaType = 'string' | 'number' | 'integer' | 'boolean' | 'array' | 'object';

export interface McpParameter {
  name: string;
  type: JsonSchemaType;
  description: string;
  required: boolean;
  enum?: string[];
  default?: unknown;
  /** For `array`. */
  itemType?: JsonSchemaType;
}

export interface McpTool {
  name: string;
  description: string;
  parameters: McpParameter[];
  /** Body of the handler. Left as a TODO stub when absent. */
  implementation?: string;
  /** Advertises that the tool only reads — clients can auto-approve these. */
  readOnly?: boolean;
}

export interface McpResource {
  uri: string;
  name: string;
  description: string;
  mimeType: string;
  /** Contains `{placeholder}` segments → registered as a resource template. */
  isTemplate?: boolean;
  implementation?: string;
}

export interface McpPrompt {
  name: string;
  description: string;
  arguments: Array<{ name: string; description: string; required: boolean }>;
  template: string;
}

export interface McpServerSpec {
  name: string;
  version: string;
  description: string;
  language: McpLanguage;
  transport: McpTransport;
  tools: McpTool[];
  resources: McpResource[];
  prompts: McpPrompt[];
  /** Env vars the server reads, surfaced in the generated README and configs. */
  env?: Array<{ name: string; description: string; required: boolean }>;
}

export interface ScaffoldFile {
  path: string;
  content: string;
}

// ── Validation ──────────────────────────────────────────────────────────────

export interface McpIssue {
  severity: 'error' | 'warning';
  path: string;
  message: string;
}

const TOOL_NAME_RE = /^[a-zA-Z0-9_-]{1,64}$/;

/**
 * Validate against the constraints MCP clients actually enforce.
 * Most of these fail *silently* at runtime — a malformed tool name simply never
 * appears in the client's tool list — so catching them here is the difference
 * between a working server and an hour of confusion.
 */
export function validateSpec(spec: McpServerSpec): McpIssue[] {
  const issues: McpIssue[] = [];

  if (!spec.name?.trim()) issues.push({ severity: 'error', path: 'name', message: 'Server name is required.' });
  if (!/^\d+\.\d+\.\d+/.test(spec.version)) {
    issues.push({ severity: 'warning', path: 'version', message: `"${spec.version}" is not semver. Clients display this verbatim.` });
  }
  if (!spec.tools.length && !spec.resources.length && !spec.prompts.length) {
    issues.push({ severity: 'error', path: 'spec', message: 'A server exposing no tools, resources or prompts does nothing.' });
  }

  const toolNames = new Set<string>();
  for (const tool of spec.tools) {
    const at = `tools.${tool.name}`;
    if (!TOOL_NAME_RE.test(tool.name)) {
      issues.push({ severity: 'error', path: at, message: `Tool name "${tool.name}" must match [a-zA-Z0-9_-]{1,64}. Clients drop tools with invalid names without reporting it.` });
    }
    if (toolNames.has(tool.name)) {
      issues.push({ severity: 'error', path: at, message: `Duplicate tool name "${tool.name}".` });
    }
    toolNames.add(tool.name);

    if (!tool.description?.trim()) {
      issues.push({ severity: 'error', path: at, message: 'Tool description is required — it is the only thing the model uses to decide when to call it.' });
    } else if (tool.description.length < 15) {
      issues.push({ severity: 'warning', path: at, message: 'Description is too terse for reliable tool selection. State when to use it and what it returns.' });
    }

    const paramNames = new Set<string>();
    for (const p of tool.parameters) {
      if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(p.name)) {
        issues.push({ severity: 'error', path: `${at}.${p.name}`, message: 'Parameter names must be valid identifiers.' });
      }
      if (paramNames.has(p.name)) {
        issues.push({ severity: 'error', path: `${at}.${p.name}`, message: 'Duplicate parameter name.' });
      }
      paramNames.add(p.name);
      if (!p.description?.trim()) {
        issues.push({ severity: 'warning', path: `${at}.${p.name}`, message: 'Parameter has no description; the model will guess at its meaning.' });
      }
      if (p.type === 'array' && !p.itemType) {
        issues.push({ severity: 'warning', path: `${at}.${p.name}`, message: 'Array parameter has no item type — schema will default to `string` items.' });
      }
      if (p.enum?.length && p.type !== 'string') {
        issues.push({ severity: 'warning', path: `${at}.${p.name}`, message: 'Enum constraints on non-string parameters are inconsistently supported.' });
      }
    }
  }

  for (const resource of spec.resources) {
    if (!/^[a-z][a-z0-9+.-]*:\/\//.test(resource.uri)) {
      issues.push({ severity: 'error', path: `resources.${resource.name}`, message: `Resource URI "${resource.uri}" must be a full URI with a scheme, e.g. file:// or myapp://.` });
    }
    const hasPlaceholder = /\{[^}]+\}/.test(resource.uri);
    if (hasPlaceholder && !resource.isTemplate) {
      issues.push({ severity: 'warning', path: `resources.${resource.name}`, message: 'URI contains a {placeholder} but is not marked as a template; it will be registered as a static resource and never match.' });
    }
  }

  for (const prompt of spec.prompts) {
    for (const arg of prompt.arguments) {
      if (!prompt.template.includes(`{{${arg.name}}}`)) {
        issues.push({ severity: 'warning', path: `prompts.${prompt.name}.${arg.name}`, message: `Argument is declared but never used in the template ({{${arg.name}}}).` });
      }
    }
  }

  return issues;
}

// ── JSON Schema ─────────────────────────────────────────────────────────────

export function inputSchema(tool: McpTool): Record<string, unknown> {
  const properties: Record<string, unknown> = {};
  const required: string[] = [];

  for (const p of tool.parameters) {
    const prop: Record<string, unknown> = { type: p.type, description: p.description };
    if (p.enum?.length) prop.enum = p.enum;
    if (p.default !== undefined) prop.default = p.default;
    if (p.type === 'array') prop.items = { type: p.itemType ?? 'string' };
    properties[p.name] = prop;
    if (p.required) required.push(p.name);
  }

  return {
    type: 'object',
    properties,
    ...(required.length ? { required } : {}),
    additionalProperties: false,
  };
}

// ── Generators ──────────────────────────────────────────────────────────────

const identifier = (name: string) => name.replace(/[^a-zA-Z0-9_]/g, '_').replace(/^(\d)/, '_$1');
const pkgName = (name: string) => name.toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/-{2,}/g, '-').replace(/^-|-$/g, '');

function tsToolHandler(tool: McpTool): string {
  const args = tool.parameters.map((p) => `${p.name}`).join(', ');
  const destructure = tool.parameters.length ? `  const { ${args} } = args as ${identifier(tool.name)}Args;\n` : '';

  return `server.registerTool(
  ${JSON.stringify(tool.name)},
  {
    description: ${JSON.stringify(tool.description)},
    inputSchema: ${JSON.stringify(inputSchema(tool), null, 4).replace(/\n/g, '\n    ')},${tool.readOnly ? '\n    annotations: { readOnlyHint: true },' : ''}
  },
  async (args) => {
${destructure}${tool.implementation
      ? tool.implementation.split('\n').map((l) => `    ${l}`).join('\n')
      : `    // TODO: implement ${tool.name}
    throw new Error(${JSON.stringify(`${tool.name} is not implemented yet.`)});`}
  },
);`;
}

function tsArgTypes(spec: McpServerSpec): string {
  return spec.tools
    .filter((t) => t.parameters.length)
    .map((tool) => {
      const fields = tool.parameters
        .map((p) => {
          const type =
            p.type === 'array'
              ? `${p.itemType ?? 'string'}[]`
              : p.type === 'integer'
                ? 'number'
                : p.enum?.length
                  ? p.enum.map((e) => JSON.stringify(e)).join(' | ')
                  : p.type;
          return `  /** ${p.description} */\n  ${p.name}${p.required ? '' : '?'}: ${type};`;
        })
        .join('\n');
      return `interface ${identifier(tool.name)}Args {\n${fields}\n}`;
    })
    .join('\n\n');
}

function generateTypeScript(spec: McpServerSpec): ScaffoldFile[] {
  const files: ScaffoldFile[] = [];
  const name = pkgName(spec.name);

  files.push({
    path: 'package.json',
    content: JSON.stringify(
      {
        name,
        version: spec.version,
        description: spec.description,
        type: 'module',
        bin: { [name]: './build/index.js' },
        files: ['build'],
        scripts: {
          build: 'tsc && chmod +x build/index.js',
          dev: 'tsc --watch',
          start: 'node build/index.js',
          inspect: `npx @modelcontextprotocol/inspector node build/index.js`,
        },
        dependencies: {
          '@modelcontextprotocol/sdk': '^1.12.0',
          zod: '^3.24.1',
        },
        devDependencies: {
          '@types/node': '^22.10.0',
          typescript: '^5.7.2',
        },
        engines: { node: '>=18' },
      },
      null,
      2,
    ) + '\n',
  });

  files.push({
    path: 'tsconfig.json',
    content: JSON.stringify(
      {
        compilerOptions: {
          target: 'ES2022',
          module: 'Node16',
          moduleResolution: 'Node16',
          outDir: './build',
          rootDir: './src',
          strict: true,
          esModuleInterop: true,
          skipLibCheck: true,
          forceConsistentCasingInFileNames: true,
          declaration: true,
        },
        include: ['src/**/*'],
        exclude: ['node_modules', 'build'],
      },
      null,
      2,
    ) + '\n',
  });

  const resourceRegistrations = spec.resources
    .map((r) => {
      if (r.isTemplate) {
        return `server.registerResource(
  ${JSON.stringify(r.name)},
  new ResourceTemplate(${JSON.stringify(r.uri)}, { list: undefined }),
  { description: ${JSON.stringify(r.description)}, mimeType: ${JSON.stringify(r.mimeType)} },
  async (uri, params) => ({
    contents: [
      {
        uri: uri.href,
        mimeType: ${JSON.stringify(r.mimeType)},
${r.implementation ? r.implementation.split('\n').map((l) => `        ${l}`).join('\n') : `        text: \`TODO: resolve ${r.name} for \${JSON.stringify(params)}\`,`}
      },
    ],
  }),
);`;
      }
      return `server.registerResource(
  ${JSON.stringify(r.name)},
  ${JSON.stringify(r.uri)},
  { description: ${JSON.stringify(r.description)}, mimeType: ${JSON.stringify(r.mimeType)} },
  async (uri) => ({
    contents: [
      {
        uri: uri.href,
        mimeType: ${JSON.stringify(r.mimeType)},
${r.implementation ? r.implementation.split('\n').map((l) => `        ${l}`).join('\n') : `        text: 'TODO: resolve ${r.name}',`}
      },
    ],
  }),
);`;
    })
    .join('\n\n');

  const promptRegistrations = spec.prompts
    .map(
      (p) => `server.registerPrompt(
  ${JSON.stringify(p.name)},
  {
    description: ${JSON.stringify(p.description)},
    argsSchema: {
${p.arguments.map((a) => `      ${a.name}: z.string()${a.required ? '' : '.optional()'}.describe(${JSON.stringify(a.description)}),`).join('\n')}
    },
  },
  (args) => ({
    messages: [
      {
        role: 'user',
        content: {
          type: 'text',
          text: ${JSON.stringify(p.template)}
${p.arguments.map((a) => `            .replace(/\\{\\{${a.name}\\}\\}/g, String(args.${a.name} ?? ''))`).join('\n')},
        },
      },
    ],
  }),
);`,
    )
    .join('\n\n');

  const imports = [
    `import { McpServer${spec.resources.some((r) => r.isTemplate) ? ', ResourceTemplate' : ''} } from '@modelcontextprotocol/sdk/server/mcp.js';`,
    spec.transport === 'stdio'
      ? `import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';`
      : `import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';\nimport { createServer } from 'node:http';`,
    spec.prompts.length ? `import { z } from 'zod';` : '',
  ]
    .filter(Boolean)
    .join('\n');

  const bootstrap =
    spec.transport === 'stdio'
      ? `async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  // stdout is the JSON-RPC channel. Anything written there corrupts the protocol,
  // so every diagnostic must go to stderr.
  console.error(${JSON.stringify(`${spec.name} MCP server running on stdio`)});
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});`
      : `const PORT = Number(process.env.PORT ?? 3000);

async function main() {
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  await server.connect(transport);

  createServer(async (req, res) => {
    if (req.url !== '/mcp') {
      res.writeHead(404).end('Not found');
      return;
    }
    await transport.handleRequest(req, res);
  }).listen(PORT, () => {
    console.error(\`${spec.name} MCP server listening on http://localhost:\${PORT}/mcp\`);
  });
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});`;

  files.push({
    path: 'src/index.ts',
    content: `#!/usr/bin/env node
/**
 * ${spec.name} — ${spec.description}
 *
 * Generated by Chomugiri MCP Builder.
 * Transport: ${spec.transport}
 */

${imports}

${tsArgTypes(spec)}

const server = new McpServer({
  name: ${JSON.stringify(spec.name)},
  version: ${JSON.stringify(spec.version)},
});

${spec.env?.length
        ? `// Required configuration — fail fast rather than at first tool call.
${spec.env
            .filter((e) => e.required)
            .map(
              (e) => `if (!process.env.${e.name}) {
  console.error('Missing required environment variable ${e.name} — ${e.description}');
  process.exit(1);
}`,
            )
            .join('\n')}\n`
        : ''}
// ── Tools ───────────────────────────────────────────────────────────────────

${spec.tools.map(tsToolHandler).join('\n\n')}

${spec.resources.length ? `// ── Resources ───────────────────────────────────────────────────────────────\n\n${resourceRegistrations}\n` : ''}
${spec.prompts.length ? `// ── Prompts ─────────────────────────────────────────────────────────────────\n\n${promptRegistrations}\n` : ''}
// ── Bootstrap ───────────────────────────────────────────────────────────────

${bootstrap}
`,
  });

  return files;
}

function pySchemaHint(p: McpParameter): string {
  const base =
    p.type === 'string' ? 'str'
      : p.type === 'integer' ? 'int'
        : p.type === 'number' ? 'float'
          : p.type === 'boolean' ? 'bool'
            : p.type === 'array' ? `list[${p.itemType === 'integer' ? 'int' : p.itemType === 'number' ? 'float' : p.itemType === 'boolean' ? 'bool' : 'str'}]`
              : 'dict';
  return p.required ? base : `${base} | None`;
}

function generatePython(spec: McpServerSpec): ScaffoldFile[] {
  const files: ScaffoldFile[] = [];
  const module = identifier(pkgName(spec.name).replace(/-/g, '_'));

  files.push({
    path: 'pyproject.toml',
    content: `[project]
name = "${pkgName(spec.name)}"
version = "${spec.version}"
description = "${spec.description.replace(/"/g, "'")}"
requires-python = ">=3.10"
dependencies = [
    "mcp[cli]>=1.9.0",
]

[project.scripts]
${pkgName(spec.name)} = "${module}.server:main"

[build-system]
requires = ["hatchling"]
build-backend = "hatchling.build"

[tool.hatch.build.targets.wheel]
packages = ["src/${module}"]
`,
  });

  const toolFns = spec.tools
    .map((tool) => {
      const params = tool.parameters
        .map((p) => `${p.name}: ${pySchemaHint(p)}${p.required ? '' : ' = None'}`)
        .join(', ');
      const docParams = tool.parameters.map((p) => `        ${p.name}: ${p.description}`).join('\n');

      return `@mcp.tool()
async def ${identifier(tool.name)}(${params}) -> str:
    """${tool.description}
${tool.parameters.length ? `\n    Args:\n${docParams}\n` : ''}    """
${tool.implementation
        ? tool.implementation.split('\n').map((l) => `    ${l}`).join('\n')
        : `    raise NotImplementedError("${tool.name} is not implemented yet.")`}`;
    })
    .join('\n\n\n');

  const resourceFns = spec.resources
    .map((r) => {
      const placeholders = [...r.uri.matchAll(/\{([^}]+)\}/g)].map((m) => m[1]);
      const args = placeholders.map((p) => `${p}: str`).join(', ');
      return `@mcp.resource("${r.uri}", mime_type="${r.mimeType}")
async def ${identifier(r.name)}(${args}) -> str:
    """${r.description}"""
${r.implementation ? r.implementation.split('\n').map((l) => `    ${l}`).join('\n') : `    return "TODO: resolve ${r.name}"`}`;
    })
    .join('\n\n\n');

  const promptFns = spec.prompts
    .map((p) => {
      const args = p.arguments.map((a) => `${a.name}: str${a.required ? '' : ' = ""'}`).join(', ');
      const replacements = p.arguments.map((a) => `.replace("{{${a.name}}}", ${a.name})`).join('');
      return `@mcp.prompt()
def ${identifier(p.name)}(${args}) -> str:
    """${p.description}"""
    return ${JSON.stringify(p.template)}${replacements}`;
    })
    .join('\n\n\n');

  files.push({
    path: `src/${module}/__init__.py`,
    content: `"""${spec.name} — ${spec.description}"""\n\n__version__ = "${spec.version}"\n`,
  });

  files.push({
    path: `src/${module}/server.py`,
    content: `"""${spec.name} — ${spec.description}

Generated by Chomugiri MCP Builder.
Transport: ${spec.transport}
"""

from __future__ import annotations

import os
import sys

from mcp.server.fastmcp import FastMCP

mcp = FastMCP("${spec.name}")

${spec.env?.filter((e) => e.required).length
        ? `# Required configuration — fail fast rather than at first tool call.
${spec.env
            .filter((e) => e.required)
            .map(
              (e) => `if not os.environ.get("${e.name}"):
    print("Missing required environment variable ${e.name} — ${e.description}", file=sys.stderr)
    sys.exit(1)`,
            )
            .join('\n')}\n`
        : ''}

# ── Tools ────────────────────────────────────────────────────────────────────

${toolFns || '# No tools defined.'}

${spec.resources.length ? `\n# ── Resources ────────────────────────────────────────────────────────────────\n\n${resourceFns}\n` : ''}
${spec.prompts.length ? `\n# ── Prompts ──────────────────────────────────────────────────────────────────\n\n${promptFns}\n` : ''}

def main() -> None:
    mcp.run(transport="${spec.transport === 'http' ? 'streamable-http' : 'stdio'}")


if __name__ == "__main__":
    main()
`,
  });

  return files;
}

// ── Client configuration snippets ───────────────────────────────────────────

export function clientConfigs(spec: McpServerSpec): Record<string, string> {
  const name = pkgName(spec.name);
  const env = Object.fromEntries((spec.env ?? []).map((e) => [e.name, `<${e.name.toLowerCase()}>`]));
  const hasEnv = Object.keys(env).length > 0;

  const stdioEntry =
    spec.language === 'typescript'
      ? { command: 'node', args: [`/absolute/path/to/${name}/build/index.js`], ...(hasEnv ? { env } : {}) }
      : { command: 'uv', args: ['--directory', `/absolute/path/to/${name}`, 'run', name], ...(hasEnv ? { env } : {}) };

  const httpEntry = { type: 'http', url: 'http://localhost:3000/mcp' };
  const entry = spec.transport === 'http' ? httpEntry : stdioEntry;

  return {
    'claude_desktop_config.json': JSON.stringify({ mcpServers: { [name]: entry } }, null, 2),
    '.mcp.json (Claude Code, project scope)': JSON.stringify({ mcpServers: { [name]: entry } }, null, 2),
    'Claude Code CLI': spec.transport === 'http'
      ? `claude mcp add --transport http ${name} http://localhost:3000/mcp`
      : spec.language === 'typescript'
        ? `claude mcp add ${name} -- node /absolute/path/to/${name}/build/index.js`
        : `claude mcp add ${name} -- uv --directory /absolute/path/to/${name} run ${name}`,
    'Cursor (~/.cursor/mcp.json)': JSON.stringify({ mcpServers: { [name]: entry } }, null, 2),
    'VS Code (.vscode/mcp.json)': JSON.stringify({ servers: { [name]: entry } }, null, 2),
    'Gemini CLI (~/.gemini/settings.json)': JSON.stringify({ mcpServers: { [name]: entry } }, null, 2),
  };
}

// ── Assembly ────────────────────────────────────────────────────────────────

export function scaffoldServer(spec: McpServerSpec): { files: ScaffoldFile[]; issues: McpIssue[] } {
  const issues = validateSpec(spec);
  const files = spec.language === 'typescript' ? generateTypeScript(spec) : generatePython(spec);
  const configs = clientConfigs(spec);
  const name = pkgName(spec.name);

  files.push({
    path: 'README.md',
    content: `# ${spec.name}

${spec.description}

Generated by Chomugiri MCP Builder · MCP ${spec.transport} server · ${spec.language}

## Install

\`\`\`bash
${spec.language === 'typescript' ? `npm install\nnpm run build` : `uv sync`}
\`\`\`

## Verify

\`\`\`bash
${spec.language === 'typescript' ? `npx @modelcontextprotocol/inspector node build/index.js` : `npx @modelcontextprotocol/inspector uv --directory . run ${name}`}
\`\`\`

The Inspector is the fastest way to confirm the handshake works before wiring a
client — it shows the exact \`initialize\` response and every tool schema.

## Tools

${spec.tools.length
        ? spec.tools
            .map(
              (t) => `### \`${t.name}\`${t.readOnly ? ' _(read-only)_' : ''}

${t.description}

${t.parameters.length
                  ? `| Parameter | Type | Required | Description |\n|---|---|---|---|\n${t.parameters
                      .map((p) => `| \`${p.name}\` | \`${p.type}${p.type === 'array' ? `<${p.itemType ?? 'string'}>` : ''}\` | ${p.required ? 'yes' : 'no'} | ${p.description} |`)
                      .join('\n')}`
                  : '_No parameters._'}`,
            )
            .join('\n\n')
        : '_None._'}

## Resources

${spec.resources.length ? spec.resources.map((r) => `- \`${r.uri}\`${r.isTemplate ? ' _(template)_' : ''} — ${r.description} (\`${r.mimeType}\`)`).join('\n') : '_None._'}

## Prompts

${spec.prompts.length ? spec.prompts.map((p) => `- \`${p.name}\` — ${p.description}`).join('\n') : '_None._'}

${spec.env?.length
        ? `## Environment

${spec.env.map((e) => `- \`${e.name}\`${e.required ? ' **(required)**' : ''} — ${e.description}`).join('\n')}
`
        : ''}
## Client configuration

${Object.entries(configs)
        .map(([label, snippet]) => `### ${label}\n\n\`\`\`${label.endsWith('.json') || label.includes('.json') ? 'json' : 'bash'}\n${snippet}\n\`\`\``)
        .join('\n\n')}

${issues.length
        ? `## Validation\n\n${issues.map((i) => `- ${i.severity === 'error' ? '🔴' : '🟡'} \`${i.path}\` — ${i.message}`).join('\n')}`
        : ''}
`,
  });

  files.push({
    path: '.gitignore',
    content: spec.language === 'typescript'
      ? 'node_modules/\nbuild/\n*.tsbuildinfo\n.env\n'
      : '__pycache__/\n*.py[cod]\n.venv/\ndist/\n.env\n',
  });

  return { files, issues };
}

/** A working starter spec so the builder opens with something real, not blanks. */
export function starterSpec(): McpServerSpec {
  return {
    name: 'my-mcp-server',
    version: '0.1.0',
    description: 'An MCP server scaffolded by Chomugiri.',
    language: 'typescript',
    transport: 'stdio',
    tools: [
      {
        name: 'search_docs',
        description: 'Search the indexed documentation and return the most relevant passages. Use this before answering any question about the project.',
        readOnly: true,
        parameters: [
          { name: 'query', type: 'string', description: 'Natural-language search query.', required: true },
          { name: 'limit', type: 'integer', description: 'Maximum passages to return.', required: false, default: 5 },
        ],
        implementation: `const results = await searchIndex(query, limit ?? 5);
return {
  content: [{ type: 'text', text: results.map((r) => \`## \${r.title}\\n\${r.body}\`).join('\\n\\n') }],
};`,
      },
    ],
    resources: [
      {
        uri: 'docs://index',
        name: 'documentation-index',
        description: 'The full list of indexed documents.',
        mimeType: 'application/json',
      },
    ],
    prompts: [
      {
        name: 'explain-module',
        description: 'Produce a technical explanation of a module.',
        arguments: [{ name: 'module', description: 'Module path or name.', required: true }],
        template: 'Explain the design and responsibilities of {{module}}. Be specific about its inputs, outputs and failure modes.',
      },
    ],
    env: [],
  };
}
