import type { Db } from 'mongodb';
import { getDb } from '../../../services/db.js';
import { getLogger } from '../../../utils/logger.js';
import { buildIngressDeps, handleTextIngress } from '../../../voicebot_tgbot/ingressHandlers.js';

const logger = getLogger();

export type HandleTextJobData = {
  message?: Record<string, unknown>;
};

export const handleTextJob = async (payload: HandleTextJobData): Promise<Record<string, unknown>> => {
  const db: Db = getDb();
  const result = await handleTextIngress({
    deps: buildIngressDeps({ db, logger }),
    input: payload.message || {},
  });
  return result;
};
