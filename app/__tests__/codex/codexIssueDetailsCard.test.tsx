import { describe, expect, it } from '@jest/globals';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import CodexIssueDetailsCard from '../../src/components/codex/CodexIssueDetailsCard';

jest.mock('remark-gfm', () => ({
  __esModule: true,
  default: () => null,
}));

jest.mock('react-markdown', () => ({
  __esModule: true,
  default: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
}));

describe('CodexIssueDetailsCard comments section', () => {
  it('does not render Comments section when comments are missing', () => {
    const html = renderToStaticMarkup(
      <CodexIssueDetailsCard
        issue={{
          id: 'copilot-74xk',
          title: 'UI issue',
        }}
      />,
    );

    expect(html).not.toContain('Comments');
    expect(html).not.toContain('Нет комментариев');
  });

  it('renders existing comments with author and text', () => {
    const html = renderToStaticMarkup(
      <CodexIssueDetailsCard
        issue={{
          id: 'copilot-74xk',
          title: 'UI issue',
          comments: [
            {
              id: '1',
              author: 'operator',
              created_at: '2026-03-23T09:00:00.000Z',
              text: 'Комментарий по задаче',
            },
          ],
        }}
      />,
    );

    expect(html).toContain('Comments');
    expect(html).toContain('operator');
    expect(html).toContain('Комментарий по задаче');
    expect(html).not.toContain('Нет комментариев');
  });
});
