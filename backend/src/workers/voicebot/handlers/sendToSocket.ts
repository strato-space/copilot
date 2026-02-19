import { getLogger } from '../../../utils/logger.js';

const logger = getLogger();

export type SendToSocketJobData = {
  session_id?: string;
  socket_id?: string;
  event?: string;
  payload?: unknown;
};

export const handleSendToSocketJob = async (
  payload: SendToSocketJobData
): Promise<{ ok: boolean; skipped?: boolean; reason?: string; error?: string }> => {
  const event = String(payload.event || '').trim();
  if (!event) {
    return { ok: false, error: 'invalid_event' };
  }

  // Socket.IO room delivery is handled directly in backend runtime.
  // Dedicated workers currently do not own socket transport state.
  logger.warn('[voicebot-worker] send_to_socket skipped', {
    reason: 'socket_runtime_not_available',
    session_id: payload.session_id ?? null,
    socket_id: payload.socket_id ?? null,
    event,
  });

  return {
    ok: true,
    skipped: true,
    reason: 'socket_runtime_not_available',
  };
};
