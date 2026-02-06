import { test as setup, expect } from '@playwright/test';
import { fileURLToPath } from 'url';
import path from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const authFile = path.join(__dirname, '../.playwright/.auth/user.json');

/**
 * Global setup: Login and save authentication state.
 * This runs before all authenticated tests.
 *
 * Required environment variables:
 * - TEST_USER_EMAIL: test user email
 * - TEST_USER_PASSWORD: test user password
 */
setup('authenticate', async ({ page }) => {
    const email = process.env.TEST_USER_EMAIL;
    const password = process.env.TEST_USER_PASSWORD;

    if (!email || !password) {
        throw new Error(
            'Missing test credentials. Set TEST_USER_EMAIL and TEST_USER_PASSWORD environment variables.\n' +
            'Example: TEST_USER_EMAIL=test@example.com TEST_USER_PASSWORD=secret npm run test:e2e'
        );
    }

    // Navigate to login page
    await page.goto('/login');
    await page.waitForLoadState('networkidle');

    // Fill in login form
    await page.getByPlaceholder(/corporate email/i).fill(email);
    await page.getByPlaceholder(/password/i).fill(password);

    // Submit form
    await page.getByRole('button', { name: /enter|sign in|login|войти/i }).click();

    // Wait for redirect after successful login
    await expect(page).not.toHaveURL(/\/login/, { timeout: 15000 });

    // Verify we're authenticated by checking we can access protected route
    await page.goto('/operops');
    await expect(page).not.toHaveURL(/\/login/, { timeout: 5000 });

    // Save authentication state to file
    await page.context().storageState({ path: authFile });
});
