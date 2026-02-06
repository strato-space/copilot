import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';

const getFirstSessionRow = (page: Page) => page.locator('table tbody tr').first();

test.describe('Voice UI', () => {
    test('loads sessions list', async ({ page }) => {
        await page.goto('/voice');
        await page.waitForLoadState('networkidle');

        await expect(page.getByRole('heading', { name: /сессии voicebot/i })).toBeVisible();
        await expect(page.getByRole('button', { name: /обновить/i })).toBeVisible();
    });

    test('opens session page when session exists', async ({ page }) => {
        await page.goto('/voice');
        await page.waitForLoadState('networkidle');

        const rows = page.locator('table tbody tr');
        try {
            await expect.poll(async () => rows.count(), { timeout: 5000 }).toBeGreaterThan(0);
        } catch {
            test.skip(true, 'No voice sessions available for navigation test.');
            return;
        }

        const firstRow = getFirstSessionRow(page);
        const actionsCell = firstRow.locator('td').nth(4);
        const actionButtons = actionsCell.locator('button');
        const actionCount = await actionButtons.count();

        if (actionCount === 0) {
            test.skip(true, 'No action buttons available for navigation test.');
            return;
        }

        await actionButtons.first().click();

        await expect(page).toHaveURL(/\/voice\/session\//);
        await expect(page.getByRole('button', { name: /загрузить аудио/i })).toBeVisible();
    });

    test('admin page renders or blocks by permission', async ({ page }) => {
        await page.goto('/admin');
        await page.waitForLoadState('networkidle');

        const adminHeaderVisible = await page.getByText('Панель администратора').isVisible().catch(() => false);
        const deniedVisible = await page.getByText('Доступ запрещен').isVisible().catch(() => false);

        expect(adminHeaderVisible || deniedVisible).toBeTruthy();
    });
});
