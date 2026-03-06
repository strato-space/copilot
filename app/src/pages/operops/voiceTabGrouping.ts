import { TASK_STATUSES } from '../../constants/crm';
import type { Ticket } from '../../types/crm';
import { CANONICAL_VOICE_SESSION_URL_BASE } from '../../utils/voiceSessionTaskSource';
import { resolveTaskProjectName, resolveTaskSourceInfo } from './taskPageUtils';

const VOICE_SESSION_ID_PATTERN = /^[a-fA-F0-9]{24}$/;

type VoiceSessionRef = {
  _id: string;
  session_name?: string;
  external_ref?: string;
  source_ref?: string;
  project?: {
    name?: string;
  };
};

type VoiceSessionLink = {
  session_id: string;
  session_name?: string;
  project_id?: string;
  created_at?: string;
  done_at?: string;
  role?: string;
};

export interface VoiceBacklogGroup {
  key: string;
  kind: 'session' | 'orphan';
  title: string;
  sourceReference: string;
  sessionId?: string;
  sessionLink?: string;
  sessionName?: string;
  projectNames: string[];
  possibleTaskCount: number;
  processedTaskCount: number;
  taskCount: number;
  lastUpdatedAt?: string;
  possibleTickets: Ticket[];
  processedTickets: Ticket[];
}

const toText = (value: unknown): string => {
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return '';
};

const asRecord = (value: unknown): Record<string, unknown> | null => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
};

const toLookupValue = (value: unknown): string => {
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  const record = asRecord(value);
  if (!record) return '';
  return toText(record.$oid) || toText(record._id) || toText(record.id);
};

const extractSessionIdFromRef = (value: string): string => {
  if (!value) return '';
  const match = value.match(/\/voice\/session\/([^/?#]+)/i);
  if (!match?.[1]) return '';
  try {
    return decodeURIComponent(match[1]).trim();
  } catch {
    return match[1].trim();
  }
};

const buildVoiceSessionLink = (sessionId: string): string =>
  `${CANONICAL_VOICE_SESSION_URL_BASE}/${encodeURIComponent(sessionId)}`;

const getVoiceSessionLinks = (ticket: Ticket): VoiceSessionLink[] => {
  const sourceDataRecord = asRecord(ticket.source_data);
  const voiceSessions = Array.isArray(sourceDataRecord?.voice_sessions)
    ? sourceDataRecord.voice_sessions
        .map((entry) => asRecord(entry))
        .filter((entry): entry is Record<string, unknown> => entry !== null)
        .map((entry) => ({
          session_id: toLookupValue(entry.session_id),
          ...(toText(entry.session_name) ? { session_name: toText(entry.session_name) } : {}),
          ...(toText(entry.project_id) ? { project_id: toText(entry.project_id) } : {}),
          ...(toText(entry.created_at) ? { created_at: toText(entry.created_at) } : {}),
          ...(toText(entry.done_at) ? { done_at: toText(entry.done_at) } : {}),
          ...(toText(entry.role) ? { role: toText(entry.role) } : {}),
        }))
        .filter((entry) => entry.session_id)
    : [];
  if (voiceSessions.length > 0) return voiceSessions;

  const directId =
    toLookupValue(sourceDataRecord?.session_id) ||
    toLookupValue(sourceDataRecord?.voice_session_id);
  if (directId) {
    return [
      {
        session_id: directId,
        ...(toText(sourceDataRecord?.session_name) ? { session_name: toText(sourceDataRecord?.session_name) } : {}),
      },
    ];
  }

  const sourceInfo = resolveTaskSourceInfo(ticket);
  const sourceRefId = extractSessionIdFromRef(sourceInfo.reference);
  if (sourceRefId) return [{ session_id: sourceRefId }];
  const sourceLinkId = extractSessionIdFromRef(sourceInfo.link || '');
  if (sourceLinkId) return [{ session_id: sourceLinkId }];
  if (VOICE_SESSION_ID_PATTERN.test(sourceInfo.reference)) return [{ session_id: sourceInfo.reference }];
  return [];
};

const resolvePrimaryVoiceSession = (
  ticket: Ticket,
  voiceSessions: VoiceSessionRef[]
): {
  kind: 'session' | 'orphan';
  sessionId?: string;
  sessionLink?: string;
  sessionName?: string;
  sourceReference: string;
} => {
  const linkedSessions = getVoiceSessionLinks(ticket);
  const primary = linkedSessions[0];
  if (!primary?.session_id) {
    return {
      kind: 'orphan',
      sourceReference: resolveTaskSourceInfo(ticket).reference || 'N/A',
    };
  }

  const linkedSession = voiceSessions.find((session) => toText(session._id) === primary.session_id);
  const sessionLink =
    toText(linkedSession?.external_ref) ||
    toText(linkedSession?.source_ref) ||
    buildVoiceSessionLink(primary.session_id);

  return {
    kind: 'session',
    sessionId: primary.session_id,
    sessionLink,
    ...((primary.session_name || toText(linkedSession?.session_name))
      ? { sessionName: primary.session_name || toText(linkedSession?.session_name) }
      : {}),
    sourceReference: primary.session_id,
  };
};

const getTicketTimestampMs = (ticket: Ticket): number => {
  const source = toText(ticket.updated_at) || toText(ticket.created_at);
  if (!source) return 0;
  const parsed = Date.parse(source);
  return Number.isFinite(parsed) ? parsed : 0;
};

const isArchiveLike = (ticket: Ticket): boolean => {
  const status = toText(ticket.task_status);
  return status === TASK_STATUSES.ARCHIVE || status === 'ARCHIVE';
};

const isPossibleTask = (ticket: Ticket): boolean => {
  const taskStatus = toText(ticket.task_status);
  return taskStatus === TASK_STATUSES.NEW_0 || taskStatus === 'NEW_0';
};

export const isVoiceBacklogTask = (ticket: Ticket): boolean => isPossibleTask(ticket);

type MutableVoiceBacklogGroup = VoiceBacklogGroup & {
  lastUpdatedAtMs: number;
};

export const buildVoiceBacklogGroups = ({
  tickets,
  voiceSessions,
  projectsData = [],
}: {
  tickets: Ticket[];
  voiceSessions: VoiceSessionRef[];
  projectsData?: Array<{ _id: string; name: string }>;
}): VoiceBacklogGroup[] => {
  const relevantTickets = tickets.filter((ticket) => !isArchiveLike(ticket));
  const groups = new Map<string, MutableVoiceBacklogGroup>();

  const ensureGroup = (ticket: Ticket): MutableVoiceBacklogGroup => {
    const primary = resolvePrimaryVoiceSession(ticket, voiceSessions);
    const key = primary.kind === 'session' && primary.sessionId ? `session:${primary.sessionId}` : 'orphan';
    const projectName = resolveTaskProjectName(ticket, projectsData);
    const ticketTimestampMs = getTicketTimestampMs(ticket);
    const ticketUpdatedAt = toText(ticket.updated_at) || toText(ticket.created_at);

    const existing = groups.get(key);
    if (existing) {
      if (projectName) existing.projectNames = Array.from(new Set([...existing.projectNames, projectName]));
      if (ticketTimestampMs > existing.lastUpdatedAtMs) {
        existing.lastUpdatedAtMs = ticketTimestampMs;
        existing.lastUpdatedAt = ticketUpdatedAt;
      }
      return existing;
    }

    const created: MutableVoiceBacklogGroup = {
      key,
      kind: primary.kind,
      title: primary.kind === 'session'
        ? (primary.sessionName || `Voice session ${primary.sessionId}`)
        : 'Orphan possible tasks',
      sourceReference: primary.sourceReference,
      ...(primary.sessionId ? { sessionId: primary.sessionId } : {}),
      ...(primary.sessionLink ? { sessionLink: primary.sessionLink } : {}),
      ...(primary.sessionName ? { sessionName: primary.sessionName } : {}),
      projectNames: projectName ? [projectName] : [],
      possibleTaskCount: 0,
      processedTaskCount: 0,
      taskCount: 0,
      ...(ticketUpdatedAt ? { lastUpdatedAt: ticketUpdatedAt } : {}),
      lastUpdatedAtMs: ticketTimestampMs,
      possibleTickets: [],
      processedTickets: [],
    };
    groups.set(key, created);
    return created;
  };

  relevantTickets.forEach((ticket) => {
    const group = ensureGroup(ticket);
    if (isPossibleTask(ticket)) {
      group.possibleTickets.push(ticket);
      group.possibleTaskCount += 1;
    } else if (group.kind === 'session') {
      group.processedTickets.push(ticket);
      group.processedTaskCount += 1;
    }
    group.taskCount = group.possibleTaskCount + group.processedTaskCount;
  });

  return Array.from(groups.values())
    .filter((group) => group.possibleTaskCount > 0)
    .sort((left, right) => {
      if (left.kind !== right.kind) return left.kind === 'orphan' ? -1 : 1;
      if (left.lastUpdatedAtMs !== right.lastUpdatedAtMs) return right.lastUpdatedAtMs - left.lastUpdatedAtMs;
      return left.title.localeCompare(right.title);
    })
    .map(({ lastUpdatedAtMs: _lastUpdatedAtMs, ...group }) => group);
};
