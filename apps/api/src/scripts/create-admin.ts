// Create (or promote) the first admin user.
// Usage: npm run create-admin -- <email> <password> "<Full Name>"
import { eq } from 'drizzle-orm';
import { createDb, loadEnv, profiles, readServerEnv, supabaseAdmin } from '@wellthyfy/shared/server';

loadEnv();
const env = readServerEnv();
const [email, password, fullName = 'Administrator'] = process.argv.slice(2);
if (!email || !password) {
  console.error('Usage: npm run create-admin -- <email> <password> "<Full Name>"');
  process.exit(1);
}
if (password.length < 10) {
  console.error('Use a password of at least 10 characters.');
  process.exit(1);
}

const sb = supabaseAdmin();
let userId: string | undefined;
const created = await sb.auth.admin.createUser({
  email,
  password,
  email_confirm: true,
  user_metadata: { full_name: fullName },
});
if (created.data.user) {
  userId = created.data.user.id;
} else {
  // Already exists: find it.
  for (let page = 1; page < 50 && !userId; page++) {
    const { data, error } = await sb.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw error;
    userId = data.users.find((u) => u.email?.toLowerCase() === email.toLowerCase())?.id;
    if (data.users.length < 200) break;
  }
  if (!userId) throw created.error ?? new Error('Could not create or find the user');
}

const handle = await createDb(env.DATABASE_URL, { max: 1 });
try {
  const existing = await handle.db.select().from(profiles).where(eq(profiles.id, userId));
  if (existing.length) {
    await handle.db
      .update(profiles)
      .set({ role: 'admin', active: true, fullName, email })
      .where(eq(profiles.id, userId));
  } else {
    await handle.db.insert(profiles).values({ id: userId, email, fullName, role: 'admin', active: true });
  }
  console.log(`Admin ready: ${email} (${userId})`);
} finally {
  await handle.close();
}
