import { existsSync, readdirSync } from 'node:fs';
import path from 'node:path';

const CUSTOM_PROMPTS_RELATIVE_PATH = path.join('resources', 'voicebot', 'custom_prompts');

const resolveDefaultCustomPromptsDir = (): string => {
  const cwd = process.cwd();
  const direct = path.resolve(cwd, CUSTOM_PROMPTS_RELATIVE_PATH);
  if (existsSync(direct)) return direct;

  const nested = path.resolve(cwd, 'backend', CUSTOM_PROMPTS_RELATIVE_PATH);
  if (existsSync(nested)) return nested;

  return direct;
};

export const resolveCustomPromptsDir = (): string => {
  const configured = String(process.env.VOICEBOT_CUSTOM_PROMPTS_DIR || '').trim();
  if (configured) return configured;
  return resolveDefaultCustomPromptsDir();
};

export const listCustomPromptProcessorNames = (): string[] => {
  const promptsDir = resolveCustomPromptsDir();
  if (!existsSync(promptsDir)) return [];

  try {
    return readdirSync(promptsDir)
      .filter((file) => file.endsWith('.md'))
      .map((file) => file.replace(/\.md$/i, ''))
      .map((name) => name.trim())
      .filter(Boolean);
  } catch {
    return [];
  }
};
