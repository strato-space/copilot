import type { Db } from 'mongodb';
import { getDb } from '../../../services/db.js';
import { getLogger } from '../../../utils/logger.js';
import { buildIngressDeps, handleAttachmentIngress } from '../../../voicebot_tgbot/ingressHandlers.js';

const logger = getLogger();

export type HandleAttachmentJobData = {
  message?: Record<string, unknown>;
};

export const handleAttachmentJob = async (
  payload: HandleAttachmentJobData
): Promise<Record<string, unknown>> => {
  const db: Db = getDb();
  const result = await handleAttachmentIngress({
    deps: buildIngressDeps({ db, logger }),
    input: payload.message || {},
  });
  return result;
};
