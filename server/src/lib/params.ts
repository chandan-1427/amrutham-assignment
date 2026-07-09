// src/lib/params.ts
import type { Context } from 'hono';
import { AppError } from './errors.js';

const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function requireUuidParam(c: Context, name: string): string {
  const value = c.req.param(name);
  if (!value || !uuidRegex.test(value)) throw new AppError(400, `Invalid ${name}`);
  return value;
}