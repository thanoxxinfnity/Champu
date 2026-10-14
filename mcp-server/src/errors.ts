/**
 * Structured error codes. The JSON-RPC 2.0 range -32768..-32000 is reserved; the spec leaves
 * -32000..-32099 for "implementation-defined server errors", which is where these live.
 */
export const RpcErrorCode = {
  ParseError: -32700,
  InvalidRequest: -32600,
  MethodNotFound: -32601,
  InvalidParams: -32602,
  InternalError: -32603,
  Unauthorized: -32001,
  Forbidden: -32002,
  RateLimited: -32003,
  UnknownTenant: -32004,
  UpstreamProviderError: -32005,
} as const;

export class McpHttpError extends Error {
  readonly httpStatus: number;
  readonly rpcCode: number;
  readonly extra?: Record<string, unknown>;

  constructor(httpStatus: number, rpcCode: number, message: string, extra?: Record<string, unknown>) {
    super(message);
    this.name = 'McpHttpError';
    this.httpStatus = httpStatus;
    this.rpcCode = rpcCode;
    this.extra = extra;
  }

  /** A JSON-RPC 2.0 error envelope, safe to send to the client as-is. */
  toRpcEnvelope(id: string | number | null = null) {
    return {
      jsonrpc: '2.0' as const,
      id,
      error: { code: this.rpcCode, message: this.message, data: this.extra },
    };
  }
}

export const unauthorized = (message = 'A valid bearer token is required.') =>
  new McpHttpError(401, RpcErrorCode.Unauthorized, message);

export const forbidden = (message: string, extra?: Record<string, unknown>) =>
  new McpHttpError(403, RpcErrorCode.Forbidden, message, extra);

export const rateLimited = (retryAfterSeconds: number) =>
  new McpHttpError(429, RpcErrorCode.RateLimited, 'Rate limit exceeded for this tenant.', { retryAfterSeconds });

export const unknownTenant = () => new McpHttpError(401, RpcErrorCode.UnknownTenant, 'This token does not map to a known, enabled tenant.');
