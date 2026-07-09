import { z } from 'zod';

export const createConsultationSchema = z.object({
  slotId: z.string().uuid(),
});

export const listConsultationsSchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).default(0),
});