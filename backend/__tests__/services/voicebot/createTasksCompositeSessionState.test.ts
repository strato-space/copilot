import { describe, expect, it } from '@jest/globals';

import { resolveCreateTasksNoTaskDecisionOutcome } from '../../../src/services/voicebot/createTasksCompositeSessionState.js';

describe('resolveCreateTasksNoTaskDecisionOutcome', () => {
  it('returns null when composite emits link_existing_tasks without draft rows', () => {
    const result = resolveCreateTasksNoTaskDecisionOutcome({
      decision: null,
      extractedTaskCount: 0,
      persistedTaskCount: 0,
      extractedLinkCount: 1,
      extractedCommentCount: 0,
      hasSummary: true,
      hasReview: true,
    });

    expect(result).toBeNull();
  });

  it('returns null when composite emits enrichment comments without draft rows', () => {
    const result = resolveCreateTasksNoTaskDecisionOutcome({
      decision: null,
      extractedTaskCount: 0,
      persistedTaskCount: 0,
      extractedLinkCount: 0,
      extractedCommentCount: 2,
      hasSummary: true,
      hasReview: true,
    });

    expect(result).toBeNull();
  });

  it('still infers a no-task outcome when there are no drafts or side effects', () => {
    const result = resolveCreateTasksNoTaskDecisionOutcome({
      decision: null,
      extractedTaskCount: 0,
      persistedTaskCount: 0,
      extractedLinkCount: 0,
      extractedCommentCount: 0,
      hasSummary: false,
      hasReview: true,
    });

    expect(result).toEqual(
      expect.objectContaining({
        code: 'no_task_reason_missing',
        inferred: true,
        source: 'agent_inferred',
      })
    );
  });
});
