import { describe, expect, it } from '@jest/globals';

import {
  extractVoiceTaskCreateErrorText,
  extractVoiceTaskCreateRowErrors,
} from '../../src/utils/voiceTaskCreation';

describe('voice task creation error parser', () => {
  it('parses invalid_rows performer validation errors from backend payload', () => {
    const parsed = extractVoiceTaskCreateRowErrors({
      error: 'No valid tasks to create tickets',
      invalid_rows: [
        {
          index: 0,
          ticket_id: 'task-1',
          field: 'performer_id',
          reason: 'invalid_performer_id',
          message: 'Некорректный performer_id: ожидается Mongo ObjectId',
          performer_id: 'codex-system',
        },
      ],
    });

    expect(parsed).toEqual([
      {
        index: 0,
        ticketId: 'task-1',
        field: 'performer_id',
        reason: 'invalid_performer_id',
        message: 'Некорректный performer_id: ожидается Mongo ObjectId',
        performerId: 'codex-system',
        projectId: '',
      },
    ]);
  });

  it('parses codex project git_repo guard errors as row-level project_id validation', () => {
    const parsed = extractVoiceTaskCreateRowErrors({
      error: 'No valid tasks to create tickets',
      invalid_rows: [
        {
          index: 1,
          ticket_id: 'task-2',
          field: 'project_id',
          reason: 'codex_project_git_repo_required',
          message: 'Для задач Codex у проекта должен быть git_repo',
          performer_id: '507f1f77bcf86cd799439021',
          project_id: '507f1f77bcf86cd799439022',
        },
      ],
    });

    expect(parsed).toEqual([
      {
        index: 1,
        ticketId: 'task-2',
        field: 'project_id',
        reason: 'codex_project_git_repo_required',
        message: 'Для задач Codex у проекта должен быть git_repo',
        performerId: '507f1f77bcf86cd799439021',
        projectId: '507f1f77bcf86cd799439022',
      },
    ]);
  });

  it('extracts backend error text for UI message rendering', () => {
    expect(extractVoiceTaskCreateErrorText({ error: 'No valid tasks to create tickets' })).toBe(
      'No valid tasks to create tickets'
    );
    expect(extractVoiceTaskCreateErrorText({})).toBe('');
  });
});
