import fs from 'node:fs';

import { describe, expect, it } from '@jest/globals';

describe('MediaGen routing contract', () => {
  it('keeps legacy and active MediaGen project ids in the prod and test routing buckets', () => {
    const prodRouting = JSON.parse(
      fs.readFileSync('/home/strato-space/settings/routing-prod.json', 'utf8'),
    ) as Array<Record<string, unknown>>;
    const testRouting = JSON.parse(
      fs.readFileSync('/home/strato-space/settings/routing-test.json', 'utf8'),
    ) as Array<Record<string, unknown>>;

    const prodBucket = prodRouting.find((item) => item.topic === 'MediaGen');
    const testBucket = testRouting.find((item) => item.topic === 'MediaGenFab');

    expect(prodBucket).toBeTruthy();
    expect(testBucket).toBeTruthy();

    const getProjectIds = (item: Record<string, unknown>) =>
      (Array.isArray(item.sources) ? item.sources : [])
        .map((source) =>
          source && typeof source === 'object' && 'project' in source
            ? (source as { project?: { project_id?: string } }).project?.project_id || null
            : null,
        )
        .filter((value): value is string => Boolean(value));

    expect(getProjectIds(prodBucket as Record<string, unknown>)).toEqual(
      expect.arrayContaining(['68c1379c29d21cac0a3ee872', '698af98806b3a6762286b867']),
    );
    expect(getProjectIds(testBucket as Record<string, unknown>)).toEqual(
      expect.arrayContaining(['68c1379c29d21cac0a3ee872', '698af98806b3a6762286b867']),
    );
  });

  it('maps MediaGen and MediaGenFab aliases to the active MediaGen project in checked-in crosswalk data', () => {
    const chatMembers = JSON.parse(
      fs.readFileSync('/home/strato-space/settings/chat-members.json', 'utf8'),
    ) as { 'project-crosswalk'?: Array<Record<string, unknown>> };

    const row = (chatMembers['project-crosswalk'] || []).find(
      (item) => item.voice_project_id === '698af98806b3a6762286b867',
    );

    expect(row).toBeTruthy();
    expect(row?.voice_project_name).toBe('MediaGen');
    expect(row?.routing_topic).toBe('MediaGen');
    expect(row?.sheet_aliases).toEqual(
      expect.arrayContaining(['MediaGen', 'MediaGenFab', 'MediaGen / MediaGenFab']),
    );
  });
});
