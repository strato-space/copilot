import { describe, expect, it, jest } from '@jest/globals';
import { TextDecoder, TextEncoder } from 'node:util';

jest.mock('../../src/store/kanbanStore', () => ({
  useKanbanStore: () => ({
    performers: [],
    fetchTicketById: jest.fn(),
    fetchDictionary: jest.fn(),
    epics: {},
    projectsData: [],
  }),
}));

jest.mock('../../src/store/crmStore', () => ({
  useCRMStore: () => ({
    setEditingTicket: jest.fn(),
  }),
}));

jest.mock('../../src/store/authStore', () => ({
  useAuthStore: () => ({
    isAuth: true,
    loading: false,
  }),
}));

const ensureTextEncodingGlobals = () => {
  if (!globalThis.TextEncoder) {
    Object.defineProperty(globalThis, 'TextEncoder', {
      configurable: true,
      writable: true,
      value: TextEncoder,
    });
  }
  if (!globalThis.TextDecoder) {
    Object.defineProperty(globalThis, 'TextDecoder', {
      configurable: true,
      writable: true,
      value: TextDecoder,
    });
  }
};

const getSanitizeTaskDescriptionHtml = async () => {
  ensureTextEncodingGlobals();
  const module = await import('../../src/pages/operops/TaskPage');
  return module.sanitizeTaskDescriptionHtml;
};

describe('TaskPage description sanitization behavior', () => {
  it('removes unsafe scripts/attributes while preserving allowed links', async () => {
    const sanitizeTaskDescriptionHtml = await getSanitizeTaskDescriptionHtml();
    const html = [
      '<p>Hello</p>',
      '<script>alert(1)</script>',
      '<a href="javascript:alert(1)">bad</a>',
      '<a href="https://copilot.stratospace.fun" target="_blank">good</a>',
      '<img src="https://copilot.stratospace.fun/image.png" onerror="alert(1)" />',
    ].join('');

    const sanitized = sanitizeTaskDescriptionHtml(html);

    expect(sanitized).not.toContain('<script');
    expect(sanitized).not.toContain('javascript:');
    expect(sanitized).not.toContain('onerror=');
    expect(sanitized).toContain('href="https://copilot.stratospace.fun"');
    expect(sanitized).toContain('rel="noopener noreferrer"');
  });

  it('returns empty string for empty-ish inputs', async () => {
    const sanitizeTaskDescriptionHtml = await getSanitizeTaskDescriptionHtml();
    expect(sanitizeTaskDescriptionHtml(undefined)).toBe('');
    expect(sanitizeTaskDescriptionHtml(null)).toBe('');
    expect(sanitizeTaskDescriptionHtml('')).toBe('');
  });

  it('drops non-http image schemes and keeps http/https images', async () => {
    const sanitizeTaskDescriptionHtml = await getSanitizeTaskDescriptionHtml();
    const html = [
      '<img src="data:image/png;base64,AAAA" alt="inline" />',
      '<img src="http://copilot.stratospace.fun/image.png" alt="http" />',
      '<img src="https://copilot.stratospace.fun/image.png" alt="https" />',
    ].join('');

    const sanitized = sanitizeTaskDescriptionHtml(html);

    expect(sanitized).not.toContain('data:image/png');
    expect(sanitized).toContain('src="http://copilot.stratospace.fun/image.png"');
    expect(sanitized).toContain('src="https://copilot.stratospace.fun/image.png"');
  });
});
