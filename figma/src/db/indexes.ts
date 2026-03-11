import type { Db, IndexDescription } from 'mongodb';
import { getEnv } from '../config/env.js';
import { FIGMA_COLLECTIONS } from '../constants/collections.js';

type CollectionIndexMap = Array<{ collection: string; indexes: IndexDescription[] }>;

const buildIndexes = (): CollectionIndexMap => {
  const env = getEnv();
  return [
    {
      collection: FIGMA_COLLECTIONS.TEAMS,
      indexes: [
        { key: { team_id: 1 }, name: 'team_id_unique', unique: true },
        { key: { is_active: 1, updated_at: -1 }, name: 'teams_active_updated_at' },
      ],
    },
    {
      collection: FIGMA_COLLECTIONS.PROJECTS,
      indexes: [
        { key: { project_id: 1 }, name: 'project_id_unique', unique: true },
        { key: { team_id: 1, name: 1 }, name: 'projects_team_name' },
        { key: { team_id: 1, is_active: 1 }, name: 'projects_team_active' },
      ],
    },
    {
      collection: FIGMA_COLLECTIONS.FILES,
      indexes: [
        { key: { file_key: 1 }, name: 'file_key_unique', unique: true },
        { key: { project_id: 1, last_modified_at: -1 }, name: 'files_project_last_modified' },
        { key: { team_id: 1, project_id: 1 }, name: 'files_team_project' },
        { key: { name: 'text' }, name: 'files_name_text' },
      ],
    },
    {
      collection: FIGMA_COLLECTIONS.FILE_SNAPSHOTS,
      indexes: [
        { key: { file_key: 1, version: 1, depth: 1 }, name: 'snapshot_file_version_depth', unique: true },
        { key: { file_key: 1, created_at: -1 }, name: 'snapshot_file_created_at' },
      ],
    },
    {
      collection: FIGMA_COLLECTIONS.NODES_FLAT,
      indexes: [
        { key: { file_key: 1, version: 1, node_id: 1 }, name: 'nodes_flat_file_version_node', unique: true },
        { key: { file_key: 1, node_type: 1 }, name: 'nodes_flat_file_type' },
        { key: { name: 'text', path: 'text' }, name: 'nodes_flat_name_path_text' },
      ],
    },
    {
      collection: FIGMA_COLLECTIONS.WEBHOOK_SUBSCRIPTIONS,
      indexes: [
        { key: { webhook_id: 1 }, name: 'webhook_subscription_id_unique', unique: true },
        { key: { context: 1, context_id: 1 }, name: 'webhook_subscription_context' },
      ],
    },
    {
      collection: FIGMA_COLLECTIONS.WEBHOOK_EVENTS,
      indexes: [
        { key: { event_id: 1 }, name: 'webhook_event_id_unique', unique: true },
        { key: { process_status: 1, received_at: 1 }, name: 'webhook_process_status_received_at' },
        {
          key: { received_at: 1 },
          name: 'webhook_received_at_ttl',
          expireAfterSeconds: env.figmaWebhookEventRetentionDays * 24 * 60 * 60,
        },
      ],
    },
    {
      collection: FIGMA_COLLECTIONS.SYNC_RUNS,
      indexes: [
        { key: { scope_type: 1, started_at: -1 }, name: 'sync_runs_scope_started_at' },
        { key: { status: 1, started_at: -1 }, name: 'sync_runs_status_started_at' },
        {
          key: { started_at: 1 },
          name: 'sync_runs_started_at_ttl',
          expireAfterSeconds: env.figmaSyncRunRetentionDays * 24 * 60 * 60,
        },
      ],
    },
  ];
};

export const ensureFigmaIndexes = async (db: Db): Promise<void> => {
  for (const definition of buildIndexes()) {
    const collection = db.collection(definition.collection);
    for (const index of definition.indexes) {
      await collection.createIndex(index.key!, index);
    }
  }
};
