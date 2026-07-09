import { z } from 'zod';

export const searchAvailabilitySchema = z.object({
  specialty: z.string().min(1).optional(),
  date: z.string().date().optional(),
  language: z.string().min(2).max(5).optional(),
  maxPrice: z.coerce.number().positive().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).default(0),
});