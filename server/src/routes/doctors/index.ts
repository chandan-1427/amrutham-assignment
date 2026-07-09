import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { db } from '../../db/client.js';
import { availabilitySlots } from '../../db/schema.js';
import { requireAuth } from '../../middleware/auth.js';
import { AppError } from '../../lib/errors.js';
import { createAvailabilitySchema } from './schema.js';

const doctorsRoute = new Hono();

doctorsRoute.post(
  '/:id/availability',
  requireAuth,
  zValidator('json', createAvailabilitySchema),
  async (c) => {
    const authUser = c.get('user');
    const doctorId = c.req.param('id');

    if (authUser.role !== 'doctor' || authUser.id !== doctorId) {
      throw new AppError(403, 'Only the doctor themself can add their availability');
    }

    const { startTime, endTime } = c.req.valid('json');

    const [slot] = await db
      .insert(availabilitySlots)
      .values({
        doctorId,
        startTime: new Date(startTime),
        endTime: new Date(endTime),
      })
      .returning();

    return c.json(slot, 201);
  }
);

export default doctorsRoute;