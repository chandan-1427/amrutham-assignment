import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { and, gte, lte, sql } from 'drizzle-orm';
import { db } from '../../db/client.js';
import { consultations } from '../../db/schema.js';
import { requireAuth } from '../../middleware/auth.js';
import { AppError } from '../../lib/errors.js';
import { analyticsQuerySchema } from './schema.js';

const adminRoute = new Hono();

adminRoute.get(
  '/analytics/consultations',
  requireAuth,
  zValidator('query', analyticsQuerySchema),
  async (c) => {
    const authUser = c.get('user');
    if (authUser.role !== 'admin') throw new AppError(403, 'Admin access required');

    const { from, to } = c.req.valid('query');
    const conditions = [];
    if (from) conditions.push(gte(consultations.createdAt, new Date(`${from}T00:00:00.000Z`)));
    if (to) conditions.push(lte(consultations.createdAt, new Date(`${to}T23:59:59.999Z`)));

    const byStatus = await db
      .select({ status: consultations.status, count: sql<number>`count(*)::int` })
      .from(consultations)
      .where(conditions.length ? and(...conditions) : undefined)
      .groupBy(consultations.status);

    const total = byStatus.reduce((sum, row) => sum + row.count, 0);

    return c.json({ total, byStatus });
  }
);

export default adminRoute;