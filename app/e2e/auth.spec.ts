import { test, expect } from '@playwright/test';

/**
 * Authentication tests - unauthenticated only
 * These tests verify login page and redirect behavior
 */
test.describe('Authentication Flow @unauth', () => {
    test('should redirect unauthenticated user to login from operops', async ({ page }) => {
        await page.goto('/operops');
        await expect(page).toHaveURL(/\/login/);
    });

    test('should redirect unauthenticated user to login from plan-fact', async ({ page }) => {
        await page.goto('/plan-fact');
        await expect(page).toHaveURL(/\/login/);
    });

    test('should display login form on login page', async ({ page }) => {
        await page.goto('/login');

        // Should have some form of login UI
        const hasLoginButton = await page.getByRole('button', { name: /войти|login|sign in|submit/i }).isVisible().catch(() => false);
        const hasForm = await page.locator('form').isVisible().catch(() => false);
        const hasInputs = await page.locator('input').first().isVisible().catch(() => false);

        // At least one login element should be present
        expect(hasLoginButton || hasForm || hasInputs).toBe(true);
    });

    test('should have password input on login page', async ({ page }) => {
        await page.goto('/login');

        // Wait for page to load
        await page.waitForLoadState('networkidle');

        // Check for password input
        const passwordInput = page.locator('input[type="password"]');
        const isVisible = await passwordInput.isVisible().catch(() => false);

        // Password field should exist on login page
        expect(isVisible).toBe(true);
    });

    test('should have email input on login page', async ({ page }) => {
        await page.goto('/login');
        await page.waitForLoadState('networkidle');

        const emailInput = page.locator('input[type="email"], input#login, input[name="email"], input[name="login"]');
        await expect(emailInput.first()).toBeVisible();
    });

    test('should have submit button on login page', async ({ page }) => {
        await page.goto('/login');
        await page.waitForLoadState('networkidle');

        const submitButton = page.getByRole('button', { name: /войти|sign in|login|submit|enter/i });
        await expect(submitButton).toBeVisible();
    });
});

test.describe('Protected Routes @unauth', () => {
    test('operops redirects to login', async ({ page }) => {
        await page.goto('/operops');
        await page.waitForLoadState('networkidle');
        await expect(page).toHaveURL(/\/login/);
    });

    test('plan-fact redirects to login', async ({ page }) => {
        await page.goto('/plan-fact');
        await page.waitForLoadState('networkidle');
        await expect(page).toHaveURL(/\/login/);
    });

    test('analytics redirects to login', async ({ page }) => {
        await page.goto('/analytics');
        await page.waitForLoadState('networkidle');
        await expect(page).toHaveURL(/\/login/);
    });
});

test.describe('Authenticated Session', () => {
    test('should not redirect to login when authenticated', async ({ page }) => {
        await page.goto('/operops');
        await page.waitForLoadState('networkidle');

        // Should NOT be redirected to login
        await expect(page).not.toHaveURL(/\/login/);
    });

    test('should have access to protected routes', async ({ page }) => {
        await page.goto('/analytics');
        await page.waitForLoadState('networkidle');

        // Should NOT be redirected to login
        await expect(page).not.toHaveURL(/\/login/);
    });
});
