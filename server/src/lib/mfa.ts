import { TOTP } from 'otplib';
import { env } from '../config/env.js';
import { encrypt, decrypt } from './encryption.js';

const totp = new TOTP();
const mfaKey = Buffer.from(env.MFA_ENCRYPTION_KEY, 'hex');

export const encryptMfaSecret = (secret: string) => encrypt(secret, mfaKey);
export const decryptMfaSecret = (stored: string) => decrypt(stored, mfaKey);

export async function verifyTotpCode(encryptedSecret: string, code: string): Promise<boolean> {
  const secret = decryptMfaSecret(encryptedSecret);
  const result = await totp.verify(code, { secret });
  return result.valid;
}