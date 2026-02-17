import { test, expect, type Page } from '@playwright/test';

const SESSION_ID = '507f1f77bcf86cd799439011';

const mockAuth = async (page: Page): Promise<void> => {
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
};

const mockCommonVoiceListApis = async (page: Page, sessions: Array<Record<string, unknown>>): Promise<void> => {
    await page.route('**/api/voicebot/projects', async (route) => {
        await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify([]),
        });
    });

    await page.route('**/api/voicebot/persons/list', async (route) => {
        await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify([]),
        });
    });

    await page.route('**/api/voicebot/sessions/list', async (route) => {
        await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify(sessions),
        });
    });
};

const mockSessionGet = async (page: Page, sessionId = SESSION_ID): Promise<void> => {
    await page.route('**/api/voicebot/sessions/get', async (route) => {
        await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({
                voice_bot_session: {
                    _id: sessionId,
                    session_name: 'E2E Session',
                    is_active: true,
                    access_level: 'private',
                    participants: [],
                    allowed_users: [],
                },
                session_messages: [],
                socket_token: null,
                socket_port: null,
            }),
        });
    });
};

test.describe('Voice UI', () => {
    test('@unauth loads /voice sessions table', async ({ page }) => {
        await mockAuth(page);
        await mockCommonVoiceListApis(page, [
            {
                _id: SESSION_ID,
                session_name: 'Voice E2E Session',
                created_at: '2026-02-17T10:00:00.000Z',
                is_active: true,
                participants: [],
            },
        ]);

        await page.goto('/voice');
        await expect(page.getByRole('columnheader', { name: 'Дата' })).toBeVisible();
        await expect(page.getByRole('columnheader', { name: 'Название' })).toBeVisible();
        await expect(page.getByText('Voice E2E Session')).toBeVisible();
    });

    test('@unauth opens session from /voice table row click', async ({ page }) => {
        await mockAuth(page);
        await mockCommonVoiceListApis(page, [
            {
                _id: SESSION_ID,
                session_name: 'Clickable Session',
                created_at: '2026-02-17T10:00:00.000Z',
                is_active: true,
                participants: [],
            },
        ]);
        await mockSessionGet(page, SESSION_ID);

        await page.goto('/voice');
        await page.getByText('Clickable Session').click();
        await expect(page).toHaveURL(new RegExp(`/voice/session/${SESSION_ID}`));
        await expect(page.getByText('Транскрипция')).toBeVisible();
        await expect(page.getByText('Категоризация')).toBeVisible();
    });

    test('@unauth keeps /voice usable when sessions/list returns 500', async ({ page }) => {
        await mockAuth(page);
        await page.route('**/api/voicebot/projects', async (route) => {
            await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([]) });
        });
        await page.route('**/api/voicebot/persons/list', async (route) => {
            await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([]) });
        });
        await page.route('**/api/voicebot/sessions/list', async (route) => {
            await route.fulfill({
                status: 500,
                contentType: 'application/json',
                body: JSON.stringify({ error: 'boom' }),
            });
        });

        await page.goto('/voice');
        await expect(page.getByRole('columnheader', { name: 'Дата' })).toBeVisible();
        await expect(page.getByRole('columnheader', { name: 'Название' })).toBeVisible();
    });

    test('@unauth resolves /voice/session to active-session', async ({ page }) => {
        await mockAuth(page);
        await mockSessionGet(page, SESSION_ID);
        await page.route('**/api/voicebot/active_session', async (route) => {
            await route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify({
                    active_session: {
                        session_id: SESSION_ID,
                        session_name: 'Resolver Session',
                        is_active: true,
                    },
                }),
            });
        });

        await page.goto('/voice/session');
        await expect(page).toHaveURL(new RegExp(`/voice/session/${SESSION_ID}`), { timeout: 10000 });
    });

    test('@unauth shows empty-state on /voice/session without active-session', async ({ page }) => {
        await mockAuth(page);
        await page.route('**/api/voicebot/active_session', async (route) => {
            await route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify({ active_session: null }),
            });
        });

        await page.goto('/voice/session');
        await expect(page.getByText('Активная сессия не найдена')).toBeVisible();
        await expect(page.getByRole('button', { name: 'Открыть список сессий' })).toBeVisible();
    });

    test('@unauth shows runtime mismatch screen on 404 session fetch', async ({ page }) => {
        await mockAuth(page);
        await page.route('**/api/voicebot/sessions/get', async (route) => {
            await route.fulfill({
                status: 404,
                contentType: 'application/json',
                body: JSON.stringify({ error: 'Session not found' }),
            });
        });

        await page.goto('/voice/session/69948bce20288880ed5dea89');
        await expect(page.getByText('Сессия недоступна в текущем runtime (prod/dev mismatch)')).toBeVisible();
    });
});
