const constants = require("../constants");
const { PERMISSIONS } = require("../permissions/permissions-config");

const toStringSafe = (value) =>
  value !== null && value !== undefined ? String(value) : "";

function computeSessionAccess({ session, performer, userPermissions = [] }) {
  const canReadAll = userPermissions.includes(
    PERMISSIONS.VOICEBOT_SESSIONS.READ_ALL
  );
  const canReadOwn = userPermissions.includes(
    PERMISSIONS.VOICEBOT_SESSIONS.READ_OWN
  );
  const canUpdateSession = userPermissions.includes(
    PERMISSIONS.VOICEBOT_SESSIONS.UPDATE
  );

  let hasAccess = false;
  if (canReadAll) {
    hasAccess = true;
  } else if (canReadOwn) {
    hasAccess =
      (session?.chat_id &&
        performer?.telegram_id &&
        toStringSafe(session.chat_id) === toStringSafe(performer.telegram_id)) ||
      (session?.user_id &&
        performer?._id &&
        toStringSafe(session.user_id) === toStringSafe(performer._id));

    if (
      !hasAccess &&
      session?.project_id &&
      session?.access_level === constants.voice_bot_session_access.PUBLIC
    ) {
      if (
        Array.isArray(performer?.projects_access) &&
        performer.projects_access.length > 0
      ) {
        hasAccess = performer.projects_access.some(
          (projectId) => toStringSafe(projectId) === toStringSafe(session.project_id)
        );
      }
    }

    if (
      !hasAccess &&
      session?.access_level === constants.voice_bot_session_access.RESTRICTED
    ) {
      if (Array.isArray(session?.allowed_users) && session.allowed_users.length > 0) {
        hasAccess = session.allowed_users.some(
          (userId) => toStringSafe(userId) === toStringSafe(performer?._id)
        );
      }
    }
  }

  return {
    canReadAll,
    canReadOwn,
    canUpdateSession,
    hasAccess,
  };
}

module.exports = {
  computeSessionAccess,
};
