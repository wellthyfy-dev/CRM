import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const rawUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim();

// A malformed value (e.g. a literal "${SUPABASE_URL}" pasted into Vercel) must not crash the build/prerender;
// the login page shows "Supabase is not configured" instead.
const url = rawUrl && /^https?:\/\/[^\s"'$]+$/.test(rawUrl) ? rawUrl : undefined;
if (rawUrl && !url) console.error('NEXT_PUBLIC_SUPABASE_URL is not a valid http(s) URL; Supabase is disabled.');

export const supabaseConfigured = !!url && !!anonKey;

/** Browser Supabase client (anon key only). Used for login/session; all data goes through the API. */
export const supabase: SupabaseClient = createClient(
  url || 'http://localhost:54321',
  anonKey || 'missing-anon-key',
  {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
  },
);
