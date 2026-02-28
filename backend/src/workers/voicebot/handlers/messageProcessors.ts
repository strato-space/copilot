import { VOICEBOT_PROCESSORS } from '../../../constants.js';

type MessageWithCategorization = {
  categorization?: unknown[];
  processors_data?: Record<string, unknown>;
};

export const parseJsonArray = (raw: string): unknown[] => {
  const direct = raw.trim();
  if (!direct) return [];

  const candidates = [
    direct,
    direct.replace(/^```json\s*/i, '').replace(/```$/i, '').trim(),
    direct.replace(/^```\s*/i, '').replace(/```$/i, '').trim(),
  ];

  for (const candidate of candidates) {
    if (!candidate) continue;
    try {
      const parsed = JSON.parse(candidate) as unknown;
      if (Array.isArray(parsed)) return parsed;
    } catch {
      // ignore parse error and continue
    }
  }

  return [];
};

export const getCategorizationData = (message: MessageWithCategorization): unknown[] => {
  if (Array.isArray(message.categorization)) {
    return message.categorization;
  }

  const processorsData =
    message.processors_data && typeof message.processors_data === 'object'
      ? (message.processors_data as Record<string, unknown>)
      : {};
  const categorizationBucket = processorsData[VOICEBOT_PROCESSORS.CATEGORIZATION] as
    | { data?: unknown[] }
    | undefined;

  if (categorizationBucket && Array.isArray(categorizationBucket.data)) {
    return categorizationBucket.data;
  }

  return [];
};
