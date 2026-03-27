export interface VoiceSessionTaskflowRefreshHint {
    reason?: string;
    possible_tasks?: boolean;
    tasks?: boolean;
    codex?: boolean;
    summary?: boolean;
    correlation_id?: string;
    clicked_at_ms?: number;
    updated_at?: string;
}

export interface VoiceBotSession {
    _id: string;
    session_id?: string;
    session_db_id?: string;
    session_name?: string;
    dialogue_tag?: string;
    created_at?: string;
    updated_at?: string;
    last_voice_timestamp?: string | number | Date;
    project_id?: string | null;
    show_in_crm?: boolean;
    is_postprocessing?: boolean;
    is_active?: boolean;
    is_waiting?: boolean;
    is_messages_processed?: boolean;
    is_finalized?: boolean;
    to_finalize?: boolean;
    is_deleted?: boolean;
    processors?: string[];
    session_processors?: string[];
    access_level?: string;
    participants?: Array<string | VoicebotPerson>;
    allowed_users?: string[];
    source_ref?: string;
    external_ref?: string;
    source_data?: Record<string, unknown>;
    processors_data?: Record<string, unknown>;
    agent_results?: {
        create_tasks?: VoicePossibleTask[];
    } | null;
    custom_prompt_run?: {
        result?: unknown;
    } | null;
    summary_md_text?: string;
    summary_saved_at?: string;
    review_md_text?: string;
    taskflow_refresh?: VoiceSessionTaskflowRefreshHint | null;
}

export interface VoicebotPerson {
    _id: string;
    name?: string;
    full_name?: string;
    project_id?: string;
    role?: string;
}

export interface VoicePossibleTask {
    _id?: string;
    row_id: string;
    id: string;
    name: string;
    description: string;
    priority: string;
    priority_reason: string;
    performer_id: string;
    project_id: string;
    task_type_id: string;
    dialogue_tag: string;
    task_id_from_ai: string;
    dependencies_from_ai: string[];
    dialogue_reference: string;
    task_status?: string;
    relations?: Array<Record<string, unknown>>;
    source_ref?: string;
    external_ref?: string;
    source_data?: Record<string, unknown>;
    discussion_count?: number;
    discussion_sessions?: Array<{
        session_id: string;
        session_name?: string;
        project_id?: string;
        created_at?: string;
        role?: string;
    }>;
}

export type VoiceTaskEnrichmentSectionKey =
    | 'description'
    | 'object_locators'
    | 'expected_results'
    | 'acceptance_criteria'
    | 'evidence_links'
    | 'executor_routing_hints'
    | 'open_questions';

export type VoiceTaskEnrichmentSections = Record<VoiceTaskEnrichmentSectionKey, string>;

export interface VoiceTaskEnrichmentEntry {
    key: VoiceTaskEnrichmentSectionKey;
    label: VoiceTaskEnrichmentSectionKey;
    value: string;
    isFilled: boolean;
}

export interface VoiceTaskEnrichmentParseResult {
    synopsis: string;
    sections: VoiceTaskEnrichmentSections;
    entries: VoiceTaskEnrichmentEntry[];
    filledCount: number;
    totalCount: number;
    missingKeys: VoiceTaskEnrichmentSectionKey[];
}

export type VoicePayloadMediaKind = 'audio' | 'video' | 'image' | 'binary_document' | 'unknown';
export type VoiceTranscriptionEligibility = 'eligible' | 'ineligible' | null;
export type VoiceClassificationResolutionState = 'resolved' | 'pending';
export type VoiceTranscriptionProcessingState =
    | 'pending_classification'
    | 'pending_transcription'
    | 'transcribed'
    | 'classified_skip'
    | 'transcription_error';

export interface VoiceAttachmentTranscriptionContract {
    attachment_index?: number | null;
    payload_media_kind?: VoicePayloadMediaKind | null;
    speech_bearing_assessment?: string | null;
    classification_resolution_state?: VoiceClassificationResolutionState | null;
    transcription_eligibility?: VoiceTranscriptionEligibility;
    transcription_processing_state?: VoiceTranscriptionProcessingState | null;
    transcription_skip_reason?: string | null;
    transcription_eligibility_basis?: string | null;
    classification_rule_ref?: string | null;
    transcription_text?: string | null;
    transcription_raw?: unknown;
    transcription_error?: string | null;
    audio_track_state?: string | null;
    duration_ms?: number | null;
    duration_seconds?: number | string | null;
    payloadMediaKind?: VoicePayloadMediaKind | null;
    speechBearingAssessment?: string | null;
    classificationResolutionState?: VoiceClassificationResolutionState | null;
    transcriptionEligibility?: VoiceTranscriptionEligibility;
    transcriptionProcessingState?: VoiceTranscriptionProcessingState | null;
    transcriptionSkipReason?: string | null;
    transcriptionEligibilityBasis?: string | null;
    classificationRuleRef?: string | null;
    transcriptionText?: string | null;
    transcriptionRaw?: unknown;
    transcriptionError?: string | null;
    audioTrackState?: string | null;
}

export type VoiceMessageAttachment = VoiceAttachmentTranscriptionContract & Record<string, unknown>;

export interface VoiceBotMessage {
    _id?: string;
    message_id?: string;
    message_timestamp?: string | number;
    session_id?: string;
    is_deleted?: boolean | string;
    image_anchor_message_id?: string | null;
    image_anchor_linked_message_id?: string | null;
    material_row_group_id?: string | null;
    material_anchor_message_id?: string | null;
    material_target_message_id?: string | null;
    is_image_anchor?: boolean;
    message_type?: string;
    text?: string;
    file_id?: string;
    file_path?: string;
    file_name?: string;
    file_unique_id?: string;
    file_hash?: string;
    mime_type?: string;
    to_transcribe?: boolean;
    transcription_error?: string | null;
    transcription_text?: string | null;
    transcription?: {
        duration_seconds?: number | string;
        segments?: Array<{
            id?: string;
            start?: number;
            end?: number;
            speaker?: string | null;
            text?: string;
            is_deleted?: boolean;
        }>;
    };
    transcription_chunks?: Array<{
        id?: string;
        text?: string;
        speaker?: string | null;
        is_deleted?: boolean;
    }>;
    primary_payload_media_kind?: VoicePayloadMediaKind | null;
    primary_transcription_attachment_index?: number | null;
    transcription_eligibility?: VoiceTranscriptionEligibility;
    classification_resolution_state?: VoiceClassificationResolutionState | null;
    transcription_processing_state?: VoiceTranscriptionProcessingState | null;
    transcription_skip_reason?: string | null;
    transcription_eligibility_basis?: string | null;
    classification_rule_ref?: string | null;
    source_note_text?: string | null;
    audio_track_state?: string | null;
    payload_media_kind?: VoicePayloadMediaKind | null;
    primary_attachment_index?: number | null;
    transcription_state?: VoiceTranscriptionProcessingState | null;
    classification_state?: VoiceClassificationResolutionState | null;
    eligibility?: VoiceTranscriptionEligibility;
    skip_reason?: string | null;
    source_note?: string | null;
    payloadMediaKind?: VoicePayloadMediaKind | null;
    primaryTranscriptionAttachmentIndex?: number | null;
    transcriptionEligibility?: VoiceTranscriptionEligibility;
    classificationResolutionState?: VoiceClassificationResolutionState | null;
    transcriptionProcessingState?: VoiceTranscriptionProcessingState | null;
    transcriptionSkipReason?: string | null;
    transcriptionEligibilityBasis?: string | null;
    classificationRuleRef?: string | null;
    sourceNoteText?: string | null;
    audioTrackState?: string | null;
    is_transcribed?: boolean;
    is_finalized?: boolean;
    categorization?: CategorizationChunk[];
    attachments?: VoiceMessageAttachment[];
    processors_data?: Record<string, unknown> & {
        summarization?: { data?: Array<{ summary?: string }> };
        questioning?: { data?: unknown[] };
    };
    source_type?: string;
    file_metadata?: {
        original_filename?: string;
    };
}

export interface CategorizationChunk {
    start?: number;
    end?: number;
    speaker?: string;
    text?: string;
    related_goal?: string;
    new_pattern_detected?: string;
    quality_flag?: string;
    topic_keywords?: string;
}

export interface VoiceMessageRow {
    timeStart?: number | undefined;
    timeEnd?: number | undefined;
    row_id?: string | undefined;
    row_index?: number | undefined;
    segment_oid?: string | undefined;
    source_segment_id?: string | undefined;
    source_file_name?: string | undefined;
    message_timestamp?: string | number | undefined;
    avatar: string;
    name?: string | undefined;
    text?: string | undefined;
    kind?: 'categorization' | 'text' | 'image' | undefined;
    imageUrl?: string | undefined;
    imageName?: string | undefined;
    goal?: string | undefined;
    patt?: string | undefined;
    flag?: string | undefined;
    keywords?: string | undefined;
    message_id?: string | undefined;
    message_db_id?: string | undefined;
    material_group_id?: string | undefined;
    material_anchor_message_id?: string | undefined;
    material_target_message_id?: string | undefined;
    material_source_message_id?: string | undefined;
}

export interface VoiceMessageGroup {
    message_id: string | undefined;
    message_timestamp: string | number | undefined;
    material_group_id?: string | undefined;
    material_anchor_message_id?: string | undefined;
    material_target_message_id?: string | undefined;
    original_message: VoiceBotMessage;
    rows: VoiceMessageRow[];
    materials?: VoiceMessageRow[];
    summary: {
        text: string;
    };
    widgets: Record<string, unknown>;
}

export interface VoiceBotSessionResponse {
    voice_bot_session: VoiceBotSession;
    session_messages: VoiceBotMessage[];
    session_attachments?: VoiceSessionAttachment[];
    socket_token?: string | null;
    socket_port?: number | null;
}

export interface VoiceSessionAttachment {
    _id: string;
    message_id?: string | null;
    message_oid?: string | null;
    message_timestamp?: string | number | null;
    message_type?: string | null;
    kind?: string | null;
    source?: string | null;
    source_type?: string | null;
    uri?: string | null;
    url?: string | null;
    name?: string | null;
    mimeType?: string | null;
    size?: number | null;
    width?: number | null;
    height?: number | null;
    caption?: string | null;
    file_id?: string | null;
    file_unique_id?: string | null;
    direct_uri?: string | null;
}

export interface VoiceSessionLogEvent {
    _id?: string;
    oid?: string;
    event_group?: string;
    event_name?: string;
    event_time?: string | number;
    status?: string;
    reason?: string;
    target?: {
        entity_oid?: string;
    } | null;
    diff?: {
        old_value?: unknown;
        new_value?: unknown;
    } | null;
    action?: {
        available?: boolean;
        type?: string;
    } | null;
}

export interface TaskTypeNode {
    _id?: string;
    key?: string;
    id?: string | { $oid?: string } | null;
    name?: string;
    title?: string;
    long_name?: string;
    path?: string;
    task_id?: string;
    parent?: {
        _id?: string;
        title?: string;
        name?: string;
    } | null;
    children?: TaskTypeNode[];
}

export interface VoiceBotProject {
    _id: string;
    name?: string;
    title?: string;
    git_repo?: string | null;
    project_group?: {
        _id?: string;
        name?: string;
        is_active?: boolean;
    } | null;
    customer?: {
        _id?: string;
        name?: string;
        is_active?: boolean;
    } | null;
}

export interface CodexTask {
    _id: string;
    id?: string;
    name?: string;
    description?: string;
    task_status?: string;
    priority?: string;
    codex_review_state?: string;
    external_ref?: string;
    issue_type?: string;
    assignee?: string;
    owner?: string;
    created_by?: string;
    created_by_name?: string;
    source_kind?: string;
    source_ref?: string;
    labels?: string[];
    dependencies?: string[];
    notes?: string;
    created_at?: string | number | null;
    updated_at?: string | number | null;
}

export interface VoiceBotPerformer {
    _id: string;
    name?: string;
    full_name?: string;
}

export interface CreateTaskChunk {
    text: string;
}

export interface TicketsModalData {
    tickets?: Array<{ id?: string; project_id?: string } & Record<string, unknown>>;
}
