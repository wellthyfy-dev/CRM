import { loadEnv } from '../server/env';
import { createDb } from './client';
import { seed } from './seed';
import { ensureStorageBucket } from '../server/storage';

loadEnv();
const handle = await createDb(process.env.DATABASE_URL ?? '', { max: 1 });
try {
  const result = await seed(handle.db);
  console.log(`Seed complete: ${result.templates} templates, ${result.programmes} programmes inserted.`);
  if (process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY) {
    await ensureStorageBucket();
    console.log('Storage bucket ready.');
  }
} finally {
  await handle.close();
}
