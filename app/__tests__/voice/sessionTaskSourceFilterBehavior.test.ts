import {
  buildVoiceSessionTaskSourceRefs,
  normalizeVoiceSessionSourceRefs,
  ticketMatchesVoiceSessionSourceRefs,
} from '../../src/utils/voiceSessionTaskSource';

describe('voice session task source filter behavior', () => {
  const sessionId = '65f0aabbccddeeff00112233';
  const canonicalSessionUrl = `https://copilot.stratospace.fun/voice/session/${sessionId}`;

  it('builds canonical source refs for the current voice session', () => {
    const refs = buildVoiceSessionTaskSourceRefs(sessionId, {
      _id: sessionId,
      session_name: 'Test session',
      processors_data: {},
      external_ref: `${canonicalSessionUrl}/`,
    } as unknown as { _id: string });

    expect(refs).toContain(sessionId);
    expect(refs).toContain(canonicalSessionUrl);
    expect(refs.filter((value) => value === canonicalSessionUrl)).toHaveLength(1);
  });

  it('matches ticket when session is stored in source_data.session_id', () => {
    const refs = buildVoiceSessionTaskSourceRefs(sessionId, null);
    const ticket = {
      source_data: {
        session_id: { $oid: sessionId },
      },
    };

    expect(ticketMatchesVoiceSessionSourceRefs(ticket, refs)).toBe(true);
  });

  it('matches ticket when session is stored in source_data.session_db_id', () => {
    const refs = buildVoiceSessionTaskSourceRefs(sessionId, null);
    const ticket = {
      source_data: {
        session_db_id: { $oid: sessionId },
      },
    };

    expect(ticketMatchesVoiceSessionSourceRefs(ticket, refs)).toBe(true);
  });

  it('matches ticket when source_ref uses canonical session URL', () => {
    const refs = buildVoiceSessionTaskSourceRefs(sessionId, null);
    const ticket = {
      source_ref: `${canonicalSessionUrl}/`,
    };

    expect(ticketMatchesVoiceSessionSourceRefs(ticket, refs)).toBe(true);
  });

  it('matches ticket when source object stores voice_session_id', () => {
    const refs = normalizeVoiceSessionSourceRefs([canonicalSessionUrl]);
    const ticket = {
      source: {
        voice_session_id: sessionId,
      },
    };

    expect(ticketMatchesVoiceSessionSourceRefs(ticket, refs)).toBe(true);
  });

  it('does not match unrelated session source refs', () => {
    const refs = buildVoiceSessionTaskSourceRefs(sessionId, null);
    const ticket = {
      source_data: {
        session_id: '65f0aabbccddeeff00112234',
      },
      source_ref: 'https://copilot.stratospace.fun/voice/session/65f0aabbccddeeff00112234',
    };

    expect(ticketMatchesVoiceSessionSourceRefs(ticket, refs)).toBe(false);
  });
});
