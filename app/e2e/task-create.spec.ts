import { test, expect } from '@playwright/test';

test.describe('Task Creation @unauth', () => {
    test('should redirect to login when accessing CRM', async ({ page }) => {
        await page.goto('/operops');
        await expect(page).toHaveURL(/\/login/);
    });
});

test.describe('Task Creation', () => {
    // Skip these tests if CRM data loading is slow or unavailable
    // They depend on external API that may not be available in test environment
    test.skip('should have create task button', async ({ page }) => {
        await page.goto('/operops/crm');
        await page.waitForLoadState('networkidle');

        // Wait for page to load and show the button "+ Задачу"
        const createButton = page.getByRole('button', { name: /Задачу/i })
            .or(page.locator('button').filter({ hasText: /Задачу/ }));
        await expect(createButton.first()).toBeVisible({ timeout: 20000 });
    });

    test.skip('should open create task form when clicking create button', async ({ page }) => {
        await page.goto('/operops/crm');
        await page.waitForLoadState('networkidle');

        const createButton = page.getByRole('button', { name: /Задачу/i });
        await expect(createButton.first()).toBeVisible({ timeout: 20000 });
        await createButton.first().click();
        await page.waitForTimeout(500);

        // Should show form with input fields
        const formElement = page.locator('.ant-input, .ant-select, .ant-form');
        await expect(formElement.first()).toBeVisible({ timeout: 5000 });
    });

    test.skip('should have project selector in create form', async ({ page }) => {
        await page.goto('/operops/crm');
        await page.waitForLoadState('networkidle');

        const createButton = page.getByRole('button', { name: /Задачу/i });
        await expect(createButton.first()).toBeVisible({ timeout: 20000 });
        await createButton.first().click();
        await page.waitForTimeout(500);

        // Look for project select or any select dropdown
        const projectSelect = page.locator('.ant-select');
        await expect(projectSelect.first()).toBeVisible({ timeout: 5000 });
    });

    test.skip('should close form when clicking back/cancel', async ({ page }) => {
        await page.goto('/operops/crm');
        await page.waitForLoadState('networkidle');

        const createButton = page.getByRole('button', { name: /Задачу/i });
        await expect(createButton.first()).toBeVisible({ timeout: 20000 });
        await createButton.first().click();
        await page.waitForTimeout(500);

        // Find back button (arrow left icon)
        const backButton = page.locator('.anticon-arrow-left')
            .or(page.getByRole('button', { name: /назад|back|cancel|отмена/i }));

        if (await backButton.first().isVisible()) {
            await backButton.first().click();
            await page.waitForTimeout(300);
        }
    });
});
