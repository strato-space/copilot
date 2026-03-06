import type { Ticket } from '../../src/types/crm';
import { buildVoiceBacklogGroups, isVoiceBacklogTask } from '../../src/pages/operops/voiceTabGrouping';

describe('OperOps Voice tab grouping behavior', () => {
  const sessionId = '65f0aabbccddeeff00112233';
  const sessionUrl = `https://copilot.stratospace.fun/voice/session/${sessionId}`;

  const makeTicket = (overrides: Partial<Ticket>): Ticket => ({
    _id: overrides._id ?? Math.random().toString(36).slice(2),
    id: overrides.id ?? `task-${Math.random().toString(36).slice(2)}`,
    name: overrides.name ?? 'Task',
    project: overrides.project ?? 'Alpha',
    task_status: overrides.task_status ?? 'Backlog',
    ...(overrides.project_id ? { project_id: overrides.project_id } : {}),
    ...(overrides.source ? { source: overrides.source } : {}),
    ...(overrides.source_data ? { source_data: overrides.source_data } : {}),
    ...(overrides.source_kind ? { source_kind: overrides.source_kind } : {}),
    ...(overrides.source_ref ? { source_ref: overrides.source_ref } : {}),
    ...(overrides.external_ref ? { external_ref: overrides.external_ref } : {}),
    ...(overrides.updated_at ? { updated_at: overrides.updated_at } : {}),
    ...(overrides.created_at ? { created_at: overrides.created_at } : {}),
    ...(overrides.performer ? { performer: overrides.performer } : {}),
    ...(overrides.priority ? { priority: overrides.priority } : {}),
    ...(overrides.description ? { description: overrides.description } : {}),
  });

  it('keeps only NEW_0 tasks in the grouped dataset, including orphan non-voice rows', () => {
    const voiceTicket = makeTicket({
      id: 'voice-1',
      source: 'VOICE_BOT',
      source_data: { session_id: sessionId },
    });
    const nonVoiceTicket = makeTicket({ id: 'manual-1', source: 'manual' });
    const nonBacklogTicket = makeTicket({ id: 'voice-2', source: 'VOICE_BOT', task_status: 'Ready' });

    expect(isVoiceBacklogTask(voiceTicket)).toBe(true);
    expect(isVoiceBacklogTask(nonVoiceTicket)).toBe(true);
    expect(isVoiceBacklogTask(nonBacklogTicket)).toBe(false);
  });

  it('groups NEW_0 tasks by linked voice session and collects orphan voice tasks separately', () => {
    const grouped = buildVoiceBacklogGroups({
      tickets: [
        makeTicket({
          id: 'voice-session-1',
          name: 'Session linked task',
          source: 'VOICE_BOT',
          source_data: { session_id: sessionId },
          external_ref: sessionUrl,
          updated_at: '2026-03-06T10:00:00.000Z',
        }),
        makeTicket({
          id: 'voice-orphan-1',
          name: 'Orphan task',
          source: 'VOICE_BOT',
          updated_at: '2026-03-06T11:00:00.000Z',
        }),
      ],
      voiceSessions: [
        {
          _id: sessionId,
          session_name: 'Weekly sync',
          external_ref: sessionUrl,
          project: { name: 'Alpha' },
        },
      ],
      projectsData: [{ _id: 'project-1', name: 'Alpha' }],
    });

    expect(grouped).toHaveLength(2);
    expect(grouped[0]?.kind).toBe('orphan');
    expect(grouped[0]?.title).toBe('Orphan possible tasks');
    expect(grouped[0]?.possibleTaskCount).toBe(1);
    expect(grouped[0]?.processedTaskCount).toBe(0);

    expect(grouped[1]).toEqual(
      expect.objectContaining({
        kind: 'session',
        sessionId,
        title: 'Weekly sync',
        sourceReference: sessionId,
        sessionLink: sessionUrl,
      })
    );
    expect(grouped[1]?.taskCount).toBe(1);
    expect(grouped[1]?.possibleTickets[0]?.name).toBe('Session linked task');
  });
});
