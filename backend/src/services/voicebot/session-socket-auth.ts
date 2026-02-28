import { VOICE_BOT_SESSION_ACCESS } from '../../constants.js';
import { PERMISSIONS } from '../../permissions/permissions-config.js';

const toStringSafe = (value: unknown): string =>
  value !== null && value !== undefined ? String(value) : '';

type SessionLike = {
  chat_id?: unknown;
  user_id?: unknown;
  project_id?: unknown;
  access_level?: string;
  allowed_users?: unknown[];
};

type PerformerLike = {
  _id?: unknown;
  telegram_id?: unknown;
  projects_access?: unknown[];
};

export function computeSessionAccess({
  session,
  performer,
  userPermissions = [],
}: {
  session: SessionLike;
  performer: PerformerLike;
  userPermissions?: string[];
}) {
  const canReadAll = userPermissions.includes(PERMISSIONS.VOICEBOT_SESSIONS.READ_ALL);
  const canReadOwn = userPermissions.includes(PERMISSIONS.VOICEBOT_SESSIONS.READ_OWN);
  const canUpdateSession = userPermissions.includes(PERMISSIONS.VOICEBOT_SESSIONS.UPDATE);

  let hasAccess = false;
  if (canReadAll) {
    hasAccess = true;
  } else if (canReadOwn) {
    const matchesChat = Boolean(
      session?.chat_id !== null &&
        session?.chat_id !== undefined &&
        performer?.telegram_id !== null &&
        performer?.telegram_id !== undefined &&
        toStringSafe(session.chat_id) === toStringSafe(performer.telegram_id)
    );
    const matchesOwner = Boolean(
      session?.user_id !== null &&
        session?.user_id !== undefined &&
        performer?._id !== null &&
        performer?._id !== undefined &&
        toStringSafe(session.user_id) === toStringSafe(performer._id)
    );
    hasAccess = matchesChat || matchesOwner;

    if (
      !hasAccess &&
      session?.project_id &&
      session?.access_level === VOICE_BOT_SESSION_ACCESS.PUBLIC &&
      Array.isArray(performer?.projects_access) &&
      performer.projects_access.length > 0
    ) {
      hasAccess = performer.projects_access.some(
        (projectId) => toStringSafe(projectId) === toStringSafe(session.project_id)
      );
    }

    if (
      !hasAccess &&
      session?.access_level === VOICE_BOT_SESSION_ACCESS.RESTRICTED &&
      Array.isArray(session?.allowed_users) &&
      session.allowed_users.length > 0
    ) {
      hasAccess = session.allowed_users.some(
        (userId) => toStringSafe(userId) === toStringSafe(performer?._id)
      );
    }
  }

  return {
    canReadAll,
    canReadOwn,
    canUpdateSession,
    hasAccess,
  };
}
