import 'dotenv/config';
import { Hono } from 'hono';
import { serve } from '@hono/node-server'
import { HTTPException } from 'hono/http-exception';
import { AppError } from './lib/errors.js';
import auth from './routes/auth/index.js';
import usersRoute from './routes/users/index.js';
import doctorsRoute from './routes/doctors/index.js';
import availabilityRoute from './routes/availability/index.js';

const app = new Hono();

app.route('/auth', auth);
app.route('/users', usersRoute);
app.route('/doctors', doctorsRoute);
app.route('/availability', availabilityRoute);

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