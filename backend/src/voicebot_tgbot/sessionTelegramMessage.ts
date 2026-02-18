import { ObjectId, type Db } from 'mongodb';
import { VOICEBOT_COLLECTIONS } from '../constants.js';

const FALLBACK_VALUE = '—';

export const getPublicInterfaceBase = (): string => {
  const rawBase = (process.env.VOICE_WEB_INTERFACE_URL || 'https://voice.stratospace.fun').replace(/\/+$/, '');
  if (rawBase.includes('176.124.201.53')) return 'https://voice.stratospace.fun';
  return rawBase;
};

export const buildSessionLink = (sessionId?: string | null): string => {
  const sid = String(sessionId || '').trim();
  if (!sid) return `${getPublicInterfaceBase()}/session`;
  return `${getPublicInterfaceBase()}/session/${sid}`;
};

const normalizeSessionId = (session: Record<string, unknown>): string => {
  const raw = session._id || session.session_id || session.id || '';
  return String(raw || '').trim();
};

const normalizeSessionName = (session: Record<string, unknown>): string => {
  const name = session.session_name;
  if (typeof name === 'string' && name.trim()) return name.trim();
  return FALLBACK_VALUE;
};

const resolveProjectName = async ({
  db,
  session,
}: {
  db: Db;
  session: Record<string, unknown>;
}): Promise<string> => {
  const projectIdRaw = session.project_id;
  if (!projectIdRaw) return FALLBACK_VALUE;

  let projectObjectId: ObjectId | null = null;
  if (projectIdRaw instanceof ObjectId) {
    projectObjectId = projectIdRaw;
  } else if (typeof projectIdRaw === 'string' && ObjectId.isValid(projectIdRaw)) {
    projectObjectId = new ObjectId(projectIdRaw);
  }
  if (!projectObjectId) return FALLBACK_VALUE;

  const project = await db.collection(VOICEBOT_COLLECTIONS.PROJECTS).findOne(
    { _id: projectObjectId },
    { projection: { name: 1, title: 1 } }
  ) as Record<string, unknown> | null;
  if (typeof project?.name === 'string' && project.name.trim()) return project.name.trim();
  if (typeof project?.title === 'string' && project.title.trim()) return project.title.trim();
  return FALLBACK_VALUE;
};

export const formatTelegramSessionEventMessage = async ({
  db,
  session,
  eventName,
}: {
  db: Db;
  session: Record<string, unknown>;
  eventName: string;
}): Promise<string> => {
  const sid = normalizeSessionId(session);
  const friendlyEvent = String(eventName || '').trim() || FALLBACK_VALUE;
  const sessionName = normalizeSessionName(session);
  const projectName = await resolveProjectName({ db, session });
  const url = buildSessionLink(sid);

  return [friendlyEvent, url, sessionName, projectName].join('\n');
};
