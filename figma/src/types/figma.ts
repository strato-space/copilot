import type { ObjectId } from 'mongodb';
import {
  FIGMA_INDEX_STATUS,
  FIGMA_SYNC_SCOPE_TYPE,
  FIGMA_SYNC_STATUS,
  FIGMA_SYNC_TRIGGER,
  FIGMA_WEBHOOK_PROCESS_STATUS,
} from '../constants/sync.js';

export interface FigmaTeamDoc {
  _id?: ObjectId;
  team_id: string;
  name: string | null;
  source: 'env_seed' | 'api';
  is_active: boolean;
  last_seen_at: number;
  last_synced_at: number | null;
  created_at: number;
  updated_at: number;
}

export interface FigmaProjectDoc {
  _id?: ObjectId;
  project_id: string;
  team_id: string;
  name: string;
  is_active: boolean;
  last_seen_at: number;
  last_synced_at: number | null;
  created_at: number;
  updated_at: number;
}

export interface FigmaFileDoc {
  _id?: ObjectId;
  file_key: string;
  project_id: string;
  team_id: string;
  name: string;
  thumbnail_url: string | null;
  last_modified_at: string | null;
  version: string | null;
  branch_key: string | null;
  branch_name: string | null;
  is_deleted: boolean;
  last_seen_at: number;
  last_indexed_at: number | null;
  last_index_status: (typeof FIGMA_INDEX_STATUS)[keyof typeof FIGMA_INDEX_STATUS];
  last_index_error: string | null;
  last_webhook_at: number | null;
  created_at: number;
  updated_at: number;
}

export interface FigmaTreeSection {
  node_id: string;
  name: string;
  node_type: 'SECTION';
  path: string;
}

export interface FigmaTreePage {
  node_id: string;
  name: string;
  node_type: 'PAGE';
  path: string;
  sections: FigmaTreeSection[];
}

export interface FigmaTreeSnapshot {
  file_key: string;
  file_name: string;
  version: string | null;
  depth: number;
  pages: FigmaTreePage[];
}

export interface FigmaFileSnapshotDoc {
  _id?: ObjectId;
  file_key: string;
  project_id: string;
  team_id: string;
  version: string | null;
  depth: number;
  tree_json: FigmaTreeSnapshot;
  pages_count: number;
  sections_count: number;
  source: 'poll' | 'webhook' | 'manual';
  created_at: number;
}

export interface FigmaNodeFlatDoc {
  _id?: ObjectId;
  file_key: string;
  version: string | null;
  node_id: string;
  parent_node_id: string | null;
  node_type: 'FILE' | 'PAGE' | 'SECTION';
  name: string;
  page_node_id: string | null;
  page_name: string | null;
  section_node_id: string | null;
  section_name: string | null;
  path: string;
  created_at: number;
}

export interface FigmaWebhookEventDoc {
  _id?: ObjectId;
  event_id: string;
  webhook_id: string | null;
  event_type: string;
  team_id: string | null;
  project_id: string | null;
  file_key: string | null;
  file_name: string | null;
  event_timestamp: string | null;
  payload: Record<string, unknown>;
  received_at: number;
  processed_at: number | null;
  process_status: (typeof FIGMA_WEBHOOK_PROCESS_STATUS)[keyof typeof FIGMA_WEBHOOK_PROCESS_STATUS];
  process_error: string | null;
}

export interface FigmaWebhookSubscriptionDoc {
  _id?: ObjectId;
  webhook_id: string;
  context: 'TEAM' | 'PROJECT' | 'FILE';
  context_id: string;
  team_id: string | null;
  notes: string | null;
  created_at: number;
  updated_at: number;
}

export interface FigmaSyncRunDoc {
  _id?: ObjectId;
  scope_type: (typeof FIGMA_SYNC_SCOPE_TYPE)[keyof typeof FIGMA_SYNC_SCOPE_TYPE];
  scope_id: string | null;
  trigger: (typeof FIGMA_SYNC_TRIGGER)[keyof typeof FIGMA_SYNC_TRIGGER];
  status: (typeof FIGMA_SYNC_STATUS)[keyof typeof FIGMA_SYNC_STATUS];
  stats: Record<string, unknown>;
  error: string | null;
  started_at: number;
  finished_at: number | null;
}

export interface FigmaApiProject {
  id: string;
  name: string;
}

export interface FigmaApiFile {
  key: string;
  name: string;
  thumbnail_url?: string | null;
  last_modified?: string | null;
  version?: string | null;
  branch_key?: string | null;
  branch_name?: string | null;
}

export interface FigmaApiNode {
  id: string;
  name: string;
  type: string;
  children?: FigmaApiNode[];
}

export interface FigmaApiFileResponse {
  name?: string;
  version?: string | null;
  lastModified?: string | null;
  document?: FigmaApiNode;
}

export interface NormalizedWebhookPayload {
  event_id: string;
  webhook_id: string | null;
  event_type: string;
  team_id: string | null;
  project_id: string | null;
  file_key: string | null;
  file_name: string | null;
  event_timestamp: string | null;
  passcode: string | null;
  raw_payload: Record<string, unknown>;
}
