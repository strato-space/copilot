import type { Db } from 'mongodb';
import { getDb } from '../../../services/db.js';
import { getLogger } from '../../../utils/logger.js';
import { buildIngressDeps, handleVoiceIngress } from '../../../voicebot_tgbot/ingressHandlers.js';

const logger = getLogger();

export type HandleVoiceJobData = {
  message?: Record<string, unknown>;
};

export const handleVoiceJob = async (payload: HandleVoiceJobData): Promise<Record<string, unknown>> => {
  const db: Db = getDb();
  const result = await handleVoiceIngress({
    deps: buildIngressDeps({ db, logger }),
    input: payload.message || {},
  });
  return result;
};
