import fs from 'node:fs/promises';
import path from 'node:path';
import type { ServerEnv } from './env';
import { downloadFile, listFiles, removeFiles, signedUrl, uploadFile } from './storage';

/** Private file storage for proposals and backups: Supabase Storage in production, a local folder in development. */
export interface FileStore {
  readonly kind: 'supabase' | 'local' | 'memory';
  put(key: string, body: Buffer, contentType: string): Promise<void>;
  get(key: string): Promise<Buffer>;
  list(prefix: string): Promise<{ name: string; createdAt: Date | null }[]>;
  remove(keys: string[]): Promise<void>;
  /** Short-lived download URL (Supabase) or null (local: stream through the API). */
  url(key: string): Promise<string | null>;
}

function safeKey(key: string): string {
  if (key.includes('..') || path.isAbsolute(key)) throw new Error('Invalid storage key');
  return key;
}

export function supabaseFileStore(): FileStore {
  return {
    kind: 'supabase',
    put: (key, body, contentType) => uploadFile(safeKey(key), body, contentType),
    get: (key) => downloadFile(safeKey(key)),
    async list(prefix) {
      return (await listFiles(prefix)).map((f) => ({
        name: f.name,
        createdAt: f.created_at ? new Date(f.created_at) : null,
      }));
    },
    remove: (keys) => removeFiles(keys.map(safeKey)),
    url: (key) => signedUrl(safeKey(key)),
  };
}

export function localFileStore(root: string): FileStore {
  const full = (key: string) => path.join(root, safeKey(key));
  return {
    kind: 'local',
    async put(key, body) {
      await fs.mkdir(path.dirname(full(key)), { recursive: true });
      await fs.writeFile(full(key), body);
    },
    get: (key) => fs.readFile(full(key)),
    async list(prefix) {
      try {
        const dir = full(prefix);
        const names = await fs.readdir(dir);
        return Promise.all(
          names.map(async (name) => ({ name, createdAt: (await fs.stat(path.join(dir, name))).mtime })),
        );
      } catch {
        return [];
      }
    },
    async remove(keys) {
      for (const k of keys) await fs.rm(full(k), { force: true });
    },
    url: async () => null,
  };
}

export function memoryFileStore(): FileStore & { files: Map<string, Buffer> } {
  const files = new Map<string, Buffer>();
  return {
    kind: 'memory',
    files,
    async put(key, body) {
      files.set(safeKey(key), body);
    },
    async get(key) {
      const b = files.get(key);
      if (!b) throw new Error(`File not found: ${key}`);
      return b;
    },
    async list(prefix) {
      return [...files.keys()]
        .filter((k) => k.startsWith(prefix.endsWith('/') ? prefix : `${prefix}/`))
        .map((k) => ({ name: k.slice(prefix.length).replace(/^\//, ''), createdAt: null }));
    },
    async remove(keys) {
      for (const k of keys) files.delete(k);
    },
    url: async () => null,
  };
}

export function createFileStore(
  env: Pick<ServerEnv, 'SUPABASE_URL' | 'SUPABASE_SERVICE_ROLE_KEY'>,
): FileStore {
  if (env.SUPABASE_URL && env.SUPABASE_SERVICE_ROLE_KEY) return supabaseFileStore();
  return localFileStore(path.resolve(process.cwd(), process.env.LOCAL_STORAGE_DIR || '.storage'));
}
