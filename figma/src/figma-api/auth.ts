import { getEnv } from '../config/env.js';

export const buildFigmaHeaders = (): Record<string, string> => {
  const env = getEnv();
  if (!env.figmaPersonalAccessToken) {
    throw new Error('figma_pat_missing');
  }

  return {
    'X-Figma-Token': env.figmaPersonalAccessToken,
    Accept: 'application/json',
  };
};
