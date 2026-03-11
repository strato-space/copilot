export const FIGMA_COLLECTIONS = {
  TEAMS: 'copilot_figma_teams',
  PROJECTS: 'copilot_figma_projects',
  FILES: 'copilot_figma_files',
  FILE_SNAPSHOTS: 'copilot_figma_file_snapshots',
  NODES_FLAT: 'copilot_figma_nodes_flat',
  WEBHOOK_SUBSCRIPTIONS: 'copilot_figma_webhook_subscriptions',
  WEBHOOK_EVENTS: 'copilot_figma_webhook_events',
  SYNC_RUNS: 'copilot_figma_sync_runs',
} as const;

export type FigmaCollectionName = (typeof FIGMA_COLLECTIONS)[keyof typeof FIGMA_COLLECTIONS];
