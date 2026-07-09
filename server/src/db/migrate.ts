import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';
import { env } from '../config/env.js';

const migrationClient = postgres(env.DATABASE_URL, { max: 1 });

async function run() {
  await migrate(drizzle(migrationClient), { migrationsFolder: './drizzle' });
  await migrationClient.end();
  console.log('Migrations applied');
}

run().catch((err) => {
  console.error('Migration failed:', err);
  process.exit(1);
});