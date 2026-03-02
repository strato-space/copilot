import { test, expect } from '@playwright/test';

const allowClicksThroughSpinner = async (page: import('@playwright/test').Page): Promise<void> => {
    await page.addStyleTag({
        content: '.ant-spin-fullscreen-show { pointer-events: none !important; }',
    });
};

const mockAuthAndCrmApis = async (page: import('@playwright/test').Page): Promise<() => number> => {
    await page.route('**/api/auth/me', async (route) => {
        await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({
                data: {
                    user: {
                        id: '507f1f77bcf86cd799439099',
                        email: 'test@stratospace.fun',
                        role: 'ADMIN',
                        permissions: [],
                    },
                },
            }),
        });
    });

    let createTicketCalls = 0;
    await page.route('**/api/crm/**', async (route) => {
        const pathname = new URL(route.request().url()).pathname;

        if (pathname.endsWith('/dictionary')) {
            await route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify({
                    projects: [{ _id: 'proj-1', name: 'Demo Project' }],
                    performers: [],
                    customers: [],
                    projectGroups: [],
                    tree: [],
                    task_types: [],
                    task_supertypes: [],
                    task_types_tree: [],
                    epics: [],
                    income_types: [],
                }),
            });
            return;
        }

        if (
            pathname.endsWith('/tickets') ||
            pathname.endsWith('/customers/list') ||
            pathname.endsWith('/project_groups/list') ||
            pathname.endsWith('/projects/list')
        ) {
            await route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify([]),
            });
            return;
        }

        if (pathname.endsWith('/tickets/create')) {
            createTicketCalls += 1;
            await route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify({ success: true }),
            });
            return;
        }

        await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({}),
        });
    });

    return () => createTicketCalls;
};

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

    test('@unauth should close form when clicking back/cancel', async ({ page }) => {
        const getCreateTicketCalls = await mockAuthAndCrmApis(page);

        await page.goto('/operops/crm');
        await page.waitForLoadState('domcontentloaded');
        await allowClicksThroughSpinner(page);

        const createButton = page.getByRole('button', { name: /Задачу/i });
        await expect(createButton.first()).toBeVisible({ timeout: 15000 });
        await createButton.first().click({ force: true });

        await expect(page.getByText('Создать задачу')).toBeVisible({ timeout: 10000 });

        // Find back button (arrow left icon)
        const backButton = page.locator('.anticon-arrow-left')
            .or(page.getByRole('button', { name: /назад|back|cancel|отмена/i }));

        await expect(backButton.first()).toBeVisible();
        await backButton.first().click();

        await expect(createButton.first()).toBeVisible({ timeout: 10000 });
        await expect(page.getByText('Создать задачу')).toHaveCount(0);
        await expect.poll(() => getCreateTicketCalls()).toBe(0);
    });
});
