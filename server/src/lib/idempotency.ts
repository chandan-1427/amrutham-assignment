import type { Context } from 'hono';
import { AppError } from './errors.js';

export function requireIdempotencyKey(c: Context): string {
  const key = c.req.header('Idempotency-Key');
  if (!key) throw new AppError(400, 'Idempotency-Key header is required');
  return key;
}