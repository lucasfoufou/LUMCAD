import { defineConfig } from '@playwright/test';

// LUMCAD_E2E_PORT lets several checkouts run the suite side by side.
const port = Number(process.env.LUMCAD_E2E_PORT) || 1429;
const baseURL = `http://127.0.0.1:${port}`;

export default defineConfig({
    testDir: './tests/e2e',
    timeout: 30_000,
    expect: { timeout: 5000 },
    fullyParallel: true,
    workers: process.env.CI ? 2 : 4,
    retries: 0,
    reporter: [['list'], ['html', { open: 'never' }]],
    use: {
        baseURL,
        viewport: { width: 1440, height: 900 },
        trace: 'retain-on-failure',
        screenshot: 'only-on-failure',
        launchOptions: process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {},
    },
    webServer: {
        command: 'npm run dev:e2e',
        url: baseURL,
        reuseExistingServer: false,
        timeout: 60_000,
    },
    projects: [{ name: 'chromium', use: { browserName: 'chromium' } }],
});
