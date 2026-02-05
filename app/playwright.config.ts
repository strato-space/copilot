import { defineConfig, devices } from '@playwright/test';
import { fileURLToPath } from 'url';
import path from 'path';
import dotenv from 'dotenv';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load test environment variables
dotenv.config({ path: path.resolve(__dirname, '.env.test') });

/**
 * Playwright configuration for FinOps + CRM E2E tests
 * @see https://playwright.dev/docs/test-configuration
 */

const isCI = Boolean(process.env.CI);
const authFile = path.join(__dirname, '.playwright/.auth/user.json');

// WebServer disabled - run `npm run dev` manually before tests
// const webServerConfig = isCI
//     ? {}
//     : {
//         webServer: {
//             command: 'npm run dev',
//             url: 'http://localhost:5173',
//             reuseExistingServer: true,
//             timeout: 120 * 1000,
//         },
//     };

const workersConfig = isCI ? { workers: 1 } : {};

export default defineConfig({
    testDir: './e2e',
    /* Run tests in files in parallel */
    fullyParallel: true,
    /* Fail the build on CI if you accidentally left test.only in the source code. */
    forbidOnly: isCI,
    /* Retry on CI only */
    retries: isCI ? 2 : 0,
    /* Reporter to use. See https://playwright.dev/docs/test-reporters */
    reporter: 'list',
    /* Shared settings for all the projects below. See https://playwright.dev/docs/api/class-testoptions. */
    use: {
        /* Base URL to use in actions like `await page.goto('/')`. */
        baseURL: process.env.PLAYWRIGHT_BASE_URL ?? 'http://127.0.0.1:3002',
        /* Collect trace when retrying the failed test. See https://playwright.dev/docs/trace-viewer */
        trace: 'on-first-retry',
        /* Screenshot on failure */
        screenshot: 'only-on-failure',
    },

    /* Configure projects for major browsers */
    projects: [
        // Setup project - runs first to authenticate
        {
            name: 'setup',
            testMatch: /auth\.setup\.ts/,
        },
        // Unauthenticated tests - run without auth state
        {
            name: 'chromium-unauth',
            testMatch: /\.spec\.ts/,
            testIgnore: /auth\.setup\.ts/,
            use: { ...devices['Desktop Chrome'] },
            grep: /@unauth|unauthenticated/i,
        },
        // Authenticated tests - depend on setup
        {
            name: 'chromium',
            testMatch: /\.spec\.ts/,
            testIgnore: /auth\.setup\.ts/,
            use: {
                ...devices['Desktop Chrome'],
                storageState: authFile,
            },
            dependencies: ['setup'],
            grepInvert: /@unauth|unauthenticated/i,
        },
    ],

    ...workersConfig,
});
