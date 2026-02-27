export interface VoiceBotSession {
    _id: string;
    session_id?: string;
    session_name?: string;
    dialogue_tag?: string;
    created_at?: string;
    updated_at?: string;
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
    processors_data?: Record<string, unknown>;
    custom_prompt_run?: {
        result?: unknown;
    } | null;
}

export interface VoicebotPerson {
    _id: string;
    name?: string;
    full_name?: string;
    project_id?: string;
    role?: string;
}

export interface VoiceBotMessage {
    _id?: string;
    message_id?: string;
    message_timestamp?: string | number;
    session_id?: string;
    image_anchor_message_id?: string | null;
    is_image_anchor?: boolean;
    message_type?: string;
    text?: string;
    file_id?: string;
    transcription_text?: string;
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
    is_transcribed?: boolean;
    is_finalized?: boolean;
    categorization?: CategorizationChunk[];
    attachments?: Array<Record<string, unknown>>;
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
}

export interface VoiceMessageGroup {
    message_id: string | undefined;
    message_timestamp: string | number | undefined;
    original_message: VoiceBotMessage;
    rows: VoiceMessageRow[];
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
    name?: string;
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
