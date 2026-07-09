import { SignJWT, jwtVerify } from 'jose';
import { randomBytes, createHash } from 'crypto';
import { env } from '../config/env.js';

const secret = new TextEncoder().encode(env.JWT_SECRET);

type Role = 'patient' | 'doctor' | 'admin';

export async function signAccessToken(userId: string, role: Role) {
  return new SignJWT({ role })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(userId)
    .setIssuedAt()
    .setExpirationTime('15m')
    .sign(secret);
}

export async function signMfaChallengeToken(userId: string) {
  return new SignJWT({ purpose: 'mfa' })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(userId)
    .setIssuedAt()
    .setExpirationTime('5m')
    .sign(secret);
}

export async function verifyMfaChallengeToken(token: string) {
  const { payload } = await jwtVerify(token, secret, { algorithms: ['HS256'] });
  if (payload.purpose !== 'mfa' || !payload.sub) {
    throw new Error('Invalid MFA challenge token');
  }
  return payload.sub as string;
}

export async function verifyAccessToken(token: string) {
  const { payload } = await jwtVerify(token, secret, { algorithms: ['HS256'] });
  return payload as { sub: string; role: Role };
}

// Refresh tokens are opaque, not JWTs — only their hash is stored, so a DB leak doesn't leak usable tokens.
export function generateRefreshToken() {
  const raw = randomBytes(32).toString('hex');
  const hash = hashRefreshToken(raw);
  return { raw, hash };
}

export function hashRefreshToken(raw: string) {
  return createHash('sha256').update(raw).digest('hex');
}