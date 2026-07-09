import { eq } from 'drizzle-orm';
import { db } from './client.js';
import { users, doctors } from './schema.js';

async function seedDoctor(email: string) {
  const normalizedEmail = email.toLowerCase();

  const user = await db.query.users.findFirst({
    where: eq(users.email, normalizedEmail),
  });

  if (!user) {
    console.error(`No user found with email ${normalizedEmail}. Register that user first.`);
    process.exit(1);
  }

  await db.update(users).set({ role: 'doctor' }).where(eq(users.id, user.id));

  const existing = await db.query.doctors.findFirst({
    where: eq(doctors.userId, user.id),
  });

  if (existing) {
    console.log(`${normalizedEmail} is already a doctor. Nothing to insert.`);
    return;
  }

  await db.insert(doctors).values({
    userId: user.id,
    specialty: 'General Physician',
    consultationFee: '500.00',
    verificationStatus: 'verified',
    languages: ['en', 'hi'],
  });

  console.log(`${normalizedEmail} promoted to doctor with a test doctors row.`);
}

const email = process.argv[2];
if (!email) {
  console.error('Usage: pnpm db:seed <email>');
  process.exit(1);
}

seedDoctor(email)
  .catch((err) => {
    console.error('Seed failed:', err);
    process.exit(1);
  })
  .finally(() => process.exit(0));