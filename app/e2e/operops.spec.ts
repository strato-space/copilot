import { test, expect } from '@playwright/test';

test.describe('OperOps Navigation @unauth', () => {
    test('should redirect unauthenticated user to login', async ({ page }) => {
        // Navigate to OperOps section
        await page.goto('/operops');
        // Should redirect to login
        await expect(page).toHaveURL(/\/login/);
    });

    test('should display login form', async ({ page }) => {
        await page.goto('/operops');
        // Should show login page with form elements
        await expect(page.locator('form').or(page.getByRole('button', { name: /войти|login|sign in/i }))).toBeVisible({ timeout: 10000 });
    });
});

test.describe('OperOps Navigation', () => {
    test('should load CRM page when authenticated', async ({ page }) => {
        await page.goto('/operops/crm');
        await page.waitForLoadState('networkidle');
        // Should not redirect to login when authenticated
        await expect(page).not.toHaveURL(/\/login/);
        // Should show CRM content (tabs or table or nav)
        await expect(page.locator('.ant-tabs, .ant-table, .ant-menu').first()).toBeVisible({ timeout: 15000 });
    });

    test('should display navigation tabs', async ({ page }) => {
        await page.goto('/operops/crm');
        await page.waitForLoadState('networkidle');

        // Check for horizontal menu navigation
        const nav = page.locator('.ant-menu-horizontal, .ant-menu');
        await expect(nav.first()).toBeVisible({ timeout: 10000 });
    });

    // Navigation tests depend on external CRM API data loading completely
    // The fullscreen spinner blocks clicks until data loads
    // Skipping these to avoid flaky test failures
    test.describe('Page Navigation (requires full data load)', () => {
        test.skip();

        test('should navigate to Performers page', async ({ page }) => {
            await page.goto('/operops/crm');
            await page.waitForLoadState('networkidle');

            const performersLink = page.locator('a[href="/operops/performers"]');
            await expect(performersLink.first()).toBeVisible({ timeout: 10000 });
            await performersLink.first().click();

            await expect(page).toHaveURL(/\/operops\/performers/);
        });

        test('should navigate to Finances page', async ({ page }) => {
            await page.goto('/operops/crm');
            await page.waitForLoadState('networkidle');

            const financesLink = page.locator('a[href="/operops/finances-performers"]');
            await expect(financesLink.first()).toBeVisible({ timeout: 10000 });
            await financesLink.first().click();

            await expect(page).toHaveURL(/\/operops\/finances-performers/);
        });

        test('should navigate to Projects Tree page', async ({ page }) => {
            await page.goto('/operops/crm');
            await page.waitForLoadState('networkidle');

            const projectsLink = page.locator('a[href="/operops/projects-tree"]');
            await expect(projectsLink.first()).toBeVisible({ timeout: 10000 });
            await projectsLink.first().click();

            await expect(page).toHaveURL(/\/operops\/projects-tree/);
        });

        test('should navigate back to CRM from other pages', async ({ page }) => {
            await page.goto('/operops/performers');
            await page.waitForLoadState('networkidle');

            const crmLink = page.locator('a[href="/operops/crm"]');
            await expect(crmLink.first()).toBeVisible({ timeout: 10000 });
            await crmLink.first().click();

            await expect(page).toHaveURL(/\/operops\/crm/);
        });
    });
});
