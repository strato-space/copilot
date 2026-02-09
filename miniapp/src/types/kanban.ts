export interface PerformerSummary {
    id?: string;
    name?: string;
    real_name?: string;
}

export interface TaskTypeSummary {
    _id: string;
    id?: string;
    title?: string;
    description?: string;
    parent?: {
        _id?: string;
        title?: string;
    };
    parent_type_id?: string;
    type_class?: string;
    roles?: string[];
    execution_plan?: Array<{ id?: string; _id?: string; title?: string }>;
}

export interface Ticket {
    _id: string;
    id?: string;
    name: string;
    project?: string;
    task_status: string;
    priority?: string;
    created_at?: string;
    updated_at?: string;
    task_type?: TaskTypeSummary | null;
    description?: string;
    epic?: string;
    total_hours?: number;
    performer?: PerformerSummary | null;
    board?: string;
    type?: string;
    status?: string;
}

export interface TrackTimePayload {
    ticket_id: string;
    date: string;
    time: string;
    comment: string;
    result_link: string;
}
