import { test, expect, type Page } from '@playwright/test';

const SESSION_ID = '507f1f77bcf86cd799439011';
const BASE_URL = process.env.PLAYWRIGHT_BASE_URL ?? 'http://127.0.0.1:3002';

const mockAuth = async (
  page: Page,
  options: { permissions?: string[] } = {}
): Promise<void> => {
  const permissions = Array.isArray(options.permissions) ? options.permissions : [];
  await page.route('**/api/auth/me**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        data: {
          user: {
            id: '507f1f77bcf86cd799439099',
            email: 'test@stratospace.fun',
            role: 'ADMIN',
            permissions,
          },
        },
      }),
    });
  });
};

const addAuthCookie = async (page: Page): Promise<void> => {
  const target = new URL(BASE_URL);
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

const gotoWithBootRetry = async (page: Page, path: string): Promise<void> => {
  let lastDiagnostic = '';
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    await page.goto(path, { waitUntil: 'domcontentloaded' });
    await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => undefined);
    await page.waitForTimeout(800);

    const ready = await page
      .evaluate(() => {
        const root = document.getElementById('root');
        if (!root || root.childElementCount === 0) return false;
        return true;
      })
      .catch(() => false);
    if (ready) {
      return;
    }

    const currentUrl = page.url();
    const rootHtml = await page.locator('#root').innerHTML().catch(() => '');
    lastDiagnostic = `attempt=${attempt} url=${currentUrl} ready=false rootLen=${rootHtml.length}`;
    await page.waitForTimeout(300);
  }

  throw new Error(`App bootstrap failed for path "${path}" (${lastDiagnostic || 'no-diagnostic'})`);
};

const mockSessionApis = async (page: Page): Promise<void> => {
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
  await page.route('**/api/voicebot/sessions/get', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        voice_bot_session: {
          _id: SESSION_ID,
          session_name: 'FAB Lifecycle Session',
          is_active: true,
          access_level: 'private',
          participants: [],
          allowed_users: [],
        },
        session_messages: [],
        session_attachments: [],
        socket_token: null,
        socket_port: null,
      }),
    });
  });
};

const installFabControlMock = async (
  page: Page,
  options: { state?: string; sessionId?: string } = {}
): Promise<void> => {
  const state = options.state ?? 'paused';
  const sessionId = options.sessionId ?? SESSION_ID;
  await page.addInitScript(({ sessionId: sid, state: initialState }) => {
    const w = window as unknown as {
      __voicebotControlCalls?: string[];
      __voicebotControl?: (action: string) => void;
      __voicebotState?: { get?: () => { state?: string } };
    };
    w.__voicebotControlCalls = [];
    w.__voicebotControl = (action: string) => {
      w.__voicebotControlCalls?.push(action);
    };
    w.__voicebotState = {
      get: () => ({ state: initialState }),
    };
    window.localStorage.setItem('VOICEBOT_ACTIVE_SESSION_ID', sid);
  }, { sessionId, state });
};

const attachFabControlRecorder = async (
  page: Page,
  options: { state?: string; sessionId?: string } = {}
): Promise<void> => {
  const state = options.state ?? 'paused';
  const sessionId = options.sessionId ?? SESSION_ID;
  await page.evaluate(({ sessionId: sid, state: nextState }) => {
    const w = window as unknown as {
      __voicebotControlCalls?: string[];
      __voicebotControl?: (action: string) => Promise<void> | void;
      __voicebotState?: { get?: () => { state?: string } };
    };
    w.__voicebotControlCalls = [];
    const original = typeof w.__voicebotControl === 'function' ? w.__voicebotControl.bind(window) : null;
    const recorder = async (action: string) => {
      w.__voicebotControlCalls?.push(action);
      if (original) {
        await Promise.resolve(original(action));
      }
    };
    Object.defineProperty(window, '__voicebotControl', {
      configurable: false,
      writable: false,
      value: recorder,
    });
    w.__voicebotState = { get: () => ({ state: nextState }) };
    window.localStorage.setItem('VOICEBOT_ACTIVE_SESSION_ID', sid);
    window.dispatchEvent(
      new CustomEvent('voicebot:active-session-updated', {
        detail: {
          session_id: sid,
          source: 'playwright-test',
        },
      })
    );
  }, { sessionId, state });
};

const getFabCalls = async (page: Page): Promise<string[]> =>
  page.evaluate(() => {
    const w = window as unknown as { __voicebotControlCalls?: string[] };
    return w.__voicebotControlCalls ?? [];
  });

const controlsRow = (page: Page) =>
  page
    .locator('.voice-meeting-toolbar-buttons')
    .or(
      page
        .locator('div.flex.flex-wrap.items-center.gap-2')
        .filter({ has: page.getByRole('button', { name: /Done$/ }) })
    )
    .first();

const actionButton = (page: Page, name: string) =>
  controlsRow(page).getByRole('button', { name: new RegExp(`${name}$`) });

const mockFabScriptAsset = async (page: Page): Promise<void> => {
  await page.route('**/webrtc/webrtc-voicebot-lib.js**', async (route) => {
    const method = route.request().method().toUpperCase();
    if (method === 'HEAD') {
      await route.fulfill({
        status: 200,
        contentType: 'application/javascript',
        body: '',
        headers: {
          'content-type': 'application/javascript',
        },
      });
      return;
    }

    await route.fulfill({
      status: 200,
      contentType: 'application/javascript',
      body: `
        (function () {
          window.__voicebotFabInjectedCount = (window.__voicebotFabInjectedCount || 0) + 1;
          if (!document.getElementById('fab-wrap')) {
            const el = document.createElement('div');
            el.id = 'fab-wrap';
            el.textContent = 'FAB';
            document.body.appendChild(el);
          }
          window.__voicebotFabCleanup = function () {
            const el = document.getElementById('fab-wrap');
            if (el) el.remove();
          };
        })();
      `,
    });
  });
};

test.describe('Voice FAB lifecycle parity', () => {
  test.beforeEach(async ({ page }) => {
    await mockFabScriptAsset(page);
  });

  test('@unauth session header includes meta row and status widget', async ({ page }) => {
    await installFabControlMock(page);
    await addAuthCookie(page);
    await mockAuth(page);
    await mockSessionApis(page);
    await gotoWithBootRetry(page, `/voice/session/${SESSION_ID}`);

    const metaRow = page.locator('.voice-meeting-meta-row');
    await expect(metaRow).toBeVisible();
    await expect(metaRow.getByText('Создано', { exact: true })).toBeVisible();
    await expect(metaRow.getByText('Session ID', { exact: true })).toBeVisible();
    await expect(metaRow.getByText('Участники', { exact: true })).toBeVisible();
    await expect(metaRow.getByText('Доступ', { exact: true })).toBeVisible();

    await expect(page.getByText('Ожидание обработки сообщений').first()).toBeVisible();
    await expect(page.getByRole('button', { name: /Загрузить аудио/i }).first()).toBeVisible();
  });

  test('@unauth session action order is New / Rec / Cut / Pause / Done', async ({ page }) => {
    await installFabControlMock(page);
    await addAuthCookie(page);
    await mockAuth(page);
    await mockSessionApis(page);
    await gotoWithBootRetry(page, `/voice/session/${SESSION_ID}`);

    const expected = ['New', 'Rec', 'Cut', 'Pause', 'Done'];
    const boxes = [];
    for (const name of expected) {
      const button = actionButton(page, name);
      await expect(button).toBeVisible();
      boxes.push(await button.boundingBox());
    }

    expect(boxes.every((box) => Boolean(box))).toBeTruthy();
    const xPositions = boxes.map((box) => box!.x);
    expect([...xPositions].sort((a, b) => a - b)).toEqual(xPositions);
  });

  test('@unauth controls stay enabled on session page without local VOICEBOT token', async ({ page }) => {
    await installFabControlMock(page, { state: 'paused' });
    await addAuthCookie(page);
    await mockAuth(page);
    await mockSessionApis(page);
    await gotoWithBootRetry(page, `/voice/session/${SESSION_ID}`);

    await page.evaluate(() => {
      window.localStorage.removeItem('VOICEBOT_AUTH_TOKEN');
      window.localStorage.removeItem('auth_token');
    });

    await expect(actionButton(page, 'New')).toBeEnabled();
    await expect(actionButton(page, 'Rec')).toBeEnabled();
    await expect(actionButton(page, 'Done')).toBeEnabled();
  });

  test('@unauth New button routes action into FAB control', async ({ page }) => {
    await installFabControlMock(page);
    await addAuthCookie(page);
    await mockAuth(page);
    await mockSessionApis(page);
    await gotoWithBootRetry(page, `/voice/session/${SESSION_ID}`);
    await attachFabControlRecorder(page);

    await actionButton(page, 'New').click();
    await expect(page).toHaveURL(new RegExp(`/voice/session/${SESSION_ID}$`));
    const calls = await getFabCalls(page);
    expect(calls).toContain('new');
  });

  test('@unauth FAB stays mounted after navigation from Voice to Analytic', async ({ page }) => {
    await addAuthCookie(page);
    await mockAuth(page);
    await mockSessionApis(page);

    await gotoWithBootRetry(page, '/voice');
    await expect(page.locator('#fab-wrap')).toBeVisible();

    await page.getByRole('link', { name: /Analytic/i }).click();
    await expect(page).toHaveURL(/\/analytics$/);
    await expect(page.locator('#fab-wrap')).toBeVisible();

    const injectedCount = await page.evaluate(() => (window as { __voicebotFabInjectedCount?: number }).__voicebotFabInjectedCount ?? 0);
    expect(injectedCount).toBe(1);
  });

  test('@unauth Rec on session page activates page session then calls FAB control', async ({ page }) => {
    await installFabControlMock(page);
    await addAuthCookie(page);
    await mockAuth(page);
    await mockSessionApis(page);

    let activatePayload: Record<string, unknown> | null = null;
    await page.route('**/api/voicebot/activate_session', async (route) => {
      activatePayload = (route.request().postDataJSON() as Record<string, unknown>) ?? null;
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true }),
      });
    });

    await gotoWithBootRetry(page, `/voice/session/${SESSION_ID}`);
    await attachFabControlRecorder(page);
    await expect(actionButton(page, 'Rec')).toBeVisible();
    await actionButton(page, 'Rec').click();

    await expect.poll(() => activatePayload?.session_id).toBe(SESSION_ID);
    const calls = await getFabCalls(page);
    expect(calls).toContain('rec');
  });

  test('@unauth Rec switches active-session from another session to current page session', async ({ page }) => {
    const anotherSessionId = '507f1f77bcf86cd7994390aa';
    await installFabControlMock(page, { sessionId: anotherSessionId });
    await addAuthCookie(page);
    await mockAuth(page);
    await mockSessionApis(page);

    let activatePayload: Record<string, unknown> | null = null;
    await page.route('**/api/voicebot/activate_session', async (route) => {
      activatePayload = (route.request().postDataJSON() as Record<string, unknown>) ?? null;
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true }),
      });
    });

    await gotoWithBootRetry(page, `/voice/session/${SESSION_ID}`);
    await attachFabControlRecorder(page, { sessionId: anotherSessionId });

    await page.evaluate(() => {
      const win = window as unknown as {
        __voicebotActiveSessionEvents?: string[];
      };
      win.__voicebotActiveSessionEvents = [];
      window.addEventListener('voicebot:active-session-updated', (event) => {
        const detail = (event as CustomEvent<{ session_id?: string }>).detail;
        if (typeof detail?.session_id === 'string') {
          win.__voicebotActiveSessionEvents?.push(detail.session_id);
        }
      });
    });

    await actionButton(page, 'Rec').click();

    await expect.poll(() => activatePayload?.session_id).toBe(SESSION_ID);
    await expect.poll(() =>
      page.evaluate(() => {
        const win = window as unknown as {
          __voicebotActiveSessionEvents?: string[];
        };
        return win.__voicebotActiveSessionEvents ?? [];
      })
    ).toContain(SESSION_ID);

    const calls = await getFabCalls(page);
    expect(calls).toContain('rec');
  });

  test('@unauth button enablement follows recording state contract', async ({ page }) => {
    await installFabControlMock(page, { state: 'recording' });
    await addAuthCookie(page);
    await mockAuth(page);
    await mockSessionApis(page);
    await gotoWithBootRetry(page, `/voice/session/${SESSION_ID}`);
    await attachFabControlRecorder(page, { state: 'recording' });

    await page.evaluate((sessionId) => {
      const win = window as unknown as {
        __voicebotState?: { get?: () => { state?: string } };
      };
      win.__voicebotState = { get: () => ({ state: 'recording' }) };
      window.localStorage.setItem('VOICEBOT_ACTIVE_SESSION_ID', sessionId);
      window.dispatchEvent(
        new CustomEvent('voicebot:active-session-updated', {
          detail: {
            session_id: sessionId,
            source: 'playwright-test-force-recording',
          },
        })
      );
    }, SESSION_ID);

    await expect(actionButton(page, 'New')).toBeDisabled();
    await expect(actionButton(page, 'Rec')).toBeDisabled();
    await expect(actionButton(page, 'Cut')).toBeEnabled();
    await expect(actionButton(page, 'Pause')).toBeEnabled();
    await expect(actionButton(page, 'Done')).toBeEnabled();
  });

  test('@unauth Pause keeps controls busy until FAB pause resolves (upload-wait semantics)', async ({ page }) => {
    await installFabControlMock(page, { state: 'recording' });
    await addAuthCookie(page);
    await mockAuth(page);
    await mockSessionApis(page);
    await gotoWithBootRetry(page, `/voice/session/${SESSION_ID}`);

    await page.evaluate(({ sessionId }) => {
      const win = window as unknown as {
        __voicebotControlCalls?: string[];
        __voicebotControl?: (action: string) => Promise<void>;
        __voicebotState?: { get?: () => { state?: string } };
        __resolvePauseGate?: () => void;
      };

      win.__voicebotControlCalls = [];
      let pauseResolver: (() => void) | null = null;

      win.__voicebotControl = async (action: string) => {
        win.__voicebotControlCalls?.push(action);
        if (action !== 'pause') return;
        await new Promise<void>((resolve) => {
          pauseResolver = resolve;
        });
        win.__voicebotState = { get: () => ({ state: 'paused' }) };
      };

      win.__resolvePauseGate = () => {
        if (pauseResolver) {
          pauseResolver();
          pauseResolver = null;
        }
      };

      win.__voicebotState = { get: () => ({ state: 'recording' }) };
      window.localStorage.setItem('VOICEBOT_ACTIVE_SESSION_ID', sessionId);
      window.dispatchEvent(
        new CustomEvent('voicebot:active-session-updated', {
          detail: {
            session_id: sessionId,
            source: 'playwright-pause-gate',
          },
        })
      );
    }, { sessionId: SESSION_ID });

    await expect(actionButton(page, 'Pause')).toBeEnabled();
    await actionButton(page, 'Pause').click();

    await expect(actionButton(page, 'Done')).toBeDisabled();
    await expect(actionButton(page, 'New')).toBeDisabled();
    await expect(actionButton(page, 'Rec')).toBeDisabled();

    await page.evaluate(() => {
      const win = window as unknown as { __resolvePauseGate?: () => void };
      win.__resolvePauseGate?.();
    });

    await expect(actionButton(page, 'Done')).toBeEnabled();
    const calls = await getFabCalls(page);
    expect(calls).toContain('pause');
  });

  test('@unauth Done button routes action into FAB control', async ({ page }) => {
    await installFabControlMock(page);
    await addAuthCookie(page);
    await mockAuth(page);
    await mockSessionApis(page);
    await page.route('**/api/voicebot/activate_session', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true }),
      });
    });

    await gotoWithBootRetry(page, `/voice/session/${SESSION_ID}`);
    await attachFabControlRecorder(page);
    await expect(actionButton(page, 'New')).toBeVisible();
    await expect(actionButton(page, 'Done')).toBeVisible();
    await actionButton(page, 'Done').click();

    const calls = await getFabCalls(page);
    expect(calls).toContain('done');
  });

  test('@unauth sessions cleanup flow deletes created test session row', async ({ page }) => {
    await addAuthCookie(page);
    await mockAuth(page, { permissions: ['system:admin_panel'] });

    await page.route('**/api/voicebot/projects**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([]),
      });
    });
    await page.route('**/api/voicebot/persons/list**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([]),
      });
    });

    const createdSessionId = '507f1f77bcf86cd7994390ff';
    const sessions = [
      {
        _id: createdSessionId,
        session_name: 'Playwright Temp Session',
        created_at: '2026-02-19T10:00:00.000Z',
        is_active: true,
        access_level: 'private',
        participants: [],
        allowed_users: [],
        message_count: 1,
      },
    ];

    let deletePayload: Record<string, unknown> | null = null;
    await page.route('**/api/voicebot/sessions/list**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(sessions),
      });
    });
    await page.route('**/api/voicebot/sessions/delete**', async (route) => {
      deletePayload = (route.request().postDataJSON() as Record<string, unknown>) ?? null;
      const sessionId = typeof deletePayload?.session_id === 'string' ? deletePayload.session_id : '';
      const idx = sessions.findIndex((item) => item._id === sessionId);
      if (idx >= 0) sessions.splice(idx, 1);
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true }),
      });
    });

    await gotoWithBootRetry(page, '/voice');
    await expect(page.getByText('Playwright Temp Session')).toBeVisible();
    const sessionRow = page.locator('tr').filter({ hasText: 'Playwright Temp Session' }).first();
    await expect(sessionRow).toBeVisible();

    await sessionRow.getByTitle('Меню').click();
    await page.getByText('Удалить сессию').first().click();
    await page.getByRole('button', { name: /^Да$/ }).click();

    await expect.poll(() => deletePayload?.session_id).toBe(createdSessionId);
    await expect(sessionRow).toHaveCount(0);
    expect(sessions).toHaveLength(0);
  });
});
