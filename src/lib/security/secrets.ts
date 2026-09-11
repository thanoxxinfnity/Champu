/**
 * Secret detection and the secrets vault.
 *
 * Two jobs:
 *   1. Stop a credential from being sent to a model provider by accident — the
 *      chat input is the single most common place a key leaks.
 *   2. Hold deployment environment variables so they reach Vercel's build
 *      without ever entering a prompt, a generated file, or an exported history.
 *
 * Honest about the storage: IndexedDB is not a vault. It is origin-scoped and
 * private to this device, which is the same guarantee a `.env.local` gives, and
 * that is the guarantee the UI claims. Nothing more.
 */

export type SecretKind =
  | 'nvidia'
  | 'openai'
  | 'anthropic'
  | 'github'
  | 'gitlab'
  | 'slack'
  | 'google'
  | 'aws'
  | 'huggingface'
  | 'stripe'
  | 'vercel'
  | 'jwt'
  | 'private-key'
  | 'generic';

export interface SecretMatch {
  kind: SecretKind;
  label: string;
  /** The matched text, verbatim. Never logged or sent anywhere. */
  value: string;
  start: number;
  end: number;
  /** How sure we are. `certain` blocks the send; `likely` warns. */
  confidence: 'certain' | 'likely';
  advice: string;
}

interface Rule {
  kind: SecretKind;
  label: string;
  pattern: RegExp;
  confidence: 'certain' | 'likely';
  advice: string;
  /** Extra gate for rules that would otherwise fire on ordinary prose. */
  verify?: (value: string) => boolean;
}

/**
 * Shannon entropy over the character distribution. Real credentials are close to
 * random; `your_api_key_here` and `AAAAAAAAAAAA` are not. Used to keep the
 * generic rule from flagging placeholders.
 */
export function entropy(value: string): number {
  if (!value) return 0;
  const counts = new Map<string, number>();
  for (const c of value) counts.set(c, (counts.get(c) ?? 0) + 1);

  let bits = 0;
  for (const n of counts.values()) {
    const p = n / value.length;
    bits -= p * Math.log2(p);
  }
  return bits;
}

const PLACEHOLDER = /^(x{4,}|y{4,}|\.{3,}|<.*>|\$\{.*\}|your[_-]?|example|placeholder|redacted|changeme|dummy|test[_-]?key|insert[_-]?)/i;

/**
 * Code that *reads* a credential is not a credential. `process.env.STRIPE_KEY`
 * is the single most common thing a developer pastes into a chat, and flagging
 * it would make the guard something users switch off.
 */
const CODE_REFERENCE = [
  /^(?:process\.env|import\.meta\.env|os\.environ|System\.getenv|Deno\.env|Config|ENV|env)\b/i,
  /^[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)+;?$/,   // dotted identifier chain
  /[()]/,                                           // a call expression
  /^\$\{|^\{\{|^<%/,                               // template interpolation
  /^(?:https?|postgres|postgresql|mysql|mongodb|redis|file):\/\//i,
];

function looksReal(value: string): boolean {
  const body = value.replace(/^[A-Za-z_-]*[-_]/, '');
  if (PLACEHOLDER.test(body)) return false;
  if (/^(.)\1+$/.test(body)) return false;
  if (CODE_REFERENCE.some((re) => re.test(value.trim()))) return false;
  return entropy(body) > 3.0;
}

/**
 * Ordered most-specific first. Prefixed vendor formats are unambiguous, so they
 * are `certain`; shape-only heuristics are `likely` and only warn.
 */
const RULES: Rule[] = [
  {
    kind: 'nvidia',
    label: 'NVIDIA NIM API key',
    pattern: /\bnvapi-[A-Za-z0-9_-]{40,}/g,
    confidence: 'certain',
    advice: 'Chomugiri already stores your NIM key in Settings — it never needs to appear in a prompt.',
  },
  {
    kind: 'anthropic',
    label: 'Anthropic API key',
    pattern: /\bsk-ant-[A-Za-z0-9_-]{20,}/g,
    confidence: 'certain',
    advice: 'Put it in the Secrets vault and reference it by name.',
  },
  {
    kind: 'openai',
    label: 'OpenAI-style API key',
    pattern: /\bsk-(?!ant-)[A-Za-z0-9_-]{20,}/g,
    confidence: 'certain',
    advice: 'Put it in the Secrets vault, or in Settings → Custom Endpoints if it is for an endpoint.',
  },
  {
    kind: 'github',
    label: 'GitHub token',
    pattern: /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{36,}|\bgithub_pat_[A-Za-z0-9_]{60,}/g,
    confidence: 'certain',
    advice: 'Revoke it at github.com/settings/tokens if it has already been shared anywhere.',
  },
  {
    kind: 'gitlab',
    label: 'GitLab token',
    pattern: /\bglpat-[A-Za-z0-9_-]{20,}/g,
    confidence: 'certain',
    advice: 'Store it in the Secrets vault instead.',
  },
  {
    kind: 'slack',
    label: 'Slack token',
    pattern: /\bxox[baprs]-[A-Za-z0-9-]{10,}/g,
    confidence: 'certain',
    advice: 'Rotate it in your Slack app settings.',
  },
  {
    kind: 'google',
    label: 'Google API key',
    pattern: /\bAIza[A-Za-z0-9_-]{35}\b/g,
    confidence: 'certain',
    advice: 'Restrict or rotate it in the Google Cloud console.',
  },
  {
    kind: 'aws',
    label: 'AWS access key id',
    pattern: /\b(?:AKIA|ASIA|ABIA|ACCA)[A-Z0-9]{16}\b/g,
    confidence: 'certain',
    advice: 'Rotate it in IAM. A matching secret access key is usually nearby — check before sending.',
  },
  {
    kind: 'huggingface',
    label: 'Hugging Face token',
    pattern: /\bhf_[A-Za-z0-9]{30,}/g,
    confidence: 'certain',
    advice: 'Store it in the Secrets vault.',
  },
  {
    kind: 'stripe',
    label: 'Stripe secret key',
    pattern: /\b(?:sk|rk)_(?:live|test)_[A-Za-z0-9]{20,}/g,
    confidence: 'certain',
    advice: 'Roll it in the Stripe dashboard immediately if it is a live key.',
  },
  {
    kind: 'private-key',
    label: 'Private key block',
    pattern: /-----BEGIN (?:RSA |EC |DSA |OPENSSH |PGP )?PRIVATE KEY-----/g,
    confidence: 'certain',
    advice: 'Never paste a private key into a chat box. Reference the file path instead.',
  },
  {
    kind: 'jwt',
    label: 'JSON Web Token',
    pattern: /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g,
    confidence: 'certain',
    advice: 'JWTs often carry identity claims. Redact it before sending.',
  },
  {
    kind: 'vercel',
    label: 'Vercel access token',
    // Vercel tokens are bare alphanumerics, so only flag them next to a name
    // that says what they are — matching the shape alone is all false positives.
    pattern: /\bVERCEL_(?:TOKEN|ACCESS_TOKEN)\s*[:=]\s*["']?([A-Za-z0-9]{24,})["']?/g,
    confidence: 'certain',
    advice: 'Add it under Settings → Deployment; it is sent only to Vercel and never enters a prompt.',
  },
  {
    kind: 'generic',
    label: 'Credential-shaped assignment',
    pattern:
      /\b(?:[A-Z0-9_]*(?:API[_-]?KEY|SECRET|TOKEN|PASSWORD|PASSWD|CREDENTIAL|PRIVATE[_-]?KEY|ACCESS[_-]?KEY)[A-Z0-9_]*)\s*[:=]\s*["']?([^\s"',;]{16,})["']?/gi,
    confidence: 'likely',
    advice: 'If this is a real credential, move it to the Secrets vault. If it is a placeholder, you can send anyway.',
    verify: looksReal,
  },
];

export function scanForSecrets(text: string): SecretMatch[] {
  if (!text) return [];

  const matches: SecretMatch[] = [];
  const claimed: Array<[number, number]> = [];

  for (const rule of RULES) {
    const re = new RegExp(rule.pattern.source, rule.pattern.flags);
    let m: RegExpExecArray | null;

    while ((m = re.exec(text)) !== null) {
      // A capture group means the rule matched a wider assignment but only the
      // group is the credential.
      const captured = m[1];
      const value = captured ?? m[0];
      const start = captured ? m.index + m[0].indexOf(captured) : m.index;
      const end = start + value.length;

      // The specific vendor rules run first; do not double-report their hits.
      if (claimed.some(([s, e]) => start < e && end > s)) continue;
      if (rule.verify && !rule.verify(value)) continue;

      claimed.push([start, end]);
      matches.push({
        kind: rule.kind,
        label: rule.label,
        value,
        start,
        end,
        confidence: rule.confidence,
        advice: rule.advice,
      });
    }
  }

  return matches.sort((a, b) => a.start - b.start);
}

/** True when something in the text must not be sent without the user acting. */
export function hasBlockingSecret(matches: SecretMatch[]): boolean {
  return matches.some((m) => m.confidence === 'certain');
}

/** `nvapi-9nbX…aP-n` — enough to recognise, not enough to use. */
export function maskSecret(value: string): string {
  if (value.length <= 12) return '•'.repeat(value.length);
  const prefixMatch = /^([A-Za-z]+[-_])/.exec(value);
  const prefix = prefixMatch ? prefixMatch[1] : value.slice(0, 4);
  return `${prefix}${'•'.repeat(6)}${value.slice(-4)}`;
}

/** Replace every match with a named placeholder, preserving offsets sanely. */
export function redact(text: string, matches: SecretMatch[]): string {
  let out = text;
  for (const m of [...matches].sort((a, b) => b.start - a.start)) {
    out = `${out.slice(0, m.start)}[${m.kind.toUpperCase()}_REDACTED]${out.slice(m.end)}`;
  }
  return out;
}

/** Suggest an env-var name for a detected secret, for one-tap vaulting. */
export function suggestEnvName(match: SecretMatch): string {
  const byKind: Partial<Record<SecretKind, string>> = {
    nvidia: 'NVIDIA_NIM_API_KEY',
    openai: 'OPENAI_API_KEY',
    anthropic: 'ANTHROPIC_API_KEY',
    github: 'GITHUB_TOKEN',
    gitlab: 'GITLAB_TOKEN',
    slack: 'SLACK_BOT_TOKEN',
    google: 'GOOGLE_API_KEY',
    aws: 'AWS_ACCESS_KEY_ID',
    huggingface: 'HUGGINGFACE_TOKEN',
    stripe: 'STRIPE_SECRET_KEY',
    vercel: 'VERCEL_TOKEN',
    jwt: 'AUTH_TOKEN',
    'private-key': 'PRIVATE_KEY',
  };
  return byKind[match.kind] ?? 'API_KEY';
}

// ── Vault ───────────────────────────────────────────────────────────────────

export interface SecretRecord {
  id: string;
  /** Environment variable name, e.g. `STRIPE_SECRET_KEY`. */
  name: string;
  value: string;
  /** Where this variable is injected. */
  scope: 'build' | 'runtime' | 'both';
  /** Targets it applies to on Vercel. */
  targets: Array<'production' | 'preview' | 'development'>;
  note?: string;
  createdAt: number;
  updatedAt: number;
  lastUsedAt?: number;
}

const NAME_RE = /^[A-Z_][A-Z0-9_]*$/;

export function validateSecretName(name: string): string | null {
  if (!name.trim()) return 'A name is required.';
  if (!NAME_RE.test(name)) {
    return 'Use SCREAMING_SNAKE_CASE — letters, digits and underscores, not starting with a digit.';
  }
  if (name.length > 128) return 'Name is too long.';
  // Vercel refuses these outright; catching it here beats a failed deploy.
  if (/^(VERCEL_|NOW_)/.test(name)) return 'Vercel reserves the VERCEL_ and NOW_ prefixes.';
  return null;
}

/**
 * Client-exposed variables are a deliberate, visible decision — `NEXT_PUBLIC_`
 * and `VITE_` are inlined into the bundle, so a secret placed there ships to
 * every visitor.
 */
export function isClientExposed(name: string): boolean {
  return /^(NEXT_PUBLIC_|VITE_|REACT_APP_|PUBLIC_|EXPO_PUBLIC_|GATSBY_)/.test(name);
}

export function secretsToEnvObject(secrets: SecretRecord[], scope: 'build' | 'runtime'): Record<string, string> {
  return Object.fromEntries(
    secrets
      .filter((s) => s.scope === scope || s.scope === 'both')
      .map((s) => [s.name, s.value]),
  );
}

/** `.env` text for the user to copy into a local file. Values included. */
export function toEnvFile(secrets: SecretRecord[]): string {
  const lines = ['# Generated by Chomugiri. Keep this file out of version control.', ''];
  for (const s of secrets) {
    if (s.note) lines.push(`# ${s.note}`);
    const needsQuotes = /[\s#'"]/.test(s.value);
    lines.push(`${s.name}=${needsQuotes ? JSON.stringify(s.value) : s.value}`);
  }
  return lines.join('\n') + '\n';
}

/** `.env.example` — names only, so it is safe to commit. */
export function toEnvExample(secrets: SecretRecord[]): string {
  const lines = ['# Copy to .env.local and fill in the values.', ''];
  for (const s of secrets) {
    if (s.note) lines.push(`# ${s.note}`);
    lines.push(`${s.name}=`);
  }
  return lines.join('\n') + '\n';
}
