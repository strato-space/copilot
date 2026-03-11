export interface AdminSyncTeamBody {
  team_id: string;
}

export interface AdminSyncProjectBody {
  project_id: string;
  team_id?: string;
}

export interface AdminSyncFileBody {
  file_key: string;
  project_id?: string;
  team_id?: string;
}

export interface AdminRegisterWebhookBody {
  webhook_id: string;
  context: 'TEAM' | 'PROJECT' | 'FILE';
  context_id: string;
  team_id?: string;
  notes?: string;
}

export interface WebhookRouteResponse {
  ok: boolean;
  event_id: string;
  status: 'accepted' | 'duplicate' | 'ignored';
}
