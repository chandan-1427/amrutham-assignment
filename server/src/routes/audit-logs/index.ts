import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { and, eq } from 'drizzle-orm';
import { db } from '../../db/client.js';
import { auditLogs } from '../../db/schema.js';
import { requireAuth } from '../../middleware/auth.js';
import { AppError } from '../../lib/errors.js';
import { listAuditLogsSchema } from './schema.js';

const auditLogsRoute = new Hono();

auditLogsRoute.get('/', requireAuth, zValidator('query', listAuditLogsSchema), async (c) => {
  const authUser = c.get('user');
  if (authUser.role !== 'admin') throw new AppError(403, 'Admin access required');

  const { entityType, entityId, actorId, limit, offset } = c.req.valid('query');
  const conditions = [];
  if (entityType) conditions.push(eq(auditLogs.entityType, entityType));
  if (entityId) conditions.push(eq(auditLogs.entityId, entityId));
  if (actorId) conditions.push(eq(auditLogs.actorId, actorId));

  const rows = await db.query.auditLogs.findMany({
    where: conditions.length ? and(...conditions) : undefined,
    orderBy: (t, { desc }) => [desc(t.createdAt)],
    limit,
    offset,
  });

  return c.json(rows);
});

export default auditLogsRoute;