/**
 * Chomugiri — provider contracts.
 *
 * Every model source (NVIDIA NIM, Pollinations, a user's own OpenAI-compatible
 * endpoint) is normalised onto the same request/response shape so the agent core
 * never has to branch on vendor.
 */

export type ProviderId = 'nim' | 'pollinations' | 'custom';

export type ModelCapability =
  | 'chat'
  | 'reasoning'
  | 'vision'
  | 'tools'
  | 'embedding'
  | 'rerank'
  | 'image'
  | 'video'
  | 'audio'
  | 'model3d'
  | 'search';

export interface ModelDescriptor {
  /** Provider-native id, e.g. `deepseek-ai/deepseek-r1`. */
  id: string;
  provider: ProviderId;
  /** Human label for the switcher. */
  label: string;
  vendor: string;
  capabilities: ModelCapability[];
  contextWindow?: number;
  /** Emits `reasoning_content` deltas that feed the reasoning drawer. */
  emitsReasoning?: boolean;
  /**
   * `catalogue`    — present in the live provider catalogue at boot.
   * `static`       — from the bundled registry, not confirmed against the live API.
   * `alias`        — a friendly name that resolves to `resolvesTo`.
   * `partner-only` — real, but not served by the configured base URL. Selectable
   *                  only once the user adds the partner endpoint themselves.
   */
  origin: 'catalogue' | 'static' | 'alias' | 'partner-only';
  resolvesTo?: string;
  /** For a custom-endpoint model: which configured endpoint serves it. */
  endpointId?: string;
  note?: string;
}

export interface ChatMessagePart {
  type: 'text' | 'image_url';
  text?: string;
  image_url?: { url: string };
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | ChatMessagePart[];
  name?: string;
  tool_call_id?: string;
}

export interface CustomEndpointConfig {
  baseUrl: string;
  apiKey?: string;
  /** Extra headers merged verbatim onto every upstream request. */
  headers?: Record<string, string>;
  /** Path appended to baseUrl; defaults to `/chat/completions`. */
  chatPath?: string;
}

export interface ChatRequest {
  provider: ProviderId;
  model: string;
  messages: ChatMessage[];
  temperature?: number;
  topP?: number;
  maxTokens?: number;
  stop?: string[];
  stream?: boolean;
  /** Force JSON-object responses where the upstream supports it. */
  json?: boolean;
  custom?: CustomEndpointConfig;
  /** Opaque id echoed back on every stream frame; used for cancellation. */
  runId?: string;
}

/** Normalised stream frames emitted by `/api/chat` regardless of upstream. */
export type StreamFrame =
  | { type: 'meta'; provider: ProviderId; model: string; runId?: string }
  | { type: 'reasoning'; delta: string }
  | { type: 'delta'; delta: string }
  | { type: 'usage'; promptTokens?: number; completionTokens?: number; totalTokens?: number }
  | { type: 'done'; finishReason?: string }
  | { type: 'error'; message: string; code?: string; retryable?: boolean };

export class ProviderError extends Error {
  readonly status: number;
  readonly code: string;
  readonly retryable: boolean;
  readonly detail?: unknown;

  constructor(
    message: string,
    opts: { status?: number; code?: string; retryable?: boolean; detail?: unknown } = {},
  ) {
    super(message);
    this.name = 'ProviderError';
    this.status = opts.status ?? 502;
    this.code = opts.code ?? 'provider_error';
    this.retryable = opts.retryable ?? false;
    this.detail = opts.detail;
  }
}
