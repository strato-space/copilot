type UnknownRecord = Record<string, unknown>;

export type VoiceTaskCreateRowErrorReason =
    | 'missing_performer_id'
    | 'invalid_performer_id'
    | 'performer_not_found'
    | 'codex_project_git_repo_required'
    | 'unknown_validation_error';

export type VoiceTaskCreateRowError = {
    index: number;
    ticketId: string;
    field: string;
    reason: VoiceTaskCreateRowErrorReason;
    message: string;
    performerId: string;
    projectId: string;
};

const isRecord = (value: unknown): value is UnknownRecord =>
    Boolean(value) && typeof value === 'object' && !Array.isArray(value);

const toText = (value: unknown): string =>
    typeof value === 'string' ? value.trim() : '';

const toInteger = (value: unknown): number | null => {
    if (typeof value === 'number' && Number.isInteger(value)) return value;
    if (typeof value === 'string') {
        const parsed = Number.parseInt(value.trim(), 10);
        return Number.isInteger(parsed) ? parsed : null;
    }
    return null;
};

const normalizeRowReason = (value: unknown): VoiceTaskCreateRowErrorReason => {
    const reason = toText(value);
    if (reason === 'missing_performer_id') return 'missing_performer_id';
    if (reason === 'performer_not_found') return 'performer_not_found';
    if (reason === 'codex_project_git_repo_required') return 'codex_project_git_repo_required';
    if (reason === 'invalid_performer_id') return 'invalid_performer_id';
    if (reason === 'unknown_validation_error') return 'unknown_validation_error';
    return 'unknown_validation_error';
};

const normalizeRowMessage = (reason: VoiceTaskCreateRowErrorReason, value: unknown): string => {
    const message = toText(value);
    if (message) return message;
    if (reason === 'missing_performer_id') return 'Исполнитель не выбран';
    if (reason === 'performer_not_found') return 'Исполнитель не найден в automation_performers';
    if (reason === 'codex_project_git_repo_required') return 'Для задач Codex у проекта должен быть git_repo';
    if (reason === 'invalid_performer_id') return 'Некорректный performer_id: ожидается Mongo ObjectId';
    return 'Ошибка валидации при создании задачи';
};

const parseRowError = (value: unknown): VoiceTaskCreateRowError | null => {
    if (!isRecord(value)) return null;
    const reason = normalizeRowReason(value.reason);
    const index = toInteger(value.index) ?? 0;
    const ticketId = toText(value.ticket_id) || `task-${index + 1}`;
    const performerId = toText(value.performer_id);
    const projectId = toText(value.project_id);
    const field = toText(value.field) || (reason === 'codex_project_git_repo_required' ? 'project_id' : 'performer_id');
    return {
        index,
        ticketId,
        field,
        reason,
        message: normalizeRowMessage(reason, value.message),
        performerId,
        projectId,
    };
};

const parseRows = (value: unknown): VoiceTaskCreateRowError[] => {
    if (!Array.isArray(value)) return [];
    const seen = new Set<string>();
    const result: VoiceTaskCreateRowError[] = [];
    for (const row of value) {
        const parsed = parseRowError(row);
        if (!parsed) continue;
        const dedupeKey = `${parsed.ticketId}|${parsed.field}|${parsed.reason}|${parsed.performerId}|${parsed.projectId}`;
        if (seen.has(dedupeKey)) continue;
        seen.add(dedupeKey);
        result.push(parsed);
    }
    return result;
};

export const extractVoiceTaskCreateRowErrors = (payload: unknown): VoiceTaskCreateRowError[] => {
    if (!isRecord(payload)) return [];
    const invalidRows = parseRows(payload.invalid_rows);
    const rejectedRows = parseRows(payload.rejected_rows);
    if (invalidRows.length === 0) return rejectedRows;
    if (rejectedRows.length === 0) return invalidRows;
    return [...invalidRows, ...rejectedRows];
};

export const extractVoiceTaskCreateErrorText = (payload: unknown): string => {
    if (!isRecord(payload)) return '';
    return toText(payload.error);
};

export class VoiceTaskCreateValidationError extends Error {
    readonly rowErrors: VoiceTaskCreateRowError[];
    readonly backendError: string;

    constructor(backendError: string, rowErrors: VoiceTaskCreateRowError[]) {
        super(backendError || 'Task creation validation failed');
        this.name = 'VoiceTaskCreateValidationError';
        this.backendError = backendError;
        this.rowErrors = rowErrors;
    }
}

export const isVoiceTaskCreateValidationError = (
    value: unknown
): value is VoiceTaskCreateValidationError => value instanceof VoiceTaskCreateValidationError;
