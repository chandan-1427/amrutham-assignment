import { createMiddleware } from 'hono/factory';
import { verifyAccessToken } from '../lib/tokens.js';
import { AppError } from '../lib/errors.js';

type AuthUser = { id: string; role: 'patient' | 'doctor' | 'admin' };

declare module 'hono' {
  interface ContextVariableMap {
    user: AuthUser;
  }
}

export const requireAuth = createMiddleware(async (c, next) => {
  const header = c.req.header('Authorization');
  if (!header?.startsWith('Bearer ')) {
    throw new AppError(401, 'Missing or invalid Authorization header');
  }

  const token = header.slice('Bearer '.length);

  try {
    const payload = await verifyAccessToken(token);
    c.set('user', { id: payload.sub, role: payload.role });
  } catch {
    throw new AppError(401, 'Invalid or expired token');
  }

  await next();
});