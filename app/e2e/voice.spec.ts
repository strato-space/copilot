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

const mockSessionGet = async (
    page: Page,
    sessionId = SESSION_ID,
    options: {
        sessionMessages?: Array<Record<string, unknown>>;
        sessionAttachments?: Array<Record<string, unknown>>;
        socketToken?: string | null;
    } = {}
): Promise<void> => {
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
                session_messages: options.sessionMessages ?? [],
                session_attachments: options.sessionAttachments ?? [],
                socket_token: options.socketToken ?? null,
                socket_port: null,
            }),
        });
    });
};

const mockSessionLog = async (
    page: Page,
    events: Array<Record<string, unknown>> = []
): Promise<void> => {
    await page.route('**/api/voicebot/session_log', async (route) => {
        await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({ events }),
        });
    });
};

test.describe('Voice UI', () => {
    test('@unauth does not request microphone on initial /voice load', async ({ page }) => {
        await page.addInitScript(() => {
            const win = window as unknown as { __gumCalls?: number };
            win.__gumCalls = 0;

            const nav = navigator as unknown as {
                mediaDevices?: {
                    getUserMedia?: (...args: unknown[]) => Promise<MediaStream>;
                };
            };

            if (!nav.mediaDevices) {
                nav.mediaDevices = {};
            }

            nav.mediaDevices.getUserMedia = async () => {
                win.__gumCalls = (win.__gumCalls || 0) + 1;
                throw new Error('playwright-gum-blocked');
            };
        });

        await mockAuth(page);
        await mockCommonVoiceListApis(page, []);

        await page.goto('/voice');
        await expect(page.getByRole('columnheader', { name: 'Дата' })).toBeVisible();
        await expect
            .poll(async () =>
                page.evaluate(() => ((window as unknown as { __gumCalls?: number }).__gumCalls || 0))
            )
            .toBe(0);
    });

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


    test('@unauth renders Screenshort tab attachment cards', async ({ page }) => {
        await mockAuth(page);
        await mockSessionLog(page, []);
        await mockSessionGet(page, SESSION_ID, {
            sessionAttachments: [
                {
                    _id: 'att_1',
                    message_id: 'msg_1',
                    message_timestamp: 1771405775,
                    kind: 'screenshot',
                    source: 'web',
                    uri: 'https://example.com/mock-screenshot.png',
                    url: 'https://example.com/mock-screenshot.png',
                    caption: 'Mock screenshot attachment',
                    size: 2048,
                },
            ],
        });

        await page.goto(`/voice/session/${SESSION_ID}`);
        await page.getByRole('tab', { name: 'Screenshort' }).click();

        await expect(page.getByText('Mock screenshot attachment')).toBeVisible();
        await expect(page.getByText('screenshot', { exact: true })).toBeVisible();
    });

    test('@unauth renders Log tab with rollback action controls', async ({ page }) => {
        await mockAuth(page);
        await mockSessionLog(page, [
            {
                oid: 'evt_1',
                event_group: 'transcription',
                event_name: 'segment_edited',
                status: 'done',
                event_time: '2026-02-18T09:00:00.000Z',
                action: {
                    available: true,
                    type: 'rollback',
                },
            },
        ]);
        await mockSessionGet(page, SESSION_ID);

        await page.goto(`/voice/session/${SESSION_ID}`);
        await page.getByRole('tab', { name: 'Log' }).click();

        await expect(page.getByText('segment_edited')).toBeVisible();
        await expect(page.getByRole('button', { name: 'Rollback' })).toBeVisible();
        await expect(page.getByRole('button', { name: 'Edit segment' })).toBeVisible();
    });

    test('@unauth shows not-found screen on 404 session fetch', async ({ page }) => {
        await mockAuth(page);
        await page.route('**/api/voicebot/sessions/get', async (route) => {
            await route.fulfill({
                status: 404,
                contentType: 'application/json',
                body: JSON.stringify({ error: 'Session not found' }),
            });
        });

        await page.goto('/voice/session/69948bce20288880ed5dea89');
        await expect(page.getByText('Сессия не найдена')).toBeVisible();
    });

    test('@unauth shows runtime mismatch screen on 409 session fetch', async ({ page }) => {
        await mockAuth(page);
        await page.route('**/api/voicebot/sessions/get', async (route) => {
            await route.fulfill({
                status: 409,
                contentType: 'application/json',
                body: JSON.stringify({ error: 'runtime_mismatch' }),
            });
        });

        await page.goto('/voice/session/69948bce20288880ed5dea89');
        await expect(page.getByText('Сессия недоступна в текущем runtime (prod/dev mismatch)')).toBeVisible();
    });
});
