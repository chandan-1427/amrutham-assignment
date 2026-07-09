import 'dotenv/config';
import { z } from 'zod';

const envSchema = z.object({
  DATABASE_URL: z.string().url(),
  JWT_SECRET: z.string().min(32),
  MFA_ENCRYPTION_KEY: z.string().length(64), // 32-byte hex key for AES-256-GCM
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PAYMENT_GATEWAY_WEBHOOK_SECRET: z.string().min(32),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error('Invalid environment configuration:', parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const env = parsed.data;