import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { and, eq, gte, lte, sql } from 'drizzle-orm';
import { db } from '../../db/client.js';
import { availabilitySlots, doctors, profiles } from '../../db/schema.js';
import { searchAvailabilitySchema } from './schema.js';

const availabilityRoute = new Hono();

availabilityRoute.get('/search', zValidator('query', searchAvailabilitySchema), async (c) => {
  const { specialty, date, language, maxPrice, limit, offset } = c.req.valid('query');

  const conditions = [eq(availabilitySlots.status, 'available')];

  if (specialty) conditions.push(eq(doctors.specialty, specialty));
  if (language) conditions.push(sql`${language} = ANY(${doctors.languages})`);
  if (maxPrice !== undefined) conditions.push(lte(doctors.consultationFee, maxPrice.toString()));
  if (date) {
    const dayStart = new Date(`${date}T00:00:00.000Z`);
    const dayEnd = new Date(`${date}T23:59:59.999Z`);
    conditions.push(gte(availabilitySlots.startTime, dayStart));
    conditions.push(lte(availabilitySlots.startTime, dayEnd));
  }

  const results = await db
    .select({
      slotId: availabilitySlots.id,
      startTime: availabilitySlots.startTime,
      endTime: availabilitySlots.endTime,
      doctorId: doctors.userId,
      doctorName: profiles.fullName,
      specialty: doctors.specialty,
      consultationFee: doctors.consultationFee,
      languages: doctors.languages,
    })
    .from(availabilitySlots)
    .innerJoin(doctors, eq(availabilitySlots.doctorId, doctors.userId))
    .innerJoin(profiles, eq(profiles.userId, doctors.userId))
    .where(and(...conditions))
    .orderBy(availabilitySlots.startTime)
    .limit(limit)
    .offset(offset);

  return c.json(results);
});

export default availabilityRoute;