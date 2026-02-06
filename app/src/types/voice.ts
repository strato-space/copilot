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
    transcription_text?: string;
    is_transcribed?: boolean;
    is_finalized?: boolean;
    categorization?: CategorizationChunk[];
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
    socket_token?: string | null;
    socket_port?: number | null;
}

export interface TaskTypeNode {
    _id?: string;
    name?: string;
    children?: TaskTypeNode[];
}

export interface VoiceBotProject {
    _id: string;
    name?: string;
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
