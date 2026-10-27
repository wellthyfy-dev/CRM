import { defineConfig, devices } from '@playwright/test';

// End-to-end tests run the real API against an in-process Postgres (PGlite) in dry_run mode, and the real web app.
// Authentication uses HS256 tokens minted with E2E_JWT_SECRET (see e2e/fixtures.ts). No external services.
export const E2E_JWT_SECRET = 'e2e-secret-e2e-secret-e2e-secret-e2e!';
export const E2E_API_URL = 'http://localhost:4100';
export const E2E_WEB_URL = 'http://localhost:5174';

export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: E2E_WEB_URL,
    trace: 'retain-on-failure',
    timezoneId: 'Asia/Kolkata',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: [
    {
      command: 'node --import tsx src/index.ts',
      cwd: '../api',
      url: `${E2E_API_URL}/health`,
      reuseExistingServer: false,
      timeout: 120_000,
      env: {
        DATABASE_URL: 'pglite://memory',
        SUPABASE_JWT_SECRET: E2E_JWT_SECRET,
        E2E_SEED_USERS: '1',
        EMAIL_MODE: 'dry_run',
        PORT: '4100',
        APP_URL: E2E_WEB_URL,
        LOG_LEVEL: 'warn',
        ZEROBOUNCE_API_KEY: '',
        TITAN_USER: '',
        TITAN_PASSWORD: '',
      },
    },
    {
      command: 'npx vite --port 5174 --strictPort',
      url: E2E_WEB_URL,
      reuseExistingServer: false,
      timeout: 120_000,
      env: {
        VITE_API_URL: E2E_API_URL,
        VITE_SUPABASE_URL: 'http://localhost:54321',
        VITE_SUPABASE_ANON_KEY: 'e2e-anon-key',
      },
    },
  ],
});
