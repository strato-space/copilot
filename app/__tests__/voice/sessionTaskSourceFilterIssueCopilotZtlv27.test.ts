import {
  buildVoiceSessionTaskSourceRefs,
  ticketMatchesVoiceSessionSourceRefs,
} from '../../src/utils/voiceSessionTaskSource';

describe('voice session tasks source filter regression (copilot-ztlv.27)', () => {
  const sessionId = '699e793070e6008285f900e4';
  const taskId = '69a195364f5005997ece8ec4';
  const canonicalSessionUrl = `https://copilot.stratospace.fun/voice/session/${sessionId}`;

  it('matches the repro task by canonical source mapping from voice session source link', () => {
    const sessionSourceRefs = buildVoiceSessionTaskSourceRefs(sessionId, null);
    const task = {
      _id: taskId,
      source_kind: 'voice_session',
      source_ref: 'https://t.me/c/1544940173/12567',
      external_ref: `${canonicalSessionUrl}/?from=task-source`,
      source_data: {
        session_id: { $oid: sessionId },
        session_db_id: { $oid: sessionId },
      },
    };

    expect(ticketMatchesVoiceSessionSourceRefs(task, sessionSourceRefs)).toBe(true);
  });

  it('matches when only source_data.session_db_id is present', () => {
    const sessionSourceRefs = buildVoiceSessionTaskSourceRefs(sessionId, null);
    const task = {
      _id: taskId,
      source_data: {
        session_db_id: { $oid: sessionId },
      },
    };

    expect(ticketMatchesVoiceSessionSourceRefs(task, sessionSourceRefs)).toBe(true);
  });
});
