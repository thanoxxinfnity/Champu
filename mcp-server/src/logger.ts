import pino from 'pino';
import { env } from './env.ts';

export const logger = pino({
  level: env.LOG_LEVEL,
  // Bearer tokens and API keys must never land in logs — redact by path rather than trusting
  // every call site to remember to omit them.
  redact: { paths: ['req.headers.authorization', 'authorization', 'apiKey', '*.apiKey'], remove: true },
});
