import { createClient, type SupabaseClient } from '@supabase/supabase-js';

let client: SupabaseClient | null = null;

/** Service-role Supabase client (server only). */
export function supabaseAdmin(): SupabaseClient {
  if (client) return client;
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required');
  client = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  return client;
}

export function storageBucket(): string {
  return process.env.SUPABASE_STORAGE_BUCKET || 'wellthyfy-crm';
}

export async function ensureStorageBucket(): Promise<void> {
  const sb = supabaseAdmin();
  const { data } = await sb.storage.getBucket(storageBucket());
  if (!data) {
    const { error } = await sb.storage.createBucket(storageBucket(), { public: false });
    if (error && !/already exists/i.test(error.message)) throw error;
  }
}

export async function uploadFile(
  path: string,
  body: Buffer | Uint8Array,
  contentType: string,
): Promise<void> {
  const { error } = await supabaseAdmin().storage.from(storageBucket()).upload(path, body, {
    contentType,
    upsert: true,
  });
  if (error) throw error;
}

export async function downloadFile(path: string): Promise<Buffer> {
  const { data, error } = await supabaseAdmin().storage.from(storageBucket()).download(path);
  if (error || !data) throw error ?? new Error(`File not found: ${path}`);
  return Buffer.from(await data.arrayBuffer());
}

export async function signedUrl(path: string, expiresInSeconds = 600): Promise<string> {
  const { data, error } = await supabaseAdmin()
    .storage.from(storageBucket())
    .createSignedUrl(path, expiresInSeconds);
  if (error || !data) throw error ?? new Error('Could not sign URL');
  return data.signedUrl;
}

export async function listFiles(prefix: string): Promise<{ name: string; created_at: string | null }[]> {
  const { data, error } = await supabaseAdmin().storage.from(storageBucket()).list(prefix, { limit: 1000 });
  if (error) throw error;
  return (data ?? []).map((f) => ({ name: f.name, created_at: f.created_at ?? null }));
}

export async function removeFiles(paths: string[]): Promise<void> {
  if (paths.length === 0) return;
  const { error } = await supabaseAdmin().storage.from(storageBucket()).remove(paths);
  if (error) throw error;
}
