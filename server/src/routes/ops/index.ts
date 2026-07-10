import { Hono } from 'hono';
import { sql } from 'drizzle-orm';
import { db } from '../../db/client.js';
import { registry } from '../../lib/metrics.js';

const opsRoute = new Hono();

opsRoute.get('/healthz', (c) => c.json({ status: 'ok' }));

opsRoute.get('/readyz', async (c) => {
  try {
    await db.execute(sql`select 1`);
  } catch {
    return c.json({ status: 'not_ready', db: 'unreachable' }, 503);
  }

  // Redis isn't wired into this service yet (search caching deferred) —
  // nothing to check here until that lands.
  return c.json({ status: 'ready', db: 'ok' });
});

opsRoute.get('/metrics', async (c) => {
  const metrics = await registry.metrics();
  return c.text(metrics, 200, { 'Content-Type': registry.contentType });
});

export default opsRoute;