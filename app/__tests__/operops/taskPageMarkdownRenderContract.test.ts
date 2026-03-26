import React, { act, createElement, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { execFileSync } from 'node:child_process';

const navigateMock = jest.fn();
const fetchTicketByIdMock = jest.fn(async () => currentTask);
const fetchDictionaryMock = jest.fn(async () => undefined);
const deleteTicketAttachmentMock = jest.fn(async () => undefined);

let currentTask: Record<string, unknown>;

jest.mock('react-markdown', () => ({
  __esModule: true,
  default: ({ children }: { children: unknown }) =>
    createElement('div', { 'data-testid': 'markdown-render' }, children),
}));

jest.mock('remark-gfm', () => ({
  __esModule: true,
  default: () => null,
}));

jest.mock('react-router-dom', () => ({
  useNavigate: () => navigateMock,
  useParams: () => ({ taskId: 'task-1' }),
}));

jest.mock('../../src/store/kanbanStore', () => ({
  useKanbanStore: () => ({
    performers: [],
    fetchTicketById: fetchTicketByIdMock,
    fetchDictionary: fetchDictionaryMock,
    epics: {},
    projectsData: [],
    deleteTicketAttachment: deleteTicketAttachmentMock,
  }),
}));

jest.mock('../../src/store/authStore', () => ({
  useAuthStore: () => ({
    isAuth: true,
    loading: false,
  }),
}));

import TaskPage, { shouldRenderLegacyHtmlDescriptionText } from '../../src/pages/operops/TaskPage';

type RenderHandle = {
  container: HTMLDivElement;
  unmount: () => void;
};

const buildTask = (patch: Partial<Record<string, unknown>> = {}): Record<string, unknown> => ({
  _id: 'task-1',
  name: 'OperOps markdown regression task',
  task_status: 'New',
  performer: null,
  created_at: '2026-03-26T06:00:00Z',
  updated_at: '2026-03-26T06:05:00Z',
  description: '',
  comments_list: [],
  work_data: [],
  attachments: [],
  source_data: {},
  discussion_sessions: [],
  ...patch,
});

const renderIntoDom = (node: ReactElement): RenderHandle => {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root: Root = createRoot(container);

  act(() => {
    root.render(node);
  });

  return {
    container,
    unmount: () => {
      act(() => {
        root.unmount();
      });
      container.remove();
    },
  };
};

const flushEffects = async (): Promise<void> => {
  await act(async () => {
    await Promise.resolve();
  });
};

const renderMarkdownWithRealEsmStack = (markdown: string): string => {
  const script = `
    import React from 'react';
    import { renderToStaticMarkup } from 'react-dom/server';
    import ReactMarkdown from 'react-markdown';
    import remarkGfm from 'remark-gfm';

    const value = process.env.MARKDOWN_INPUT ?? '';
    const html = renderToStaticMarkup(
      React.createElement(ReactMarkdown, { remarkPlugins: [remarkGfm] }, value)
    );
    process.stdout.write(html);
  `;

  return execFileSync('node', ['--input-type=module', '-e', script], {
    cwd: process.cwd(),
    encoding: 'utf8',
    env: {
      ...process.env,
      MARKDOWN_INPUT: markdown,
    },
  }).trim();
};

describe('TaskPage markdown/html rendering behavior', () => {
  beforeAll(() => {
    Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', {
      writable: true,
      value: true,
    });

    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      value: jest.fn().mockImplementation(() => ({
        matches: false,
        media: '',
        onchange: null,
        addListener: jest.fn(),
        removeListener: jest.fn(),
        addEventListener: jest.fn(),
        removeEventListener: jest.fn(),
        dispatchEvent: jest.fn(),
      })),
    });

    class ResizeObserverMock {
      observe(): void {}
      unobserve(): void {}
      disconnect(): void {}
    }

    Object.defineProperty(globalThis, 'ResizeObserver', {
      writable: true,
      value: ResizeObserverMock,
    });
  });

  beforeEach(() => {
    currentTask = buildTask();
  });

  afterEach(() => {
    fetchTicketByIdMock.mockClear();
    fetchDictionaryMock.mockClear();
    deleteTicketAttachmentMock.mockClear();
    navigateMock.mockClear();
    document.body.innerHTML = '';
  });

  it('renders legacy inline html formatting tags via sanitized html path', async () => {
    currentTask = buildTask({
      description: 'Legacy <strong>bold</strong> and <em>italic</em> <script>alert(1)</script>',
    });

    const view = renderIntoDom(createElement(TaskPage));

    try {
      await flushEffects();

      expect(fetchTicketByIdMock).toHaveBeenCalledWith('task-1');
      expect(view.container.querySelector('strong')?.textContent).toBe('bold');
      expect(view.container.querySelector('em')?.textContent).toBe('italic');
      expect(view.container.innerHTML).not.toContain('<script');
      expect(view.container.querySelector('[data-testid="markdown-render"]')).toBeNull();
    } finally {
      view.unmount();
    }
  });

  it('routes description and comments through markdown rendering even for subtle markdown syntax', async () => {
    currentTask = buildTask({
      description: 'Description with single-star markdown: *important*',
      comments_list: [
        {
          comment: 'Comment also has single-star markdown: *careful*',
          created_at: '2026-03-26T06:10:00Z',
          author: { name: 'Reviewer' },
        },
      ],
    });

    const view = renderIntoDom(createElement(TaskPage));

    try {
      await flushEffects();

      const markdownNodes = Array.from(view.container.querySelectorAll('[data-testid="markdown-render"]'));
      expect(markdownNodes.length).toBeGreaterThanOrEqual(2);
      expect(markdownNodes.some((node) => node.textContent?.includes('*important*'))).toBe(true);
      expect(markdownNodes.some((node) => node.textContent?.includes('*careful*'))).toBe(true);
      expect(view.container.textContent).toContain('Description with single-star markdown:');
      expect(view.container.textContent).toContain('Comment also has single-star markdown:');
    } finally {
      view.unmount();
    }
  });

  it('does not switch to legacy html path when html-like tags appear inside markdown code spans', async () => {
    currentTask = buildTask({
      description: 'Use `<strong>` in markdown code and keep *emphasis* in markdown flow',
      comments_list: [],
    });

    const view = renderIntoDom(createElement(TaskPage));

    try {
      await flushEffects();

      // Must stay in markdown rendering path despite html-like token in code span.
      expect(view.container.querySelector('[data-testid="markdown-render"]')).not.toBeNull();
      expect(view.container.querySelector('strong')).toBeNull();
      expect(view.container.textContent).toContain('Use `<strong>` in markdown code');
    } finally {
      view.unmount();
    }
  });

  it('keeps markdown path when allowed html tags are mixed with markdown semantics', async () => {
    currentTask = buildTask({
      description: 'Discuss <strong>pricing</strong> and *scope* in one markdown note',
      comments_list: [],
    });

    const view = renderIntoDom(createElement(TaskPage));

    try {
      await flushEffects();

      expect(view.container.querySelector('[data-testid="markdown-render"]')).not.toBeNull();
      expect(view.container.querySelector('strong')).toBeNull();
      expect(view.container.textContent).toContain('Discuss <strong>pricing</strong> and *scope*');
    } finally {
      view.unmount();
    }
  });

  it('normalizes escaped newlines for description and comments before markdown rendering', async () => {
    currentTask = buildTask({
      description: 'Line one\\r\\nLine two\\rLine three',
      comments_list: [
        {
          comment: 'Comment row A\\nComment row B\\r\\nComment row C',
          created_at: '2026-03-26T06:10:00Z',
          author: { name: 'Reviewer' },
        },
      ],
    });

    const view = renderIntoDom(createElement(TaskPage));

    try {
      await flushEffects();

      const markdownNodes = Array.from(view.container.querySelectorAll('[data-testid="markdown-render"]'));
      expect(markdownNodes.some((node) => (node.textContent || '').includes('Line one\nLine two\rLine three'))).toBe(true);
      expect(markdownNodes.some((node) => (node.textContent || '').includes('Comment row A\nComment row B\nComment row C'))).toBe(true);
    } finally {
      view.unmount();
    }
  });

  it('legacy html routing helper rejects mixed markdown+html and accepts pure legacy html', () => {
    expect(shouldRenderLegacyHtmlDescriptionText('Legacy <strong>bold</strong> and <em>italic</em>')).toBe(true);
    expect(shouldRenderLegacyHtmlDescriptionText('Discuss <strong>pricing</strong> and *scope*')).toBe(false);
    expect(shouldRenderLegacyHtmlDescriptionText('Discuss <strong>pricing</strong> and `scope` snippet')).toBe(false);
  });

  it('keeps real react-markdown + remark-gfm parsing behavior for emphasis and code spans', () => {
    const rendered = renderMarkdownWithRealEsmStack(
      'Description with *important* and code `<strong>` markers'
    );

    expect(rendered).toContain('<em>important</em>');
    expect(rendered).toContain('<code>&lt;strong&gt;</code>');
    expect(rendered).not.toContain('<strong>');
  });
});
