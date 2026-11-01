import { defineConfig, devices } from '@playwright/test';

const port = 4173;

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 180_000,
  expect: { timeout: 30_000 },
  fullyParallel: true,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reportSlowTests: { max: 10, threshold: 30_000 },
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: `http://localhost:${port}/`,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'phone-portrait',
      use: { ...devices['Pixel 7'] },
    },
    /* Landscape and tablet run only the tests tagged @layout. */
    {
      name: 'phone-landscape',
      use: { ...devices['Pixel 7 landscape'] },
      grep: /@layout/,
    },
    {
      name: 'tablet',
      use: { ...devices['Galaxy Tab S4'] },
      grep: /@layout/,
    },
  ],
  webServer: {
    command: `npx vite preview --port ${port} --strictPort`,
    url: `http://localhost:${port}/`,
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
});
