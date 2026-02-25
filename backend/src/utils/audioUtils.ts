import { spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { extname, join } from 'node:path';
import { mkdirSync, readdirSync } from 'node:fs';

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

export const getFileSha256FromPath = async (filePath: string): Promise<string> => {
  const buffer = await readFile(filePath);
  return createHash('sha256').update(buffer).digest('hex');
};

export const splitAudioFileByDuration = async ({
  filePath,
  segmentDurationSeconds,
  outputDir,
  outputPrefix = 'segment_',
  outputExtension,
}: {
  filePath: string;
  segmentDurationSeconds: number;
  outputDir: string;
  outputPrefix?: string;
  outputExtension?: string;
}): Promise<string[]> => {
  const safeDuration = Number(segmentDurationSeconds);
  if (!Number.isFinite(safeDuration) || safeDuration <= 0) {
    throw new Error('segmentDurationSeconds must be a positive number');
  }

  mkdirSync(outputDir, { recursive: true });

  const extension = String(outputExtension || extname(filePath) || '.webm').trim() || '.webm';
  const outputTemplate = join(outputDir, `${outputPrefix}%03d${extension}`);

  const split = spawnSync(
    'ffmpeg',
    [
      '-v',
      'error',
      '-i',
      filePath,
      '-f',
      'segment',
      '-segment_time',
      String(safeDuration),
      '-c',
      'copy',
      '-reset_timestamps',
      '1',
      outputTemplate,
    ],
    { encoding: 'utf8' }
  );

  if (split.error) {
    throw new Error(`ffmpeg split failed: ${split.error.message}`);
  }

  if (split.status !== 0) {
    const stderr = String(split.stderr || '').trim();
    throw new Error(stderr || `ffmpeg split exited with status ${split.status}`);
  }

  const files = readdirSync(outputDir)
    .filter((name) => name.startsWith(outputPrefix) && name.endsWith(extension))
    .sort((left, right) => left.localeCompare(right))
    .map((name) => join(outputDir, name));

  if (files.length === 0) {
    throw new Error('ffmpeg split produced no segments');
  }

  return files;
};
