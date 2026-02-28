import { describe, expect, it, jest } from '@jest/globals';

import { dispatchVoicebotSocketEvent } from '../../../src/services/voicebot/voicebotSocketEventsWorker.js';

describe('dispatchVoicebotSocketEvent', () => {
  it('emits to session room when socket_id is not provided', () => {
    const emit = jest.fn();
    const to = jest.fn(() => ({ emit }));
    const namespace = {
      to,
      sockets: new Map(),
    };
    const io = {
      of: jest.fn(() => namespace),
    } as unknown as Parameters<typeof dispatchVoicebotSocketEvent>[0]['io'];

    const result = dispatchVoicebotSocketEvent({
      io,
      data: {
        session_id: '6996ae012835b2811da9b9ca',
        event: 'message_update',
        payload: { message_id: 'm1' },
      },
    });

    expect(result.ok).toBe(true);
    expect(to).toHaveBeenCalledWith('voicebot:session:6996ae012835b2811da9b9ca');
    expect(emit).toHaveBeenCalledWith('message_update', { message_id: 'm1' });
  });

  it('emits to a specific socket when socket_id is provided', () => {
    const socketEmit = jest.fn();
    const namespace = {
      to: jest.fn(),
      sockets: new Map([['socket-1', { emit: socketEmit }]]),
    };
    const io = {
      of: jest.fn(() => namespace),
    } as unknown as Parameters<typeof dispatchVoicebotSocketEvent>[0]['io'];

    const result = dispatchVoicebotSocketEvent({
      io,
      data: {
        session_id: '6996ae012835b2811da9b9ca',
        socket_id: 'socket-1',
        event: 'session_update',
        payload: { is_messages_processed: false },
      },
    });

    expect(result.ok).toBe(true);
    expect(socketEmit).toHaveBeenCalledWith('session_update', {
      is_messages_processed: false,
    });
  });

  it('returns skipped for invalid payload', () => {
    const io = {
      of: jest.fn(() => ({
        to: jest.fn(() => ({ emit: jest.fn() })),
        sockets: new Map(),
      })),
    } as unknown as Parameters<typeof dispatchVoicebotSocketEvent>[0]['io'];

    const result = dispatchVoicebotSocketEvent({
      io,
      data: {
        session_id: '',
        event: '',
      },
    });

    expect(result.ok).toBe(false);
    expect(result.skipped).toBe(true);
    expect(result.reason).toBe('invalid_payload');
  });
});

