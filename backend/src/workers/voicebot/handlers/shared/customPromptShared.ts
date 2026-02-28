import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { resolveCustomPromptsDir } from '../../customPromptsDir.js';
import { mapJsonArrayRows } from '../messageProcessors.js';
import { normalizeString } from './sharedRuntime.js';

export const getCustomPromptText = (processorName: string): string | null => {
  const promptsDir = resolveCustomPromptsDir();
  const fileName = processorName.endsWith('.md') ? processorName : `${processorName}.md`;
  const promptFilePath = path.join(promptsDir, fileName);
  if (!existsSync(promptFilePath)) return null;

  try {
    return readFileSync(promptFilePath, 'utf8');
  } catch {
    return null;
  }
};

export const normalizeCustomPromptRows = (outputText: string): Array<Record<string, unknown>> =>
  mapJsonArrayRows(outputText, (item) => ({
    ...item,
    result: normalizeString(item.result),
  }));
