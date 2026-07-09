import { z } from 'zod';

export const registerSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8).max(72), // argon2/bcrypt input cap
  fullName: z.string().min(1).max(200),
  phone: z.string().min(6).max(20).optional(),
});

export const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

export const mfaVerifySchema = z.object({
  mfaToken: z.string(),
  code: z.string().length(6).optional(),
});

export const refreshSchema = z.object({
  refreshToken: z.string(),
});