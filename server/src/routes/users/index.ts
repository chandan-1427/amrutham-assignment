import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { eq } from 'drizzle-orm';
import { db } from '../../db/client.js';
import { users, profiles } from '../../db/schema.js';
import { requireAuth } from '../../middleware/auth.js';
import { AppError } from '../../lib/errors.js';
import { updateProfileSchema } from '../../db/schema.js';

const usersRoute = new Hono();

usersRoute.get('/me', requireAuth, async (c) => {
  const authUser = c.get('user');

  const user = await db.query.users.findFirst({
    where: eq(users.id, authUser.id),
    columns: {
      id: true,
      email: true,
      phone: true,
      role: true,
      mfaEnabled: true,
      status: true,
      createdAt: true,
    },
    with: {
      profile: true,
    },
  });

  if (!user) throw new AppError(404, 'User not found');

  return c.json(user);
});

usersRoute.patch('/me', requireAuth, zValidator('json', updateProfileSchema), async (c) => {
  const authUser = c.get('user');
  const updates = c.req.valid('json');

  const [profile] = await db
    .update(profiles)
    .set({ ...updates, updatedAt: new Date() })
    .where(eq(profiles.userId, authUser.id))
    .returning();

  if (!profile) throw new AppError(404, 'Profile not found');

  return c.json(profile);
});

export default usersRoute;