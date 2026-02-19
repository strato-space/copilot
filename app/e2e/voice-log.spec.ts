import { Locator, test, expect, type Page } from '@playwright/test';

const SESSION_ID = '507f1f77bcf86cd799439011';

type MockSessionDataParams = {
    messageId?: string;
    segmentId?: string;
    segmentText?: string;
    onSessionGet?: () => void;
};

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

const addAuthCookie = async (page: Page): Promise<void> => {
    const target = new URL(process.env.PLAYWRIGHT_BASE_URL ?? 'http://127.0.0.1:3002');
    await page.context().addCookies([
        {
            name: 'auth_token',
            value: 'playwright-auth-token',
            url: `${target.protocol}//${target.host}`,
            secure: target.protocol === 'https:',
            sameSite: 'Lax',
        },
    ]);
};

const mockCommonSessionApis = async (page: Page): Promise<void> => {
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
    await page.route('**/api/voicebot/auth/list-users', async (route) => {
        await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify([]),
        });
    });
};

const pickFirstOptionWithKeyboard = async (page: Page, select: Locator): Promise<void> => {
    await select.click();
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Enter');
};

const mockSessionData = async (
    page: Page,
    {
        messageId = 'msg-1',
        segmentId = 'seg-1',
        segmentText = 'Hello segment',
        onSessionGet,
    }: MockSessionDataParams = {},
): Promise<void> => {
    await page.route('**/api/voicebot/sessions/get', async (route) => {
        onSessionGet?.();
        await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({
                voice_bot_session: {
                    _id: SESSION_ID,
                    session_name: 'Log Session',
                    is_active: true,
                    access_level: 'private',
                    participants: [],
                    allowed_users: [],
                },
                session_messages: [
                    {
                        _id: messageId,
                        message_id: `message-${messageId}`,
                        message_timestamp: 1700000000,
                        transcription: {
                            segments: [
                                {
                                    id: segmentId,
                                    text: segmentText,
                                    start: 0,
                                    end: 10,
                                    speaker: 'Test',
                                },
                            ],
                        },
                        transcription_chunks: [
                            {
                                id: segmentId,
                                text: segmentText,
                                speaker: 'Test',
                                is_deleted: false,
                            },
                        ],
                    },
                ],
                session_attachments: [],
                socket_token: null,
                socket_port: null,
            }),
        });
    });

    await page.route('**/api/voicebot/session_log', async (route) => {
        await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({
                events: [
                    {
                        oid: 'evt-rollback',
                        event_name: 'transcript_segment_edited',
                        event_group: 'transcription',
                        status: 'done',
                        target: { entity_oid: segmentId },
                        event_time: 1700000001,
                        action: {
                            available: true,
                            type: 'rollback',
                        },
                    },
                    {
                        oid: 'evt-resend',
                        event_name: 'notify_requested',
                        event_group: 'notify',
                        status: 'error',
                        target: { entity_oid: `${SESSION_ID}/notify` },
                        event_time: 1700000002,
                        action: {
                            available: true,
                            type: 'resend',
                        },
                    },
                    {
                        oid: 'evt-retry',
                        event_name: 'categorization_failed',
                        event_group: 'categorization',
                        status: 'error',
                        event_time: 1700000003,
                        action: {
                            available: true,
                            type: 'retry',
                        },
                    },
                ],
            }),
        });
    });
};

test.describe('Voice log workflows', () => {
    test('@unauth shows log controls and action buttons', async ({ page }) => {
        await addAuthCookie(page);
        await mockAuth(page);
        await mockCommonSessionApis(page);
        await mockSessionData(page);

        await page.goto(`/voice/session/${SESSION_ID}`);
        await page.getByRole('tab', { name: 'Log' }).click();

        await expect(page.getByRole('button', { name: 'Refresh' })).toBeVisible();
        await expect(page.getByRole('button', { name: 'Edit segment' })).toBeVisible();
        await expect(page.getByRole('button', { name: 'Delete segment' })).toBeVisible();

        await expect(page.getByRole('button', { name: 'Rollback' })).toBeVisible();
        await expect(page.getByRole('button', { name: 'Resend' })).toBeVisible();
        await expect(page.getByRole('button', { name: 'Retry' })).toBeVisible();
    });

    test('@unauth triggers rollback, resend and retry actions with proper payloads', async ({ page }) => {
        await addAuthCookie(page);
        await mockAuth(page);
        await mockCommonSessionApis(page);

        let rollbackPayload: Record<string, unknown> | null = null;
        let resendPayload: Record<string, unknown> | null = null;
        let retryPayload: Record<string, unknown> | null = null;
        let fetchSessionCalled = 0;

        await page.route('**/api/voicebot/rollback_event', async (route) => {
            rollbackPayload = await route.request().postDataJSON();
            await route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify({ success: true }),
            });
        });
        await page.route('**/api/voicebot/resend_notify_event', async (route) => {
            resendPayload = await route.request().postDataJSON();
            await route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify({ success: true }),
            });
        });
        await page.route('**/api/voicebot/retry_categorization_event', async (route) => {
            retryPayload = await route.request().postDataJSON();
            await route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify({ success: true }),
            });
        });

        await mockSessionData(page, {
            onSessionGet: () => {
                fetchSessionCalled += 1;
            },
        });

        await page.goto(`/voice/session/${SESSION_ID}`);
        await page.getByRole('tab', { name: 'Log' }).click();

        await page.getByRole('button', { name: 'Rollback' }).first().click();
        await page.getByRole('button', { name: 'Run' }).click();
        await expect.poll(() => rollbackPayload).not.toBeNull();

        await page.getByRole('button', { name: 'Resend' }).click();
        await page.getByRole('button', { name: 'Run' }).click();
        await expect.poll(() => resendPayload).not.toBeNull();

        await page.getByRole('button', { name: 'Retry' }).click();
        await page.getByRole('button', { name: 'Run' }).click();
        await expect.poll(() => retryPayload).not.toBeNull();

        await expect(fetchSessionCalled).toBeGreaterThan(0);
        expect(rollbackPayload).toMatchObject({
            session_id: SESSION_ID,
            event_oid: 'evt-rollback',
        });
        expect(resendPayload).toMatchObject({
            session_id: SESSION_ID,
            event_oid: 'evt-resend',
        });
        expect(retryPayload).toMatchObject({
            session_id: SESSION_ID,
            event_oid: 'evt-retry',
        });
    });


    test('@unauth triggers session ready-to-summarize endpoint payload', async ({ page }) => {
        await addAuthCookie(page);
        await mockAuth(page);
        await mockCommonSessionApis(page);
        await mockSessionData(page);

        let triggerPayload: Record<string, unknown> | null = null;
        await page.route('**/api/voicebot/trigger_session_ready_to_summarize', async (route) => {
            triggerPayload = await route.request().postDataJSON();
            await route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify({ success: true, session_id: SESSION_ID }),
            });
        });

        await page.goto(`/voice/session/${SESSION_ID}`);

        const response = await page.evaluate(async (sessionId) => {
            const result = await fetch('/api/voicebot/trigger_session_ready_to_summarize', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ session_id: sessionId }),
            });
            return result.status;
        }, SESSION_ID);

        expect(response).toBe(200);
        await expect.poll(() => triggerPayload).not.toBeNull();
        expect(triggerPayload).toMatchObject({
            session_id: SESSION_ID,
        });
    });

    test('@unauth submits transcript segment edit and delete payloads', async ({ page }) => {
        await addAuthCookie(page);
        await mockAuth(page);
        await mockCommonSessionApis(page);
        let fetchSessionCalled = 0;
        await mockSessionData(page, {
            segmentText: 'Original text',
            onSessionGet: () => {
                fetchSessionCalled += 1;
            },
        });

        let editPayload: Record<string, unknown> | null = null;
        let deletePayload: Record<string, unknown> | null = null;

        await page.route('**/api/voicebot/edit_transcript_chunk', async (route) => {
            editPayload = await route.request().postDataJSON();
            await route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify({ success: true }),
            });
        });
        await page.route('**/api/voicebot/delete_transcript_chunk', async (route) => {
            deletePayload = await route.request().postDataJSON();
            await route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify({ success: true }),
            });
        });

        await page.goto(`/voice/session/${SESSION_ID}`);
        await page.getByRole('tab', { name: 'Log' }).click();

        await page.getByRole('button', { name: 'Edit segment' }).click();

        const editModal = page.getByRole('dialog', { name: 'Edit transcript segment' });
        await expect(editModal).toBeVisible();

        const editMessageSelect = editModal.getByRole('combobox').nth(0);
        await editMessageSelect.click();
        await pickFirstOptionWithKeyboard(page, editMessageSelect);

        const editSegmentSelect = editModal.getByRole('combobox').nth(1);
        await expect(editSegmentSelect).toBeEnabled();
        await editSegmentSelect.click();
        await pickFirstOptionWithKeyboard(page, editSegmentSelect);

        await editModal.getByRole('textbox', { name: /new segment text/i }).fill('Updated text');
        await editModal.getByRole('button', { name: 'Edit' }).click();

        await expect.poll(() => editPayload).not.toBeNull();
        expect(editPayload).toMatchObject({
            session_id: SESSION_ID,
            message_id: 'msg-1',
            segment_oid: 'seg-1',
            text: 'Updated text',
        });

        await page.getByRole('button', { name: 'Delete segment' }).click();

        const deleteModal = page.getByRole('dialog', { name: 'Delete transcript segment' });
        await expect(deleteModal).toBeVisible();

        const deleteMessageSelect = deleteModal.getByRole('combobox').nth(0);
        await deleteMessageSelect.click();
        await pickFirstOptionWithKeyboard(page, deleteMessageSelect);

        const deleteSegmentSelect = deleteModal.getByRole('combobox').nth(1);
        await expect(deleteSegmentSelect).toBeEnabled();
        await deleteSegmentSelect.click();
        await pickFirstOptionWithKeyboard(page, deleteSegmentSelect);

        await deleteModal.getByRole('button', { name: 'Delete' }).click();

        await expect.poll(() => deletePayload).not.toBeNull();
        expect(deletePayload).toMatchObject({
            session_id: SESSION_ID,
            message_id: 'msg-1',
            segment_oid: 'seg-1',
        });
        await expect(fetchSessionCalled).toBeGreaterThanOrEqual(2);
    });
});
