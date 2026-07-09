import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { eq, and, isNull, gt } from 'drizzle-orm';
import { db } from '../../db/client.js';
import { users, profiles, refreshTokens } from '../../db/schema.js';
import { hashPassword, verifyPassword } from '../../lib/password.js';
import {
  signAccessToken,
  signMfaChallengeToken,
  verifyMfaChallengeToken,
  generateRefreshToken,
  hashRefreshToken,
} from '../../lib/tokens.js';
import { verifyTotpCode } from '../../lib/mfa.js';
import { AppError } from '../../lib/errors.js';
import { registerSchema, loginSchema, mfaVerifySchema, refreshSchema } from './schema.js';

const auth = new Hono();
const REFRESH_TOKEN_TTL_DAYS = 30;

auth.post('/register', zValidator('json', registerSchema), async (c) => {
  const { email, password, fullName, phone } = c.req.valid('json');
  const normalizedEmail = email.toLowerCase();

  const existing = await db.query.users.findFirst({
    where: eq(users.email, normalizedEmail),
  });
  if (existing) throw new AppError(409, 'Email already registered');

  const passwordHash = await hashPassword(password);

  const [user] = await db
    .insert(users)
    .values({ email: normalizedEmail, passwordHash, phone })
    .returning({ id: users.id, role: users.role });

  await db.insert(profiles).values({ userId: user.id, fullName });

  return c.json({ id: user.id, email: normalizedEmail }, 201);
});

auth.post('/login', zValidator('json', loginSchema), async (c) => {
  const { email, password } = c.req.valid('json');
  const normalizedEmail = email.toLowerCase();

  const user = await db.query.users.findFirst({
    where: eq(users.email, normalizedEmail),
  });
  if (!user || user.status !== 'active') throw new AppError(401, 'Invalid credentials');

  const validPassword = await verifyPassword(user.passwordHash, password);
  if (!validPassword) throw new AppError(401, 'Invalid credentials');

  const mfaToken = await signMfaChallengeToken(user.id);

  return c.json({ mfaToken, mfaRequired: user.mfaEnabled });
});

auth.post('/mfa/verify', zValidator('json', mfaVerifySchema), async (c) => {
  const { mfaToken, code } = c.req.valid('json');

  let userId: string;
  try {
    userId = await verifyMfaChallengeToken(mfaToken);
  } catch {
    throw new AppError(401, 'Invalid or expired MFA token');
  }

  const user = await db.query.users.findFirst({ where: eq(users.id, userId) });
  if (!user || user.status !== 'active') throw new AppError(401, 'Invalid credentials');

  if (user.mfaEnabled) {
    if (!code || !user.mfaSecret) throw new AppError(401, 'MFA code required');
    if (!(await verifyTotpCode(user.mfaSecret, code))) throw new AppError(401, 'Invalid MFA code');
  }

  const accessToken = await signAccessToken(user.id, user.role);
  const { raw: refreshToken, hash } = generateRefreshToken();
  const expiresAt = new Date(Date.now() + REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000);

  await db.insert(refreshTokens).values({ userId: user.id, tokenHash: hash, expiresAt });

  return c.json({ accessToken, refreshToken });
});

auth.post('/refresh-token', zValidator('json', refreshSchema), async (c) => {
  const { refreshToken } = c.req.valid('json');
  const tokenHash = hashRefreshToken(refreshToken);

  const stored = await db.query.refreshTokens.findFirst({
    where: and(
      eq(refreshTokens.tokenHash, tokenHash),
      isNull(refreshTokens.revokedAt),
      gt(refreshTokens.expiresAt, new Date())
    ),
  });
  if (!stored) throw new AppError(401, 'Invalid or expired refresh token');

  const user = await db.query.users.findFirst({ where: eq(users.id, stored.userId) });
  if (!user || user.status !== 'active') throw new AppError(401, 'Invalid refresh token');

  await db
    .update(refreshTokens)
    .set({ revokedAt: new Date() })
    .where(eq(refreshTokens.id, stored.id));

  const { raw: newRefreshToken, hash: newHash } = generateRefreshToken();
  const expiresAt = new Date(Date.now() + REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000);
  await db.insert(refreshTokens).values({ userId: user.id, tokenHash: newHash, expiresAt });

  const accessToken = await signAccessToken(user.id, user.role);

  return c.json({ accessToken, refreshToken: newRefreshToken });
});

export default auth;