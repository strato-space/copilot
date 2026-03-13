import { describe, expect, it } from '@jest/globals';

import { extractRoutingProjectSources } from '../../src/utils/routingConfig.js';

describe('routingConfig', () => {
  it('extracts all unique project sources from one routing item', () => {
    const result = extractRoutingProjectSources({
      sources: [
        { project: { project_id: 'legacy-id', name: 'MediaGenFab' } },
        { github: { url: 'https://github.com/strato-space/mediagen', path: '.' } },
        { project: { project_id: 'active-id', name: 'MediaGen', alias: 'MediaGenFab' } },
        { project: { project_id: 'active-id', name: 'MediaGen', alias: 'MediaGenFab' } },
      ],
    });

    expect(result).toEqual([
      {
        project_id: 'legacy-id',
        name: 'MediaGenFab',
        alias: null,
      },
      {
        project_id: 'active-id',
        name: 'MediaGen',
        alias: 'MediaGenFab',
      },
    ]);
  });

  it('ignores malformed project sources', () => {
    const result = extractRoutingProjectSources({
      sources: [
        null,
        {},
        { project: {} },
        { project: { project_id: '   ' } },
      ],
    });

    expect(result).toEqual([]);
  });
});
