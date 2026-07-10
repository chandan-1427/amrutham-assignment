import { z } from 'zod';

export const createPrescriptionSchema = z.object({
  notes: z.string().min(1).max(5000),
  medications: z
    .array(
      z.object({
        name: z.string().min(1).max(200),
        dosage: z.string().min(1).max(100),
        duration: z.string().min(1).max(100),
      })
    )
    .min(1),
});