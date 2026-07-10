import 'dotenv/config';
import { Hono } from 'hono';
import { serve } from '@hono/node-server'
import { HTTPException } from 'hono/http-exception';
import { AppError } from './lib/errors.js';

import opsRoute from './routes/ops/index.js';
import { metricsMiddleware } from './middleware/metrics.js';

import auth from './routes/auth/index.js';
import usersRoute from './routes/users/index.js';
import doctorsRoute from './routes/doctors/index.js';
import availabilityRoute from './routes/availability/index.js';
import consultationsRoute from './routes/consultations/index.js';
import paymentsRoute from './routes/payments/index.js';
import prescriptionsRoute from './routes/prescriptions/index.js';
import auditLogsRoute from './routes/audit-logs/index.js';
import adminRoute from './routes/admin/index.js';

const app = new Hono();

app.use('*', metricsMiddleware);
app.route('/', opsRoute);

app.route('/auth', auth);
app.route('/users', usersRoute);
app.route('/doctors', doctorsRoute);
app.route('/availability', availabilityRoute);
app.route('/consultations', consultationsRoute);
app.route('/payments', paymentsRoute);
app.route('/prescriptions', prescriptionsRoute);
app.route('/audit-logs', auditLogsRoute);
app.route('/admin', adminRoute);

app.onError((err, c) => {
  if (err instanceof AppError) {
    return c.json({ error: err.message }, err.status);
  }
  if (err instanceof HTTPException) {
    return c.json({ error: err.message }, err.status);
  }
  console.error(err);
  return c.json({ error: 'Internal server error' }, 500);
});

serve({
  fetch: app.fetch,
  port: 3000
}, (info) => {
  console.log(`Server is running on port: ${info.port}`)
})

export default app;