import { expect, test } from '@playwright/test';

test.describe('Agents harness @unauth', () => {
  test('renders ACP UI kernel without auth or MCP fallback', async ({ page }) => {
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

    await page.goto('/__harness/agents');

    await expect(page.getByRole('textbox', { name: 'Message input' })).toBeVisible();
    await expect(page.getByText('ACP v0.1.35')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Input · Explain ACP request' })).toBeVisible();
    await expect(page.getByText('Show 1 more tool')).toBeVisible();

    const hasAcpUiStylesheetRules = await page.evaluate(() => {
      for (const sheet of Array.from(document.styleSheets)) {
        try {
          for (const rule of Array.from(sheet.cssRules)) {
            const cssText = rule.cssText || '';
            if (
              cssText.includes('#acp-root textarea:focus-visible') ||
              cssText.includes('.bg-input') ||
              cssText.includes('.text-input-foreground')
            ) {
              return true;
            }
          }
        } catch {
          // Ignore cross-origin stylesheets and continue checking local bundles.
        }
      }
      return false;
    });

    expect(hasAcpUiStylesheetRules).toBe(true);

    await page.getByRole('button', { name: 'Open sidebar' }).click();
    await page.waitForTimeout(350);
    await expect(page.getByText('Ping', { exact: true })).toBeVisible();

    const relevantRequestFailures = requestFailures.filter(
      (entry) => !entry.includes('fonts.googleapis.com'),
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

  test('stays within the mobile viewport without horizontal overflow', async ({ page }) => {
    await page.setViewportSize({ width: 414, height: 896 });
    await page.goto('/__harness/agents');

    await expect(page.getByRole('textbox', { name: 'Message input' })).toBeVisible();

    const dimensions = await page.evaluate(() => ({
      innerWidth: window.innerWidth,
      scrollWidth: document.documentElement.scrollWidth,
      bodyScrollWidth: document.body.scrollWidth,
    }));

    expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.innerWidth + 1);
    expect(dimensions.bodyScrollWidth).toBeLessThanOrEqual(dimensions.innerWidth + 1);
  });
});
