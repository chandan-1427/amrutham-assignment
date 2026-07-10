import { eq } from 'drizzle-orm';
import { db } from './client.js';
import { users, doctors } from './schema.js';

async function seedUser(email: string, role: 'doctor' | 'admin') {
  const normalizedEmail = email.toLowerCase();

  const user = await db.query.users.findFirst({ where: eq(users.email, normalizedEmail) });
  if (!user) {
    console.error(`No user found with email ${normalizedEmail}. Register that user first.`);
    process.exit(1);
  }

  await db.update(users).set({ role }).where(eq(users.id, user.id));

  if (role === 'doctor') {
    const existing = await db.query.doctors.findFirst({ where: eq(doctors.userId, user.id) });
    if (!existing) {
      await db.insert(doctors).values({
        userId: user.id,
        specialty: 'General Physician',
        consultationFee: '500.00',
        verificationStatus: 'verified',
        languages: ['en', 'hi'],
      });
    }
  }

  console.log(`${normalizedEmail} promoted to ${role}.`);
}

const [email, role] = process.argv.slice(2);
if (!email || (role !== 'doctor' && role !== 'admin')) {
  console.error('Usage: pnpm db:seed <email> <doctor|admin>');
  process.exit(1);
}

seedUser(email, role)
  .catch((err) => {
    console.error('Seed failed:', err);
    process.exit(1);
  })
  .finally(() => process.exit(0));