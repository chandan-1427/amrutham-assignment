import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';
import { TOTP } from 'otplib';
import { env } from '../config/env.js';

const key = Buffer.from(env.MFA_ENCRYPTION_KEY, 'hex');
const totp = new TOTP();

export function encryptMfaSecret(secret: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(secret, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return [iv.toString('hex'), authTag.toString('hex'), encrypted.toString('hex')].join(':');
}

export function decryptMfaSecret(stored: string) {
  const [ivHex, authTagHex, dataHex] = stored.split(':');
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(ivHex, 'hex'));
  decipher.setAuthTag(Buffer.from(authTagHex, 'hex'));
  const decrypted = Buffer.concat([decipher.update(Buffer.from(dataHex, 'hex')), decipher.final()]);
  return decrypted.toString('utf8');
}

export async function verifyTotpCode(encryptedSecret: string, code: string): Promise<boolean> {
  const secret = decryptMfaSecret(encryptedSecret);
  const result = await totp.verify(code, { secret });
  return result.valid;
}