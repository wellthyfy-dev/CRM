import { loadEnv } from '../server/env';
import { createDb, runMigrations } from './client';

loadEnv();
const handle = await createDb(process.env.DATABASE_URL ?? '', { max: 1 });
try {
  await runMigrations(handle);
  console.log('Migrations applied.');
} finally {
  await handle.close();
}
