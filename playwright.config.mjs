// Playwright for the public judge view.
//
// The page is static, so the server is 40 lines of node: the test therefore
// exercises exactly the files gh-pages serves, with no bundler in between.
import { defineConfig, devices } from '@playwright/test';
import { fileURLToPath } from 'node:url';

const here = fileURLToPath(new URL('.', import.meta.url));
const PORT = 4180;

export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  expect: { timeout: 7_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    viewport: { width: 1440, height: 960 },
    trace: 'retain-on-failure',
  },
  webServer: {
    command: `node tools/serve-static.mjs ${PORT}`,
    cwd: here,
    url: `http://127.0.0.1:${PORT}/`,
    reuseExistingServer: true,
    timeout: 20_000,
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
