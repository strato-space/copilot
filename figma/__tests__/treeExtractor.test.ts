import { extractFileTreeSnapshot, flattenTreeSnapshot } from '../src/services/treeExtractor.js';

describe('treeExtractor', () => {
  it('extracts file -> page -> section tree and flattens it', () => {
    const snapshot = extractFileTreeSnapshot({
      fileKey: 'file-123',
      fileName: 'Design System',
      depth: 2,
      response: {
        version: '42',
        document: {
          id: '0:0',
          name: 'Root',
          type: 'DOCUMENT',
          children: [
            {
              id: '1:1',
              name: 'Page A',
              type: 'CANVAS',
              children: [
                { id: '2:1', name: 'Hero', type: 'SECTION' },
                { id: '2:2', name: 'Ignored frame', type: 'FRAME' },
              ],
            },
            {
              id: '1:2',
              name: 'Page B',
              type: 'CANVAS',
              children: [{ id: '2:3', name: 'Footer', type: 'SECTION' }],
            },
          ],
        },
      },
    });

    expect(snapshot.pages).toHaveLength(2);
    expect(snapshot.pages[0]?.sections).toHaveLength(1);
    expect(snapshot.pages[0]?.sections[0]?.path).toBe('Page A / Hero');

    const flat = flattenTreeSnapshot(snapshot);
    expect(flat.map((row) => row.node_type)).toEqual(['FILE', 'PAGE', 'SECTION', 'PAGE', 'SECTION']);
  });
});
