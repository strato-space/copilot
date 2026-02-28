import { describe, expect, it } from '@jest/globals';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import PageHeader from '../../src/components/PageHeader';

describe('PageHeader', () => {
  it('renders required title with base layout class', () => {
    const html = renderToStaticMarkup(<PageHeader title="Finance Ops" />);

    expect(html).toContain('finops-page-header');
    expect(html).toContain('Finance Ops');
  });

  it('renders optional actions, description, and extra blocks when provided', () => {
    const html = renderToStaticMarkup(
      <PageHeader
        title="Voice"
        description={<span>Realtime updates enabled</span>}
        actions={<button type="button">Create</button>}
        extra={<div data-testid="extra">Filters</div>}
      />,
    );

    expect(html).toContain('finops-header-actions');
    expect(html).toContain('Create');
    expect(html).toContain('Realtime updates enabled');
    expect(html).toContain('data-testid="extra"');
    expect(html).toContain('Filters');
  });

  it('omits optional wrappers when optional props are missing', () => {
    const html = renderToStaticMarkup(<PageHeader title="OperOps" />);

    expect(html).not.toContain('finops-header-actions');
    expect(html).not.toContain('mt-2 text-sm text-slate-600');
    expect(html).not.toContain('mt-3');
  });
});
