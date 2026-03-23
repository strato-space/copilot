import { test, expect, type Page } from '@playwright/test';

const DRAFT_SESSION_ID = '69be9224a123bbddf9dbb280';
const REVIEW_SESSION_CANDIDATES = [
    '69bfda8a63c3f038ea06ceaf',
    '69be9224a123bbddf9dbb280',
    '69b3b631b00ed62d0c449ff8',
];
const TASK_ID = '69bfdcd18beabd01af8d01b4';

type VoiceSessionGetResponse = {
    voice_bot_session?: {
        _id?: unknown;
        review_md_text?: unknown;
    } | null;
};

const gotoWithRetry = async (page: Page, url: string, attempts = 3): Promise<void> => {
    let lastError: unknown;
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
        try {
            await page.goto(url, { waitUntil: 'domcontentloaded' });
            return;
        } catch (error) {
            lastError = error;
            if (attempt === attempts) break;
            await page.waitForTimeout(1000 * attempt);
        }
    }
    throw lastError;
};

const normalizeText = (value: string): string => value.replace(/\s+/g, ' ').trim();

const getSessionDetails = async (page: Page, sessionId: string): Promise<VoiceSessionGetResponse> => {
    const response = await page.request.post('/api/voicebot/sessions/get', {
        data: { session_id: sessionId },
    });
    expect(response.ok(), `Expected session get to succeed for ${sessionId}`).toBeTruthy();
    return (await response.json()) as VoiceSessionGetResponse;
};

test.describe('Voice review workspace live smoke', () => {
    test('Draft tab uses simplified review workspace without legacy bulk controls', async ({ page }) => {
        test.setTimeout(90_000);
        await gotoWithRetry(page, `/voice/session/${DRAFT_SESSION_ID}`);
        await expect(page).not.toHaveURL(/\/login/);

        await page.getByRole('tab', { name: /^Задачи\s+\d+$/ }).click();
        await page.getByRole('tab', { name: /^Draft\s+\d+$/ }).click();

        await expect(page.getByText('Черновики', { exact: true })).toHaveCount(0);
        await expect(page.getByText('Карточка черновика', { exact: true })).toHaveCount(0);
        await expect(page.getByRole('button', { name: 'Сохранить' })).toBeVisible();
        await expect(page.getByRole('button', { name: 'Клонировать' })).toBeVisible();
        await expect(page.getByRole('button', { name: 'Удалить' })).toBeVisible();

        await expect(page.getByRole('button', { name: /Выбрать видимые/i })).toHaveCount(0);
        await expect(page.getByRole('button', { name: /Очистить выбор/i })).toHaveCount(0);
        await expect(page.getByRole('button', { name: /Создать выбранные/i })).toHaveCount(0);
        await expect(page.getByText(/Всего:\s*\d+/i)).toHaveCount(0);
        await expect(page.getByText(/Нужно заполнить:\s*\d+/i)).toHaveCount(0);
        await expect(page.getByText(/Enrichment:\s*\d+\/\d+/i)).toHaveCount(0);
        await expect(page.getByPlaceholder(/Поиск по названию/i)).toHaveCount(0);
        await expect(page.getByText('Все приоритеты', { exact: true })).toHaveCount(0);
        await expect(page.getByText('Review signals', { exact: true })).toHaveCount(0);
    });

    test('Review tab renders persisted review markdown when available', async ({ page }) => {
        test.setTimeout(90_000);

        let selectedSessionId = REVIEW_SESSION_CANDIDATES[0]!;
        let reviewText = '';
        for (const candidateId of REVIEW_SESSION_CANDIDATES) {
            const payload = await getSessionDetails(page, candidateId);
            const text = typeof payload.voice_bot_session?.review_md_text === 'string'
                ? payload.voice_bot_session.review_md_text.trim()
                : '';
            if (text) {
                selectedSessionId = candidateId;
                reviewText = text;
                break;
            }
        }

        await gotoWithRetry(page, `/voice/session/${selectedSessionId}`);
        await expect(page).not.toHaveURL(/\/login/);

        await page.getByRole('tab', { name: /^Ревью$/ }).click();

        if (reviewText) {
            const preview = normalizeText(reviewText).slice(0, 80);
            await expect(page.getByText(preview, { exact: false }).first()).toBeVisible({ timeout: 20_000 });
        } else {
            await expect(page.getByText('Ревью еще не сформировано', { exact: true })).toBeVisible();
        }
    });

    test('Task page Edit Task opens canonical CRM edit route', async ({ page }) => {
        test.setTimeout(90_000);
        await gotoWithRetry(page, `/operops/task/${TASK_ID}`);
        await expect(page).not.toHaveURL(/\/login/);

        await page.getByRole('button', { name: 'Edit Task' }).click();
        await expect(page).toHaveURL(/\/operops\/crm\/task\/[^/]+\/edit$/, { timeout: 20_000 });
        await expect(page.getByText('Редактировать задачу', { exact: true })).toBeVisible();
    });
});
