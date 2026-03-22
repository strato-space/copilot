import { test, expect, type Locator, type Page } from '@playwright/test';

const VOICE_REPRESENTATIVE_SESSION_ID = '69b3b631b00ed62d0c449ff8';

type CrmStatusCountEntry = {
    status_key?: unknown;
    count?: unknown;
};

type CrmStatusCountsResponse = {
    status_counts?: CrmStatusCountEntry[];
};

type CrmTicketSummary = {
    name?: unknown;
};

type VoiceSessionTasksResponse = {
    items?: unknown[];
};

type VoiceSessionTabCountEntry = {
    status?: unknown;
    status_key?: unknown;
    label?: unknown;
    count?: unknown;
};

type VoiceSessionTabCountsResponse = {
    status_counts?: VoiceSessionTabCountEntry[];
};

const normalizeText = (value: string): string => value.replace(/\s+/g, ' ').trim();

const escapeRegExp = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const toFiniteNumber = (value: unknown): number => {
    const numeric = typeof value === 'number' ? value : Number(value);
    return Number.isFinite(numeric) ? numeric : 0;
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
            await page.waitForTimeout(1_000 * attempt);
        }
    }
    throw lastError;
};

const postJson = async <T>(page: Page, endpoint: string, payload: unknown): Promise<T> => {
    const response = await page.request.post(endpoint, { data: payload });
    expect(response.ok(), `Expected successful response from ${endpoint}, got ${response.status()}`).toBeTruthy();
    return (await response.json()) as T;
};

const readTabCount = async (root: Page | Locator, label: string): Promise<number> => {
    const tab = root.getByRole('tab', { name: new RegExp(`^${escapeRegExp(label)}\\s+\\d+$`, 'i') }).first();
    await expect(tab).toBeVisible();
    const text = normalizeText((await tab.textContent()) ?? '');
    const match = text.match(/(\d+)\s*$/);
    if (!match) {
        throw new Error(`Unable to parse count from tab "${label}" text: "${text}"`);
    }
    return Number(match[1]);
};

const expectTabCount = async (root: Page | Locator, label: string, expectedCount: number): Promise<void> => {
    await expect
        .poll(async () => readTabCount(root, label), {
            message: `Expected tab "${label}" to show count ${expectedCount}`,
            timeout: 20_000,
        })
        .toBe(expectedCount);
};

const normalizeTicketTitles = (items: unknown): string[] => {
    if (!Array.isArray(items)) return [];
    return items
        .map((item) => String((item as CrmTicketSummary)?.name ?? '').trim())
        .filter((value) => value.length > 0);
};

const selectMainTab = async (page: Page, label: string): Promise<void> => {
    await page.getByRole('tab', { name: new RegExp(`^${escapeRegExp(label)}\\s+\\d+$`, 'i') }).click();
};

const expectTableContainsTitle = async (page: Page, title: string): Promise<void> => {
    await expect(page.locator('.ant-table-tbody').getByText(title, { exact: true }).first()).toBeVisible({
        timeout: 20_000,
    });
};

type CapturedCrmTicketsRequest = {
    statuses: string[];
    draft_horizon_days?: number;
};

const waitForCapturedCrmTicketsRequest = async (
    requestsRef: CapturedCrmTicketsRequest[],
    predicate: (payload: CapturedCrmTicketsRequest) => boolean
): Promise<CapturedCrmTicketsRequest> => {
    await expect
        .poll(() => requestsRef.find(predicate) ?? null, {
            timeout: 20_000,
        })
        .not.toBeNull();

    return requestsRef.find(predicate)!;
};

const resolveVoiceLifecycleLabel = (entry: VoiceSessionTabCountEntry): string | null => {
    const statusKey = String(entry.status_key ?? entry.status ?? '').trim().toUpperCase();
    if (statusKey === 'READY_10') return 'Ready';
    if (statusKey === 'PROGRESS_10') return 'In Progress';
    if (statusKey === 'REVIEW_10') return 'Review';
    if (statusKey === 'DONE_10') return 'Done';
    if (statusKey === 'ARCHIVE') return 'Archive';

    const label = normalizeText(String(entry.label ?? ''));
    if (!label) return null;
    if (/^ready$/i.test(label)) return 'Ready';
    if (/^in progress$/i.test(label)) return 'In Progress';
    if (/^review$/i.test(label)) return 'Review';
    if (/^done$/i.test(label)) return 'Done';
    if (/^archive$/i.test(label)) return 'Archive';
    return null;
};

test.describe('Live parity checks', () => {
    test('OperOps CRM status tabs parity with /api/crm/tickets/status-counts', async ({ page }) => {
        test.setTimeout(90_000);
        const capturedTicketRequests: CapturedCrmTicketsRequest[] = [];
        await page.route('**/api/crm/tickets', async (route) => {
            const postData = route.request().postDataJSON?.() as Record<string, unknown> | undefined;
            const capturedRequest: CapturedCrmTicketsRequest = {
                statuses: Array.isArray(postData?.statuses) ? postData.statuses.map((value) => String(value)) : [],
            };
            if (typeof postData?.draft_horizon_days === 'number') {
                capturedRequest.draft_horizon_days = postData.draft_horizon_days;
            }
            capturedTicketRequests.push(capturedRequest);
            await route.continue();
        });

        await gotoWithRetry(page, '/operops/crm');
        await expect(page).not.toHaveURL(/\/login/);
        await expect(page.getByText('Draft/Archive depth', { exact: true })).toBeVisible();
        await expect(page.getByText('1d', { exact: true }).first()).toBeVisible();

        const [apiResponse, draftFiltered, archiveFiltered] = await Promise.all([
            postJson<CrmStatusCountsResponse>(page, '/api/crm/tickets/status-counts', {
                draft_horizon_days: 1,
            }),
            postJson<CrmTicketSummary[]>(page, '/api/crm/tickets', {
                statuses: ['DRAFT_10'],
                response_mode: 'summary',
                draft_horizon_days: 1,
            }),
            postJson<CrmTicketSummary[]>(page, '/api/crm/tickets', {
                statuses: ['ARCHIVE'],
                response_mode: 'summary',
                draft_horizon_days: 1,
            }),
        ]);

        const statusCountByKey = new Map<string, number>();
        for (const entry of apiResponse.status_counts ?? []) {
            const statusKey = String(entry?.status_key ?? '').trim().toUpperCase();
            if (!statusKey) continue;
            statusCountByKey.set(statusKey, toFiniteNumber(entry?.count));
        }

        const headerTabs = page.locator('.crm-header-tabs');
        await expect(headerTabs).toBeVisible();

        await expectTabCount(headerTabs, 'Draft', statusCountByKey.get('DRAFT_10') ?? 0);
        await expectTabCount(headerTabs, 'Ready', statusCountByKey.get('READY_10') ?? 0);
        await expectTabCount(headerTabs, 'In Progress', statusCountByKey.get('PROGRESS_10') ?? 0);
        await expectTabCount(headerTabs, 'Review', statusCountByKey.get('REVIEW_10') ?? 0);
        await expectTabCount(headerTabs, 'Done', statusCountByKey.get('DONE_10') ?? 0);
        await expectTabCount(headerTabs, 'Archive', statusCountByKey.get('ARCHIVE') ?? 0);

        const filteredDraftTitles = normalizeTicketTitles(draftFiltered);
        const draftRequest = await waitForCapturedCrmTicketsRequest(
            capturedTicketRequests,
            (payload) => payload.statuses.length === 1 && payload.statuses[0] === 'DRAFT_10' && payload.draft_horizon_days === 1
        );
        expect(draftRequest.draft_horizon_days).toBe(1);

        await selectMainTab(page, 'Draft');
        if (filteredDraftTitles.length > 0) {
            await expectTableContainsTitle(page, filteredDraftTitles[0]!);
        }

        const filteredArchiveTitles = normalizeTicketTitles(archiveFiltered);
        await selectMainTab(page, 'Archive');
        const archiveRequest = await waitForCapturedCrmTicketsRequest(
            capturedTicketRequests,
            (payload) => payload.statuses.length === 1 && payload.statuses[0] === 'ARCHIVE' && payload.draft_horizon_days === 1
        );
        expect(archiveRequest.draft_horizon_days).toBe(1);
        if (filteredArchiveTitles.length > 0) {
            await expectTableContainsTitle(page, filteredArchiveTitles[0]!);
        }
    });

    test('Voice representative session tasks parity with session APIs', async ({ page }) => {
        test.setTimeout(60_000);
        const sessionId = VOICE_REPRESENTATIVE_SESSION_ID;
        await gotoWithRetry(page, `/voice/session/${sessionId}`);
        await expect(page).not.toHaveURL(/\/login/);

        const [draftResponse, tabCountsResponse] = await Promise.all([
            postJson<VoiceSessionTasksResponse>(page, '/api/voicebot/session_tasks', {
                session_id: sessionId,
                bucket: 'Draft',
            }),
            postJson<VoiceSessionTabCountsResponse>(page, '/api/voicebot/session_tab_counts', {
                session_id: sessionId,
            }),
        ]);

        const draftCount = Array.isArray(draftResponse.items) ? draftResponse.items.length : 0;
        const lifecycleCounts: Record<'Ready' | 'In Progress' | 'Review' | 'Done' | 'Archive', number> = {
            Ready: 0,
            'In Progress': 0,
            Review: 0,
            Done: 0,
            Archive: 0,
        };

        for (const entry of tabCountsResponse.status_counts ?? []) {
            const lifecycleLabel = resolveVoiceLifecycleLabel(entry);
            if (!lifecycleLabel) continue;
            lifecycleCounts[lifecycleLabel as keyof typeof lifecycleCounts] += toFiniteNumber(entry.count);
        }

        const tasksParentCount =
            draftCount +
            lifecycleCounts.Ready +
            lifecycleCounts['In Progress'] +
            lifecycleCounts.Review +
            lifecycleCounts.Done +
            lifecycleCounts.Archive;

        await expectTabCount(page, 'Задачи', tasksParentCount);
        await page.getByRole('tab', { name: /Задачи/i }).click();

        await expectTabCount(page, 'Draft', draftCount);
        await expectTabCount(page, 'Ready', lifecycleCounts.Ready);
        await expectTabCount(page, 'In Progress', lifecycleCounts['In Progress']);
        await expectTabCount(page, 'Review', lifecycleCounts.Review);
        await expectTabCount(page, 'Done', lifecycleCounts.Done);
        await expectTabCount(page, 'Archive', lifecycleCounts.Archive);
    });
});
