import { z } from 'zod';

export const createPaymentIntentSchema = z.object({
  consultationId: z.string().uuid(),
});

export const webhookPayloadSchema = z.object({
  providerRef: z.string(),
  consultationId: z.string().uuid(),
  status: z.enum(['confirmed', 'failed']),
});