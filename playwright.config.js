import { defineConfig } from '@playwright/test';

export default defineConfig({
    testDir: './tests/e2e',
    timeout: 30_000,
    expect: { timeout: 5000 },
    fullyParallel: true,
    workers: process.env.CI ? 2 : 4,
    retries: 0,
    reporter: [['list'], ['html', { open: 'never' }]],
    use: {
        baseURL: 'http://127.0.0.1:1429',
        viewport: { width: 1440, height: 900 },
        trace: 'retain-on-failure',
        screenshot: 'only-on-failure',
        launchOptions: process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {},
    },
    webServer: {
        command: 'npm run dev:e2e',
        url: 'http://127.0.0.1:1429',
        reuseExistingServer: false,
        timeout: 60_000,
    },
    projects: [{ name: 'chromium', use: { browserName: 'chromium' } }],
});
