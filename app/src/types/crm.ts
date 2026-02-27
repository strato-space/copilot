/**
 * CRM Types - TypeScript interfaces for CRM entities
 */

// Base entities
export interface Performer {
    _id: string;
    id?: string;
    name: string;
    real_name?: string;
    email?: string;
    is_active?: boolean;
    payments?: string;
    _payments_changed?: boolean;
}

export interface Project {
    _id: string;
    name: string;
    epics?: Epic[];
    is_active?: boolean;
    git_repo?: string;
    figma_dev_url?: string;
    figma_des_url?: string;
    project_group?: string;
}

export interface Epic {
    _id: string;
    name: string;
    project: string;
    project_name?: string;
    description?: string;
    is_deleted?: boolean;
}

export interface TaskType {
    _id: string;
    name: string;
    long_name?: string;
    parent?: string;
    supertype?: string;
    task_id?: string;
}

export interface TaskSupertype {
    _id: string;
    name: string;
}

export interface IncomeType {
    _id: string;
    name: string;
}

// Ticket / Task
export interface Comment {
    _id?: string;
    comment: string;
    created_at: number;
    author?: {
        _id?: string;
        name?: string;
        real_name?: string;
    } | null;
}

export interface WorkData {
    _id: string;
    date: string;
    date_timestamp?: number;
    description?: string;
    work_hours?: number;
    ticket_id: string;
    ticket_db_id?: string;
    created_at?: string;
    edited_at?: string;
    created_by?: string;
    performer?: string;
    project?: string;
    result_link?: string;
}

export interface Ticket {
    _id: string;
    id: string;
    name: string;
    project: string;
    project_id?: string;
    project_data?: {
        _id: string;
        name: string;
    };
    task_type?: string;
    task_status?: string;
    performer?: Performer | string;
    priority?: string;
    description?: string;
    epic?: string;
    epic_name?: string;
    comments_list?: Comment[];
    work_data?: WorkData[];
    total_hours?: number;
    notifications?: unknown;
    created_at?: string;
    updated_at?: string;
    last_status_update?: number;
    status_update_checked?: boolean;
    shipment_date?: string;
    estimated_time?: number;
    notion_url?: string;
    created_by?: unknown;
    created_by_name?: string;
    source?: unknown;
    source_data?: unknown;
    source_kind?: string;
    source_ref?: string;
    external_ref?: string;
}

// Tree structures
export interface TreeNode {
    key?: string;
    title?: string;
    name?: string;
    _id?: string;
    type: 'project' | 'customer' | 'group' | 'unassigned-category';
    data?: Project | Customer | ProjectGroup | ProjectWithGroup;
    children?: TreeNode[];
}

// Projects Tree (new structure)
export interface Customer {
    _id: string;
    name: string;
    is_active?: boolean;
    description?: string;
    project_groups_ids?: string[];
}

export interface ProjectGroup {
    _id: string;
    name: string;
    customer?: string;
    is_active?: boolean;
    description?: string;
    projects_ids?: string[];
}

export interface ProjectWithGroup {
    _id: string;
    name: string;
    project_group?: string;
    is_active?: boolean;
    git_repo?: string;
    start_date?: string;
    end_date?: string;
    time_capacity?: number;
    description?: string;
    drive_folder_id?: string;
    telegram_project_chat_url?: string;
    telegram_work_chat_url?: string;
    contacts?: string[] | string;
}

// Figma Sync
export interface FigmaPage {
    name: string;
    node_id: string;
    sections: FigmaSection[];
}

export interface FigmaSection {
    name: string;
    node_id: string;
}

export interface FigmaFile {
    fileKey: string;
    fileUrl: string;
    pages?: FigmaPage[] | undefined;
}

export interface FigmaSyncPair {
    dev: FigmaFile;
    des: FigmaFile;
}

export interface SectionToSync {
    source_file_url: string;
    destination_file_url: string;
    source_file_id: string;
    destination_file_id: string;
    page_name: string;
    section_name: string;
}

// Finances
export interface ExpenseRecord {
    _id: string;
    year: number;
    month: number;
    performer_id: string;
    payments: string;
}

export interface IncomeRecord {
    _id?: string;
    project: string;
    performer: string;
    performer_name?: string | undefined;
    year: number;
    month: number;
    hours_amount?: number | undefined;
    hour_price?: number | undefined;
}

// Week Reports
export interface WeekReportItem {
    _id: string;
    id: string;
    name: string;
    project: string;
    sprint?: string;
    task_status?: string;
    priority?: string;
    type?: string;
    performer?: {
        _id: string;
        name: string;
        real_name?: string;
    };
    created_at?: string;
    updated_at?: string;
    // Day columns
    Mo?: number;
    Tu?: number;
    We?: number;
    Th?: number;
    Fr?: number;
    Sa?: number;
    Su?: number;
    planned?: {
        Mo?: number;
        Tu?: number;
        We?: number;
        Th?: number;
        Fr?: number;
        Sa?: number;
        Su?: number;
    };
}

export type WeekReports = Record<string, WeekReportItem[]>;

// Bot Commands
export interface BotCommandStage {
    name: string;
    prompt: string;
    generate_document: boolean;
}

export interface BotCommand {
    _id?: string;
    short_name: string;
    name: string;
    is_active: boolean;
    stages: BotCommandStage[];
}

// API Response types
export interface DictionaryResponse {
    projects: Project[];
    performers: Performer[];
    customers: Customer[];
    projectGroups: ProjectGroup[];
    tree: TreeNode[];
    task_types: TaskType[];
    task_supertypes: TaskSupertype[];
    task_types_tree: TreeNode[];
    epics: Epic[];
    income_types: IncomeType[];
}

// Editing states
export interface EditingColumn {
    ticket: Ticket | null;
    column: string | null;
}

// Filters
export interface CRMFilters {
    performer?: string;
    project?: string;
    status?: string[];
    priority?: string;
    [key: string]: unknown;
}
