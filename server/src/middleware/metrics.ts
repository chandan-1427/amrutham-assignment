import { createMiddleware } from 'hono/factory';
import { httpRequestsTotal, httpRequestDuration } from '../lib/metrics.js';

export const metricsMiddleware = createMiddleware(async (c, next) => {
  const start = process.hrtime.bigint();
  await next();
  const durationSeconds = Number(process.hrtime.bigint() - start) / 1e9;

  const route = c.req.routePath ?? c.req.path;
  const labels = { method: c.req.method, route, status: String(c.res.status) };

  httpRequestsTotal.inc(labels);
  httpRequestDuration.observe(labels, durationSeconds);
});