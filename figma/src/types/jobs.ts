export interface SyncTeamJobData {
  team_id: string;
  trigger: 'startup' | 'interval' | 'manual' | 'webhook';
}

export interface SyncProjectsForTeamJobData {
  team_id: string;
  trigger: 'startup' | 'interval' | 'manual' | 'webhook';
}

export interface SyncFilesForProjectJobData {
  team_id: string;
  project_id: string;
  trigger: 'startup' | 'interval' | 'manual' | 'webhook';
}

export interface SyncFileTreeJobData {
  team_id: string;
  project_id: string;
  file_key: string;
  reason: 'poll' | 'webhook' | 'manual' | 'reconcile';
  source: 'poll' | 'webhook' | 'manual';
}

export interface ProcessWebhookEventJobData {
  event_id: string;
}

export interface ReconcileStaleFilesJobData {
  trigger: 'interval' | 'manual';
}

export interface RetryRateLimitedFilesJobData {
  trigger: 'interval' | 'manual';
}
