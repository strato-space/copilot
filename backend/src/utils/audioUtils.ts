import { spawnSync } from 'node:child_process';

const toPositiveNumber = (value: unknown): number | null => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return parsed;
};

export const parseFfprobeDuration = (rawOutput: string): number => {
  const raw = String(rawOutput || '').trim();
  if (!raw) {
    throw new Error('Empty ffprobe output');
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Invalid ffprobe JSON: ${message}`);
  }

  const root = parsed as Record<string, unknown>;
  const candidates: number[] = [];

  const formatDuration = toPositiveNumber(
    (root.format as Record<string, unknown> | undefined)?.duration
  );
  if (formatDuration != null) {
    candidates.push(formatDuration);
  }

  const streams = Array.isArray(root.streams) ? root.streams : [];
  for (const stream of streams) {
    const streamDuration = toPositiveNumber((stream as Record<string, unknown>)?.duration);
    if (streamDuration != null) {
      candidates.push(streamDuration);
    }
  }

  if (candidates.length === 0) {
    throw new Error('Duration is unavailable in ffprobe metadata');
  }

  return Math.max(...candidates);
};

export const getAudioDurationFromFile = async (filePath: string): Promise<number> => {
  const probe = spawnSync(
    'ffprobe',
    [
      '-v',
      'error',
      '-show_entries',
      'format=duration:stream=duration',
      '-of',
      'json',
      filePath,
    ],
    { encoding: 'utf8' }
  );

  if (probe.error) {
    throw new Error(`ffprobe execution failed: ${probe.error.message}`);
  }

  if (probe.status !== 0) {
    const stderr = String(probe.stderr || '').trim();
    throw new Error(stderr || `ffprobe exited with status ${probe.status}`);
  }

  return parseFfprobeDuration(String(probe.stdout || ''));
};
