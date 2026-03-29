import { expect, test, type Page } from '@playwright/test';

const BASE_URL = process.env.PLAYWRIGHT_BASE_URL ?? 'http://127.0.0.1:3002';

async function mockAgentsShellAuth(page: Page): Promise<void> {
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
            permissions: [],
          },
        },
      }),
    });
  });
}

async function addAuthCookie(page: Page): Promise<void> {
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
}

async function installAcpSocketHarness(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const handlers = new Map<string, (...args: unknown[]) => void>();
    const socket = {
      connected: false,
      auth: {} as Record<string, unknown>,
      on(event: string, handler: (...args: unknown[]) => void) {
        handlers.set(event, handler);
        return socket;
      },
      off(event: string) {
        handlers.delete(event);
        return socket;
      },
      emit() {
        return true;
      },
      connect() {
        socket.connected = true;
        handlers.get('connect')?.();
        return socket;
      },
      disconnect() {
        socket.connected = false;
        handlers.get('disconnect')?.();
        return socket;
      },
    };

    (window as unknown as { __ACP_SOCKET_FACTORY__?: (authToken?: string | null) => unknown }).__ACP_SOCKET_FACTORY__ = (
      authToken?: string | null,
    ) => {
      socket.auth = authToken ? { token: authToken } : {};
      return socket;
    };
  });
}

async function stubShellRuntimeNoise(page: Page): Promise<void> {
  await page.route('**/webrtc/webrtc-voicebot-lib.js', async (route) => {
    if (route.request().method() === 'HEAD') {
      await route.fulfill({ status: 204, body: '' });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/javascript',
      body: 'window.__voicebotFabCleanup = () => {};',
    });
  });
}

test.describe('Agents shell @unauth', () => {
  test('keeps the real /agents host shell inside the mobile viewport', async ({ page }) => {
    const pageErrors: string[] = [];
    const requestFailures: string[] = [];
    const responseFailures: string[] = [];

    page.on('pageerror', (err) => pageErrors.push(err.message || String(err)));
    page.on('requestfailed', (request) => {
      const failure = request.failure()?.errorText ?? 'unknown';
      requestFailures.push(`${request.url()} :: ${failure}`);
    });
    page.on('response', (response) => {
      if (response.status() >= 400) {
        responseFailures.push(`${response.status()} :: ${response.url()}`);
      }
    });

    await page.setViewportSize({ width: 414, height: 896 });
    await installAcpSocketHarness(page);
    await stubShellRuntimeNoise(page);
    await mockAgentsShellAuth(page);
    await addAuthCookie(page);

    await page.goto('/agents');
    await page.waitForLoadState('networkidle');

    await expect(page).not.toHaveURL(/\/login/);
    await expect(page.getByRole('button', { name: /expand sidebar|collapse sidebar/i })).toBeVisible();
    await expect(page.getByRole('textbox', { name: 'Message input' })).toBeVisible();

    const dimensions = await page.evaluate(() => ({
      innerWidth: window.innerWidth,
      scrollWidth: document.documentElement.scrollWidth,
      bodyScrollWidth: document.body.scrollWidth,
    }));

    expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.innerWidth + 1);
    expect(dimensions.bodyScrollWidth).toBeLessThanOrEqual(dimensions.innerWidth + 1);

    const relevantRequestFailures = requestFailures.filter(
      (entry) =>
        !entry.includes('fonts.googleapis.com') &&
        !entry.includes('/webrtc/webrtc-voicebot-lib.js'),
    );
    const relevantResponseFailures = responseFailures.filter(
      (entry) => !entry.endsWith(':: http://127.0.0.1:4173/favicon.ico') && !entry.includes('/favicon.ico'),
    );

    expect(pageErrors, `page errors:\n${pageErrors.join('\n')}`).toEqual([]);
    expect(
      relevantRequestFailures,
      `request failures:\n${relevantRequestFailures.join('\n')}`,
    ).toEqual([]);
    expect(
      relevantResponseFailures,
      `response failures:\n${relevantResponseFailures.join('\n')}`,
    ).toEqual([]);
  });
});
