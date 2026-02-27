import type { Performer, Project, Ticket } from '../../types/crm';

const normalizeTaskId = (value: unknown): string | null => {
    if (typeof value !== 'string') {
        return null;
    }

    const trimmedValue = value.trim();
    return trimmedValue.length > 0 ? trimmedValue : null;
};

export const resolveCanonicalTaskId = (task: Ticket, requestedTaskId?: string): string => {
    const fromTicket = normalizeTaskId(task.id);
    if (fromTicket) {
        return fromTicket;
    }

    const fromRoute = normalizeTaskId(requestedTaskId);
    if (fromRoute) {
        return fromRoute;
    }

    const fromDatabase = normalizeTaskId(task._id);
    if (fromDatabase) {
        return fromDatabase;
    }

    return 'N/A';
};

const toLookupValue = (value: unknown): string => {
    if (typeof value === 'string') return value;
    if (typeof value === 'number') return String(value);
    if (!value || typeof value !== 'object') return '';
    const record = value as Record<string, unknown>;
    if (typeof record.$oid === 'string') return record.$oid;
    if (typeof record._id === 'string') return record._id;
    if (typeof record.toString === 'function') {
        const directValue = record.toString();
        if (directValue && directValue !== '[object Object]') return directValue;
    }
    return '';
};

const toNonEmptyString = (value: unknown): string => {
    if (typeof value !== 'string') return '';
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : '';
};

const getPerformerDisplayName = (performer?: Performer | null): string => {
    if (!performer) return '';
    return (
        toNonEmptyString(performer.real_name) ||
        toNonEmptyString(performer.name) ||
        toNonEmptyString(performer.id) ||
        toNonEmptyString(performer._id)
    );
};

const findPerformerByIdentity = (performers: Performer[], identity: unknown): Performer | undefined => {
    const target = toLookupValue(identity);
    if (!target) return undefined;

    return performers.find((performer) => {
        if (toLookupValue(performer._id) === target) return true;
        if (toLookupValue(performer.id) === target) return true;
        return false;
    });
};

const SOURCE_KIND_LABELS = {
    voice_session: 'Voice session',
    telegram: 'Telegram',
    manual: 'Manual',
    codex: 'Codex',
    unknown: 'Unknown',
} as const;

const VOICE_SESSION_BASE_URL = 'https://copilot.stratospace.fun/voice/session';

export interface TaskSourceInfo {
    kind: keyof typeof SOURCE_KIND_LABELS;
    label: (typeof SOURCE_KIND_LABELS)[keyof typeof SOURCE_KIND_LABELS];
    reference: string;
    link?: string;
}

const normalizeSourceKind = (value: unknown): TaskSourceInfo['kind'] => {
    if (typeof value !== 'string') {
        return 'unknown';
    }

    const normalized = value.trim().toLowerCase();
    if (normalized === 'voice_session' || normalized === 'voice' || normalized === 'voice_bot') {
        return 'voice_session';
    }
    if (normalized === 'telegram') {
        return 'telegram';
    }
    if (normalized === 'manual') {
        return 'manual';
    }
    if (normalized === 'codex') {
        return 'codex';
    }
    return 'unknown';
};

const asRecord = (value: unknown): Record<string, unknown> | null => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        return null;
    }
    return value as Record<string, unknown>;
};

const normalizeExternalLink = (value: unknown): string => {
    const raw = toNonEmptyString(value);
    if (!raw) return '';
    if (/^https?:\/\//i.test(raw)) return raw;
    if (/^t\.me\//i.test(raw)) return `https://${raw}`;
    return '';
};

const buildVoiceSessionLink = (sessionIdValue: unknown): string => {
    const sessionId = toLookupValue(sessionIdValue);
    if (!sessionId) return '';
    return `${VOICE_SESSION_BASE_URL}/${encodeURIComponent(sessionId)}`;
};

const buildTelegramLink = (telegramValue: unknown): string => {
    const telegramRecord = asRecord(telegramValue);
    if (!telegramRecord) return '';

    const chatId = toLookupValue(telegramRecord.chat_id);
    const threadId = toLookupValue(telegramRecord.thread_id);
    const messageId = toLookupValue(telegramRecord.message_id);
    if (!chatId || !messageId) return '';

    if (/^-100\d+$/.test(chatId)) {
        const compactChat = chatId.slice(4);
        if (threadId) {
            return `https://t.me/c/${compactChat}/${threadId}/${messageId}`;
        }
        return `https://t.me/c/${compactChat}/${messageId}`;
    }

    return `https://t.me/${chatId}/${messageId}`;
};

const getProjectDataName = (projectData: unknown): string => {
    if (projectData && typeof projectData === 'object' && !Array.isArray(projectData)) {
        const directName = (projectData as { name?: unknown }).name;
        if (typeof directName === 'string' && directName.trim()) {
            return directName.trim();
        }
    }

    if (Array.isArray(projectData)) {
        const firstNamedProject = projectData.find((item) => {
            if (!item || typeof item !== 'object') return false;
            const name = (item as { name?: unknown }).name;
            return typeof name === 'string' && name.trim().length > 0;
        }) as { name?: string } | undefined;

        if (firstNamedProject?.name) {
            return firstNamedProject.name.trim();
        }
    }

    return '';
};

const getProjectByValue = (projectsData: Project[], projectValue?: unknown): Project | null => {
    const targetValue = toLookupValue(projectValue);
    if (!targetValue) return null;

    return (
        projectsData.find((project) => toLookupValue(project._id) === targetValue) ??
        projectsData.find((project) => project.name === targetValue) ??
        null
    );
};

export const resolveTaskProjectName = (task: Ticket, projectsData: Project[] = []): string => {
    const projectData = (task as Ticket & { project_data?: unknown }).project_data;
    const projectDataName = getProjectDataName(projectData);
    if (projectDataName) {
        return projectDataName;
    }

    const projectFromLookup =
        getProjectByValue(projectsData, (task as Ticket & { project_id?: unknown }).project_id) ??
        getProjectByValue(projectsData, task.project);
    if (projectFromLookup?.name) {
        return projectFromLookup.name;
    }

    const directProject = typeof task.project === 'string' ? task.project.trim() : '';
    if (directProject) {
        return directProject;
    }

    return 'N/A';
};

export const resolveTaskCreator = (task: Ticket, performers: Performer[] = []): string => {
    const explicitCreatorName =
        toNonEmptyString((task as Ticket & { created_by_name?: unknown }).created_by_name) ||
        toNonEmptyString((task as Ticket & { creator_name?: unknown }).creator_name);
    if (explicitCreatorName) {
        return explicitCreatorName;
    }

    const rawCreator =
        (task as Ticket & { created_by?: unknown }).created_by ??
        (task as Ticket & { creator?: unknown }).creator ??
        (task as Ticket & { createdBy?: unknown }).createdBy;

    if (rawCreator && typeof rawCreator === 'object') {
        const creatorRecord = rawCreator as Record<string, unknown>;
        const creatorLabel =
            toNonEmptyString(creatorRecord.real_name) ||
            toNonEmptyString(creatorRecord.name) ||
            toNonEmptyString(creatorRecord.email) ||
            toNonEmptyString(creatorRecord.corporate_email);
        if (creatorLabel) {
            return creatorLabel;
        }

        const creatorIdentity =
            creatorRecord._id ?? creatorRecord.id ?? creatorRecord.user_id ?? creatorRecord.userId;
        const performerMatch = findPerformerByIdentity(performers, creatorIdentity);
        const performerName = getPerformerDisplayName(performerMatch);
        if (performerName) {
            return performerName;
        }

        const identityLabel = toLookupValue(creatorIdentity);
        if (identityLabel) {
            return identityLabel;
        }
    }

    const performerMatch = findPerformerByIdentity(performers, rawCreator);
    const performerName = getPerformerDisplayName(performerMatch);
    if (performerName) {
        return performerName;
    }

    const rawLabel = toLookupValue(rawCreator);
    if (rawLabel) {
        return rawLabel;
    }

    return 'N/A';
};

export const resolveTaskSourceInfo = (task: Ticket): TaskSourceInfo => {
    const embeddedSource = asRecord(task.source);
    const sourceData = asRecord(task.source_data);
    const telegramSource = asRecord(embeddedSource?.telegram) ?? asRecord(sourceData?.telegram);

    const explicitKind =
        normalizeSourceKind(task.source_kind) !== 'unknown'
            ? normalizeSourceKind(task.source_kind)
            : normalizeSourceKind(embeddedSource?.kind);
    const legacyKind = normalizeSourceKind(task.source);

    let kind: TaskSourceInfo['kind'] = explicitKind;
    if (kind === 'unknown' && legacyKind !== 'unknown') {
        kind = legacyKind;
    }
    if (kind === 'unknown' && toLookupValue(sourceData?.session_id)) {
        kind = 'voice_session';
    }
    if (kind === 'unknown') {
        kind = 'manual';
    }

    const sourceRef = toNonEmptyString(task.source_ref) || toLookupValue(embeddedSource?.voice_session_id);
    const externalRef = normalizeExternalLink(task.external_ref);
    const sourceRefLink = normalizeExternalLink(sourceRef);

    let link = externalRef || sourceRefLink;
    if (!link && kind === 'voice_session') {
        link = buildVoiceSessionLink(sourceRef || sourceData?.session_id);
    }
    if (!link && kind === 'telegram') {
        link = buildTelegramLink(telegramSource);
    }

    const reference = sourceRef || toLookupValue(sourceData?.session_id) || link || 'N/A';

    return {
        kind,
        label: SOURCE_KIND_LABELS[kind],
        reference,
        ...(link ? { link } : {}),
    };
};
