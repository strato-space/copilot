import { readdir, stat } from 'fs/promises';
import path from 'path';

export interface CrmSnapshotMeta {
  filePath: string;
  fileName: string;
  snapshotDate: string;
  mtimeMs: number;
}

const SNAPSHOT_DIR = '/home/strato-space/voicebot/downloads';
const DATE_RE = /(\d{4}-\d{2}-\d{2})/;

const parseSnapshotDate = (fileName: string): string => {
  const match = fileName.match(DATE_RE);
  return match ? match[1] : new Date().toISOString().slice(0, 10);
};

export const findLatestSnapshot = async (): Promise<CrmSnapshotMeta | null> => {
  const entries = await readdir(SNAPSHOT_DIR);
  const csvFiles = entries.filter((name) => name.endsWith('.csv'));
  if (csvFiles.length === 0) {
    return null;
  }

  let latest: CrmSnapshotMeta | null = null;
  for (const fileName of csvFiles) {
    const filePath = path.join(SNAPSHOT_DIR, fileName);
    const stats = await stat(filePath);
    const snapshotDate = parseSnapshotDate(fileName);
    const meta: CrmSnapshotMeta = {
      filePath,
      fileName,
      snapshotDate,
      mtimeMs: stats.mtimeMs,
    };
    if (!latest || meta.mtimeMs > latest.mtimeMs) {
      latest = meta;
    }
  }

  return latest;
};

export const isSnapshotStale = (snapshot: CrmSnapshotMeta, maxAgeMs: number): boolean => {
  const age = Date.now() - snapshot.mtimeMs;
  return age > maxAgeMs;
};

export const loadCrmSnapshotMeta = async (): Promise<CrmSnapshotMeta | null> => {
  return findLatestSnapshot();
};
